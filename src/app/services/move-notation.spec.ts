import { DeckItem } from './cards';
import { decodeMoveList, describeTurn, encodeMoveList, splitTurns } from './move-notation';
import {
	PlayerSide,
	RoundEventType,
	RoundGameplayEvent,
	RoundPhase,
	RoundSavedState,
	RoundTurnStep,
} from './round';

/**
 * Round-trip della notazione mosse: encode → decode conserva deal e mosse,
 * e il testo è leggibile (italiano discorsivo).
 */
describe('move-notation', () => {
	const items = (tags: string[]) => tags.map((t) => new DeckItem(t));
	const saved = (tags: string[], faceDown: boolean) => tags.map((tag) => ({ tag, faceDown }));

	const setup: RoundSavedState = {
		phase: RoundPhase.InProgress,
		dealer: PlayerSide.West,
		currentPlayer: PlayerSide.North,
		turnStep: RoundTurnStep.DrawOrCollect,
		turnIndex: 1,
		initialized: true,
		hands: {
			north: saved(['7♥️', '7♦️', '7♠️', 'K♥️'], true),
			east: saved(['8♠️', '3♦️'], true),
			south: saved(['2♣️'], true),
			west: saved(['A♦️'], true),
		},
		drawPile: saved(['A♣️', 'Q♥️'], true),
		discardPile: saved(['K♣️'], false),
		pots: [saved(['9♥️'], true), saved(['10♠️'], true)],
		melds: { ours: [], opponents: [] },
		winnerPlayer: null,
		winnerTeam: null,
		score: null,
		playerHasTakenPot: {
			[PlayerSide.North]: false,
			[PlayerSide.East]: false,
			[PlayerSide.South]: false,
			[PlayerSide.West]: false,
		},
	};

	const events: RoundGameplayEvent[] = [
		{ type: RoundEventType.Draw, player: PlayerSide.North },
		{
			type: RoundEventType.Open,
			player: PlayerSide.North,
			cards: items(['7♥️', '7♦️', '7♠️']),
		},
		{ type: RoundEventType.Discard, player: PlayerSide.North, cards: items(['K♥️']) },
		{ type: RoundEventType.TakeDiscard, player: PlayerSide.East, cards: items(['K♣️']) },
		{
			type: RoundEventType.Attach,
			player: PlayerSide.East,
			meldIndex: 0,
			cards: items(['8♠️']),
		},
		{ type: RoundEventType.Discard, player: PlayerSide.East, cards: items(['3♦️']) },
	];

	it('produce testo leggibile in italiano', () => {
		const text = encodeMoveList(setup, events);
		expect(text).toContain('Nord pesca dal tallone');
		expect(text).toContain('cala 7♥️ 7♦️ 7♠️');
		expect(text).toContain('Est raccoglie il monte');
		expect(text).toContain('appoggia 8♠️ al gioco 1');
		expect(text).toContain('scarta K♥️');
	});

	it('round-trip: decode conserva il deal iniziale', () => {
		const decoded = decodeMoveList(encodeMoveList(setup, events));
		expect(decoded.setup.hands.north.map((c) => c.tag)).toEqual(['7♥️', '7♦️', '7♠️', 'K♥️']);
		expect(decoded.setup.drawPile.map((c) => c.tag)).toEqual(['A♣️', 'Q♥️']);
		expect(decoded.setup.discardPile.map((c) => c.tag)).toEqual(['K♣️']);
		expect(decoded.setup.pots[0].map((c) => c.tag)).toEqual(['9♥️']);
		expect(decoded.setup.pots[1].map((c) => c.tag)).toEqual(['10♠️']);
		expect(decoded.setup.dealer).toBe(PlayerSide.West);
		expect(decoded.setup.currentPlayer).toBe(PlayerSide.North);
	});

	it('round-trip: decode conserva le mosse', () => {
		const { moves } = decodeMoveList(encodeMoveList(setup, events));
		expect(moves.map((m) => m.type)).toEqual([
			'draw',
			'open',
			'discard',
			'take_discard',
			'attach',
			'discard',
		]);
		const attach = moves.find((m) => m.type === 'attach') as Extract<
			(typeof moves)[number],
			{ type: 'attach' }
		>;
		expect(attach.meldIndex).toBe(0);
		expect(attach.cards).toEqual(['8♠️']);
		expect(attach.player).toBe(PlayerSide.East);
	});

	it('splitTurns raggruppa per turno', () => {
		const { moves } = decodeMoveList(encodeMoveList(setup, events));
		const turns = splitTurns(moves);
		expect(turns.length).toBe(2);
		expect(describeTurn(turns[0])).toContain('Nord');
		expect(describeTurn(turns[0])).toContain('cala');
	});
});
