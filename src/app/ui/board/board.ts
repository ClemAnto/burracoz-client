import { CommonModule } from '@angular/common';
import { Component, signal, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { STARTER_DECK } from '../../services/cards';
import { Deck, DeckItem } from '../deck/deck';
import { Tweener } from "../tweener/tweener";

@Component({
	selector: 'ui-board',
	imports: [
		CommonModule,
		NzButtonModule,
		Deck,
		Tweener
	],
	templateUrl: './board.html'
})
export class Board {
	@ViewChild("drawPile") drawPile:Deck;
	@ViewChild("discardPile") discardPile:Deck;
	@ViewChild("myDeck") myDeck:Deck;

	//tableDeck: string[] = shuffle(STARTER_DECK);
	tableCards = signal<string[]>(STARTER_DECK.concat(STARTER_DECK));
	//tableCards = signal<string[]>(STARTER_DECK);
	discardCards = signal<string[]>([]);
	myCards = signal<string[]>([]);
	myMelds = signal<DeckItem[][]>([])
	animate = signal<boolean>(true)

	shuffle() {
		this.drawPile.shuffle();
	}

	move() {
		const items = this.drawPile.selecteds();
		console.log("[BOARD] move: ", items);
		this.drawPile.removeItems(items);
		this.myDeck.put(items);
		
	}

	start() {
		this.animate.set(false);
		//requestAnimationFrame(()=>{
		this.drawPile.shuffle();
		

		this.animate.set(true);
		const myCards = this.drawPile.take(11);
		this.myDeck.put(myCards);

		const [card] = this.drawPile.take(1);
		this.discardPile.put([card]);
			
	}

	check() {
		const cards = this.myDeck.selecteds();
		this.myDeck.removeItems(cards);
		this.myMelds().push(cards);
	}

	willTakeDiscardPile() {
		const cards = this.discardPile.takeAll();
		this.myDeck.put(cards);
	}

	willTakeFromDrawPile() {
		const cards = this.drawPile.take(1);
		this.myDeck.put(cards);
	}
}
