
import { Component, signal, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { Subject } from 'rxjs';
import { STARTER_DECK } from '../../services/cards';
import { sleep } from '../../utils/rx';
import { Deck, DeckItem } from '../deck/deck';
import { Tweener } from '../tweener/tweener';

@Component({
	selector: 'ui-board',
	imports: [NzButtonModule, Deck, Tweener],
	templateUrl: './board.html',
	host: {
		class: 'flex flex-col h-full w-full',
	},
})
export class Board {
	@ViewChild('drawPile') drawPile: Deck;
	@ViewChild('discardPile') discardPile: Deck;
	@ViewChild('myDeck') myDeck: Deck;
	@ViewChild('northDeck') northDeck: Deck;
	@ViewChild('eastDeck') eastDeck: Deck;
	@ViewChild('westDeck') westDeck: Deck;

	//tableDeck: string[] = shuffle(STARTER_DECK);
	tableCards = signal<string[]>(STARTER_DECK.concat(STARTER_DECK));
	//tableCards = signal<string[]>(STARTER_DECK);
	discardCards = signal<string[]>([]);
	northCards = signal<string[]>([]);
	eastCards = signal<string[]>([]);
	westCards = signal<string[]>([]);

	myCards = signal<string[]>([]);
	ourMelds = signal<DeckItem[][]>([]);
	theirMelds = signal<DeckItem[][]>([]);
	animate = signal<boolean>(true);

	animationComplete = new Subject<any>();
	noMoreAnimations = new Subject<void>();

	shuffle() {
		this.drawPile.shuffle();
	}

	move() {
		const items = this.drawPile.selecteds();
		console.log('[BOARD] move: ', items);
		this.drawPile.removeItems(items);
		this.myDeck.put(items);
	}

	async start() {
		//requestAnimationFrame(()=>{
		this.drawPile.shuffle();

		var count = 11;
		while (count--) {
			const north = this.drawPile.take(1);
			this.northDeck.put(north);

			const east = this.drawPile.take(1);
			this.eastDeck.put(east);

			const my = this.drawPile.take(1);
			this.myDeck.put(my);

			const west = this.drawPile.take(1);
			this.westDeck.put(west);
		}

		await sleep(500);

		const [card] = this.drawPile.take(1);
		this.discardPile.put([card]);

		//await firstValueFrom(this.noMoreAnimations);
	}

	async addMeld() {
		const cards = this.myDeck.validateLayOff();
		if (!cards) return;

		this.myDeck.freeze();
		this.myDeck.removeItems(cards);
		this.ourMelds().push(cards);
	}

	attachToMeld(pile: Deck) {
		const cards = this.myDeck.selecteds();
		const newMeld = pile.willAttach(cards);

		if (newMeld) {
			this.myDeck.freeze();
			this.myDeck.removeItems(cards);
		}
	}

	willTakeDiscardPile() {
		const cards = this.discardPile.takeAll();
		this.myDeck.put(cards);
	}

	willTakeFromDrawPile() {
		const cards = this.drawPile.take(1);
		this.myDeck.put(cards);
	}

	onTweenComplete(tweenInfo: any) {
		this.animationComplete.next(tweenInfo);
		if (!tweenInfo.pendings) this.noMoreAnimations.next();
	}
}
