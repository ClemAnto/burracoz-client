import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';

import { CommonModule } from '@angular/common';
import { CardValue, parseCardSuit, parseCardValue, Suit } from '../../services/cards';
import { Rules } from '../../services/rules';
import { Card } from '../card/card';


export class DeckItem {
	static uid = 0;
	public uid:number;
	public tag:string;
	public faceDown:boolean;
	public value:CardValue;
	public suit:Suit;

	constructor(card:string, faceDown:boolean = false) {
		this.uid = DeckItem.uid++;
		this.tag = card;
		this.value = parseCardValue(card.match(/[\w*]+/)[0]);
		this.suit = parseCardSuit(card.match(/\W+/)[0]);
		this.faceDown = faceDown;
	}

	toString() {
		return this.tag;
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

	freezeds = signal<any>({})

	

	selecteds = signal<DeckItem[]>([]);
	selectedsChange = output<DeckItem[]>();
	selectedSet = computed(()=>{
		return new Set(this.selecteds().map(c=>c.uid));
	})
	

	constructor(
		private Rules:Rules
	){

	}

	shuffle() {
		this.list.update(items=>items.sort((a,b)=>Math.random()-0.5));
	}

	toggleItem(uid:number) {
		
		if (!this.selectable()) return;

		const selecteds = this.selecteds().slice();
		const index = selecteds.findIndex(card=>card.uid == uid);
		if (index >= 0) {
			selecteds.splice(index, 1);
		} else {
			const card = this.getItemByUid(uid);
			selecteds.push(card);
		}


		this.selecteds.set(selecteds);
		this.selectedsChange.emit(this.selecteds());
	}

	removeItems(toRemove:DeckItem[]) {
		if (!toRemove) return;
		this.list.update(items=>items.filter(item=>!toRemove.some(toRemoveItem=>toRemoveItem.uid == item.uid)));
		this.selecteds.update(items=>items.filter(item=>!toRemove.some(toRemoveItem=>toRemoveItem.uid == item.uid)));
		this.selectedsChange.emit(this.selecteds());
	}

	getItemByUid(uid:number) {
		return this.list().find(item=>item.uid == uid);
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
	
	
	freeze() {
		const freezeds:any = {};
		this.list().forEach(item=>{
			if (this.selecteds().some(s=>s.uid==item.uid)) return;
			freezeds[item.uid] = 500;
		})
		this.freezeds.set(freezeds)
	}


	willAttach(cards:DeckItem[]) {
		this.Rules.validateMeld(cards, this.list());
	}

	validateLayOff():DeckItem[] {
		return this.Rules.validateMeld(this.selecteds());
	}
}
