import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';

import { Card } from '../card/card';
import { CommonModule } from '@angular/common';


export class DeckItem {
	static uid = 0;
	public uid:number;
	public tag:string;
	public faceDown:boolean;

	constructor(card:string, faceDown:boolean = false) {
		this.uid = DeckItem.uid++;
		this.tag = card;
		this.faceDown = faceDown;
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

	layout = input<'stack' | 'grid'>('grid');

	selectable = input<boolean>(false);
	faceDown = input<boolean>(null);
	
	cards = input<string[] | DeckItem[]>();

	list = linkedSignal<DeckItem[]>(()=>{
		return this.cards().map(c=>{
			if (typeof(c)=="string") return new DeckItem(c, this.faceDown());
			return c;
		})
	});

	

	selectedSet = signal<Set<number>>(new Set());

	public selecteds = computed<DeckItem[]>(()=>Array.from(this.selectedSet()).map(uid=>this.list().find(item=>item.uid == uid)));
	selectedsChange = output<Set<number>>();

	shuffle() {
		

		this.list.update(items=>items.sort((a,b)=>Math.random()-0.5));
	}

	toggleItem(uid:number) {
		if (!this.selectable()) return;

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

	put(toPut:DeckItem[]) {
		if (!toPut) return;
		if (this.faceDown() !== null) {
			toPut.forEach(item=>item.faceDown = this.faceDown());
		}
		this.list.update(cards=>cards.concat(toPut));
	}

	take(amount:number = 0):DeckItem[] {
		const items = this.list();
		const taken = items.splice(-amount, amount);
		this.list.set(items);
		return taken
	}

	takeAll() {
		return this.take(this.list().length);
	}
	
	offsetCurve(index:number) {
		const k = 0.1; 
		return 10 * (1 - Math.exp(-k * index));
	}
	
}
