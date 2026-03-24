import { NgClass, UpperCasePipe } from '@angular/common';
import { AfterViewInit, Component, computed, inject, signal, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { Game } from '../../services/game';
import { DealResult, PlayerSide, RoundPhase, RoundPlayer, RoundTurnStep } from '../../services/round';
import { Deck } from '../deck/deck';
import { Tweener } from '../tweener/tweener';
import { firstValueFrom, Subject } from 'rxjs';

@Component({
	selector: 'ui-board',
	imports: [NzButtonModule, Deck, Tweener, UpperCasePipe, NgClass],
	templateUrl: './board.html',
	host: {
		class: 'flex flex-col flex-1 min-h-0 w-full relative overflow-hidden',
	},
})
export class Board implements AfterViewInit {
	@ViewChild('tweener')     tweener:     Tweener;
	@ViewChild('drawPile')    drawPile:    Deck;
	@ViewChild('discardPile') discardPile: Deck;
	@ViewChild('pot1')   pot1:   Deck;
	@ViewChild('pot2')   pot2:   Deck;
	@ViewChild('northDeck')   northDeck:      Deck;
	@ViewChild('southDeck')   southDeck:      Deck;
	@ViewChild('eastDeck')    eastDeck:       Deck;
	@ViewChild('westDeck')    westDeck:       Deck;

	private game = inject(Game);

	readonly RoundPhase = RoundPhase;
	readonly RoundTurnStep = RoundTurnStep;
	readonly PlayerSide = PlayerSide;

	// Modalità debug: tutte le mani scoperte (true = carte visibili per tutti)
	debug = signal(true);
	playAsEveryone = computed(() => this.debug());

	animate = signal(true);
	private resetGen = 0;
	
	currentPlayer = this.game.currentPlayer;
	eastCards = computed(()=>this.game.hands().east);
	westCards = computed(()=>this.game.hands().west);
	northCards = computed(()=>this.game.hands().north);
	southCards = computed(()=>this.game.hands().south);
	drawPileCards = this.game.drawPile;
	discardPileCards = this.game.discardPile;
	pot1Cards = computed(() => this.game.pots()[0] ?? []);
	pot2Cards = computed(() => this.game.pots()[1] ?? []);
	turnStep = this.game.turnStep;
	totalScore = this.game.totalScore;

	winnerPlayer = this.game.winnerPlayer;
	handScore = this.game.handScore;

	ourZoneActive = computed(() =>
		this.canPlay() &&
		(this.currentPlayer() === PlayerSide.North || this.currentPlayer() === PlayerSide.South)
	);
	theirZoneActive = computed(() =>
		this.canPlay() &&
		(this.currentPlayer() === PlayerSide.East || this.currentPlayer() === PlayerSide.West)
	);

	ourMeldsData   = computed(() => this.game.melds().ours);
	theirMeldsData = computed(() => this.game.melds().opponents);


	canDraw = computed(() =>
		this.roundPhase() === RoundPhase.InProgress &&
		this.turnStep() === RoundTurnStep.DrawOrCollect &&
		(this.playAsEveryone() || this.currentPlayer() === PlayerSide.South)
	);

	canPlay = computed(() =>
		this.roundPhase() === RoundPhase.InProgress &&
		this.turnStep() === RoundTurnStep.PlayAndDiscard &&
		(this.playAsEveryone() || this.currentPlayer() === PlayerSide.South)
	);

	canUndo = computed(()=>false);
	isHandClosed = computed(() => this.roundPhase() === RoundPhase.Closed);

	roundPhase = this.game.roundPhase;

	lastError = signal<string>(null);

	tweenCompleted = new Subject<void>();
	private dealAbort: AbortController | null = null;

	onTweenComplete() {
		this.tweenCompleted.next();
	}

	attachToMeld(meldIndex: number) {
		const deck = this.playerDecks[this.currentPlayer()];
		if (!deck) return;
		const tags = deck.selecteds().map(c => c.tag);
		if (!tags.length) return;
		this.game.attachToMeld(meldIndex, tags);
		deck.selecteds.set([]);
	}

	addMeld() {
		const deck = this.playerDecks[this.currentPlayer()];
		if (!deck) return;
		const tags = deck.selecteds().map(c => c.tag);
		if (!tags.length) return;
		this.game.openMeld(tags);
		deck.selecteds.set([]);
	}

	async willTakeFromDrawPile() {
		const pile = this.game.drawPile();
		if (!pile.length) return;
		const card = pile.at(-1);
		const player = this.currentPlayer();

		this.drawPile.removeItems([card]);
		this.playerDecks[player]?.put([card]);

		await firstValueFrom(this.tweenCompleted);
		this.game.drawFromStock();
	}

	willTakeDiscardPile() {

	}

	private playerDecks: Partial<Record<RoundPlayer, Deck>> = {};

	ngAfterViewInit() {
		this.playerDecks = {
			[PlayerSide.North]: this.northDeck,
			[PlayerSide.East]:  this.eastDeck,
			[PlayerSide.South]: this.southDeck,
			[PlayerSide.West]:  this.westDeck,
		};
	}

	/**
	 * Anima la distribuzione delle carte usando le istanze DeckItem già calcolate
	 * da game.prepareHand(). Al termine, i Deck component hanno le stesse istanze
	 * che commitHand() scriverà nei signal → nessun salto visivo.
	 */
	private async deal(result: DealResult, signal: AbortSignal): Promise<void> {
		const check = () => { if (signal.aborted) throw new DOMException('aborted', 'AbortError'); };
		const dealOrder: RoundPlayer[] = this.buildDealOrder(result.firstPlayer);

		// 11 giri × 4 giocatori, una carta per volta
		for (let i = 0; i < 11; i++) {
			for (const player of dealOrder) {
				const card = result.hands[player][i];
				if (!card) continue;
				this.drawPile.removeItems([card]);
				this.playerDecks[player].put([card]);
				await sleep(10); check();
			}
		}

		await firstValueFrom(this.tweenCompleted); check();
		await sleep(500); check();

		// Pozzetti
		for (let i = 0; i < 2; i++) {
			const cards = result.pots[i];
			this.drawPile.removeItems(cards);
			[this.pot1, this.pot2][i].put(cards);
			await sleep(500); check();
		}

		await firstValueFrom(this.tweenCompleted); check();

		// Prima carta degli scarti
		if (result.discard) {
			this.drawPile.removeItems([result.discard]);
			this.discardPile.put([result.discard]);
		}
	}

	private buildDealOrder(firstPlayer: RoundPlayer): RoundPlayer[] {
		const ORDER: PlayerSide[] = [PlayerSide.North, PlayerSide.East, PlayerSide.South, PlayerSide.West];
		const start = ORDER.indexOf(firstPlayer);
		return [...ORDER.slice(start), ...ORDER.slice(0, start)];
	}

	async startGame() {
		this.dealAbort?.abort();
		this.dealAbort = new AbortController();
		this.game.startGame();
		const deal = this.game.prepareHand();
		try {
			await this.deal(deal, this.dealAbort.signal);
			this.game.commitHand(deal);
		} catch (e: any) {
			if (e?.name !== 'AbortError') throw e;
		}
	}

	async resetGame() {
		const gen = ++this.resetGen;
		this.dealAbort?.abort();
		this.tweenCompleted.next();
		this.animate.set(false);
		this.tweener?.reset();
		await sleep(0); // attende che Angular processi animate=false (e azzeri le leave animations) prima di cambiare i segnali delle carte
		if (gen !== this.resetGen) return;
		await this.game.resetGame();
		if (gen === this.resetGen) this.animate.set(true);
	}

	undoTurn() {

	}

	async discard() {
		const player = this.currentPlayer();
		const deck = this.playerDecks[player];
		if (!deck) return;
		const [card] = deck.selecteds();
		if (!card) return;

		deck.removeItems([card]);
		card.faceDown = false;
		this.discardPile.put([card]);

		await firstValueFrom(this.tweenCompleted);
		this.game.discard(card.tag);
	}

	async nextHand() {
		const deal = this.game.prepareHand();
		await this.deal(deal, new AbortController().signal);
		this.game.commitHand(deal);
	}

}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
