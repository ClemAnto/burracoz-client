import { DeckItem } from '../services/cards';
import { PlayerSide } from '../services/round';
import { Rules } from '../services/rules';
import { AiProfile, GameView } from './ai-player';
import { DefaultAi } from './default.ai';

// ============================================================
// Helper di test. L'IA è STOCASTICA (usa `rng` in observe/attendsBoard/scarto):
// iniettiamo `rng = () => 0` così "presta sempre attenzione" e "ricorda tutto"
// (`rng() < attention` è vero per attention > 0), rendendo le decisioni ripetibili.
// ============================================================

const rules = new Rules();

/** Una carta dal suo tag (es. `7♥️`). */
const card = (tag: string) => new DeckItem(tag);

/** Una mano/gioco da tag separati da spazio. */
const cards = (tags: string) => tags.split(/\s+/).filter(Boolean).map(card);

/** Profilo neutro: assi a metà, cooperazione/voce spente, memoria piena. Override per test. */
function profile(overrides: Partial<AiProfile> = {}): AiProfile {
	return {
		risk: 0.5,
		pointGreed: 0.5,
		pileAppetite: 0.5,
		wildUsage: 0.5,
		discardCaution: 0.5,
		cooperation: 0,
		patience: 0.5,
		attention: 1,
		learning: 0,
		experience: 0.5,
		talkativeness: 0,
		meanness: 0,
		selfIrony: 0,
		...overrides,
	};
}

/** IA di test con `rng` deterministico (default: sempre attenta/ricorda). */
function makeAi(profileOverrides: Partial<AiProfile> = {}, rng: () => number = () => 0): TestAi {
	return new TestAi({ id: 'test', name: 'Test', profile: profile(profileOverrides), rng });
}

/** Espone i metodi decisionali protetti per testarli direttamente. */
class TestAi extends DefaultAi {
	stance(view: GameView) {
		return this.closingStance(view);
	}
	threat(view: GameView) {
		return this.opponentClosingThreat(view);
	}
	imminent(view: GameView) {
		return this.opponentClosingImminent(view);
	}
	wants(value: string) {
		return this.opponentWantsValue(value);
	}
}

/** GameView sintetica: SUD (noi) contro EST/OVEST, valori neutri. Override per test. */
function view(overrides: Partial<GameView> = {}): GameView {
	return {
		me: PlayerSide.South,
		team: 'ours',
		partner: PlayerSide.North,
		opponents: [PlayerSide.East, PlayerSide.West],
		hand: [],
		partnerHandCount: 7,
		discardPile: [],
		discardTop: null,
		drawPileCount: 60,
		myMelds: [],
		theirMelds: [],
		potTakenByTeam: false,
		teamHasBurraco: false,
		opponentsTookPot: false,
		opponentHandCounts: [7, 7],
		matchScore: { ours: 0, opponents: 0 },
		targetScore: 2005,
		handIndex: 0,
		rules,
		...overrides,
	};
}

/** Stato che minaccia la chiusura avversaria: loro pozzetto + burraco + un avversario corto. */
function threatView(minOpponentHand: number, overrides: Partial<GameView> = {}): GameView {
	return view({
		opponentsTookPot: true,
		theirMelds: [cards('4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️')], // 7 carte = burraco
		opponentHandCounts: [minOpponentHand, 7],
		...overrides,
	});
}

describe('DefaultAi — fase pesca', () => {
	it('pesca dal tallone se il monte scarti è vuoto', () => {
		const ai = makeAi();
		expect(ai.decideDraw(view({ discardPile: [] })).value).toBe('stock');
	});

	it('raccoglie il monte se il tallone è esaurito', () => {
		const ai = makeAi();
		const decision = ai.decideDraw(view({ drawPileCount: 0, discardPile: cards('K♣️') }));
		expect(decision.value).toBe('discard');
	});

	it('raccoglie il monte se il top completa un gioco in mano', () => {
		const ai = makeAi({ pileAppetite: 0.5, risk: 0.5 });
		const top = card('7♦️');
		const decision = ai.decideDraw(
			view({ hand: cards('7♥️ 7♠️'), discardPile: [top], discardTop: top }),
		);
		expect(decision.value).toBe('discard');
	});

	it('distratto (attention 0): ignora il monte utile e pesca dal tallone', () => {
		const ai = makeAi({ attention: 0 });
		const top = card('7♦️');
		const decision = ai.decideDraw(
			view({ hand: cards('7♥️ 7♠️'), discardPile: [top], discardTop: top }),
		);
		expect(decision.value).toBe('stock');
		expect(decision.reason).toContain('Distratto');
	});
});

describe('DefaultAi — fase gioca', () => {
	it('cala un tris tenendo una carta per lo scarto', () => {
		const ai = makeAi({ patience: 0.2 }); // poca pazienza: non trattiene
		const plays = ai.decidePlays(view({ hand: cards('7♥️ 7♠️ 7♦️ K♣️') })).value;
		const opens = plays.filter((p) => p.kind === 'open');
		expect(opens.length).toBe(1);
		expect(opens[0].cards.length).toBe(3);
	});

	it('preferisce la scala al tris quando competono per le stesse carte', () => {
		const ai = makeAi({ patience: 0 });
		// 7♥️ potrebbe stare nella scala (7-8-9♥️) o nel set (7♥️7♠️7♦️): vince la scala.
		const plays = ai.decidePlays(view({ hand: cards('7♥️ 8♥️ 9♥️ 7♠️ 7♦️ K♣️') })).value;
		const opens = plays.filter((p) => p.kind === 'open');
		expect(opens.length).toBe(1);
		const tags = opens[0].cards.map((c) => c.tag);
		expect(tags).toContain('8♥️');
		expect(tags).toContain('9♥️');
	});

	it('neofita (experience < 0.4): cala subito la scala anche se pazientissimo', () => {
		const ai = makeAi({ experience: 0.3, patience: 1 });
		const plays = ai.decidePlays(view({ hand: cards('7♥️ 8♥️ 9♥️ K♣️ Q♦️') })).value;
		expect(plays.some((p) => p.kind === 'open')).toBeTrue();
	});

	it('esperto paziente: trattiene una scala pulita corta per allungarla', () => {
		const ai = makeAi({ experience: 0.8, patience: 0.9, cooperation: 0 });
		const decision = ai.decidePlays(view({ hand: cards('7♥️ 8♥️ 9♥️ K♣️ Q♦️') }));
		expect(decision.value.some((p) => p.kind === 'open')).toBeFalse();
		expect(decision.reason).toContain('trattengo');
	});

	it('distratto (attention 0): non valuta la mano, non cala nulla', () => {
		const ai = makeAi({ attention: 0 });
		const decision = ai.decidePlays(view({ hand: cards('7♥️ 7♠️ 7♦️ K♣️') }));
		expect(decision.value.length).toBe(0);
		expect(decision.reason).toContain('Distratto');
	});
});

describe('DefaultAi — stance di chiusura', () => {
	it('accumula finché non può chiudere', () => {
		const ai = makeAi({ experience: 0.8 });
		expect(ai.stance(view({ potTakenByTeam: false }))).toBe('accumulate');
	});

	it('esperto vicino alla vittoria: chiude in fretta (rush)', () => {
		const ai = makeAi({ experience: 0.8 });
		const v = view({
			potTakenByTeam: true,
			teamHasBurraco: true,
			matchScore: { ours: 1800, opponents: 300 }, // ≥ 85% di 2005
		});
		expect(ai.stance(v)).toBe('rush');
	});

	it('cooperativo: non chiude se il compagno è pieno di carte', () => {
		const ai = makeAi({ experience: 0.8, cooperation: 0.8 });
		const v = view({
			potTakenByTeam: true,
			teamHasBurraco: true,
			matchScore: { ours: 1800, opponents: 300 }, // da solo sarebbe rush
			partnerHandCount: 9,
		});
		expect(ai.stance(v)).toBe('accumulate');
	});

	it('cooperativo: se il compagno accumula, vado io al pozzetto (rush)', () => {
		const ai = makeAi({ cooperation: 0.8 });
		expect(ai.stance(view({ potTakenByTeam: false, partnerHandCount: 9 }))).toBe('rush');
	});

	it('cooperativo: se il compagno è quasi pronto, glielo lascio e accumulo', () => {
		const ai = makeAi({ cooperation: 0.8 });
		expect(ai.stance(view({ potTakenByTeam: false, partnerHandCount: 3 }))).toBe('accumulate');
	});

	it('la minaccia di chiusura avversaria forza il rush (priorità massima)', () => {
		const ai = makeAi({ experience: 0.8, cooperation: 0.8 });
		expect(ai.stance(threatView(3, { partnerHandCount: 9 }))).toBe('rush');
	});
});

describe('DefaultAi — difesa dalla chiusura avversaria', () => {
	it('rileva la minaccia (pozzetto + burraco loro + avversario corto)', () => {
		const ai = makeAi();
		expect(ai.threat(threatView(3))).toBeTrue();
		expect(ai.imminent(threatView(3))).toBeFalse();
	});

	it('nessuna minaccia senza burraco avversario', () => {
		const ai = makeAi();
		expect(ai.threat(view({ opponentsTookPot: true, opponentHandCounts: [2, 7] }))).toBeFalse();
	});

	it('scarto difensivo: sgombra la penalità pesante non appoggiabile ai loro', () => {
		const ai = makeAi();
		// K♣️ (10) vs 5♦️ (5) vs matta (30 ma −60): scarto il K, il più pesante innocuo.
		const decision = ai.decideDiscard(threatView(3, { hand: cards('K♣️ 5♦️ *⚫') }));
		expect(decision.value.tag).toBe('K♣️');
		expect(decision.reason).toContain('chiusura');
	});

	it('sotto minaccia sporca un gioco da 6 con una matta per farne un burraco', () => {
		const ai = makeAi({ patience: 0 });
		const hand = cards('4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ *⚫ K♣️ Q♦️');
		const plays = ai.decidePlays(threatView(3, { hand })).value;
		const opens = plays.filter((p) => p.kind === 'open');
		expect(opens.some((p) => p.cards.length >= 7)).toBeTrue();
	});

	it('avversario a 1 carta: attenzione massima, niente scarto sbadato anche se distratto', () => {
		const ai = makeAi({ attention: 0 }); // di norma scarterebbe a caso
		const decision = ai.decideDiscard(threatView(1, { hand: cards('K♣️ 5♦️ 3♠️') }));
		expect(decision.reason).not.toContain('Distratto');
		expect(decision.reason).toContain('chiusura');
	});
});

describe('DefaultAi — scale con asso alto', () => {
	it('genera una scala che chiude con l’asso alto (…-Q-K-A)', () => {
		const ai = makeAi({ patience: 0 });
		const plays = ai.decidePlays(view({ hand: cards('J♥️ Q♥️ K♥️ A♥️ 3♣️') })).value;
		const opens = plays.filter((p) => p.kind === 'open');
		expect(opens.length).toBe(1);
		expect(opens[0].cards.map((c) => c.tag)).toContain('A♥️');
	});
});

describe('DefaultAi — modello del contenuto delle mani avversarie', () => {
	/** L'avversario EST scarta più volte, ma mai un K. */
	function afterEastDiscards(ai: TestAi): void {
		for (const tag of ['3♠️', '4♦️', '5♦️', '6♦️']) {
			ai.observe({ kind: 'discard', actor: PlayerSide.East, cards: cards(tag) }, view());
		}
	}

	it('inferisce il valore che un avversario raccoglie (non scarta mai)', () => {
		const ai = makeAi({ attention: 1 });
		afterEastDiscards(ai);
		expect(ai.wants('K')).toBeGreaterThan(0); // mai scartato → lo cerca
		expect(ai.wants('3')).toBe(0); // già scartato → non lo cerca
	});

	it('tiene la carta che i loro sembrano cercare e ne scarta un’altra', () => {
		const ai = makeAi({ attention: 1, discardCaution: 0.5 });
		afterEastDiscards(ai);
		// Senza il segnale scarterebbe il K (più pesante); sapendo che lo cercano, tiene il K.
		const decision = ai.decideDiscard(view({ hand: cards('K♣️ 3♥️') }));
		expect(decision.value.tag).toBe('3♥️');
	});
});

describe('DefaultAi — attenzione e memoria', () => {
	it('con attention 1 registra le carte viste uscire', () => {
		const ai = makeAi({ attention: 1 });
		ai.observe({ kind: 'discard', actor: PlayerSide.East, cards: cards('7♥️') }, view());
		expect(ai.memorySnapshot().seenCards).toContain('7♥️');
	});

	it('con attention 0 non registra nulla (ragiona solo su mano+tavolo)', () => {
		const ai = makeAi({ attention: 0 });
		ai.observe({ kind: 'discard', actor: PlayerSide.East, cards: cards('7♥️') }, view());
		expect(ai.memorySnapshot().seenCards.length).toBe(0);
	});
});
