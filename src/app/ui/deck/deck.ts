import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';

import { Card } from '../card/card';
import { CommonModule } from '@angular/common';


class DeckItem {
	static uid = 0;
	public uid:number;
	public tag:string;

	constructor(card:string) {
		this.uid = DeckItem.uid++;
		this.tag = card;
	}
}

@Component({
	selector: 'ui-deck',
	imports: [
		CommonModule,
    	Card,
	],
	templateUrl: './deck.html',
	styleUrl: './deck.scss'
})
export class Deck {

	cards = input<string[]>();

	list = linkedSignal<DeckItem[]>(()=>this.cards().map(c=>new DeckItem(c)));

	selectedSet = signal<Set<number>>(new Set());

	public selecteds = computed<DeckItem[]>(()=>Array.from(this.selectedSet()).map(uid=>this.list().find(item=>item.uid == uid)));
	selectedsChange = output<Set<number>>();

	shuffle() {
		

		this.list.update(items=>items.sort((a,b)=>Math.random()-0.5));
	}

	toggleItem(uid:number) {
		if (this.selectedSet().has(uid)) {
			this.selectedSet().delete(uid);
		} else {
			this.selectedSet().add(uid);
		}

		this.selectedsChange.emit(this.selectedSet());
	}

	removeItems(toRemove:DeckItem[]) {
		if (!toRemove) return;
		this.list.update(items=>items.filter(item=>!toRemove.some(toRemoveItem=>toRemoveItem.uid == item.uid)));
		this.selectedSet.update(itemSet=>new Set(Array.from(itemSet).filter(uid=>!toRemove.some(toRemoveItem=>toRemoveItem.uid==uid))));
	}

	addItems(toAdd:DeckItem[]) {
		if (!toAdd) return;
		this.list.update(cards=>cards.concat(toAdd));
	}
	
}
