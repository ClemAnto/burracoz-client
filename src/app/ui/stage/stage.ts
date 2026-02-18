import { Component } from '@angular/core';
import { Board } from '../board/board';

@Component({
	selector: 'ui-stage',
	imports: [Board],
	templateUrl: './stage.html',
})
export class Stage {}
