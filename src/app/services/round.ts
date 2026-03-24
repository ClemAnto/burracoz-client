import { Injectable, computed, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { DeckItem } from '../ui/deck/deck';
import { STARTER_DECK } from './cards';
import { Rules } from './rules';

export enum PlayerSide {
	North = 'north',
	East  = 'east',
	South = 'south',
	West  = 'west',
}
export type RoundPlayer = PlayerSide;
export type RoundTeam = 'opponents' | 'ours';

export enum RoundPhase {
	Idle       = 'idle',
	InProgress = 'in_progress',
	Closed     = 'closed',
}

export enum RoundTurnStep {
	DrawOrCollect  = 'draw_or_collect',
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

const PLAYER_ORDER: PlayerSide[] = [PlayerSide.North, PlayerSide.East, PlayerSide.South, PlayerSide.West];

export const TEAM_BY_PLAYER: Record<PlayerSide, RoundTeam> = {
	[PlayerSide.East]:  'opponents',
	[PlayerSide.West]:  'opponents',
	[PlayerSide.North]: 'ours',
	[PlayerSide.South]: 'ours',
};

@Injectable({
	providedIn: 'root',
})
export class Round {
	phase         = signal<RoundPhase>(RoundPhase.Idle);
	dealer        = signal<RoundPlayer | null>(null);
	currentPlayer = signal<RoundPlayer | null>(null);
	turnStep      = signal<RoundTurnStep>(RoundTurnStep.DrawOrCollect);
	turnIndex     = signal<number>(0);

	hands       = signal<Record<RoundPlayer, DeckItem[]>>(createEmptyHands());
	drawPile    = signal<DeckItem[]>([]);
	discardPile = signal<DeckItem[]>([]);
	pots        = signal<DeckItem[][]>([]);
	melds       = signal<Record<RoundTeam, DeckItem[][]>>(createEmptyMelds());
	initialized = signal<boolean>(false);
	// TODO: placeholder — da implementare
	winnerPlayer            = signal<RoundPlayer | null>(null);
	winnerTeam              = signal<RoundTeam | null>(null);
	score                   = signal<RoundScore | null>(null);
	lastError               = signal<string | null>(null);
	playerHasTakenPot  = signal<Record<PlayerSide, boolean>>({
		[PlayerSide.East]: false, [PlayerSide.West]: false,
		[PlayerSide.North]: false, [PlayerSide.South]: false,
	});
	teamHasBurraco = computed(() => {
		const melds = this.melds();
		const hasBurraco = (teamMelds: DeckItem[][]) => teamMelds.some(m => m.length >= 7);
		return { ours: hasBurraco(melds.ours), opponents: hasBurraco(melds.opponents) };
	});
	canUndoTurn             = computed(() => false);

	// TODO: placeholder — da implementare
	readonly events = new Subject<{ type: 'round_closed'; winnerPlayer: RoundPlayer; winnerTeam: RoundTeam; score: RoundScore }>();

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
				...h.north, ...h.east, ...h.south, ...h.west,
			]);
			this.discardPile.set([]);
			this.pots.set([]);
			this.melds.set(createEmptyMelds());
			this.drawPile.set(draws);
			this.hands.set(createEmptyHands());
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
		}

		this.phase.set(RoundPhase.Idle);
		this.dealer.set(null);
		this.currentPlayer.set(null);
		this.turnStep.set(RoundTurnStep.DrawOrCollect);
		this.turnIndex.set(0);
		
			
			
		
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

		return { dealer, firstPlayer, hands, pots: [firstPot, secondPot], discard, remainingDeck: deck };
	}

	/** Imposta i signal del Round dalla distribuzione precalcolata. */
	commitDeal(deal: DealResult): void {
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
	}

	getState(): RoundSavedState {
		const save = (deck: DeckItem[]): SavedCard[] =>
			deck.map(c => ({ tag: c.tag, faceDown: c.faceDown }));
		const hands = this.hands();
		const melds  = this.melds();
		return {
			phase:             this.phase(),
			dealer:            this.dealer(),
			currentPlayer:     this.currentPlayer(),
			turnStep:          this.turnStep(),
			turnIndex:         this.turnIndex(),
			initialized:       this.initialized(),
			hands: {
				north: save(hands.north),
				east:  save(hands.east),
				south: save(hands.south),
				west:  save(hands.west),
			},
			drawPile:         save(this.drawPile()),
			discardPile:      save(this.discardPile()),
			pots:             this.pots().map(save),
			melds: {
				ours:      melds.ours.map(save),
				opponents: melds.opponents.map(save),
			},
			winnerPlayer:     this.winnerPlayer(),
			winnerTeam:       this.winnerTeam(),
			score:            this.score(),
			playerHasTakenPot: { ...this.playerHasTakenPot() },
		};
	}

	restoreState(state: RoundSavedState): void {
		const restore = (cards: SavedCard[]): DeckItem[] =>
			cards.map(c => new DeckItem(c.tag, c.faceDown));

		this.initialized.set(state.initialized);
		this.phase.set(state.phase);
		this.dealer.set(state.dealer);
		this.currentPlayer.set(state.currentPlayer);
		this.turnStep.set(state.turnStep);
		this.turnIndex.set(state.turnIndex);
		this.hands.set({
			north: restore(state.hands.north),
			east:  restore(state.hands.east),
			south: restore(state.hands.south),
			west:  restore(state.hands.west),
		});
		this.drawPile.set(restore(state.drawPile));
		this.discardPile.set(restore(state.discardPile));
		this.pots.set(state.pots.map(restore));
		this.melds.set({
			ours:      state.melds.ours.map(restore),
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
		this.hands.update(h => {
			const updated = { ...h };
			updated[player] = [...h[player], card];
			return updated;
		});
		this.turnStep.set(RoundTurnStep.PlayAndDiscard);
		this.lastError.set(null);
		return true;
	}
	takeDiscardPile(): boolean                               { return false; }

	openMeld(cards: string[]): boolean {
		const player = this.ensurePlayPhase();
		if (!player) return false;

		const tags = cards.map(c => c?.trim()).filter(Boolean);
		if (tags.length < 3) return this.rejectAction('Occorrono almeno 3 carte per calare.');

		const toMeld = this.findCardsInHand(player, tags);
		if (!toMeld) return this.rejectAction('Le carte selezionate non sono tutte in mano.');

		const validated = this.rules.validateMeld(toMeld);
		if (!validated) return this.rejectAction('Combinazione non valida secondo le regole.');

		this.removeCardsFromHand(player, toMeld);
		const team = TEAM_BY_PLAYER[player];
		this.melds.update(m => ({ ...m, [team]: [...m[team], Array.from(validated)] }));

		this.lastError.set(null);
		this.handleEmptyHandAfterPlay(player);
		return true;
	}

	attachToMeld(meldIndex: number, cards: string[]): boolean {
		const player = this.ensurePlayPhase();
		if (!player) return false;

		const tags = cards.map(c => c?.trim()).filter(Boolean);
		if (!tags.length) return this.rejectAction('Seleziona almeno una carta da legare.');

		const toAttach = this.findCardsInHand(player, tags);
		if (!toAttach) return this.rejectAction('Le carte selezionate non sono tutte in mano.');

		const team = TEAM_BY_PLAYER[player];
		const tableMeld = this.melds()[team][meldIndex];
		if (!tableMeld) return this.rejectAction('Gioco a terra non trovato.');

		const validated = this.rules.validateMeld(toAttach, tableMeld);
		if (!validated) return this.rejectAction('Legata non valida secondo le regole.');

		this.removeCardsFromHand(player, toAttach);
		this.melds.update(m => {
			const teamMelds = m[team].slice();
			teamMelds[meldIndex] = Array.from(validated);
			return { ...m, [team]: teamMelds };
		});

		this.lastError.set(null);
		return true;
	}

	discard(card: string): boolean {
		const player = this.ensurePlayPhase();
		if (!player) return false;

		const tag = card?.trim();
		if (!tag) return this.rejectAction('Carta non specificata.');

		const cardItems = this.findCardsInHand(player, [tag]);
		if (!cardItems) return this.rejectAction('La carta selezionata non è in mano.');

		const [cardItem] = cardItems;
		this.removeCardsFromHand(player, cardItems);
		cardItem.faceDown = false;
		this.discardPile.update(pile => [...pile, cardItem]);
		this.lastError.set(null);

		this.handleEmptyHandAfterPlay(player);

		// Chiusura: mano vuota + pozzetto preso + burraco in campo
		const team = TEAM_BY_PLAYER[player];
		if (this.hands()[player].length === 0 &&
			this.playerHasTakenPot()[player] &&
			this.teamHasBurraco()[team]) {
			this.closeRound(player);
			return true;
		}

		this.nextTurn();
		return true;
	}

	undoTurn(): boolean                                      { return false; }

	private handleEmptyHandAfterPlay(player: RoundPlayer): void {
		if (this.hands()[player].length > 0) return;
		if (this.playerHasTakenPot()[player]) return;

		const team = TEAM_BY_PLAYER[player];
		const potIndex = team === 'ours' ? 0 : 1;
		const pot = this.pots()[potIndex];
		if (!pot?.length) return;

		pot.forEach(c => (c.faceDown = false));
		this.hands.update(h => ({ ...h, [player]: [...h[player], ...pot] }));
		this.pots.update(ps => ps.map((p, i) => (i === potIndex ? [] : p)));
		this.playerHasTakenPot.update(m => ({ ...m, [player]: true }));
	}

	private nextTurn(): void {
		this.currentPlayer.set(this.nextPlayer(this.currentPlayer()!));
		this.turnStep.set(RoundTurnStep.DrawOrCollect);
		this.turnIndex.update(n => n + 1);
	}

	private closeRound(player: RoundPlayer): void {
		const team = TEAM_BY_PLAYER[player];
		const empty: RoundScoreBreakdown = {
			openMeldPoints: 0, burracoBonus: 0, closureBonus: 0,
			remainingHandPenalty: 0, potNotTakenPenalty: 0,
			potTakenNotPlayedPenalty: 0, penalizedCardsPenalty: 0,
		};
		const score: RoundScore = {
			ours:      { positive: 0, negative: 0, total: 0, breakdown: { ...empty } },
			opponents: { positive: 0, negative: 0, total: 0, breakdown: { ...empty } },
		};
		this.phase.set(RoundPhase.Closed);
		this.winnerPlayer.set(player);
		this.winnerTeam.set(team);
		this.score.set(score);
		this.events.next({ type: 'round_closed', winnerPlayer: player, winnerTeam: team, score });
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

	/** Cerca le carte per tag nella mano del giocatore, restituisce le istanze DeckItem o null. */
	private findCardsInHand(player: RoundPlayer, tags: string[]): DeckItem[] | null {
		const hand = this.hands()[player].slice();
		const found: DeckItem[] = [];
		for (const tag of tags) {
			const idx = hand.findIndex(c => c.tag === tag);
			if (idx < 0) return null;
			found.push(hand.splice(idx, 1)[0]);
		}
		return found;
	}

	private removeCardsFromHand(player: RoundPlayer, cards: DeckItem[]): void {
		const uids = new Set(cards.map(c => c.uid));
		this.hands.update(h => ({ ...h, [player]: h[player].filter(c => !uids.has(c.uid)) }));
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

function createEmptyHands(): Record<PlayerSide, DeckItem[]> {
	return {
		[PlayerSide.East]: [], [PlayerSide.West]: [],
		[PlayerSide.North]: [], [PlayerSide.South]: [],
	};
}

function createEmptyMelds(): Record<RoundTeam, DeckItem[][]> {
	return { opponents: [], ours: [] };
}
