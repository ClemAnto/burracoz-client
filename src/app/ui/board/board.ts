import { NgClass, UpperCasePipe } from '@angular/common';
import { AfterViewInit, Component, computed, inject, signal, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { Game } from '../../services/game';
import { RoundPhase, RoundPlayer, RoundTurnStep } from '../../services/round';
import { Deck } from '../deck/deck';
import { Tweener } from '../tweener/tweener';

@Component({
	selector: 'ui-board',
	imports: [NzButtonModule, Deck, Tweener, UpperCasePipe, NgClass],
	templateUrl: './board.html',
	host: {
		class: 'flex flex-col flex-1 min-h-0 w-full relative overflow-hidden',
	},
})
export class Board implements AfterViewInit {
	@ViewChild('drawPile')    drawPile:    Deck;
	@ViewChild('discardPile') discardPile: Deck;
	@ViewChild('northDeck')   northDeck:      Deck;
	@ViewChild('southDeck')   southDeck:      Deck;
	@ViewChild('eastDeck')    eastDeck:       Deck;
	@ViewChild('westDeck')    westDeck:       Deck;

	private game = inject(Game);

	readonly RoundPhase = RoundPhase;
	readonly RoundTurnStep = RoundTurnStep;

	// Modalità debug: tutte le mani scoperte (true = carte visibili per tutti)
	debug = signal(true);

	animate = signal(true);
	
	currentPlayer = this.game.currentPlayer;
	eastCards = computed(()=>this.game.hands().east);
	westCards = computed(()=>this.game.hands().west);
	northCards = computed(()=>this.game.hands().north);
	southCards = computed(()=>this.game.hands().south);
	drawPileCards = this.game.drawPile;
	discardPileCards = this.game.discardPile;
	turnStep = this.game.turnStep;
	totalScore = this.game.totalScore;

	winnerPlayer = this.game.winnerPlayer;
	handScore = this.game.handScore;

	ourZoneActive = computed(()=>false);
	theirZoneActive = computed(()=>false);

	ourMeldsData = computed<any[]>(()=>[]);
	theirMeldsData = computed<any[]>(()=>[]);


	canDraw = computed(()=>false);
	canPlay = computed(()=>false);
	canUndo = computed(()=>false);
	isHandClosed = computed(()=>false);

	roundPhase = this.game.roundPhase;

	lastError = signal<string>(null);

	onTweenComplete() {}

	attachToMeld(meldIndex:number) {

	}

	addMeld() {

	}

	willTakeFromDrawPile(){

	}

	willTakeDiscardPile() {

	}

	private playerDecks: Partial<Record<RoundPlayer, Deck>> = {};

	ngAfterViewInit() {
		this.playerDecks = {
			north: this.northDeck,
			east:  this.eastDeck,
			south: this.southDeck,
			west:  this.westDeck,
		};
	}

	async dealAnimation() {
		const order: RoundPlayer[] = ['north', 'east', 'south', 'west'];

		for (const player of order) {
			const cards = this.drawPile.take(11);
			this.playerDecks[player].put(cards);
			await sleep(100);
		}

		await sleep(5000);

		for (const player of order) {
			const cards = this.playerDecks[player].takeAll();
			this.drawPile.put(cards);
			await sleep(100);
		}
	}

	async startGame() {
		await this.dealAnimation();
		return
		
		this.animate.set(false);
		this.game.startGame();
		await sleep(50);
		this.animate.set(true);
	}

	async resetGame() {
		this.animate.set(true);
		await this.game.resetGame();
		this.animate.set(true);
	}

	undoTurn() {

	}

	discard() {

	}

	nextHand() {

	}

}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
