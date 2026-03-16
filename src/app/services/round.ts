import { Injectable, computed, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { DeckItem } from '../ui/deck/deck';
import { STARTER_DECK } from './cards';

export type RoundPlayer = 'east' | 'west' | 'north' | 'south';
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

// TODO: rimuovere quando game.ts verrà aggiornato
export type RoundSavedState = unknown;

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

const PLAYER_ORDER: RoundPlayer[] = ['north', 'east', 'south', 'west'];

export const TEAM_BY_PLAYER: Record<RoundPlayer, RoundTeam> = {
	east: 'opponents',
	west: 'opponents',
	north: 'ours',
	south: 'ours',
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
	pozzetti    = signal<DeckItem[][]>([]);
	melds       = signal<Record<RoundTeam, DeckItem[][]>>(createEmptyMelds());
	initialized = signal<boolean>(false);
	// TODO: placeholder — da implementare
	winnerPlayer            = signal<RoundPlayer | null>(null);
	winnerTeam              = signal<RoundTeam | null>(null);
	score                   = signal<RoundScore | null>(null);
	lastError               = signal<string | null>(null);
	playerHasTakenPozzetto  = signal<Record<RoundPlayer, boolean>>({ east: false, west: false, north: false, south: false });
	teamHasBurraco          = computed(() => ({ ours: false, opponents: false }));
	canUndoTurn             = computed(() => false);

	// TODO: placeholder — da implementare
	readonly events = new Subject<{ type: 'round_closed'; winnerPlayer: RoundPlayer; winnerTeam: RoundTeam; score: RoundScore }>();

	currentTeam = computed<RoundTeam | null>(() => {
		const player = this.currentPlayer();
		return player ? TEAM_BY_PLAYER[player] : null;
	});

	async prepareDeck() {
		

		if (this.initialized()) {
			var draws = this.drawPile().slice();

		
			draws = [...draws, ...this.hands().south.slice()];
			
			//draws.push(...this.hands().east.splice(0));
			//draws.push(...this.hands().west.splice(0));
			//draws.push(...this.hands().north.splice(0));
			//draws.push(...this.hands().south.splice(0));
			//draws.push(...this.discardPile().splice(0));
			//draws.push(...this.pozzetti().slice().flat());
			this.discardPile.set([]);
			this.pozzetti.set([]);
			this.drawPile.set(draws);
			this.hands.set(createEmptyHands());
			await sleep(10);
			

		} else {
			DeckItem.uid = 1;
			this.initialized.set(true);
			const deck = this.shuffleDeck(
				[...STARTER_DECK, ...STARTER_DECK].map((tag) => new DeckItem(tag, true)),
			);
			this.drawPile.set(deck);
			this.discardPile.set([]);
			this.pozzetti.set([]);
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
		const deck = this.drawPile().slice();
		const dealer = this.pickRandomPlayer();
		const firstPlayer = this.nextPlayer(dealer);
		const order = this.buildDistributionOrder(firstPlayer);
		const hands = createEmptyHands();

		for (const player of order) {
			hands[player] = deck.splice(0, 11);
		}

		const [firstPozzetto, secondPozzetto] = this.createPozzetti(deck);
		const firstDiscard = deck.pop();

		this.phase.set(RoundPhase.InProgress);
		this.dealer.set(dealer);
		this.currentPlayer.set(firstPlayer);
		this.turnStep.set(RoundTurnStep.DrawOrCollect);
		this.turnIndex.set(1);

		this.hands.set(hands);
		this.drawPile.set(deck);
		this.discardPile.set(firstDiscard ? [firstDiscard] : []);
		this.pozzetti.set([firstPozzetto, secondPozzetto]);
		this.melds.set(createEmptyMelds());
	}

	// TODO: placeholder — da implementare
	getState(): RoundSavedState                              { return null; }
	restoreState(state: RoundSavedState): void               {}
	drawFromTallone(): boolean                               { return false; }
	takeDiscardPile(): boolean                               { return false; }
	openMeld(cards: string[]): boolean                       { return false; }
	attachToMeld(meldIndex: number, cards: string[]): boolean { return false; }
	discard(card: string): boolean                           { return false; }
	undoTurn(): boolean                                      { return false; }

	private createPozzetti(deck: DeckItem[]): [DeckItem[], DeckItem[]] {
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

function createEmptyHands(): Record<RoundPlayer, DeckItem[]> {
	return { east: [], west: [], north: [], south: [] };
}

function createEmptyMelds(): Record<RoundTeam, DeckItem[][]> {
	return { opponents: [], ours: [] };
}
