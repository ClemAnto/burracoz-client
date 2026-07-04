import { Injectable, computed, effect, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { DeckItem } from './cards';
import { LocalStorage } from './local-storage';
import {
	CardRef,
	DealResult,
	Round,
	RoundPhase,
	RoundPlayer,
	RoundSavedState,
	RoundScore,
	RoundTeam,
} from './round';

// ============================================================
// TIPI DI STATO E EVENTI
// ============================================================

export enum GamePhase {
	Idle = 'idle',
	Playing = 'playing',
	Ended = 'ended',
}

/** Risultato di una singola mano completata. */
export type HandResult = {
	handIndex: number;
	winnerTeam: RoundTeam;
	winnerPlayer: RoundPlayer;
	score: RoundScore;
};

/** Punteggio cumulato sull'intera partita (somma di tutte le mani). */
export type GameTotalScore = {
	ours: number;
	opponents: number;
};

type GameSavedState = {
	gamePhase: GamePhase;
	handIndex: number;
	handHistory: HandResult[];
	round: RoundSavedState;
};

export enum GameEventType {
	GameStarted = 'game_started',
	HandStarted = 'hand_started',
	HandEnded = 'hand_ended',
	GameEnded = 'game_ended',
}

/** Eventi emessi a livello di partita. */
export type GameEvent =
	| { type: GameEventType.GameStarted }
	| { type: GameEventType.HandStarted; handIndex: number }
	| { type: GameEventType.HandEnded; result: HandResult }
	| { type: GameEventType.GameEnded; winner: RoundTeam; totalScore: GameTotalScore };

// ============================================================
// SERVIZIO GAME
// ============================================================

/**
 * Orchestratore della partita di Burraco.
 *
 * Gestisce il ciclo di vita multi-mano (Game → Round → Round → …),
 * accumula i punteggi e funge da unico punto d'accesso per la UI.
 *
 * Per lo stato della mano corrente (carte, turno, ecc.) ri-espone i
 * signal del servizio Round tramite getter: la UI importa solo Game.
 *
 * Flusso principale:
 *  1. startGame()                     → avvia la partita e la prima mano
 *  2. drawFromStock() | takeDiscardPile()  → pesca o raccoglie
 *  3. openMeld() / attachToMeld()     → cala o appoggia (0..N volte)
 *  4. discard()                       → scarta e passa il turno
 *     - se il giocatore rimane senza carte → pozzetto automatico
 *     - se ha pozzetto + burraco → chiude la mano
 *  5. startNextHand()                 → avvia la mano successiva
 */
@Injectable({
	providedIn: 'root',
})
export class Game {
	// ----------------------------------------------------------
	// Stato del game (livello partita, multi-mano)
	// ----------------------------------------------------------

	/** Fase della partita: idle → playing → ended. */
	readonly phase = signal<GamePhase>(GamePhase.Idle);

	/** Numero progressivo della mano corrente (0 = nessuna mano iniziata). */
	readonly handIndex = signal<number>(0);

	/** Storico dei risultati di tutte le mani già completate. */
	readonly handHistory = signal<HandResult[]>([]);

	/** Punteggio totale cumulato su tutte le mani (computed). */
	readonly totalScore = computed<GameTotalScore>(() =>
		this.handHistory().reduce(
			(acc, hand) => ({
				ours: acc.ours + hand.score.ours.total,
				opponents: acc.opponents + hand.score.opponents.total,
			}),
			{ ours: 0, opponents: 0 },
		),
	);

	/** Soglia punti che determina la fine della partita (Art. 18). Configurabile. */
	readonly targetScore = signal<number>(2005);

	/** Squadra vincitrice della partita (null finché la partita non è finita). */
	readonly gameWinner = signal<RoundTeam | null>(null);

	/** True quando la partita è terminata (una squadra ha superato la soglia). */
	readonly isGameEnded = computed(() => this.phase() === GamePhase.Ended);

	/**
	 * Quando true, la chiusura di una mano NON viene registrata nello storico:
	 * usato durante il replay/player delle mosse per non sporcare la partita reale.
	 */
	suspendHistory = false;

	// ----------------------------------------------------------
	// Passthrough dei signal del Round (livello mano corrente)
	// Esposti tramite getter per evitare problemi di inizializzazione
	// e permettere alla UI di fare binding senza importare Round.
	// ----------------------------------------------------------

	/** Fase della mano corrente: idle | in_progress | closed. */
	get roundPhase() {
		return this.round.phase;
	}

	/** Il giocatore che deve agire in questo momento. */
	get currentPlayer() {
		return this.round.currentPlayer;
	}

	/** Passo del turno: draw_or_collect | play_and_discard. */
	get turnStep() {
		return this.round.turnStep;
	}

	/** La squadra del giocatore corrente (computed). */
	get currentTeam() {
		return this.round.currentTeam;
	}

	/** Numero di turno dall'inizio della mano. */
	get turnIndex() {
		return this.round.turnIndex;
	}

	/** Il mazziere estratto a sorte per questa mano. */
	get dealer() {
		return this.round.dealer;
	}

	/** Carte in mano a ciascun giocatore { east, west, north, south }. */
	get hands() {
		return this.round.hands;
	}

	/** Lo stock (carte rimanenti da pescare). */
	get drawPile() {
		return this.round.drawPile;
	}

	/** Il monte degli scarti. */
	get discardPile() {
		return this.round.discardPile;
	}

	/** I pozzetti ancora disponibili (1 per squadra, assegnato al primo esaurimento). */
	get pots() {
		return this.round.pots;
	}

	/** I giochi calati a terra per ciascuna squadra { ours, opponents }. */
	get melds() {
		return this.round.melds;
	}

	/** Indica se un giocatore specifico ha già preso il suo pozzetto. */
	get playerHasTakenPot() {
		return this.round.playerHasTakenPot;
	}

	/** Indica se una squadra ha almeno un burraco (≥7 carte) a terra (computed). */
	get teamHasBurraco() {
		return this.round.teamHasBurraco;
	}

	/** Classifica un gioco come burraco (pulito/semipulito/sporco) o null. */
	classifyBurraco(meld: DeckItem[]) {
		return this.round.classifyBurraco(meld);
	}

	/** Ultimo errore generato da un'azione non valida (null se nessun errore). */
	get lastError() {
		return this.round.lastError;
	}

	/** True se ci sono giocate annullabili nel turno corrente. */
	get canUndoTurn() {
		return this.round.canUndoTurn;
	}

	/** Giocatore che ha chiuso l'ultima mano. */
	get winnerPlayer() {
		return this.round.winnerPlayer;
	}

	/** Squadra che ha vinto l'ultima mano. */
	get winnerTeam() {
		return this.round.winnerTeam;
	}

	/** Punteggio dell'ultima mano (disponibile dopo la chiusura). */
	get handScore() {
		return this.round.score;
	}

	// ----------------------------------------------------------
	// Stream di eventi
	// ----------------------------------------------------------

	/** Emette eventi a livello di partita (game_started, hand_started, ecc.). */
	readonly gameEvents = new Subject<GameEvent>();

	/**
	 * Ri-espone lo stream di eventi del Round corrente.
	 * Getter per evitare riferimento a `this.round` prima dell'inizializzazione.
	 */
	get roundEvents() {
		return this.round.events;
	}

	/** Stream degli eventi di gioco fini (una emissione per azione del turno). */
	get gameplayEvents() {
		return this.round.gameplayEvents;
	}

	// ============================================================
	// COSTRUTTORE
	// ============================================================

	private static readonly STORAGE_KEY = 'burracoz_v1';

	constructor(
		private readonly round: Round,
		private readonly storage: LocalStorage,
	) {
		// Intercetta la chiusura del round per registrare il risultato
		// e aggiornare lo stato del game.
		this.round.events.subscribe((event) => {
			if (event.type === 'round_closed') {
				this.onRoundClosed(event.winnerPlayer, event.winnerTeam, event.score);
			}
		});

		this.loadFromStorage();

		if (this.round.phase() === RoundPhase.Idle) {
			this.round.prepareDeck();
		}

		effect(() => {
			const state: GameSavedState = {
				gamePhase: this.phase(),
				handIndex: this.handIndex(),
				handHistory: this.handHistory(),
				round: this.round.getState(),
			};
			// Non persistere gli stati intermedi di replay/player.
			if (this.suspendHistory) return;
			this.storage.set(Game.STORAGE_KEY, state);
		});
	}

	// ============================================================
	// AZIONI DEL GAME
	// ============================================================

	/**
	 * Avvia una nuova partita: resetta lo storico, poi inizia la prima mano.
	 * Corrisponde al pulsante START nella UI.
	 */
	/**
	 * Resetta la partita e torna alla schermata iniziale (mazzo visibile, nessuna carta distribuita).
	 */
	async resetGame() {
		this.handHistory.set([]);
		this.handIndex.set(0);
		this.gameWinner.set(null);
		this.phase.set(GamePhase.Idle);
		await this.round.prepareDeck();
	}

	/**
	 * Avvia la partita: imposta la fase e segnala l'inizio.
	 * Non distribuisce le carte: la Board chiama prepareHand() + commitHand()
	 * per gestire l'animazione di distribuzione.
	 */
	startGame(): void {
		// Partita nuova: azzera storico e contatore così una "NUOVA PARTITA"
		// dopo la fine riparte pulita (all'avvio iniziale sono già vuoti).
		this.handHistory.set([]);
		this.handIndex.set(0);
		this.gameWinner.set(null);
		this.phase.set(GamePhase.Playing);
		this.gameEvents.next({ type: GameEventType.GameStarted });
	}

	/**
	 * Prepara la distribuzione di una nuova mano: incrementa il contatore
	 * e calcola la distribuzione senza aggiornare i signal del Round.
	 * La Board usa il DealResult per animare la distribuzione, poi chiama commitHand().
	 *
	 * Dalla seconda mano in poi il mazzo va ricostituito e rimescolato: a fine
	 * mano le carte sono sparse tra mani, giochi, pozzetti e scarti, e nel tallone
	 * ne restano troppo poche per una nuova distribuzione. `prepareDeck()` le
	 * raccoglie tutte e le rimescola. Alla prima mano (round in Idle) il mazzo è
	 * già pronto e rimescolato, quindi si salta.
	 */
	async prepareHand(): Promise<DealResult> {
		if (this.round.phase() !== RoundPhase.Idle) {
			await this.round.prepareDeck();
		}
		this.handIndex.update((n) => n + 1);
		return this.round.prepareDeal();
	}

	/**
	 * Imposta i signal del Round dalla distribuzione preparata e segnala l'inizio mano.
	 * Da chiamare dopo che la Board ha completato l'animazione di distribuzione.
	 */
	commitHand(deal: DealResult): void {
		this.round.commitDeal(deal);
		this.gameEvents.next({ type: GameEventType.HandStarted, handIndex: this.handIndex() });
	}

	/**
	 * Avvia la mano successiva dopo la chiusura (senza animazione).
	 * Non fa nulla se la partita non è in corso.
	 */
	async startNextHand(): Promise<void> {
		if (this.phase() !== GamePhase.Playing) return;
		const deal = await this.prepareHand();
		this.commitHand(deal);
	}

	// ============================================================
	// AZIONI DEL TURNO (delegate al Round)
	// ============================================================

	/**
	 * Pesca una carta dallo stock.
	 * Valido solo nella fase draw_or_collect del turno.
	 * Restituisce false (e imposta lastError) se l'azione non è consentita.
	 */
	drawFromStock(): boolean {
		return this.round.drawFromStock();
	}

	/**
	 * Raccoglie l'intero monte degli scarti.
	 * Valido solo nella fase draw_or_collect del turno.
	 * Restituisce false (e imposta lastError) se l'azione non è consentita.
	 */
	takeDiscardPile(): boolean {
		return this.round.takeDiscardPile();
	}

	/**
	 * Cala un nuovo gioco (combinazione o sequenza) con le carte indicate.
	 * Valido nella fase play_and_discard. Richiede almeno 3 carte.
	 *
	 * Se dopo la calata il giocatore rimane senza carte, il pozzetto
	 * viene preso automaticamente ("pozzetto diretto").
	 *
	 * @param cards le carte da calare, es. ['7♥️', '7♦️', '7♠️']
	 */
	openMeld(cards: CardRef[]): boolean {
		return this.round.openMeld(cards);
	}

	/**
	 * Aggiunge carte a un gioco già calato dalla propria squadra ("legare").
	 * Valido nella fase play_and_discard.
	 *
	 * @param meldIndex indice del gioco a terra nella lista della squadra corrente
	 * @param cards le carte da aggiungere al gioco
	 */
	attachToMeld(meldIndex: number, cards: CardRef[]): boolean {
		return this.round.attachToMeld(meldIndex, cards);
	}

	/**
	 * Scarta una carta, terminando il turno corrente.
	 *
	 * Gestisce automaticamente i casi speciali:
	 * - se la mano è vuota e il pozzetto non è ancora stato preso → presa del pozzetto
	 * - se la mano è vuota, il pozzetto è stato preso e la squadra ha un burraco → chiusura
	 * - altrimenti → passa il turno al giocatore successivo
	 *
	 * Nota (Art. 14 regolamento): non è possibile chiudere scartando una matta.
	 *
	 * @param card la carta da scartare
	 */
	discard(card: CardRef): boolean {
		return this.round.discard(card);
	}

	/**
	 * Annulla tutte le giocate del turno corrente, ripristinando
	 * mano e giochi a terra allo stato di inizio turno (dopo la pesca).
	 */
	undoTurn(): boolean {
		return this.round.undoTurn();
	}

	// ============================================================
	// PRIVATO
	// ============================================================

	private loadFromStorage(): void {
		const state = this.storage.get<GameSavedState>(Game.STORAGE_KEY);
		if (!state?.round) return;
		this.phase.set(state.gamePhase);
		this.handIndex.set(state.handIndex);
		this.handHistory.set(state.handHistory ?? []);
		this.round.restoreState(state.round);
	}

	/**
	 * Chiamato quando Round segnala la chiusura della mano (round_closed).
	 * Aggiunge il risultato allo storico del game.
	 *
	 * Estensione futura: qui si può implementare la logica di fine partita
	 * (es. dopo N mani, o al raggiungimento di una soglia di punteggio).
	 */
	private onRoundClosed(
		winnerPlayer: RoundPlayer,
		winnerTeam: RoundTeam,
		score: RoundScore,
	): void {
		// Durante il replay/player non si registra la mano nella partita reale.
		if (this.suspendHistory) return;

		const result: HandResult = {
			handIndex: this.handIndex(),
			winnerPlayer,
			winnerTeam,
			score,
		};

		this.handHistory.update((h) => h.concat(result));
		this.gameEvents.next({ type: GameEventType.HandEnded, result });

		this.maybeEndGame();
	}

	/**
	 * Termina la partita se una squadra ha raggiunto la soglia (Art. 18).
	 * A parità di punteggio sopra soglia si gioca un'altra mano (nessun vincitore).
	 */
	private maybeEndGame(): void {
		const totals = this.totalScore();
		const target = this.targetScore();
		if (totals.ours < target && totals.opponents < target) return;
		if (totals.ours === totals.opponents) return;

		const winner: RoundTeam = totals.ours > totals.opponents ? 'ours' : 'opponents';
		this.gameWinner.set(winner);
		this.phase.set(GamePhase.Ended);
		this.gameEvents.next({ type: GameEventType.GameEnded, winner, totalScore: totals });
	}
}
