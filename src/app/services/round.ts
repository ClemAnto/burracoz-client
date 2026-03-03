import { Injectable, computed, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { DeckItem } from '../ui/deck/deck';
import { parseCardValue, STARTER_DECK } from './cards';
import { isWild, Rules } from './rules';

export type RoundPlayer = 'east' | 'west' | 'north' | 'south';
export type RoundTeam = 'opponents' | 'ours';
export type RoundPhase = 'idle' | 'in_progress' | 'closed';
export type RoundTurnStep = 'draw_or_collect' | 'play_and_discard';
export type PozzettoMode = 'direct' | 'after_discard';
export type BurracoType = 'clean' | 'semi_clean' | 'dirty';

export type RoundEvent =
	| {
			type: 'hand_started';
			dealer: RoundPlayer;
			firstPlayer: RoundPlayer;
	  }
	| {
			type: 'card_drawn';
			player: RoundPlayer;
			source: 'tallone' | 'scarti';
			cards: string[];
	  }
	| {
			type: 'meld_opened';
			player: RoundPlayer;
			team: RoundTeam;
			meld: string[];
	  }
	| {
			type: 'meld_attached';
			player: RoundPlayer;
			team: RoundTeam;
			meldIndex: number;
			meld: string[];
	  }
	| {
			type: 'pozzetto_taken';
			player: RoundPlayer;
			team: RoundTeam;
			mode: PozzettoMode;
			cards: number;
	  }
	| {
			type: 'card_discarded';
			player: RoundPlayer;
			card: string;
	  }
	| {
			type: 'turn_changed';
			previousPlayer: RoundPlayer;
			currentPlayer: RoundPlayer;
	  }
	| {
			type: 'round_closed';
			winnerPlayer: RoundPlayer;
			winnerTeam: RoundTeam;
			score: RoundScore;
	  }
	| {
			type: 'action_rejected';
			reason: string;
	  };

export type RoundScoreBreakdown = {
	openMeldPoints: number;
	burracoBonus: number;
	closureBonus: number;
	remainingHandPenalty: number;
	pozzettoNotTakenPenalty: number;
	pozzettoTakenNotPlayedPenalty: number;
	penalizedCardsPenalty: number;
};

export type RoundTeamScore = {
	positive: number;
	negative: number;
	total: number;
	breakdown: RoundScoreBreakdown;
};

export type RoundScore = Record<RoundTeam, RoundTeamScore>;

export type TeamRoundState = {
	hasTakenPozzetto: boolean;
	takenBy: RoundPlayer | null;
	takenWithDiscard: boolean;
	originalPozzetto: string[];
	cardsPlayedAfterPozzetto: number;
};

export type RoundSavedState = {
	phase: RoundPhase;
	dealer: RoundPlayer | null;
	currentPlayer: RoundPlayer | null;
	turnStep: RoundTurnStep;
	turnIndex: number;
	hands: Record<RoundPlayer, string[]>;
	drawPile: string[];
	discardPile: string[];
	pozzetti: string[][];
	melds: Record<RoundTeam, string[][]>;
	playerHasTakenPozzetto: Record<RoundPlayer, boolean>;
	teamRoundState: Record<RoundTeam, TeamRoundState>;
	winnerPlayer: RoundPlayer | null;
	winnerTeam: RoundTeam | null;
	score: RoundScore | null;
};

/** Snapshot dello stato all'inizio della fase play_and_discard, usato per il rollback. */
type TurnSnapshot = {
	player: RoundPlayer;
	team: RoundTeam;
	hand: string[];
	teamMelds: string[][];
	pozzetti: string[][];
	playerHasTakenPozzetto: Record<RoundPlayer, boolean>;
	teamRoundState: Record<RoundTeam, TeamRoundState>;
};

const PLAYER_ORDER: RoundPlayer[] = ['north', 'east', 'south', 'west'];
const TEAM_BY_PLAYER: Record<RoundPlayer, RoundTeam> = {
	east: 'opponents',
	west: 'opponents',
	north: 'ours',
	south: 'ours',
};
const TEAM_PLAYERS: Record<RoundTeam, [RoundPlayer, RoundPlayer]> = {
	ours: ['north', 'south'],
	opponents: ['east', 'west'],
};

@Injectable({
	providedIn: 'root',
})
export class Round {
	private readonly eventsSubject = new Subject<RoundEvent>();
	readonly events$ = this.eventsSubject.asObservable();

	phase = signal<RoundPhase>('idle');
	dealer = signal<RoundPlayer | null>(null);
	currentPlayer = signal<RoundPlayer | null>(null);
	turnStep = signal<RoundTurnStep>('draw_or_collect');
	turnIndex = signal<number>(0);

	hands = signal<Record<RoundPlayer, string[]>>(createEmptyHands());
	drawPile = signal<string[]>([]);
	discardPile = signal<string[]>([]);
	pozzetti = signal<string[][]>([]);
	melds = signal<Record<RoundTeam, string[][]>>(createEmptyMelds());

	playerHasTakenPozzetto = signal<Record<RoundPlayer, boolean>>(createEmptyPlayerPozzettiState());
	teamRoundState = signal<Record<RoundTeam, TeamRoundState>>(createEmptyTeamRoundState());

	winnerPlayer = signal<RoundPlayer | null>(null);
	winnerTeam = signal<RoundTeam | null>(null);
	score = signal<RoundScore | null>(null);
	lastError = signal<string | null>(null);

	private readonly turnSnapshotSignal = signal<TurnSnapshot | null>(null);

	/** True se ci sono giocate annullabili nel turno corrente. */
	readonly canUndoTurn = computed(() =>
		this.turnSnapshotSignal() !== null && this.turnStep() === 'play_and_discard',
	);

	currentTeam = computed<RoundTeam | null>(() => {
		const player = this.currentPlayer();
		return player ? TEAM_BY_PLAYER[player] : null;
	});

	teamHasBurraco = computed<Record<RoundTeam, boolean>>(() => {
		const melds = this.melds();
		return {
			ours: melds.ours.some((meld) => meld.length >= 7),
			opponents: melds.opponents.some((meld) => meld.length >= 7),
		};
	});

	constructor(private readonly rules: Rules) {}

	getState(): RoundSavedState {
		return {
			phase: this.phase(),
			dealer: this.dealer(),
			currentPlayer: this.currentPlayer(),
			turnStep: this.turnStep(),
			turnIndex: this.turnIndex(),
			hands: this.hands(),
			drawPile: this.drawPile(),
			discardPile: this.discardPile(),
			pozzetti: this.pozzetti(),
			melds: this.melds(),
			playerHasTakenPozzetto: this.playerHasTakenPozzetto(),
			teamRoundState: this.teamRoundState(),
			winnerPlayer: this.winnerPlayer(),
			winnerTeam: this.winnerTeam(),
			score: this.score(),
		};
	}

	restoreState(s: RoundSavedState): void {
		this.phase.set(s.phase);
		this.dealer.set(s.dealer);
		this.currentPlayer.set(s.currentPlayer);
		this.turnStep.set(s.turnStep);
		this.turnIndex.set(s.turnIndex);
		this.hands.set(s.hands);
		this.drawPile.set(s.drawPile);
		this.discardPile.set(s.discardPile);
		this.pozzetti.set(s.pozzetti);
		this.melds.set(s.melds);
		this.playerHasTakenPozzetto.set(s.playerHasTakenPozzetto);
		this.teamRoundState.set(s.teamRoundState);
		this.winnerPlayer.set(s.winnerPlayer);
		this.winnerTeam.set(s.winnerTeam);
		this.score.set(s.score);
		this.lastError.set(null);
		this.turnSnapshotSignal.set(null);
	}

	startHand() {
		this.turnSnapshotSignal.set(null);
		const deck = this.shuffleDeck(STARTER_DECK.concat(STARTER_DECK));
		const dealer = this.pickRandomPlayer();
		const firstPlayer = this.nextPlayer(dealer);
		const distributionOrder = this.buildDistributionOrder(firstPlayer);
		const hands = createEmptyHands();

		for (let i = 0; i < 11; i++) {
			for (const player of distributionOrder) {
				const card = deck.pop();
				if (!card) {
					this.rejectAction('Mazzo insufficiente durante la distribuzione.');
					return;
				}
				hands[player].push(card);
			}
		}

		const [firstPozzetto, secondPozzetto] = this.createPozzetti(deck);
		const firstDiscard = deck.pop();

		this.phase.set('in_progress');
		this.dealer.set(dealer);
		this.currentPlayer.set(firstPlayer);
		this.turnStep.set('draw_or_collect');
		this.turnIndex.set(1);

		this.hands.set(hands);
		this.drawPile.set(deck);
		this.discardPile.set(firstDiscard ? [firstDiscard] : []);
		this.pozzetti.set([firstPozzetto, secondPozzetto]);
		this.melds.set(createEmptyMelds());

		this.playerHasTakenPozzetto.set(createEmptyPlayerPozzettiState());
		this.teamRoundState.set(createEmptyTeamRoundState());

		this.winnerPlayer.set(null);
		this.winnerTeam.set(null);
		this.score.set(null);
		this.lastError.set(null);

		this.eventsSubject.next({
			type: 'hand_started',
			dealer,
			firstPlayer,
		});
	}

	drawFromTallone(): boolean {
		const player = this.ensureActionContext('draw_or_collect');
		if (!player) return false;

		const deck = this.drawPile();
		if (!deck.length) return this.rejectAction('Tallone esaurito: non puoi pescare.');

		const nextDeck = deck.slice();
		const card = nextDeck.pop();

		this.drawPile.set(nextDeck);
		this.addCardsToHand(player, [card]);
		this.turnStep.set('play_and_discard');
		this.lastError.set(null);
		this.turnSnapshotSignal.set(this.captureSnapshot(player, TEAM_BY_PLAYER[player]));

		this.eventsSubject.next({
			type: 'card_drawn',
			player,
			source: 'tallone',
			cards: [card],
		});

		return true;
	}

	takeDiscardPile(): boolean {
		const player = this.ensureActionContext('draw_or_collect');
		if (!player) return false;

		const discardPile = this.discardPile();
		if (!discardPile.length) return this.rejectAction('Monte degli scarti vuoto.');

		this.addCardsToHand(player, discardPile);
		this.discardPile.set([]);
		this.turnStep.set('play_and_discard');
		this.lastError.set(null);
		this.turnSnapshotSignal.set(this.captureSnapshot(player, TEAM_BY_PLAYER[player]));

		this.eventsSubject.next({
			type: 'card_drawn',
			player,
			source: 'scarti',
			cards: discardPile,
		});

		return true;
	}

	/**
	 * Annulla tutte le giocate del turno corrente (calate e legature),
	 * ripristinando la mano e i giochi a terra allo stato di inizio turno.
	 * Disponibile solo durante la fase play_and_discard.
	 */
	undoTurn(): boolean {
		if (this.phase() !== 'in_progress')
			return this.rejectAction('La mano non è in corso.');
		if (this.turnStep() !== 'play_and_discard')
			return this.rejectAction('Annullamento disponibile solo nella fase di gioco.');
		if (!this.turnSnapshotSignal())
			return this.rejectAction('Nessuna giocata da annullare.');
		this.applySnapshot();
		this.lastError.set(null);
		return true;
	}

	openMeld(cards: string[]): boolean {
		const player = this.ensureActionContext('play_and_discard');
		if (!player) return false;

		const toLayOff = normalizeCards(cards);
		if (!toLayOff.length) return this.rejectAction('Seleziona almeno una carta da aprire.');

		if (!this.playerHasAllCards(player, toLayOff)) {
			return this.rejectAction('Le carte selezionate non sono tutte presenti in mano.');
		}

		const validated = this.rules.validateMeld(toLayOff.join(' '));
		if (!validated) return this.rejectAction('Gioco non valido secondo le regole.');

		const meld = deckItemsToTags(validated);
		const team = TEAM_BY_PLAYER[player];

		if (!this.removeCardsFromPlayer(player, toLayOff)) {
			return this.rejectAction('Impossibile rimuovere le carte dalla mano.');
		}

		this.melds.update((value) => {
			return {
				...value,
				[team]: value[team].concat([meld]),
			};
		});

		this.markCardsPlayedAfterPozzetto(player, toLayOff.length);
		this.lastError.set(null);

		this.eventsSubject.next({
			type: 'meld_opened',
			player,
			team,
			meld,
		});

		this.tryTakePozzettoDirect(player);
		return true;
	}

	attachToMeld(meldIndex: number, cards: string[]): boolean {
		const player = this.ensureActionContext('play_and_discard');
		if (!player) return false;

		const toAttach = normalizeCards(cards);
		if (!toAttach.length) return this.rejectAction('Seleziona almeno una carta da legare.');

		if (!this.playerHasAllCards(player, toAttach)) {
			return this.rejectAction('Le carte selezionate non sono tutte presenti in mano.');
		}

		const team = TEAM_BY_PLAYER[player];
		const currentMelds = this.melds()[team];
		const tableMeld = currentMelds[meldIndex];
		if (!tableMeld) return this.rejectAction('Mazzo a terra non trovato.');

		const validated = this.rules.validateMeld(toAttach.join(' '), tableMeld.join(' '));
		if (!validated) return this.rejectAction('Legata non valida secondo le regole.');

		if (!this.removeCardsFromPlayer(player, toAttach)) {
			return this.rejectAction('Impossibile rimuovere le carte dalla mano.');
		}

		const updatedMeld = deckItemsToTags(validated);
		this.melds.update((value) => {
			const teamMelds = value[team].slice();
			teamMelds[meldIndex] = updatedMeld;
			return {
				...value,
				[team]: teamMelds,
			};
		});

		this.markCardsPlayedAfterPozzetto(player, toAttach.length);
		this.lastError.set(null);

		this.eventsSubject.next({
			type: 'meld_attached',
			player,
			team,
			meldIndex,
			meld: updatedMeld,
		});

		this.tryTakePozzettoDirect(player);
		return true;
	}

	discard(card: string): boolean {
		const player = this.ensureActionContext('play_and_discard');
		if (!player) return false;

		const discardCard = card?.trim();
		if (!discardCard) return this.rejectAction('Carta di scarto non valida.');

		const hand = this.hands()[player];
		if (!hand.includes(discardCard)) {
			return this.rejectAction('La carta di scarto non e presente nella mano del giocatore.');
		}

		const team = TEAM_BY_PLAYER[player];
		const hasTakenPozzetto = this.playerHasTakenPozzetto()[player];
		const isClosingAttempt = hand.length === 1 && hasTakenPozzetto;
		if (isClosingAttempt && !this.teamHasBurraco()[team]) {
			this.applySnapshot();
			return this.rejectAction('Per chiudere servono pozzetto preso e almeno un burraco. Le carte giocate in questo turno sono state restituite.');
		}
		// Art. 14: non è possibile chiudere scartando una matta (jolly o 2 selvaggio)
		if (isClosingAttempt && isWild(new DeckItem(discardCard))) {
			this.applySnapshot();
			return this.rejectAction('Non si può chiudere scartando una matta (Art. 14). Le carte giocate in questo turno sono state restituite.');
		}

		if (!this.removeCardsFromPlayer(player, [discardCard])) {
			return this.rejectAction('Impossibile eseguire lo scarto.');
		}

		this.discardPile.update((value) => value.concat(discardCard));
		this.lastError.set(null);

		this.eventsSubject.next({
			type: 'card_discarded',
			player,
			card: discardCard,
		});

		const currentHand = this.hands()[player];
		if (!currentHand.length && !hasTakenPozzetto) {
			this.takePozzetto(player, 'after_discard');
			this.advanceTurn(player);
			return true;
		}

		if (!currentHand.length && hasTakenPozzetto && this.teamHasBurraco()[team]) {
			this.closeRound(player);
			return true;
		}

		this.advanceTurn(player);
		return true;
	}

	private captureSnapshot(player: RoundPlayer, team: RoundTeam): TurnSnapshot {
		const trs = this.teamRoundState();
		return {
			player,
			team,
			hand: [...this.hands()[player]],
			teamMelds: this.melds()[team].map((m) => [...m]),
			pozzetti: this.pozzetti().map((p) => [...p]),
			playerHasTakenPozzetto: { ...this.playerHasTakenPozzetto() },
			teamRoundState: {
				ours: { ...trs.ours, originalPozzetto: [...trs.ours.originalPozzetto] },
				opponents: { ...trs.opponents, originalPozzetto: [...trs.opponents.originalPozzetto] },
			},
		};
	}

	private applySnapshot(): void {
		const s = this.turnSnapshotSignal();
		if (!s) return;
		this.hands.update((h) => ({ ...h, [s.player]: s.hand }));
		this.melds.update((m) => ({ ...m, [s.team]: s.teamMelds }));
		this.pozzetti.set(s.pozzetti);
		this.playerHasTakenPozzetto.set(s.playerHasTakenPozzetto);
		this.teamRoundState.set(s.teamRoundState);
		this.turnSnapshotSignal.set(null);
	}

	private ensureActionContext(step: RoundTurnStep): RoundPlayer | null {
		if (this.phase() !== 'in_progress') {
			this.rejectAction('La mano non e in corso.');
			return null;
		}

		if (this.turnStep() !== step) {
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
		this.eventsSubject.next({
			type: 'action_rejected',
			reason,
		});
		return false;
	}

	private addCardsToHand(player: RoundPlayer, cards: string[]) {
		this.hands.update((value) => {
			return {
				...value,
				[player]: value[player].concat(cards),
			};
		});
	}

	private removeCardsFromPlayer(player: RoundPlayer, cards: string[]): boolean {
		const hand = this.hands()[player];
		const updated = removeCards(hand, cards);
		if (!updated) return false;

		this.hands.update((value) => {
			return {
				...value,
				[player]: updated,
			};
		});
		return true;
	}

	private playerHasAllCards(player: RoundPlayer, cards: string[]): boolean {
		const hand = this.hands()[player];
		return !!removeCards(hand, cards);
	}

	private tryTakePozzettoDirect(player: RoundPlayer) {
		const hand = this.hands()[player];
		const alreadyTaken = this.playerHasTakenPozzetto()[player];
		if (!hand.length && !alreadyTaken) {
			this.takePozzetto(player, 'direct');
		}
	}

	private takePozzetto(player: RoundPlayer, mode: PozzettoMode): boolean {
		const team = TEAM_BY_PLAYER[player];
		const teamState = this.teamRoundState()[team];
		if (teamState.hasTakenPozzetto) {
			return this.rejectAction('La squadra ha gia preso il proprio pozzetto.');
		}

		const availablePozzetti = this.pozzetti();
		if (!availablePozzetti.length) {
			return this.rejectAction('Nessun pozzetto disponibile.');
		}

		const [pozzetto, ...remaining] = availablePozzetti;
		this.pozzetti.set(remaining);
		this.addCardsToHand(player, pozzetto);

		this.playerHasTakenPozzetto.update((value) => {
			return {
				...value,
				[player]: true,
			};
		});

		this.teamRoundState.update((value) => {
			return {
				...value,
				[team]: {
					hasTakenPozzetto: true,
					takenBy: player,
					takenWithDiscard: mode === 'after_discard',
					originalPozzetto: pozzetto.slice(),
					cardsPlayedAfterPozzetto: 0,
				},
			};
		});

		this.lastError.set(null);
		this.eventsSubject.next({
			type: 'pozzetto_taken',
			player,
			team,
			mode,
			cards: pozzetto.length,
		});

		return true;
	}

	private markCardsPlayedAfterPozzetto(player: RoundPlayer, cardsPlayed: number) {
		const team = TEAM_BY_PLAYER[player];

		this.teamRoundState.update((value) => {
			const teamState = value[team];
			if (!teamState.hasTakenPozzetto || teamState.takenBy !== player) return value;
			return {
				...value,
				[team]: {
					...teamState,
					cardsPlayedAfterPozzetto: teamState.cardsPlayedAfterPozzetto + cardsPlayed,
				},
			};
		});
	}

	private advanceTurn(previousPlayer: RoundPlayer) {
		if (this.phase() !== 'in_progress') return;
		this.turnSnapshotSignal.set(null);

		const next = this.nextPlayer(previousPlayer);
		this.currentPlayer.set(next);
		this.turnStep.set('draw_or_collect');
		this.turnIndex.update((value) => value + 1);

		this.eventsSubject.next({
			type: 'turn_changed',
			previousPlayer,
			currentPlayer: next,
		});
	}

	private closeRound(winnerPlayer: RoundPlayer) {
		this.turnSnapshotSignal.set(null);
		const winnerTeam = TEAM_BY_PLAYER[winnerPlayer];
		const score = this.calculateScore(winnerTeam);

		this.phase.set('closed');
		this.winnerPlayer.set(winnerPlayer);
		this.winnerTeam.set(winnerTeam);
		this.score.set(score);
		this.turnStep.set('draw_or_collect');
		this.lastError.set(null);

		this.eventsSubject.next({
			type: 'round_closed',
			winnerPlayer,
			winnerTeam,
			score,
		});
	}

	private calculateScore(winnerTeam: RoundTeam): RoundScore {
		const teamRoundState = this.teamRoundState();
		const atLeastOnePozzettoTaken =
			teamRoundState.ours.hasTakenPozzetto || teamRoundState.opponents.hasTakenPozzetto;

		return {
			ours: this.calculateTeamScore('ours', winnerTeam, atLeastOnePozzettoTaken),
			opponents: this.calculateTeamScore('opponents', winnerTeam, atLeastOnePozzettoTaken),
		};
	}

	private calculateTeamScore(
		team: RoundTeam,
		winnerTeam: RoundTeam,
		atLeastOnePozzettoTaken: boolean,
	): RoundTeamScore {
		const melds = this.melds()[team];
		const [firstPlayer, secondPlayer] = TEAM_PLAYERS[team];
		const firstHand = this.hands()[firstPlayer];
		const secondHand = this.hands()[secondPlayer];
		const teamState = this.teamRoundState()[team];

		const openMeldPoints = this.sumCardsPoints(melds.flat());
		const burracoBonus = melds.reduce((total, meld) => total + this.getBurracoBonus(meld), 0);
		const closureBonus = winnerTeam === team ? 100 : 0;

		const remainingHandPenalty = this.sumCardsPoints(firstHand.concat(secondHand));
		const pozzettoNotTakenPenalty =
			!teamState.hasTakenPozzetto && atLeastOnePozzettoTaken ? 100 : 0;
		const pozzettoTakenNotPlayedPenalty =
			teamState.hasTakenPozzetto && teamState.cardsPlayedAfterPozzetto === 0
				? this.sumCardsPoints(teamState.originalPozzetto)
				: 0;
		const penalizedCardsPenalty = 0;

		const positive = openMeldPoints + burracoBonus + closureBonus;
		const negative =
			remainingHandPenalty +
			pozzettoNotTakenPenalty +
			pozzettoTakenNotPlayedPenalty +
			penalizedCardsPenalty;

		return {
			positive,
			negative,
			total: positive - negative,
			breakdown: {
				openMeldPoints,
				burracoBonus,
				closureBonus,
				remainingHandPenalty,
				pozzettoNotTakenPenalty,
				pozzettoTakenNotPlayedPenalty,
				penalizedCardsPenalty,
			},
		};
	}

	private getBurracoBonus(meld: string[]): number {
		if (meld.length < 7) return 0;
		const burracoType = this.classifyBurraco(meld);

		switch (burracoType) {
			case 'clean':
				return 200;
			case 'semi_clean':
				return 150;
			default:
				return 100;
		}
	}

	private classifyBurraco(meld: string[]): BurracoType {
		const cards = meld.map((tag) => new DeckItem(tag));
		const wildCards = cards.filter((card, index) => this.isWildForBurraco(cards, index));
		const naturals = cards.filter((card, index) => !this.isWildForBurraco(cards, index));

		if (!wildCards.length) return 'clean';
		if (wildCards.length > 1) return 'dirty';

		const isCombination =
			naturals.length > 0 && naturals.every((card) => card.value === naturals[0].value);
		const isSequence =
			naturals.length > 0 && naturals.every((card) => card.suit === naturals[0].suit);

		if (isCombination && meld.length === 8) return 'semi_clean';
		if (isSequence && this.isWildOnMeldEdge(cards)) return 'semi_clean';

		return 'dirty';
	}

	private isWildForBurraco(cards: DeckItem[], index: number): boolean {
		const card = cards[index];
		if (!card) return false;
		if (card.value === '*') return true;
		if (card.value !== '2') return false;
		return !this.isNaturalTwo(cards, index);
	}

	private isNaturalTwo(cards: DeckItem[], index: number): boolean {
		const current = cards[index];
		if (!current || current.value !== '2') return false;

		const nearCards = [cards[index - 1], cards[index + 1]].filter(Boolean);
		return nearCards.some(
			(card) => card.suit === current.suit && (card.value === 'A' || card.value === '3'),
		);
	}

	private isWildOnMeldEdge(cards: DeckItem[]): boolean {
		if (!cards.length) return false;
		return this.isWildForBurraco(cards, 0) || this.isWildForBurraco(cards, cards.length - 1);
	}

	private sumCardsPoints(cards: string[]): number {
		return cards.reduce((total, card) => total + this.getCardPoints(card), 0);
	}

	private getCardPoints(card: string): number {
		const value = parseCardValue(card);
		if (value === '*') return 30;
		if (value === '2') return 20;
		if (value === 'A') return 15;
		if (value === 'K' || value === 'Q' || value === 'J') return 10;
		if (value === '10') return 10;
		return 5;
	}

	private createPozzetti(deck: string[]): [string[], string[]] {
		const first: string[] = [];
		const second: string[] = [];

		for (let i = 0; i < 22; i++) {
			const card = deck.pop();
			if (!card) break;
			if (i % 2 === 0) {
				first.push(card);
			} else {
				second.push(card);
			}
		}

		return [first, second];
	}

	private buildDistributionOrder(firstPlayer: RoundPlayer): RoundPlayer[] {
		const startIndex = PLAYER_ORDER.indexOf(firstPlayer);
		return PLAYER_ORDER.slice(startIndex).concat(PLAYER_ORDER.slice(0, startIndex));
	}

	private pickRandomPlayer(): RoundPlayer {
		const index = Math.floor(Math.random() * PLAYER_ORDER.length);
		return PLAYER_ORDER[index];
	}

	private nextPlayer(player: RoundPlayer): RoundPlayer {
		const currentIndex = PLAYER_ORDER.indexOf(player);
		const nextIndex = (currentIndex + 1) % PLAYER_ORDER.length;
		return PLAYER_ORDER[nextIndex];
	}

	private shuffleDeck(deck: string[]): string[] {
		const shuffled = deck.slice();
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const tmp = shuffled[i];
			shuffled[i] = shuffled[j];
			shuffled[j] = tmp;
		}
		return shuffled;
	}
}

function normalizeCards(cards: string[] = []): string[] {
	return cards.map((card) => card?.trim()).filter(Boolean);
}

function createEmptyHands(): Record<RoundPlayer, string[]> {
	return {
		east: [],
		west: [],
		north: [],
		south: [],
	};
}

function createEmptyMelds(): Record<RoundTeam, string[][]> {
	return {
		opponents: [],
		ours: [],
	};
}

function createEmptyPlayerPozzettiState(): Record<RoundPlayer, boolean> {
	return {
		east: false,
		west: false,
		north: false,
		south: false,
	};
}

function createEmptyTeamRoundState(): Record<RoundTeam, TeamRoundState> {
	return {
		opponents: {
			hasTakenPozzetto: false,
			takenBy: null,
			takenWithDiscard: false,
			originalPozzetto: [],
			cardsPlayedAfterPozzetto: 0,
		},
		ours: {
			hasTakenPozzetto: false,
			takenBy: null,
			takenWithDiscard: false,
			originalPozzetto: [],
			cardsPlayedAfterPozzetto: 0,
		},
	};
}

function removeCards(source: string[], toRemove: string[]): string[] | null {
	const remaining = source.slice();
	for (const card of toRemove) {
		const index = remaining.indexOf(card);
		if (index < 0) return null;
		remaining.splice(index, 1);
	}
	return remaining;
}

function deckItemsToTags(items: DeckItem[]): string[] {
	return Array.from(items, (item) => item.tag);
}
