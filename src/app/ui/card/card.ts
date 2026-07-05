import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DeckItem } from '../../services/cards';
import { SuitIcon } from '../suit-icon/suit-icon';

@Component({
	selector: 'ui-card',
	imports: [SuitIcon],
	templateUrl: './card.html',
	styleUrl: './card.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: {
		'[style.--rot-y.deg]': 'faceDown() ? 180 : 0',
		'[attr.data-card]': 'item()?.tag',
	},
})
export class Card {
	faceDown = input<boolean>();

	/** L'istanza già parsata: la carta non ri-parsa mai il tag. */
	item = input<DeckItem>();

	suit = computed(() => this.item()?.suit);

	value = computed(() => this.item()?.value);
}
