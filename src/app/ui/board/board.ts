import { CommonModule } from '@angular/common';
import { Component, signal, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { firstValueFrom, Subject } from 'rxjs';
import { STARTER_DECK } from '../../services/cards';
import { sleep } from '../../utils/rx';
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
	animate = signal<boolean>(true);

	animationComplete = new Subject<any>();
	noMoreAnimations = new Subject<void>();

	shuffle() {
		this.drawPile.shuffle();
	}

	move() {
		const items = this.drawPile.selecteds();
		console.log("[BOARD] move: ", items);
		this.drawPile.removeItems(items);
		this.myDeck.put(items);
		
	}

	async start() {
		
		//requestAnimationFrame(()=>{
		this.drawPile.shuffle();
		
		
		
		const myCards = this.drawPile.take(11);
		this.myDeck.put(myCards);

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
		this.myMelds().push(cards);
	}

	attachToMeld(pile:Deck) {
		const cards = this.myDeck.selecteds();
		pile.willAttach(cards);
		/*
		this.myDeck.freeze();
		this.myDeck.removeItems(cards);
		pile.put(cards);
		*/
	}

	willTakeDiscardPile() {
		const cards = this.discardPile.takeAll();
		this.myDeck.put(cards);
	}

	willTakeFromDrawPile() {
		const cards = this.drawPile.take(1);
		this.myDeck.put(cards);
	}

	onTweenComplete(tweenInfo:any) {
		this.animationComplete.next(tweenInfo);
		if (!tweenInfo.pendings) this.noMoreAnimations.next();
	}
}
