import { Injectable, computed, effect, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Round, RoundPlayer, RoundSavedState, RoundScore, RoundTeam } from './round';

// ============================================================
// TIPI DI STATO E EVENTI
// ============================================================

/** Fase della partita (multi-mano). */
export type GamePhase = 'idle' | 'playing' | 'ended';

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

/** Eventi emessi a livello di partita. */
export type GameEvent =
	| { type: 'game_started' }
	| { type: 'hand_started'; handIndex: number }
	| { type: 'hand_ended'; result: HandResult }
	| { type: 'game_ended'; winner: RoundTeam; totalScore: GameTotalScore };

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
 *  2. drawFromTallone() | takeDiscardPile()  → pesca o raccoglie
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
	readonly phase = signal<GamePhase>('idle');

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

	// ----------------------------------------------------------
	// Passthrough dei signal del Round (livello mano corrente)
	// Esposti tramite getter per evitare problemi di inizializzazione
	// e permettere alla UI di fare binding senza importare Round.
	// ----------------------------------------------------------

	/** Fase della mano corrente: idle | in_progress | closed. */
	get roundPhase() { return this.round.phase; }

	/** Il giocatore che deve agire in questo momento. */
	get currentPlayer() { return this.round.currentPlayer; }

	/** Passo del turno: draw_or_collect | play_and_discard. */
	get turnStep() { return this.round.turnStep; }

	/** La squadra del giocatore corrente (computed). */
	get currentTeam() { return this.round.currentTeam; }

	/** Numero di turno dall'inizio della mano. */
	get turnIndex() { return this.round.turnIndex; }

	/** Il mazziere estratto a sorte per questa mano. */
	get dealer() { return this.round.dealer; }

	/** Carte in mano a ciascun giocatore { east, west, north, sud }. */
	get hands() { return this.round.hands; }

	/** Il tallone (carte rimanenti da pescare). */
	get drawPile() { return this.round.drawPile; }

	/** Il monte degli scarti. */
	get discardPile() { return this.round.discardPile; }

	/** I pozzetti ancora disponibili (1 per squadra, assegnato al primo esaurimento). */
	get pozzetti() { return this.round.pozzetti; }

	/** I giochi calati a terra per ciascuna squadra { ours, opponents }. */
	get melds() { return this.round.melds; }

	/** Indica se un giocatore specifico ha già preso il suo pozzetto. */
	get playerHasTakenPozzetto() { return this.round.playerHasTakenPozzetto; }

	/** Indica se una squadra ha almeno un burraco (≥7 carte) a terra (computed). */
	get teamHasBurraco() { return this.round.teamHasBurraco; }

	/** Ultimo errore generato da un'azione non valida (null se nessun errore). */
	get lastError() { return this.round.lastError; }

	/** Giocatore che ha chiuso l'ultima mano. */
	get winnerPlayer() { return this.round.winnerPlayer; }

	/** Squadra che ha vinto l'ultima mano. */
	get winnerTeam() { return this.round.winnerTeam; }

	/** Punteggio dell'ultima mano (disponibile dopo la chiusura). */
	get handScore() { return this.round.score; }

	// ----------------------------------------------------------
	// Stream di eventi
	// ----------------------------------------------------------

	/** Emette eventi a livello di partita (game_started, hand_started, ecc.). */
	private readonly gameEventsSubject = new Subject<GameEvent>();
	readonly gameEvents = this.gameEventsSubject.asObservable();

	/**
	 * Ri-espone lo stream di eventi del Round corrente.
	 * Getter per evitare riferimento a `this.round` prima dell'inizializzazione.
	 */
	get roundEvents() { return this.round.events$; }

	// ============================================================
	// COSTRUTTORE
	// ============================================================

	private static readonly STORAGE_KEY = 'burracoz_v1';

	constructor(private readonly round: Round) {
		// Intercetta la chiusura del round per registrare il risultato
		// e aggiornare lo stato del game.
		this.round.events$.subscribe((event) => {
			if (event.type === 'round_closed') {
				this.onRoundClosed(event.winnerPlayer, event.winnerTeam, event.score);
			}
		});

		this.loadFromStorage();

		effect(() => {
			const state: GameSavedState = {
				gamePhase: this.phase(),
				handIndex: this.handIndex(),
				handHistory: this.handHistory(),
				round: this.round.getState(),
			};
			try {
				localStorage.setItem(Game.STORAGE_KEY, JSON.stringify(state));
			} catch { /* quota exceeded o SSR */ }
		});
	}

	// ============================================================
	// AZIONI DEL GAME
	// ============================================================

	/**
	 * Avvia una nuova partita: resetta lo storico, poi inizia la prima mano.
	 * Corrisponde al pulsante START nella UI.
	 */
	startGame(): void {
		this.handHistory.set([]);
		this.handIndex.set(0);
		this.phase.set('playing');
		this.gameEventsSubject.next({ type: 'game_started' });
		this.startHand();
	}

	/**
	 * Avvia la mano successiva dopo la chiusura di quella corrente.
	 * Non fa nulla se la partita non è in corso.
	 */
	startNextHand(): void {
		if (this.phase() !== 'playing') return;
		this.startHand();
	}

	// ============================================================
	// AZIONI DEL TURNO (delegate al Round)
	// ============================================================

	/**
	 * Pesca una carta dal tallone.
	 * Valido solo nella fase draw_or_collect del turno.
	 * Restituisce false (e imposta lastError) se l'azione non è consentita.
	 */
	drawFromTallone(): boolean {
		return this.round.drawFromTallone();
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
	openMeld(cards: string[]): boolean {
		return this.round.openMeld(cards);
	}

	/**
	 * Aggiunge carte a un gioco già calato dalla propria squadra ("legare").
	 * Valido nella fase play_and_discard.
	 *
	 * @param meldIndex indice del gioco a terra nella lista della squadra corrente
	 * @param cards le carte da aggiungere al gioco
	 */
	attachToMeld(meldIndex: number, cards: string[]): boolean {
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
	discard(card: string): boolean {
		return this.round.discard(card);
	}

	// ============================================================
	// PRIVATO
	// ============================================================

	/**
	 * Incrementa il contatore delle mani e delega a Round la logica di setup:
	 * mischia il mazzo doppio (108 carte), estrae il dealer, distribuisce
	 * 11 carte per giocatore, crea i 2 pozzetti da 11 carte e scopre
	 * la prima carta del monte scarti.
	 */
	private startHand(): void {
		this.handIndex.update((n) => n + 1);
		this.round.startHand();
		this.gameEventsSubject.next({
			type: 'hand_started',
			handIndex: this.handIndex(),
		});
	}

	private loadFromStorage(): void {
		try {
			const json = localStorage.getItem(Game.STORAGE_KEY);
			if (!json) return;
			const state: GameSavedState = JSON.parse(json);
			if (!state?.round) return;
			this.phase.set(state.gamePhase);
			this.handIndex.set(state.handIndex);
			this.handHistory.set(state.handHistory ?? []);
			this.round.restoreState(state.round);
		} catch { /* JSON malformato o storage non disponibile */ }
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
		const result: HandResult = {
			handIndex: this.handIndex(),
			winnerPlayer,
			winnerTeam,
			score,
		};

		this.handHistory.update((h) => h.concat(result));
		this.gameEventsSubject.next({ type: 'hand_ended', result });

		// TODO futuro: confrontare totalScore con la soglia di fine partita
		// e chiamare this.endGame() se la partita è terminata.
	}
}
