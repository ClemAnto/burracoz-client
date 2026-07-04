import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Game, GameEvent, GameEventType, GamePhase } from './game';
import { PlayerSide, Round, RoundScore, RoundTeam } from './round';

/**
 * Fine partita (Art. 18): al superamento della soglia di punti la partita
 * termina e vince la squadra col punteggio cumulato più alto.
 */
describe('Game – fine partita', () => {
	let game: Game;
	let round: Round;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
		game = TestBed.inject(Game);
		round = TestBed.inject(Round);
	});

	const scoreWith = (oursTotal: number, oppTotal: number): RoundScore => {
		const team = (total: number) => ({
			positive: total,
			negative: 0,
			total,
			breakdown: {
				openMeldPoints: total,
				burracoBonus: 0,
				closureBonus: 0,
				remainingHandPenalty: 0,
				potNotTakenPenalty: 0,
				potTakenNotPlayedPenalty: 0,
				penalizedCardsPenalty: 0,
			},
		});
		return { ours: team(oursTotal), opponents: team(oppTotal) };
	};

	/** Simula la chiusura di una mano emettendo l'evento del Round. */
	const closeHand = (ours: number, opp: number, winner: RoundTeam = 'ours') => {
		round.events.next({
			type: 'round_closed',
			winnerPlayer: winner === 'ours' ? PlayerSide.South : PlayerSide.East,
			winnerTeam: winner,
			score: scoreWith(ours, opp),
		});
	};

	it('termina la partita quando una squadra supera la soglia', () => {
		game.targetScore.set(300);
		game.startGame();

		let ended: GameEvent | null = null;
		game.gameEvents.subscribe((e) => {
			if (e.type === GameEventType.GameEnded) ended = e;
		});

		closeHand(200, 50);
		expect(game.isGameEnded()).toBeFalse();

		closeHand(150, 20);
		expect(game.isGameEnded()).toBeTrue();
		expect(game.phase()).toBe(GamePhase.Ended);
		expect(game.gameWinner()).toBe('ours');
		expect(ended!.type).toBe(GameEventType.GameEnded);
	});

	it('non termina se nessuna squadra ha raggiunto la soglia', () => {
		game.targetScore.set(2005);
		game.startGame();

		closeHand(100, 80);
		expect(game.isGameEnded()).toBeFalse();
		expect(game.gameWinner()).toBeNull();
	});

	it('a parità sopra soglia la partita continua (nessun vincitore)', () => {
		game.targetScore.set(300);
		game.startGame();

		closeHand(300, 300);
		expect(game.isGameEnded()).toBeFalse();
		expect(game.gameWinner()).toBeNull();
	});
});
