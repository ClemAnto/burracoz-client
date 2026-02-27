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

	it('accepts simple stright of 4 cards', () => {
		const result = service.validateRun('A♥️ 2♥️ 3♥️ 4♥️');
		expect(result).not.toBeNull();
	});

	it('accepts simple set of 3 cards', () => {
		const result = service.validateSet('7♥️ 7♥️ 7♠️');
		expect(result).not.toBeNull();
	});

	it('rejects set opening with less than 3 cards', () => {
		const result = service.validateSet('7♥️ 7♠️');
		expect(result).toBeNull();
	});

	it('rejects layoff with no cards from hand', () => {
		const result = service.validateSet('', '7♥️ 7♠️ 7♦️');
		expect(result).toBeNull();
	});

	it('accepts set of 8 naturals plus 1 wild', () => {
		const result = service.validateSet('7♥️ 7♥️ 7♠️ 7♠️ 7♦️ 7♦️ 7♣️ 7♣️ *');
		expect(result).not.toBeNull();
	});

	it('rejects set longer than allowed size', () => {
		const result = service.validateSet('7♥️ 7♥️ 7♠️ 7♠️ 7♦️ 7♦️ 7♣️ 7♣️ * 7♥️');
		expect(result).toBeNull();
	});

	it('rejects set with different natural ranks', () => {
		const result = service.validateSet('7♥️ 7♠️ 8♦️');
		expect(result).toBeNull();
	});

	it('reject simple set of 3 equal cards', () => {
		const result = service.validateSet('7♥️ 7♥️ 7♥️');
		expect(result).toBeNull();
	});

	it('reject double A', () => {
		const result = service.validateRun('A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️ A♥️');
		expect(result).toBeNull();
	});

	it('accept complete run of 14 cards (last Jocker)', () => {
		const result = service.validateRun('A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️ *');
		expect(result).not.toBeNull();
	});

	it('reject complete run of 14 cards double wild', () => {
		const result = service.validateRun('3♥️ 4♥️ 8♥️ 9♥️ 10♥️ J♥️ 5♥️ 6♥️ 7♥️ A♥️ 2♠️ Q♥️ K♥️ *');
		expect(result).toBeNull();
	});

	it('accept complete run of 14 cards (first Jocker)', () => {
		const result = service.validateRun('* 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️ A♥️');
		expect(result).not.toBeNull();
	});

	it('accept complete run 1 wild + 1 natural two (at end)', () => {
		const result = service.validateRun('2♠️ 4♥️ A♥️ 2♥️');
		expect(result).not.toBeNull();
	});

	it('accept complete run 1 wild + 1 natural two (at start)', () => {
		const result = service.validateRun('2♥️ 4♥️ A♥️ 2♠️');
		expect(result).not.toBeNull();
	});

	it('accept complete run 2 wild', () => {
		const result = service.validateRun('2♠️ 4♥️ A♥️ *');
		expect(result).toBeNull();
	});

	it('releases table wild when layoff has the matching natural card', () => {
		const result = service.validateRun('6♥️', '5♥️ * 7♥️');
		expect(result).not.toBeNull();
		expect(result!.map((c) => c.toString())).toEqual(['7♥️', '6♥️', '5♥️', '*']);
	});

	it('moves natural two from table to layoff when no other wild is on table', () => {
		const result = service.validateRun('6♥️', '2♥️ 3♥️ 4♥️');
		expect(result).not.toBeNull();
		expect(result!.map((c) => c.toString())).toEqual(['6♥️', '2♥️', '4♥️', '3♥️']);
	});
});
