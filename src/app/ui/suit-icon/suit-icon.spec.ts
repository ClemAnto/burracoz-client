import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SuitIcon } from './suit-icon';

describe('SuitIcon', () => {
	let component: SuitIcon;
	let fixture: ComponentFixture<SuitIcon>;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [SuitIcon],
		}).compileComponents();

		fixture = TestBed.createComponent(SuitIcon);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});
});
