import { TestBed } from '@angular/core/testing';

import { Rules } from './rules';

describe('Rules', () => {
	let service: Rules;

	beforeEach(() => {
		TestBed.configureTestingModule({});
		service = TestBed.inject(Rules);
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	it('accepts run strings with mixed separators', () => {
		const result = service.validateRun('A♥️, 2♥️; 3♥️ / 4♥️');
		expect(result).not.toBeNull();
	});

	it('accepts set strings with mixed separators', () => {
		const result = service.validateSet('7♥️ - 7♦️ / 7♠️');
		expect(result).not.toBeNull();
	});
});
