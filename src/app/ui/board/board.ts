import { CommonModule } from '@angular/common';
import { Component, signal, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { STARTER_DECK } from '../../services/cards';
import { Deck } from '../deck/deck';
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
	@ViewChild("tableDeck") tableDeck:Deck;
	@ViewChild("myDeck") myDeck:Deck;

	//tableDeck: string[] = shuffle(STARTER_DECK);
	tableCards = signal<string[]>(STARTER_DECK.concat(STARTER_DECK));
	myCards = signal<string[]>([]);

	shuffle() {
		this.tableDeck.shuffle();
	}

	move() {
		const items = this.tableDeck.selecteds();
		console.log("[BOARD] move: ", items);
		this.tableDeck.removeItems(items);
		this.myDeck.addItems(items);
		
	}
}
