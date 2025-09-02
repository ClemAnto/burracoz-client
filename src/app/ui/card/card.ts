import { Component, computed, input } from '@angular/core';
import { CardValue, Suit } from '../../services/cards';
import { SuitIcon } from '../suit-icon/suit-icon';

type SimpleSuit = "h" | "d" | "s" | "c" | "♣️" | "♠️" | "♦️" | "♥️";


@Component({
	selector: 'ui-card',
	imports: [
		SuitIcon
	],
	templateUrl: './card.html',
	styleUrl: './card.scss'
})
export class Card {


	card = input<string>();


	suit = computed<Suit>(()=>{
		const s = (this.card() ?? '').match(/\W+/)[0]

		switch (s) {
			case 'h':
			case "♥️":
				return Suit.Hearts
			case 'd':
			case "♦️":
				return Suit.Diamonds
			case 'c':
			case "♣️":
				return Suit.Clubs
			case 's':
			case "♠️":
				return Suit.Spades
		}
		return null;
	})

	value = computed<CardValue>(()=>(this.card() ?? '').split('')[0] as CardValue);
}
