import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NzIconService } from 'ng-zorro-antd/icon';

import { Stage } from './stage';
import { NZ_ICONS } from '../../nz-icons';

describe('Stage', () => {
	let component: Stage;
	let fixture: ComponentFixture<Stage>;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [Stage],
		}).compileComponents();

		// Stage renderizza <ui-board>: registrare le icone ng-zorro usate dalla Board.
		TestBed.inject(NzIconService).addIcon(...NZ_ICONS);

		fixture = TestBed.createComponent(Stage);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	afterEach(() => fixture?.destroy());

	it('should create', () => {
		expect(component).toBeTruthy();
	});
});
