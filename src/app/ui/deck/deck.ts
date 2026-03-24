import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';

import { CommonModule } from '@angular/common';
import {
	cardToString,
	CardColor,
	CardValue,
	getCardRank,
	parseCardColor,
	parseCardSuit,
	parseCardValue,
	Suit,
} from '../../services/cards';

const SUIT_ORDER: Partial<Record<Suit, number>> = {
	[Suit.Hearts]: 0,
	[Suit.Diamonds]: 1,
	[Suit.Clubs]: 2,
	[Suit.Spades]: 3,
};

function sortBySuitThenRank(a: DeckItem, b: DeckItem): number {
	const suitA = SUIT_ORDER[a.suit] ?? 4;
	const suitB = SUIT_ORDER[b.suit] ?? 4;
	if (suitA !== suitB) return suitA - suitB;
	return getCardRank(a.value) - getCardRank(b.value);
}
import { Rules } from '../../services/rules';
import { Card } from '../card/card';

export class DeckItem {
	static uid = 0;
	public uid: number;
	public tag: string;
	public faceDown: boolean;
	public value: CardValue;
	public suit: Suit;
	public color?: CardColor;

	constructor(card: string, faceDown: boolean = false) {
		this.uid = DeckItem.uid++;
		
		this.value = parseCardValue(card);
		this.suit = parseCardSuit(card);
		this.color = parseCardColor(this.suit || card);
		this.faceDown = faceDown;
		this.tag = this.toString();
		console.log("UID: " + this.uid + " - " + this.tag);
	}

	toString() {
		return cardToString(this.value, this.suit, this.color);
	}
}

export class DeckItems extends Array<DeckItem> {
	static fromArray(items: DeckItem[] = []): DeckItems {
		return DeckItems.from(items);
	}

	override toString(): string {
		return Array.from(this, (item) => item.toString()).reverse().join(' ');
	}
}

export function deckToString(deck: DeckItems): string {
	return deck.toString();
}

const CARD_SIZE = {W:32,H:40}

@Component({
	selector: 'ui-deck',
	imports: [CommonModule, Card],
	templateUrl: './deck.html',
	styleUrls: ['./deck.scss', './animations.scss'],
	host: {
		'[style.--box-h.px]': 'CARD_SIZE.H',
		'[style.--box-w.px]': 'CARD_SIZE.W',
		'[style.--max-box-h.px]': 'gap() + CARD_SIZE.H',
		'[style.--max-box-w.px]': 'gap() + CARD_SIZE.W',
		'[style.--rotate.deg]': 'rotate()',
		'[class.no-animate]': '!animate()',
	},
})
export class Deck {
	CARD_SIZE = CARD_SIZE;

	layout = input<'stack' | 'horizontal' | 'vertical'>('horizontal');

	animate = input<boolean>(true);
	selectable = input<boolean>(false);
	faceDown = input<boolean>(null);
	rotate = input<number>(null);
	/** Spaziatura tra le carte nel layout grid (unità Tailwind spacing, es. 2 = 0.5rem). */
	gap = input<number>(null);
	/** Se true, ordina automaticamente le carte per seme poi per rank. */
	autosort = input<boolean>(false);

	cards = input<string[] | DeckItem[]>();

	list = linkedSignal<DeckItem[]>(() => {
		const fd = this.faceDown();
		const items = this.cards().map((c) => {
			if (typeof c == 'string') return new DeckItem(c, fd);
			if (fd !== null) c.faceDown = fd;
			return c;
		});
		//return items;

		if (!this.autosort()) return items;
		return [...items].sort(sortBySuitThenRank);
	});

	freezeds = signal<any>({});

	selecteds = signal<DeckItem[]>([]);
	selectedsChange = output<DeckItem[]>();
	selectedSet = computed(() => {
		return new Set(this.selecteds().map((c) => c.uid));
	});

	constructor(private Rules: Rules) {}

	shuffle() {
		this.list.update((items) => {
			const arr = items.slice();
			for (let i = arr.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[arr[i], arr[j]] = [arr[j], arr[i]];
			}
			return arr;
		});
	}

	toggleItem(uid: number) {
		if (!this.selectable()) return;

		const selecteds = this.selecteds().slice();
		const index = selecteds.findIndex((card) => card.uid == uid);
		if (index >= 0) {
			selecteds.splice(index, 1);
		} else {
			const card = this.getItemByUid(uid);
			selecteds.push(card);
		}

		this.selecteds.set(selecteds);
		this.selectedsChange.emit(this.selecteds());
	}

	removeItems(toRemove: DeckItem[]) {
		if (!toRemove) return;
		this.list.update((items) =>
			items.filter((item) => !toRemove.some((toRemoveItem) => toRemoveItem.uid == item.uid)),
		);
		this.selecteds.update((items) =>
			items.filter((item) => !toRemove.some((toRemoveItem) => toRemoveItem.uid == item.uid)),
		);
		this.selectedsChange.emit(this.selecteds());
	}

	getItemByUid(uid: number) {
		return this.list().find((item) => item.uid == uid);
	}

	put(toPut: DeckItem[]) {
		if (!toPut) return;
		if (this.faceDown() !== null) {
			toPut.forEach((item) => (item.faceDown = this.faceDown()));
		}
		this.list.update((cards) => cards.concat(toPut));
	}

	take(amount: number = 0): DeckItem[] {
		let taken: DeckItem[] = [];
		this.list.update((items) => {
			taken = items.splice(-amount, amount);
			return [...items];
		});
		return taken;
	}

	takeAll() {
		return this.take(this.list().length);
	}

	offsetCurve(index: number) {
		const k = 0.1;
		return 10 * (1 - Math.exp(-k * index));
	}

	freeze() {
		const freezeds: any = {};
		this.list().forEach((item) => {
			if (this.selecteds().some((s) => s.uid == item.uid)) return;
			freezeds[item.uid] = 500;
		});
		this.freezeds.set(freezeds);
	}

	willAttach(cards: DeckItem[]) {
		const newList = this.Rules.validateMeld(cards, this.list());
		if (newList) this.list.set(newList);
		return newList;
	}

	validateLayOff(): DeckItem[] {
		return this.Rules.validateMeld(this.selecteds());
	}
}
