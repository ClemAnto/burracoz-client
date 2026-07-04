import { NgClass, UpperCasePipe } from '@angular/common';
import { AfterViewInit, Component, computed, inject, signal, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { Game } from '../../services/game';
import {
	DealResult,
	PlayerSide,
	RoundPhase,
	RoundPlayer,
	RoundTurnStep,
} from '../../services/round';
import { Deck } from '../deck/deck';
import { Tweener } from '../tweener/tweener';

@Component({
	selector: 'ui-board',
	imports: [NzButtonModule, NzTagModule, Deck, Tweener, UpperCasePipe, NgClass],
	templateUrl: './board.html',
	host: {
		class: 'flex flex-col flex-1 min-h-0 w-full relative overflow-hidden',
	},
})
export class Board implements AfterViewInit {
	@ViewChild('tweener') tweener: Tweener;
	@ViewChild('drawPile') drawPile: Deck;
	@ViewChild('discardPile') discardPile: Deck;
	@ViewChild('pot1') pot1: Deck;
	@ViewChild('pot2') pot2: Deck;
	@ViewChild('northDeck') northDeck: Deck;
	@ViewChild('southDeck') southDeck: Deck;
	@ViewChild('eastDeck') eastDeck: Deck;
	@ViewChild('westDeck') westDeck: Deck;

	private game = inject(Game);

	readonly RoundPhase = RoundPhase;
	readonly RoundTurnStep = RoundTurnStep;
	readonly PlayerSide = PlayerSide;

	readonly PLAYER_LABELS: Record<PlayerSide, string> = {
		[PlayerSide.North]: 'NORD',
		[PlayerSide.East]: 'EST',
		[PlayerSide.South]: 'SUD',
		[PlayerSide.West]: 'OVEST',
	};

	// Modalità debug: tutte le mani scoperte (true = carte visibili per tutti)
	debug = signal(true);
	playAsEveryone = computed(() => this.debug());

	// Log [tween] + audit di univocità: separato dal debug delle mani perché i
	// console.log per-batch costano durante le animazioni di massa (deal).
	tweenDebug = signal(false);

	animate = signal(true);
	private resetGen = 0;

	currentPlayer = this.game.currentPlayer;
	eastCards = computed(() => this.game.hands().east);
	westCards = computed(() => this.game.hands().west);
	northCards = computed(() => this.game.hands().north);
	southCards = computed(() => this.game.hands().south);
	drawPileCards = this.game.drawPile;
	discardPileCards = this.game.discardPile;
	pot1Cards = computed(() => this.game.pots()[0] ?? []);
	pot2Cards = computed(() => this.game.pots()[1] ?? []);
	turnStep = this.game.turnStep;
	totalScore = this.game.totalScore;

	winnerPlayer = this.game.winnerPlayer;
	handScore = this.game.handScore;
	isGameEnded = this.game.isGameEnded;
	gameWinner = this.game.gameWinner;

	ourZoneActive = computed(
		() =>
			this.canPlay() &&
			(this.currentPlayer() === PlayerSide.North ||
				this.currentPlayer() === PlayerSide.South),
	);
	theirZoneActive = computed(
		() =>
			this.canPlay() &&
			(this.currentPlayer() === PlayerSide.East || this.currentPlayer() === PlayerSide.West),
	);

	ourMeldsData = computed(() => this.game.melds().ours);
	theirMeldsData = computed(() => this.game.melds().opponents);

	canDraw = computed(
		() =>
			this.roundPhase() === RoundPhase.InProgress &&
			this.turnStep() === RoundTurnStep.DrawOrCollect &&
			(this.playAsEveryone() || this.currentPlayer() === PlayerSide.South),
	);

	canPlay = computed(
		() =>
			this.roundPhase() === RoundPhase.InProgress &&
			this.turnStep() === RoundTurnStep.PlayAndDiscard &&
			(this.playAsEveryone() || this.currentPlayer() === PlayerSide.South),
	);

	canUndo = computed(() => false);
	isHandClosed = computed(() => this.roundPhase() === RoundPhase.Closed);

	roundPhase = this.game.roundPhase;

	lastError = signal<string>(null);

	private dealAbort: AbortController | null = null;

	/** True mentre un'azione animata (pesca/scarto) è in corso: blocca la rientranza da doppio click. */
	private busy = false;

	attachToMeld(meldIndex: number) {
		const deck = this.playerDecks[this.currentPlayer()];
		if (!deck) return;
		// Istanze, non tag: nel mazzo doppio il tag è ambiguo (due copie identiche)
		// e il Round rimuoverebbe potenzialmente la copia sbagliata dalla mano.
		const cards = deck.selecteds();
		if (!cards.length) return;
		this.game.attachToMeld(meldIndex, cards);
		deck.selecteds.set([]);
		deck.autosortNow();
	}

	addMeld() {
		const deck = this.playerDecks[this.currentPlayer()];
		if (!deck) return;
		const cards = deck.selecteds();
		if (!cards.length) return;
		this.game.openMeld(cards);
		deck.selecteds.set([]);
		deck.autosortNow();
	}

	async willTakeFromDrawPile() {
		if (this.busy) return;
		if (!this.game.drawPile().length) return;
		const player = this.currentPlayer();

		this.busy = true;
		try {
			// Commit diretto: i signal del Round spostano la carta e il FLIP
			// dello scope anima da solo il volo tallone → mano.
			if (!this.game.drawFromStock()) return;

			await this.tweener.whenIdle();
			// Riordino solo ora, a pesca (animazione) conclusa.
			this.playerDecks[player]?.autosortNow();
		} finally {
			this.busy = false;
		}
	}

	async willTakeDiscardPile() {
		if (this.busy) return;
		if (!this.game.discardPile().length) return;
		const player = this.currentPlayer();

		this.busy = true;
		try {
			// Commit diretto: i signal del Round spostano l'intero monte in mano
			// e il FLIP dello scope anima da solo il volo scarti → mano.
			if (!this.game.takeDiscardPile()) return;

			await this.tweener.whenIdle();
			// Riordino solo ora, a raccolta (animazione) conclusa.
			this.playerDecks[player]?.autosortNow();
		} finally {
			this.busy = false;
		}
	}

	private playerDecks: Partial<Record<RoundPlayer, Deck>> = {};

	ngAfterViewInit() {
		this.playerDecks = {
			[PlayerSide.North]: this.northDeck,
			[PlayerSide.East]: this.eastDeck,
			[PlayerSide.South]: this.southDeck,
			[PlayerSide.West]: this.westDeck,
		};
	}

	/**
	 * Anima la distribuzione delle carte usando le istanze DeckItem già calcolate
	 * da game.prepareHand(). Al termine, i Deck component hanno le stesse istanze
	 * che commitHand() scriverà nei signal → nessun salto visivo.
	 */
	private async deal(result: DealResult, signal: AbortSignal): Promise<void> {
		const check = () => {
			if (signal.aborted) throw new DOMException('aborted', 'AbortError');
		};
		const dealOrder: RoundPlayer[] = this.buildDealOrder(result.firstPlayer);

		// 11 giri × 4 giocatori, una carta per volta
		for (let i = 0; i < 11; i++) {
			for (const player of dealOrder) {
				const card = result.hands[player][i];
				if (!card) continue;
				this.drawPile.removeItems([card]);
				this.playerDecks[player].put([card]);
				await sleep(10);
				check();
			}
		}

		await this.tweener.whenIdle();
		check();
		await sleep(500);
		check();

		// Pozzetti
		for (let i = 0; i < 2; i++) {
			const cards = result.pots[i];
			this.drawPile.removeItems(cards);
			[this.pot1, this.pot2][i].put(cards);
			await sleep(500);
			check();
		}

		await this.tweener.whenIdle();
		check();

		// Prima carta degli scarti
		if (result.discard) {
			this.drawPile.removeItems([result.discard]);
			this.discardPile.put([result.discard]);
		}
	}

	private buildDealOrder(firstPlayer: RoundPlayer): RoundPlayer[] {
		const ORDER: PlayerSide[] = [
			PlayerSide.North,
			PlayerSide.East,
			PlayerSide.South,
			PlayerSide.West,
		];
		const start = ORDER.indexOf(firstPlayer);
		return [...ORDER.slice(start), ...ORDER.slice(0, start)];
	}

	async startGame() {
		this.dealAbort?.abort();
		this.dealAbort = new AbortController();
		this.game.startGame();
		const deal = await this.game.prepareHand();
		try {
			await this.deal(deal, this.dealAbort.signal);
			this.game.commitHand(deal);
			// Riordino delle mani solo a distribuzione conclusa.
			this.sortHands();
		} catch (e: any) {
			if (e?.name !== 'AbortError') throw e;
		}
	}

	/** Riordina tutte le mani per seme→rank (da chiamare a animazioni concluse). */
	private sortHands() {
		for (const p of [PlayerSide.North, PlayerSide.East, PlayerSide.South, PlayerSide.West]) {
			this.playerDecks[p]?.autosortNow();
		}
	}

	async resetGame() {
		const gen = ++this.resetGen;
		this.dealAbort?.abort();
		this.animate.set(false);
		this.tweener?.reset();
		await sleep(0); // attende che Angular processi animate=false (e azzeri le leave animations) prima di cambiare i segnali delle carte
		if (gen !== this.resetGen) return;
		await this.game.resetGame();
		if (gen === this.resetGen) this.animate.set(true);
	}

	undoTurn() {}

	async discard() {
		if (this.busy) return;
		const player = this.currentPlayer();
		const deck = this.playerDecks[player];
		if (!deck) return;
		const [card] = deck.selecteds();
		if (!card) return;

		this.busy = true;
		try {
			// L'istanza, non il tag: col tag il Round potrebbe rimuovere dalla mano
			// l'ALTRA copia identica della stessa carta (mazzo doppio).
			// Commit diretto: il Round scopre la carta e la sposta negli scarti,
			// il FLIP dello scope anima da solo il volo mano → scarti.
			if (!this.game.discard(card)) return;
			deck.selecteds.update((s) => s.filter((c) => c.uid !== card.uid));

			await this.tweener.whenIdle();
			// Riordino della mano di chi ha giocato (copre l'eventuale presa del pozzetto).
			deck.autosortNow();
		} finally {
			this.busy = false;
		}
	}

	async nextHand() {
		// Stesso AbortController di startGame: così un RESET durante la
		// distribuzione della nuova mano può interrompere l'animazione.
		this.dealAbort?.abort();
		this.dealAbort = new AbortController();
		// prepareHand ricostituisce e rimescola il mazzo (le carte tornano al tallone):
		// attende che l'animazione di raccolta si concluda prima di ridistribuire.
		const deal = await this.game.prepareHand();
		await this.tweener.whenIdle();
		try {
			await this.deal(deal, this.dealAbort.signal);
			this.game.commitHand(deal);
			this.sortHands();
		} catch (e: any) {
			if (e?.name !== 'AbortError') throw e;
		}
	}
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}
