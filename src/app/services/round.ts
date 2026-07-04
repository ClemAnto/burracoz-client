import { Injectable, computed, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { DeckItem, DeckItems, STARTER_DECK } from './cards';
import { Rules, isNatural2, isWild } from './rules';

export enum PlayerSide {
	North = 'north',
	East = 'east',
	South = 'south',
	West = 'west',
}
export type RoundPlayer = PlayerSide;
export type RoundTeam = 'opponents' | 'ours';

/** Tipo di evento di gioco fine, emesso a ogni azione del turno. */
export enum RoundEventType {
	Draw = 'draw',
	TakeDiscard = 'take_discard',
	Open = 'open',
	Attach = 'attach',
	Discard = 'discard',
	TakePot = 'take_pot',
	Close = 'close',
}

/**
 * Evento di gioco broadcastato a ogni azione: alimenta IA (observe/comment),
 * log e strumenti di debug. Contiene solo informazione osservabile al tavolo
 * (la pesca dal tallone NON espone la carta).
 */
export type RoundGameplayEvent = {
	type: RoundEventType;
	player: RoundPlayer;
	cards?: DeckItem[];
	meldIndex?: number;
};

export enum RoundPhase {
	Idle = 'idle',
	InProgress = 'in_progress',
	Closed = 'closed',
}

export enum RoundTurnStep {
	DrawOrCollect = 'draw_or_collect',
	PlayAndDiscard = 'play_and_discard',
}

type SavedCard = { tag: string; faceDown: boolean };

export type RoundSavedState = {
	phase: RoundPhase;
	dealer: RoundPlayer | null;
	currentPlayer: RoundPlayer | null;
	turnStep: RoundTurnStep;
	turnIndex: number;
	initialized: boolean;
	hands: Record<RoundPlayer, SavedCard[]>;
	drawPile: SavedCard[];
	discardPile: SavedCard[];
	pots: SavedCard[][];
	melds: Record<RoundTeam, SavedCard[][]>;
	winnerPlayer: RoundPlayer | null;
	winnerTeam: RoundTeam | null;
	score: RoundScore | null;
	playerHasTakenPot: Record<RoundPlayer, boolean>;
};

export type RoundScoreBreakdown = {
	openMeldPoints: number;
	burracoBonus: number;
	closureBonus: number;
	remainingHandPenalty: number;
	potNotTakenPenalty: number;
	potTakenNotPlayedPenalty: number;
	penalizedCardsPenalty: number;
};

export type RoundTeamScore = {
	positive: number;
	negative: number;
	total: number;
	breakdown: RoundScoreBreakdown;
};

export type RoundScore = Record<RoundTeam, RoundTeamScore>;

/**
 * Risultato del calcolo di distribuzione, calcolato prima che i signal vengano aggiornati.
 * Passato alla Board per l'animazione, poi a commitDeal() per aggiornare lo stato.
 */
export type DealResult = {
	dealer: RoundPlayer;
	firstPlayer: RoundPlayer;
	hands: Record<RoundPlayer, DeckItem[]>;
	pots: [DeckItem[], DeckItem[]];
	discard: DeckItem | undefined;
	remainingDeck: DeckItem[];
};

/**
 * Riferimento a una carta di mano: l'istanza stessa (identità certa via uid)
 * o il solo tag. ATTENZIONE: nel mazzo doppio ogni tag esiste in DUE copie,
 * quindi il tag da solo NON identifica univocamente una carta — quando
 * possibile passare sempre l'istanza DeckItem.
 */
export type CardRef = DeckItem | string;

/** Log delle fasi di gioco (distribuzione, turni, azioni). */
const GAME_LOG = true;
function glog(...args: unknown[]): void {
	if (GAME_LOG) console.log('%c[burracoz]', 'color:#4ade80;font-weight:bold', ...args);
}

const PLAYER_ORDER: PlayerSide[] = [
	PlayerSide.North,
	PlayerSide.East,
	PlayerSide.South,
	PlayerSide.West,
];

export const TEAM_BY_PLAYER: Record<PlayerSide, RoundTeam> = {
	[PlayerSide.East]: 'opponents',
	[PlayerSide.West]: 'opponents',
	[PlayerSide.North]: 'ours',
	[PlayerSide.South]: 'ours',
};

@Injectable({
	providedIn: 'root',
})
export class Round {
	phase = signal<RoundPhase>(RoundPhase.Idle);
	dealer = signal<RoundPlayer | null>(null);
	currentPlayer = signal<RoundPlayer | null>(null);
	turnStep = signal<RoundTurnStep>(RoundTurnStep.DrawOrCollect);
	turnIndex = signal<number>(0);

	hands = signal<Record<RoundPlayer, DeckItem[]>>(createEmptyHands());
	drawPile = signal<DeckItem[]>([]);
	discardPile = signal<DeckItem[]>([]);
	pots = signal<DeckItem[][]>([]);
	melds = signal<Record<RoundTeam, DeckItem[][]>>(createEmptyMelds());
	initialized = signal<boolean>(false);
	// TODO: placeholder — da implementare
	winnerPlayer = signal<RoundPlayer | null>(null);
	winnerTeam = signal<RoundTeam | null>(null);
	score = signal<RoundScore | null>(null);
	lastError = signal<string | null>(null);
	playerHasTakenPot = signal<Record<PlayerSide, boolean>>(createEmptyPotFlags());
	teamHasBurraco = computed(() => {
		const melds = this.melds();
		const hasBurraco = (teamMelds: DeckItem[][]) => teamMelds.some((m) => m.length >= 7);
		return { ours: hasBurraco(melds.ours), opponents: hasBurraco(melds.opponents) };
	});
	canUndoTurn = computed(() => false);

	// TODO: placeholder — da implementare
	readonly events = new Subject<{
		type: 'round_closed';
		winnerPlayer: RoundPlayer;
		winnerTeam: RoundTeam;
		score: RoundScore;
	}>();

	/** Stream degli eventi di gioco fini (una emissione per azione). */
	readonly gameplayEvents = new Subject<RoundGameplayEvent>();

	currentTeam = computed<RoundTeam | null>(() => {
		const player = this.currentPlayer();
		return player ? TEAM_BY_PLAYER[player] : null;
	});

	async prepareDeck() {
		if (this.initialized()) {
			const h = this.hands();
			const draws = this.shuffleDeck([
				...this.drawPile(),
				...this.discardPile(),
				...this.pots().flat(),
				...this.melds().ours.flat(),
				...this.melds().opponents.flat(),
				...h.north,
				...h.east,
				...h.south,
				...h.west,
			]);
			// Stato fisico: tutte le carte tornano coperte nel tallone.
			draws.forEach((c) => (c.faceDown = true));
			this.discardPile.set([]);
			this.pots.set([]);
			this.melds.set(createEmptyMelds());
			this.drawPile.set(draws);
			this.hands.set(createEmptyHands());
			glog(`Mazzo ricostituito e rimescolato (${draws.length} carte)`);
			await sleep(10);
		} else {
			//DeckItem.uid = 1;
			this.initialized.set(true);
			const deck = this.shuffleDeck(
				[...STARTER_DECK, ...STARTER_DECK].map((tag) => new DeckItem(tag, true)),
			);
			this.drawPile.set(deck);
			this.discardPile.set([]);
			this.pots.set([]);
			this.hands.set(createEmptyHands());
			this.melds.set(createEmptyMelds());
			glog(`Mazzo iniziale creato e mescolato (${deck.length} carte)`);
		}

		this.phase.set(RoundPhase.Idle);
		this.dealer.set(null);
		this.currentPlayer.set(null);
		this.turnStep.set(RoundTurnStep.DrawOrCollect);
		this.turnIndex.set(0);
		this.resetHandOutcome();
	}

	/** Azzera lo stato di esito della mano (pozzetti presi, vincitore, punteggio). */
	private resetHandOutcome(): void {
		this.playerHasTakenPot.set(createEmptyPotFlags());
		this.winnerPlayer.set(null);
		this.winnerTeam.set(null);
		this.score.set(null);
	}

	startHand(): void {
		this.commitDeal(this.prepareDeal());
	}

	/** Calcola la distribuzione dal drawPile corrente senza aggiornare i signal. */
	prepareDeal(): DealResult {
		const deck = this.drawPile().slice();
		const dealer = this.pickRandomPlayer();
		const firstPlayer = this.nextPlayer(dealer);
		const order = this.buildDistributionOrder(firstPlayer);
		const hands = createEmptyHands();

		for (const player of order) {
			hands[player] = deck.splice(0, 11);
		}

		const [firstPot, secondPot] = this.createPots(deck);
		const discard = deck.pop();
		// Stato fisico: la prima carta degli scarti viene girata a faccia in su.
		if (discard) discard.faceDown = false;

		return {
			dealer,
			firstPlayer,
			hands,
			pots: [firstPot, secondPot],
			discard,
			remainingDeck: deck,
		};
	}

	/** Imposta i signal del Round dalla distribuzione precalcolata. */
	commitDeal(deal: DealResult): void {
		glog(
			`Distribuzione completata — mazziere ${deal.dealer}, inizia ${deal.firstPlayer}`,
			`(tallone: ${deal.remainingDeck.length} carte)`,
		);
		this.phase.set(RoundPhase.InProgress);
		this.dealer.set(deal.dealer);
		this.currentPlayer.set(deal.firstPlayer);
		this.turnStep.set(RoundTurnStep.DrawOrCollect);
		this.turnIndex.set(1);

		this.hands.set(deal.hands);
		this.drawPile.set(deal.remainingDeck);
		this.discardPile.set(deal.discard ? [deal.discard] : []);
		this.pots.set(deal.pots);
		this.melds.set(createEmptyMelds());

		// Ogni mano riparte da zero: nessun pozzetto preso, nessun esito precedente.
		this.resetHandOutcome();
	}

	getState(): RoundSavedState {
		const save = (deck: DeckItem[]): SavedCard[] =>
			deck.map((c) => ({ tag: c.tag, faceDown: c.faceDown }));
		const hands = this.hands();
		const melds = this.melds();
		return {
			phase: this.phase(),
			dealer: this.dealer(),
			currentPlayer: this.currentPlayer(),
			turnStep: this.turnStep(),
			turnIndex: this.turnIndex(),
			initialized: this.initialized(),
			hands: {
				north: save(hands.north),
				east: save(hands.east),
				south: save(hands.south),
				west: save(hands.west),
			},
			drawPile: save(this.drawPile()),
			discardPile: save(this.discardPile()),
			pots: this.pots().map(save),
			melds: {
				ours: melds.ours.map(save),
				opponents: melds.opponents.map(save),
			},
			winnerPlayer: this.winnerPlayer(),
			winnerTeam: this.winnerTeam(),
			score: this.score(),
			playerHasTakenPot: { ...this.playerHasTakenPot() },
		};
	}

	restoreState(state: RoundSavedState): void {
		const restore = (cards: SavedCard[]): DeckItem[] =>
			cards.map((c) => new DeckItem(c.tag, c.faceDown));

		this.initialized.set(state.initialized);
		this.phase.set(state.phase);
		this.dealer.set(state.dealer);
		this.currentPlayer.set(state.currentPlayer);
		this.turnStep.set(state.turnStep);
		this.turnIndex.set(state.turnIndex);
		this.hands.set({
			north: restore(state.hands.north),
			east: restore(state.hands.east),
			south: restore(state.hands.south),
			west: restore(state.hands.west),
		});
		this.drawPile.set(restore(state.drawPile));
		this.discardPile.set(restore(state.discardPile));
		this.pots.set(state.pots.map(restore));
		this.melds.set({
			ours: state.melds.ours.map(restore),
			opponents: state.melds.opponents.map(restore),
		});
		this.winnerPlayer.set(state.winnerPlayer);
		this.winnerTeam.set(state.winnerTeam);
		this.score.set(state.score);
		this.playerHasTakenPot.set({ ...state.playerHasTakenPot });
	}
	constructor(private readonly rules: Rules) {}

	drawFromStock(): boolean {
		const player = this.ensureDrawPhase();
		if (!player) return false;

		const pile = this.drawPile();
		if (!pile.length) return this.rejectAction('Stock esaurito.');

		const nextPile = pile.slice();
		const card = nextPile.pop()!;

		this.drawPile.set(nextPile);
		this.hands.update((h) => {
			const updated = { ...h };
			updated[player] = [...h[player], card];
			return updated;
		});
		this.turnStep.set(RoundTurnStep.PlayAndDiscard);
		glog(`${player} pesca dal tallone (${nextPile.length} carte restanti)`);
		this.lastError.set(null);
		// La carta pescata dal tallone è nascosta agli altri: nessun `cards`.
		this.gameplayEvents.next({ type: RoundEventType.Draw, player });
		return true;
	}
	takeDiscardPile(): boolean {
		const player = this.ensureDrawPhase();
		if (!player) return false;

		const pile = this.discardPile();
		if (!pile.length) return this.rejectAction('Monte scarti vuoto.');

		// La raccolta SOSTITUISCE la pesca (Art. 7): tutto il monte scarti entra
		// in mano. Le carte sono già scoperte sul tavolo (faceDown=false), la
		// prospettiva del Deck gestisce la visibilità per mano.
		this.discardPile.set([]);
		this.hands.update((h) => ({ ...h, [player]: [...h[player], ...pile] }));
		this.turnStep.set(RoundTurnStep.PlayAndDiscard);
		glog(`${player} raccoglie il monte scarti (${pile.length} carte)`);
		this.lastError.set(null);
		this.gameplayEvents.next({ type: RoundEventType.TakeDiscard, player, cards: pile });
		return true;
	}

	openMeld(cards: CardRef[]): boolean {
		const player = this.ensurePlayPhase();
		if (!player) return false;

		const refs = cards.filter(Boolean).map((c) => (typeof c === 'string' ? c.trim() : c));
		if (refs.length < 3) return this.rejectAction('Occorrono almeno 3 carte per calare.');

		const toMeld = this.findCardsInHand(player, refs);
		if (!toMeld) return this.rejectAction('Le carte selezionate non sono tutte in mano.');

		const validated = this.rules.validateMeld(toMeld);
		if (!validated) return this.rejectAction('Combinazione non valida secondo le regole.');

		this.removeCardsFromHand(player, toMeld);
		// Stato fisico: i giochi a terra sono pubblici, le carte si scoprono.
		toMeld.forEach((c) => (c.faceDown = false));
		const team = TEAM_BY_PLAYER[player];
		this.melds.update((m) => ({ ...m, [team]: [...m[team], Array.from(validated)] }));

		glog(`${player} cala: ${toMeld.join(' ')} (${this.hands()[player].length} carte in mano)`);
		this.lastError.set(null);
		this.gameplayEvents.next({ type: RoundEventType.Open, player, cards: toMeld });
		this.handleEmptyHandAfterPlay(player);
		return true;
	}

	attachToMeld(meldIndex: number, cards: CardRef[]): boolean {
		const player = this.ensurePlayPhase();
		if (!player) return false;

		const refs = cards.filter(Boolean).map((c) => (typeof c === 'string' ? c.trim() : c));
		if (!refs.length) return this.rejectAction('Seleziona almeno una carta da legare.');

		const toAttach = this.findCardsInHand(player, refs);
		if (!toAttach) return this.rejectAction('Le carte selezionate non sono tutte in mano.');

		const team = TEAM_BY_PLAYER[player];
		const tableMeld = this.melds()[team][meldIndex];
		if (!tableMeld) return this.rejectAction('Gioco a terra non trovato.');

		const validated = this.rules.validateMeld(toAttach, tableMeld);
		if (!validated) return this.rejectAction('Legata non valida secondo le regole.');

		this.removeCardsFromHand(player, toAttach);
		// Stato fisico: le carte legate a un gioco a terra si scoprono.
		toAttach.forEach((c) => (c.faceDown = false));
		this.melds.update((m) => {
			const teamMelds = m[team].slice();
			teamMelds[meldIndex] = Array.from(validated);
			return { ...m, [team]: teamMelds };
		});

		glog(
			`${player} lega ${toAttach.join(' ')} al gioco #${meldIndex + 1} (${this.hands()[player].length} carte in mano)`,
		);
		this.lastError.set(null);
		this.gameplayEvents.next({
			type: RoundEventType.Attach,
			player,
			cards: toAttach,
			meldIndex,
		});
		this.handleEmptyHandAfterPlay(player);
		return true;
	}

	discard(card: CardRef): boolean {
		const player = this.ensurePlayPhase();
		if (!player) return false;

		const ref = typeof card === 'string' ? card.trim() : card;
		if (!ref) return this.rejectAction('Carta non specificata.');

		const cardItems = this.findCardsInHand(player, [ref]);
		if (!cardItems) return this.rejectAction('La carta selezionata non è in mano.');

		const [cardItem] = cardItems;

		// Art. 14: non si può chiudere scartando una matta. Se questo scarto
		// svuoterebbe la mano E la squadra può chiudere (pozzetto preso + burraco),
		// la matta come ultimo scarto è illegale: l'azione va rifiutata.
		const team = TEAM_BY_PLAYER[player];
		const wouldClose =
			this.hands()[player].length === 1 &&
			this.teamHasTakenPot(team) &&
			this.teamHasBurraco()[team];
		if (wouldClose && isWild(cardItem)) {
			return this.rejectAction('Non puoi chiudere scartando una matta (Art. 14).');
		}

		this.removeCardsFromHand(player, cardItems);
		cardItem.faceDown = false;
		this.discardPile.update((pile) => [...pile, cardItem]);
		glog(`${player} scarta ${cardItem} (${this.hands()[player].length} carte in mano)`);
		this.lastError.set(null);
		this.gameplayEvents.next({ type: RoundEventType.Discard, player, cards: [cardItem] });

		this.handleEmptyHandAfterPlay(player);

		// Chiusura: mano vuota + pozzetto della squadra preso + burraco in campo.
		// Il pozzetto è per squadra: basta che l'abbia preso uno dei due compagni.
		if (
			this.hands()[player].length === 0 &&
			this.teamHasTakenPot(team) &&
			this.teamHasBurraco()[team]
		) {
			this.closeRound(player);
			return true;
		}

		this.nextTurn();
		return true;
	}

	undoTurn(): boolean {
		return false;
	}

	/** True se la squadra ha già preso il proprio pozzetto (uno qualsiasi dei due compagni). */
	private teamHasTakenPot(team: RoundTeam): boolean {
		const flags = this.playerHasTakenPot();
		return playersOfTeam(team).some((p) => flags[p]);
	}

	private handleEmptyHandAfterPlay(player: RoundPlayer): void {
		if (this.hands()[player].length > 0) return;

		const team = TEAM_BY_PLAYER[player];
		// Il pozzetto è per squadra: se l'ha già preso un compagno, non se ne prende un altro.
		if (this.teamHasTakenPot(team)) return;

		const potIndex = team === 'ours' ? 0 : 1;
		const pot = this.pots()[potIndex];
		if (!pot?.length) return;

		pot.forEach((c) => (c.faceDown = false));
		this.hands.update((h) => ({ ...h, [player]: [...h[player], ...pot] }));
		this.pots.update((ps) => ps.map((p, i) => (i === potIndex ? [] : p)));
		this.playerHasTakenPot.update((m) => ({ ...m, [player]: true }));
		glog(`${player} resta senza carte e prende il pozzetto (${pot.length} carte)`);
		this.gameplayEvents.next({ type: RoundEventType.TakePot, player });
	}

	private nextTurn(): void {
		this.currentPlayer.set(this.nextPlayer(this.currentPlayer()!));
		this.turnStep.set(RoundTurnStep.DrawOrCollect);
		this.turnIndex.update((n) => n + 1);
		glog(`— Turno ${this.turnIndex()}: tocca a ${this.currentPlayer()}`);
	}

	private closeRound(player: RoundPlayer): void {
		const team = TEAM_BY_PLAYER[player];
		const score = this.computeScore(team);
		glog(
			`CHIUSURA di ${player} (${team}) — noi ${score.ours.total}, loro ${score.opponents.total}`,
		);
		this.phase.set(RoundPhase.Closed);
		this.winnerPlayer.set(player);
		this.winnerTeam.set(team);
		this.score.set(score);
		this.gameplayEvents.next({ type: RoundEventType.Close, player });
		this.events.next({ type: 'round_closed', winnerPlayer: player, winnerTeam: team, score });
	}

	// ============================================================
	// PUNTEGGIO (Art. 1, 13, 18 — sintesi FIBUR 2026)
	// ============================================================

	/**
	 * Calcola il punteggio della mano per entrambe le squadre.
	 *
	 * Positivi: valore carte nei giochi a terra + bonus burraco
	 * (pulito +200, semipulito +150, sporco +100) + chiusura +100 (vincitore).
	 * Negativi: carte rimaste in mano (per valore) + pozzetto non preso (-100).
	 */
	private computeScore(winnerTeam: RoundTeam): RoundScore {
		const melds = this.melds();
		const hands = this.hands();
		const potTaken = this.playerHasTakenPot();

		const teamScore = (team: RoundTeam): RoundTeamScore => {
			let openMeldPoints = 0;
			let burracoBonus = 0;
			for (const meld of melds[team]) {
				openMeldPoints += sumCardPoints(meld);
				const type = this.classifyBurraco(meld);
				if (type)
					burracoBonus += type === 'pulito' ? 200 : type === 'semipulito' ? 150 : 100;
			}

			const closureBonus = team === winnerTeam ? 100 : 0;

			const players = playersOfTeam(team);

			const remainingHandPenalty = players.reduce((s, p) => s + sumCardPoints(hands[p]), 0);
			const potNotTakenPenalty = players.some((p) => potTaken[p]) ? 0 : 100;

			const breakdown: RoundScoreBreakdown = {
				openMeldPoints,
				burracoBonus,
				closureBonus,
				remainingHandPenalty,
				potNotTakenPenalty,
				potTakenNotPlayedPenalty: 0,
				penalizedCardsPenalty: 0,
			};
			const positive = openMeldPoints + burracoBonus + closureBonus;
			const negative = remainingHandPenalty + potNotTakenPenalty;
			return { positive, negative, total: positive - negative, breakdown };
		};

		return { ours: teamScore('ours'), opponents: teamScore('opponents') };
	}

	/**
	 * Classifica un gioco come burraco (≥7 carte) e ne determina il tipo.
	 * Restituisce null se non è un burraco.
	 *
	 * - pulito: nessuna matta usata come matta (il 2 naturale in seme non conta);
	 * - semipulito: 1 matta a un'estremità di una sequenza con ≥7 naturali,
	 *   oppure combinazione di ≥8 carte con 1 matta;
	 * - sporco: qualsiasi altro burraco con matte.
	 */
	classifyBurraco(meld: DeckItem[]): 'pulito' | 'semipulito' | 'sporco' | null {
		if (meld.length < 7) return null;

		// Combinazione (set): naturali dello stesso valore + eventuali matte.
		if (this.rules.validateSet(meld)) {
			const counts = new Map<string, number>();
			for (const c of meld) {
				if (c.value !== '*') counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
			}
			let setValue = '';
			let max = 0;
			counts.forEach((n, v) => {
				if (n > max) {
					max = n;
					setValue = v;
				}
			});
			const wilds = meld.filter((c) => c.value === '*' || c.value !== setValue).length;
			if (wilds === 0) return 'pulito';
			if (wilds === 1 && meld.length >= 8) return 'semipulito';
			return 'sporco';
		}

		// Sequenza (run): il joker è sempre matta; il 2 solo se non è un 2 naturale in seme.
		const items = DeckItems.fromArray(meld);
		const wildIdx: number[] = [];
		meld.forEach((c, i) => {
			if (c.value === '*' || (isWild(c) && !isNatural2(items, i))) wildIdx.push(i);
		});
		if (wildIdx.length === 0) return 'pulito';
		if (wildIdx.length === 1) {
			const i = wildIdx[0];
			const atEnd = i === 0 || i === meld.length - 1;
			return atEnd && meld.length - 1 >= 7 ? 'semipulito' : 'sporco';
		}
		return 'sporco';
	}

	private ensureDrawPhase(): RoundPlayer | null {
		if (this.phase() !== RoundPhase.InProgress) {
			this.rejectAction('La mano non è in corso.');
			return null;
		}
		if (this.turnStep() !== RoundTurnStep.DrawOrCollect) {
			this.rejectAction('Azione non consentita in questa fase del turno.');
			return null;
		}
		const player = this.currentPlayer();
		if (!player) {
			this.rejectAction('Giocatore corrente non disponibile.');
			return null;
		}
		return player;
	}

	private ensurePlayPhase(): RoundPlayer | null {
		if (this.phase() !== RoundPhase.InProgress) {
			this.rejectAction('La mano non è in corso.');
			return null;
		}
		if (this.turnStep() !== RoundTurnStep.PlayAndDiscard) {
			this.rejectAction('Azione non consentita in questa fase del turno.');
			return null;
		}
		const player = this.currentPlayer();
		if (!player) {
			this.rejectAction('Giocatore corrente non disponibile.');
			return null;
		}
		return player;
	}

	private rejectAction(reason: string): false {
		this.lastError.set(reason);
		return false;
	}

	/**
	 * Cerca le carte nella mano del giocatore: per uid se il riferimento è
	 * un'istanza (identità certa), per tag se è una stringa (prima occorrenza
	 * libera). Restituisce le istanze DeckItem trovate o null se una manca.
	 * La copia di lavoro viene svuotata man mano: due riferimenti allo stesso
	 * tag risolvono su DUE copie distinte, mai sulla stessa istanza.
	 */
	private findCardsInHand(player: RoundPlayer, refs: CardRef[]): DeckItem[] | null {
		const hand = this.hands()[player].slice();
		const found: DeckItem[] = [];
		for (const ref of refs) {
			const idx =
				typeof ref === 'string'
					? hand.findIndex((c) => c.tag === ref)
					: hand.findIndex((c) => c.uid === ref.uid);
			if (idx < 0) return null;
			found.push(hand.splice(idx, 1)[0]);
		}
		return found;
	}

	private removeCardsFromHand(player: RoundPlayer, cards: DeckItem[]): void {
		const uids = new Set(cards.map((c) => c.uid));
		this.hands.update((h) => ({ ...h, [player]: h[player].filter((c) => !uids.has(c.uid)) }));
	}

	private createPots(deck: DeckItem[]): [DeckItem[], DeckItem[]] {
		const first: DeckItem[] = [];
		const second: DeckItem[] = [];
		for (let i = 0; i < 22; i++) {
			const card = deck.pop();
			if (!card) break;
			(i % 2 === 0 ? first : second).push(card);
		}
		return [first, second];
	}

	private buildDistributionOrder(firstPlayer: RoundPlayer): RoundPlayer[] {
		const startIndex = PLAYER_ORDER.indexOf(firstPlayer);
		return [...PLAYER_ORDER.slice(startIndex), ...PLAYER_ORDER.slice(0, startIndex)];
	}

	private pickRandomPlayer(): RoundPlayer {
		return PLAYER_ORDER[Math.floor(Math.random() * PLAYER_ORDER.length)];
	}

	private nextPlayer(player: RoundPlayer): RoundPlayer {
		return PLAYER_ORDER[(PLAYER_ORDER.indexOf(player) + 1) % PLAYER_ORDER.length];
	}

	private shuffleDeck(deck: DeckItem[]): DeckItem[] {
		const shuffled = deck.slice();
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Valore in punti di una singola carta (Art. 1 FIBUR). */
function cardPoints(card: DeckItem): number {
	switch (card.value) {
		case '*':
			return 30; // jolly
		case '2':
			return 20; // pinella
		case 'A':
			return 15;
		case 'K':
		case 'Q':
		case 'J':
		case '10':
			return 10;
		default:
			return 5; // 9..3
	}
}

/** Somma dei valori in punti di un insieme di carte. */
function sumCardPoints(cards: DeckItem[]): number {
	return cards.reduce((sum, card) => sum + cardPoints(card), 0);
}

function createEmptyHands(): Record<PlayerSide, DeckItem[]> {
	return {
		[PlayerSide.East]: [],
		[PlayerSide.West]: [],
		[PlayerSide.North]: [],
		[PlayerSide.South]: [],
	};
}

function createEmptyMelds(): Record<RoundTeam, DeckItem[][]> {
	return { opponents: [], ours: [] };
}

function createEmptyPotFlags(): Record<PlayerSide, boolean> {
	return {
		[PlayerSide.East]: false,
		[PlayerSide.West]: false,
		[PlayerSide.North]: false,
		[PlayerSide.South]: false,
	};
}

/** I due giocatori che compongono una squadra. */
function playersOfTeam(team: RoundTeam): PlayerSide[] {
	return team === 'ours'
		? [PlayerSide.North, PlayerSide.South]
		: [PlayerSide.East, PlayerSide.West];
}
