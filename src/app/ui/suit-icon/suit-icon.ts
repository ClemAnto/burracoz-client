import { Component, input } from '@angular/core';
import { Suit } from '../../services/cards';

@Component({
  selector: 'ui-suit-icon',
  imports: [],
  templateUrl: './suit-icon.html'
})
export class SuitIcon {
	Suit = Suit;
	
	suit = input<Suit>();
}
