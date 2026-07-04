import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NzIconService } from 'ng-zorro-antd/icon';

import { Board } from './board';
import { NZ_ICONS } from '../../nz-icons';

describe('Board', () => {
	let fixture: ComponentFixture<Board>;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [Board],
		}).compileComponents();

		// Registra le icone ng-zorro usate dal template (altrimenti la direttiva
		// nz-icon tenterebbe un fetch dinamico → 404 async che destabilizza Karma).
		TestBed.inject(NzIconService).addIcon(...NZ_ICONS);

		fixture = TestBed.createComponent(Board);
		fixture.detectChanges();
	});

	afterEach(() => fixture?.destroy());

	it('should create', () => {
		expect(fixture.componentInstance).toBeTruthy();
	});
});
