import { TestBed } from '@angular/core/testing';
import { Rules } from './rules';

/**
 * Audit del motore regole contro il regolamento ufficiale F.I.Bur.
 * (docs/burraco_regole_ufficiali_fibur_2026.txt, sez. 4-5).
 * Ogni caso cita la regola verificata.
 */
describe('Rules — audit regolamento ufficiale', () => {
	let r: Rules;
	beforeEach(() => {
		TestBed.configureTestingModule({});
		r = TestBed.inject(Rules);
	});

	const ok = (result: unknown, msg: string) => expect(result).withContext(msg).not.toBeNull();
	const ko = (result: unknown, msg: string) => expect(result).withContext(msg).toBeNull();

	// ── SEQUENZE (stesso seme, ordine progressivo, ≤1 matta) ──────────────────
	it('sequenze valide', () => {
		ok(r.validateMeld('3♥️ 4♥️ 5♥️'), 'scala minima 3 carte');
		ok(r.validateMeld('A♥️ 2♥️ 3♥️ 4♥️'), 'asso basso');
		ok(r.validateMeld('J♥️ Q♥️ K♥️ A♥️'), 'asso alto');
		ok(r.validateMeld('2♥️ 3♥️ 4♥️'), 'due naturale in coda bassa');
		ok(r.validateMeld('3♥️ 4♥️ * 6♥️'), 'matta che riempie il buco (5)');
		ok(r.validateMeld('A♥️ 2♥️ 3♥️ * 5♥️'), 'pinella-2 naturale + jolly extra (Art. matta)');
		ok(
			r.validateMeld('A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️'),
			'scala completa 13 naturali',
		);
	});

	it('sequenze non valide', () => {
		ko(r.validateMeld('3♥️ 4♦️ 5♥️'), 'semi diversi');
		ko(r.validateMeld('3♥️ 4♥️ * * 7♥️'), 'due matte senza 2 naturale');
		ko(r.validateMeld('3♥️ 5♥️ 7♥️'), 'troppi buchi senza matte');
		ko(r.validateMeld('3♥️ 4♥️'), 'apertura con meno di 3 carte');
	});

	// ── COMBINAZIONI (stesso valore, 3..8 naturali + ≤1 matta) ────────────────
	it('combinazioni valide', () => {
		ok(r.validateMeld('7♥️ 7♦️ 7♠️'), 'tris');
		ok(r.validateMeld('7♥️ 7♦️ *'), '2 naturali + matta');
		ok(r.validateMeld('7♥️ 7♦️ 7♠️ 7♣️ 7♥️ 7♦️ 7♠️ 7♣️'), '8 naturali');
		ok(r.validateMeld('7♥️ 7♦️ 7♠️ 7♣️ 7♥️ 7♦️ 7♠️ *'), '7 naturali + matta');
	});

	it('combinazioni non valide', () => {
		ko(r.validateMeld('7♥️ 8♦️ 9♠️'), 'valori diversi');
		ko(r.validateMeld('7♥️ 7♦️'), 'apertura con meno di 3 carte');
		ko(r.validateMeld('7♥️ * *'), '2 matte');
		ko(r.validateMeld('2♥️ 2♦️ 2♠️'), 'combinazione di sole pinelle (solo matte, vietata)');
		ko(r.validateMeld('7♥️ 7♥️ 7♥️'), '3 carte identiche (solo 2 mazzi)');
		ko(r.validateMeld('7♥️ 7♦️ 7♠️ 7♣️ 7♥️ 7♦️ 7♠️ 7♣️ 7♥️'), '9 naturali (max 8)');
	});

	// ── APPOGGIO (legare mantenendo la validità) ──────────────────────────────
	it('appoggi validi', () => {
		ok(r.validateMeld('J♠️', '10♠️ 9♠️ 2♥️ 7♠️'), 'estende scala con incastro (2♥=8)');
		ok(r.validateMeld('8♥️', '7♥️ 6♥️ 5♥️'), 'estende scala in alto');
		ok(r.validateMeld('7♣️', '7♥️ 7♦️ 7♠️'), 'aggiunge naturale al tris');
		ok(r.validateMeld('*', '7♥️ 7♦️ 7♠️'), 'aggiunge matta al tris');
		ok(r.validateMeld('A♥️', 'K♥️ Q♥️ J♥️ 10♥️'), 'attacca asso alto');
		ok(r.validateMeld('6♥️', '5♥️ * 7♥️'), 'sostituisce la matta-incastro');
	});

	it('appoggi non validi', () => {
		ko(r.validateMeld('*', '7♥️ 7♦️ 7♠️ *'), 'seconda matta nel tris');
		ko(r.validateMeld('9♦️', '7♥️ 8♥️ 9♥️'), 'seme sbagliato nella scala');
	});
});
