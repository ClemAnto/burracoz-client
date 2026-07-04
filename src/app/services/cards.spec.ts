import {
	DeckItem,
	getCardRank,
	parseCardSuit,
	parseCardValue,
	sortBySuitThenRank,
	STARTER_DECK,
	Suit,
} from './cards';

describe('cards (entità e parsing)', () => {
	it('parseCardValue/parseCardSuit leggono il tag emoji', () => {
		expect(parseCardValue('10♥️')).toBe('10');
		expect(parseCardSuit('10♥️')).toBe(Suit.Hearts);
		expect(parseCardValue('A♠️')).toBe('A');
		expect(parseCardSuit('A♠️')).toBe(Suit.Spades);
		expect(parseCardValue('*🔴')).toBe('*');
		expect(parseCardSuit('*🔴')).toBeNull();
	});

	it('DeckItem: uid progressivi e tag stabile (roundtrip)', () => {
		const a = new DeckItem('7♦️');
		const b = new DeckItem('7♦️');
		expect(a.uid).not.toBe(b.uid); // due copie del mazzo doppio restano distinte
		expect(a.tag).toBe('7♦️');
		expect(new DeckItem(a.tag).tag).toBe(a.tag);
	});

	it('il mazzo base ha 54 tag e ognuno fa roundtrip su DeckItem', () => {
		expect(STARTER_DECK.length).toBe(54);
		for (const tag of STARTER_DECK) {
			expect(new DeckItem(tag).tag).toBe(tag);
		}
	});

	it('sortBySuitThenRank: seme ♥♦♣♠ poi rank crescente', () => {
		const items = ['K♠️', '3♥️', 'A♦️', '7♣️', '10♥️'].map((t) => new DeckItem(t));
		expect(items.sort(sortBySuitThenRank).map((c) => c.tag)).toEqual([
			'3♥️',
			'10♥️',
			'A♦️',
			'7♣️',
			'K♠️',
		]);
	});

	it('getCardRank: asso basso di default, alto su richiesta', () => {
		expect(getCardRank('A')).toBe(1);
		expect(getCardRank('A', true)).toBe(14);
		expect(getCardRank('K')).toBe(13);
		expect(getCardRank('10')).toBe(10);
	});
});
