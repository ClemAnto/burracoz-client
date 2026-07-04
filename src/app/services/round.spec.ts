import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DeckItem } from './cards';
import { Round, RoundPhase, RoundPlayer, TEAM_BY_PLAYER } from './round';

/**
 * Invariante di univocità: sul tavolo esistono SEMPRE 108 carte, tutte con
 * uid distinto, distribuite tra le zone (mani, tallone, scarti, pozzetti,
 * giochi). Nessuna operazione può clonarle o farle sparire.
 */
describe('Round – univocità delle carte', () => {
	let round: Round;

	const allCards = (): DeckItem[] => {
		const h = round.hands();
		return [
			...h.north,
			...h.east,
			...h.south,
			...h.west,
			...round.drawPile(),
			...round.discardPile(),
			...round.pots().flat(),
			...round.melds().ours.flat(),
			...round.melds().opponents.flat(),
		];
	};

	const expectAll108Unique = () => {
		const cards = allCards();
		expect(cards.length).toBe(108);
		expect(new Set(cards.map((c) => c.uid)).size).toBe(108);
	};

	beforeEach(async () => {
		TestBed.configureTestingModule({
			providers: [provideZonelessChangeDetection()],
		});
		round = TestBed.inject(Round);
		await round.prepareDeck();
	});

	it('dopo la distribuzione: 108 carte uniche, zone senza sovrapposizioni', () => {
		round.startHand();
		expectAll108Unique();

		const h = round.hands();
		expect(h.north.length).toBe(11);
		expect(h.east.length).toBe(11);
		expect(h.south.length).toBe(11);
		expect(h.west.length).toBe(11);
		expect(round.pots()[0].length).toBe(11);
		expect(round.pots()[1].length).toBe(11);
		expect(round.discardPile().length).toBe(1);
		expect(round.drawPile().length).toBe(108 - 44 - 22 - 1);
	});

	it('pesca e scarto conservano le 108 carte uniche', () => {
		round.startHand();
		expect(round.drawFromStock()).toBeTrue();
		expectAll108Unique();

		const player = round.currentPlayer()!;
		const card = round.hands()[player].at(-1)!;
		expect(round.discard(card)).toBeTrue();
		expectAll108Unique();
		expect(round.discardPile().some((c) => c.uid === card.uid)).toBeTrue();
	});

	it('lo scarto rimuove ESATTAMENTE la copia indicata anche con tag duplicato in mano', () => {
		round.startHand();
		round.drawFromStock();
		const player = round.currentPlayer()!;

		// Due copie identiche per tag ma con uid diversi (com'è nel mazzo doppio).
		const copiaA = new DeckItem('7♥️');
		const copiaB = new DeckItem('7♥️');
		round.hands.update((h) => ({ ...h, [player]: [...h[player], copiaA, copiaB] }));

		expect(round.discard(copiaB)).toBeTrue();

		const hand = round.hands()[player];
		expect(hand.some((c) => c.uid === copiaA.uid)).toBeTrue(); // A resta in mano
		expect(hand.some((c) => c.uid === copiaB.uid)).toBeFalse(); // proprio B è uscita
		expect(round.discardPile().at(-1)!.uid).toBe(copiaB.uid);
	});

	it('raccogliere il monte scarti sposta tutte le carte in mano e conserva le 108 uniche', () => {
		round.startHand();
		const player = round.currentPlayer()!;
		const handBefore = round.hands()[player].length;
		const pileBefore = round.discardPile().length;
		expect(pileBefore).toBeGreaterThan(0);

		expect(round.takeDiscardPile()).toBeTrue();

		expect(round.discardPile().length).toBe(0);
		expect(round.hands()[player].length).toBe(handBefore + pileBefore);
		expectAll108Unique();
	});

	it('dopo la raccolta il turno passa alla fase gioca-e-scarta', () => {
		round.startHand();
		expect(round.takeDiscardPile()).toBeTrue();
		// Ora è la fase di gioco: non si può più pescare né raccogliere.
		expect(round.drawFromStock()).toBeFalse();
		expect(round.takeDiscardPile()).toBeFalse();
	});

	it('rimescolare il mazzo tra le mani conserva le 108 carte uniche', async () => {
		round.startHand();
		round.drawFromStock();
		const player = round.currentPlayer()!;
		round.discard(round.hands()[player].at(-1)!);

		await round.prepareDeck(); // raccoglie tutto e rimescola
		expect(round.drawPile().length).toBe(108);
		expect(new Set(round.drawPile().map((c) => c.uid)).size).toBe(108);
	});
});

/**
 * Casi limite di chiusura (Art. 14): non si chiude scartando una matta.
 */
describe('Round – chiusura (Art. 14)', () => {
	let round: Round;

	beforeEach(async () => {
		TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
		round = TestBed.inject(Round);
		await round.prepareDeck();
	});

	// 7 carte qualsiasi: teamHasBurraco controlla solo la lunghezza (≥7).
	const makeBurraco = (): DeckItem[] =>
		['4♠️', '5♠️', '6♠️', '7♠️', '8♠️', '9♠️', '10♠️'].map((t) => new DeckItem(t));

	/** Porta il giocatore corrente a un passo dalla chiusura, con `last` come unica carta in mano. */
	const setupPreClosure = (last: DeckItem): RoundPlayer => {
		round.startHand();
		const player = round.currentPlayer()!;
		const team = TEAM_BY_PLAYER[player];
		round.drawFromStock(); // → fase gioca-e-scarta
		round.playerHasTakenPot.update((m) => ({ ...m, [player]: true }));
		round.melds.update((m) => ({ ...m, [team]: [makeBurraco()] }));
		round.hands.update((h) => ({ ...h, [player]: [last] }));
		return player;
	};

	it('rifiuta la chiusura scartando una matta (pinella)', () => {
		const pinella = new DeckItem('2♠️');
		const player = setupPreClosure(pinella);

		expect(round.discard(pinella)).toBeFalse();
		expect(round.phase()).toBe(RoundPhase.InProgress);
		expect(round.hands()[player].some((c) => c.uid === pinella.uid)).toBeTrue();
		expect(round.lastError()).toContain('matta');
	});

	it('consente la chiusura scartando una carta naturale', () => {
		const natural = new DeckItem('7♦️');
		const player = setupPreClosure(natural);

		expect(round.discard(natural)).toBeTrue();
		expect(round.phase()).toBe(RoundPhase.Closed);
		expect(round.winnerPlayer()).toBe(player);
	});
});
