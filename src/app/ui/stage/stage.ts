import { Component } from '@angular/core';
import { Board } from '../board/board';

@Component({
	selector: 'ui-stage',
	imports: [Board],
	templateUrl: './stage.html',
	host: {
		class: 'flex w-full h-full',
	},
})
export class Stage {}
