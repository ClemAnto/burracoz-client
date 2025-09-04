import { Component, computed, input } from '@angular/core';
import { CardValue, Suit } from '../../services/cards';
import { SuitIcon } from '../suit-icon/suit-icon';
import { CommonModule } from '@angular/common';

type SimpleSuit = "h" | "d" | "s" | "c" | "♣️" | "♠️" | "♦️" | "♥️";


@Component({
	selector: 'ui-card',
	imports: [
		CommonModule,
		SuitIcon
	],
	templateUrl: './card.html',
	styleUrl: './card.scss',
	//'[class]': `faceDown() ? 'rotate-y-180' : ''`
	host: {
		'[style.--rot-y.deg]': "faceDown() ? 180 : 0"
	}
})
export class Card {


	faceDown = input<boolean>();
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

	value = computed<CardValue>(()=>(this.card() ?? '').match(/[\w*]+/)[0] as CardValue);
}
