import { DeckItem, getCardRank } from '../services/cards';
import { RoundPlayer } from '../services/round';
import { isWild, Rules } from '../services/rules';
import {
	AiDecision,
	AiLongTermMemory,
	AiMemorySnapshot,
	AiPlay,
	AiPlayer,
	AiProfile,
	CardScore,
	DrawChoice,
	GameView,
	PhraseBank,
	PhraseKey,
	PlayQuality,
	Relation,
	TableEvent,
} from './ai-player';

/** Opzioni di costruzione di una IA. */
export interface DefaultAiOptions {
	id: string;
	name: string;
	profile: AiProfile;
	/** Repertorio di battute proprio: si fonde con quello di base. */
	phrases?: PhraseBank;
	/** Sorgente di casualità iniettabile (per test deterministici). */
	rng?: () => number;
}

/**
 * IA di base del Burraco: strategia semplice ma logica, interamente guidata
 * dai parametri di `AiProfile`. Legge una `GameView` read-only e RITORNA
 * decisioni (non muta lo stato: è la Board a eseguirle → single-writer).
 *
 * Stateful solo nella propria memoria: episodica (carte uscite + tendenze
 * avversari, azzerata a ogni mano, capacità = `memory`) e a lungo termine
 * (record testa-a-testa + tendenze, persistita, capacità = `learning`).
 *
 * Le personalità estendono questa classe fornendo profilo e `PhraseBank`
 * diversi (ed eventualmente sovrascrivendo singoli metodi decisionali).
 */
export class DefaultAi implements AiPlayer {
	readonly id: string;
	readonly name: string;
	readonly profile: AiProfile;

	protected phrases: PhraseBank;
	protected rng: () => number;

	// ── Memoria episodica (azzerata a ogni mano) ──
	private seen = new Map<string, number>();
	private opponentModel: Record<
		string,
		{ discardsBySuit: Record<string, number>; discardsByValue: Record<string, number> }
	> = {};

	// ── Memoria a lungo termine (persistita tra le partite) ──
	private longTerm: AiLongTermMemory = emptyLongTerm();

	constructor(options: DefaultAiOptions) {
		this.id = options.id;
		this.name = options.name;
		this.profile = options.profile;
		this.phrases = { ...DEFAULT_PHRASES, ...(options.phrases ?? {}) };
		this.rng = options.rng ?? Math.random;
	}

	// ============================================================
	// FASE PESCA
	// ============================================================

	decideDraw(view: GameView): AiDecision<DrawChoice> {
		const pile = view.discardPile;
		// Tallone esaurito: l'unica fonte è il monte scarti (se non vuoto).
		if (view.drawPileCount === 0) {
			return pile.length
				? { value: 'discard', reason: 'Tallone esaurito: raccolgo il monte scarti.' }
				: { value: 'stock', reason: 'Tallone e monte vuoti: nessuna pesca possibile.' };
		}
		if (!pile.length) {
			return { value: 'stock', reason: 'Monte scarti vuoto: pesco dal tallone.' };
		}

		const topUseful = this.discardTopUseful(view);
		const sizeAppeal = Math.min(pile.length, 12) / 12; // 0..1
		const score = (topUseful ? 0.6 : 0) + this.profile.pileAppetite * (0.3 + 0.4 * sizeAppeal);
		// Più rischioso → soglia più bassa → prende il monte più volentieri.
		const threshold = 0.5 - this.profile.risk * 0.15;
		const take = score >= threshold;

		return {
			value: take ? 'discard' : 'stock',
			reason: take
				? `Raccolgo il monte (${pile.length} carte, top ${
						topUseful ? 'utile' : 'non decisivo'
					}; score ${score.toFixed(2)} ≥ soglia ${threshold.toFixed(2)}).`
				: `Pesco dal tallone (monte poco utile: score ${score.toFixed(
						2,
					)} < soglia ${threshold.toFixed(2)}).`,
		};
	}

	/** Il monte scarti aiuta? Il top completa un gioco in mano o si appoggia ai nostri. */
	private discardTopUseful(view: GameView): boolean {
		const top = view.discardTop;
		if (!top) return false;
		const allowWild = this.allowsWild();

		const before = totalCards(this.findOpenMelds(view.hand, view.rules, allowWild));
		const after = totalCards(this.findOpenMelds([...view.hand, top], view.rules, allowWild));
		if (after > before) return true;

		return view.myMelds.some((m) => !!view.rules.validateMeld([top], m));
	}

	// ============================================================
	// FASE GIOCA
	// ============================================================

	decidePlays(view: GameView): AiDecision<AiPlay[]> {
		const allowWild = this.allowsWild();
		const opens = this.findOpenMelds(view.hand, view.rules, allowWild);
		const usedByOpens = new Set<number>(opens.flat().map((c) => c.uid));
		const remaining = view.hand.filter((c) => !usedByOpens.has(c.uid));
		const attachments = this.findAttachments(remaining, view.myMelds, view.rules);

		let plays: AiPlay[] = [
			...opens.map((cards) => ({ kind: 'open' as const, cards })),
			...attachments,
		];

		// Non svuotare la mano: serve almeno una carta da scartare per finire il turno.
		let trimmed = false;
		while (plays.length && playedCards(plays) >= view.hand.length) {
			plays.pop();
			trimmed = true;
		}

		const reason = plays.length
			? `Calo ${plays.filter((p) => p.kind === 'open').length} giochi e appoggio ${
					plays.filter((p) => p.kind === 'attach').length
				} volte (matte ${allowWild ? 'ammesse' : 'evitate'})${
					trimmed ? '; trattengo una carta per lo scarto' : ''
				}.`
			: 'Nessun gioco valido da calare o appoggiare.';

		return { value: plays, reason };
	}

	/** Matte ammesse nei giochi in base al profilo. */
	protected allowsWild(): boolean {
		return this.profile.wildUsage >= 0.35;
	}

	/**
	 * Trova giochi apribili nella mano (set e sequenze), validati dal motore
	 * regole (fonte di verità), e ne seleziona un insieme non sovrapposto.
	 * Limite noto v1: non genera sequenze con asso alto (K-Q-...-A).
	 */
	protected findOpenMelds(cards: DeckItem[], rules: Rules, allowWild: boolean): DeckItem[][] {
		const candidates: DeckItem[][] = [];
		const naturals = cards.filter((c) => !isWild(c));
		const wilds = cards.filter((c) => isWild(c));

		// SET: naturali dello stesso valore (≥3), o coppia + 1 matta.
		const byValue = groupBy(naturals, (c) => c.value);
		for (const group of byValue.values()) {
			if (group.length >= 3) candidates.push(group.slice());
			else if (group.length === 2 && allowWild && wilds.length) {
				candidates.push([...group, wilds[0]]);
			}
		}

		// SEQUENZA: per seme, segmenti di rank consecutivi (≥3).
		const bySuit = groupBy(naturals, (c) => c.suit);
		for (const group of bySuit.values()) {
			const sorted = group
				.slice()
				.sort((a, b) => getCardRank(a.value) - getCardRank(b.value));
			let segment: DeckItem[] = [];
			let prevRank = -99;
			const flush = () => {
				if (segment.length >= 3) candidates.push(segment.slice());
				else if (segment.length === 2 && allowWild && wilds.length) {
					candidates.push([...segment, wilds[0]]);
				}
			};
			for (const card of sorted) {
				const rank = getCardRank(card.value);
				if (rank === prevRank) continue; // doppione di rank: non entra nella stessa sequenza
				if (rank === prevRank + 1) segment.push(card);
				else {
					flush();
					segment = [card];
				}
				prevRank = rank;
			}
			flush();
		}

		const valid = candidates.filter((c) => !!rules.validateMeld(c));
		return pickNonOverlapping(valid);
	}

	/** Appoggia carte della mano ai giochi già in tavola della propria squadra. */
	protected findAttachments(hand: DeckItem[], myMelds: DeckItem[][], rules: Rules): AiPlay[] {
		const plays: AiPlay[] = [];
		const used = new Set<number>();

		myMelds.forEach((meld, index) => {
			let current = meld.slice();
			const toAdd: DeckItem[] = [];
			for (const card of hand) {
				if (used.has(card.uid)) continue;
				const validated = rules.validateMeld([card], current);
				if (validated) {
					toAdd.push(card);
					used.add(card.uid);
					current = Array.from(validated);
				}
			}
			if (toAdd.length) plays.push({ kind: 'attach', meldIndex: index, cards: toAdd });
		});

		return plays;
	}

	// ============================================================
	// FASE SCARTO
	// ============================================================

	decideDiscard(view: GameView): AiDecision<DeckItem> {
		const ranking = this.discardRanking(view);
		const chosen = view.hand.find((c) => c.uid === ranking[0]?.uid) ?? view.hand[0];
		return {
			value: chosen,
			reason: `Scarto ${chosen?.tag} (keep-score minimo ${ranking[0]?.score}${
				ranking[0]?.note ? ', ' + ranking[0].note : ''
			}).`,
			detail: ranking,
		};
	}

	/** Punteggio "keep" per ogni carta: più alto = da tenere. Ordinato crescente. */
	protected discardRanking(view: GameView): CardScore[] {
		const hand = view.hand;
		return hand
			.map((card) => {
				let keep = 0;
				const notes: string[] = [];

				if (isWild(card)) {
					keep += 100;
					notes.push('matta');
				}

				const potential = this.meldPotential(card, hand);
				keep += potential * 8;
				if (potential) notes.push(`potenziale ${potential.toFixed(1)}`);

				// Pericolo di servire gli avversari (pesato da prudenza e memoria).
				let danger = 0;
				if (view.theirMelds.some((m) => !!view.rules.validateMeld([card], m))) {
					danger += 6;
					notes.push('appoggiabile dai loro');
				}
				danger += this.liveCopies(card) * this.profile.memory;
				keep += danger * this.profile.discardCaution;

				// Leggera preferenza a liberarsi delle carte alte "morte".
				keep -= pointsOf(card) / 100;

				return {
					tag: card.tag,
					uid: card.uid,
					score: +keep.toFixed(3),
					note: notes.join(', ') || undefined,
				};
			})
			.sort((a, b) => a.score - b.score);
	}

	/** Quanto una carta è connessa ad altre in mano (0 = isolata). */
	protected meldPotential(card: DeckItem, hand: DeckItem[]): number {
		if (isWild(card)) return 3;
		let potential = 0;
		const sameValue = hand.filter(
			(c) => c !== card && !isWild(c) && c.value === card.value,
		).length;
		potential += Math.min(sameValue, 2);

		const rank = getCardRank(card.value);
		const suitNeighbors = hand.filter(
			(c) =>
				c !== card &&
				!isWild(c) &&
				c.suit === card.suit &&
				getCardRank(c.value) !== rank &&
				Math.abs(getCardRank(c.value) - rank) <= 2,
		).length;
		potential += Math.min(suitNeighbors, 2) * 0.7;

		return potential;
	}

	/** Copie di questa carta non ancora viste uscire (0..2 nel mazzo doppio). */
	protected liveCopies(card: DeckItem): number {
		return Math.max(0, 2 - (this.seen.get(card.tag) ?? 0));
	}

	// ============================================================
	// MEMORIA
	// ============================================================

	observe(event: TableEvent, view: GameView): void {
		if (event.kind === 'hand_start') {
			this.seen.clear();
			this.opponentModel = {};
			return;
		}

		if (event.cards) {
			for (const card of event.cards) {
				this.seen.set(card.tag, (this.seen.get(card.tag) ?? 0) + 1);
			}
		}

		// Tendenze episodiche degli avversari: cosa scartano.
		const isOpponent = event.actor !== view.me && event.actor !== view.partner;
		if (event.kind === 'discard' && isOpponent && event.cards?.[0]) {
			const card = event.cards[0];
			const model = (this.opponentModel[event.actor] ??= {
				discardsBySuit: {},
				discardsByValue: {},
			});
			model.discardsBySuit[card.suit] = (model.discardsBySuit[card.suit] ?? 0) + 1;
			model.discardsByValue[card.value] = (model.discardsByValue[card.value] ?? 0) + 1;
		}

		if (event.kind === 'game_end') this.learnFromGame(view);
	}

	/** Apprendimento a fine partita: aggiorna record testa-a-testa e tendenze. */
	protected learnFromGame(view: GameView): void {
		if (this.profile.learning <= 0) return;
		const won = view.matchScore.ours > view.matchScore.opponents;

		for (const opponent of view.opponents) {
			const record = (this.longTerm.headToHead[opponent] ??= {
				wins: 0,
				losses: 0,
				games: 0,
			});
			record.games++;
			if (won) record.wins++;
			else record.losses++;

			const episodic = this.opponentModel[opponent];
			if (episodic) {
				const tendencies = (this.longTerm.opponentTendencies[opponent] ??= {});
				for (const [suit, count] of Object.entries(episodic.discardsBySuit)) {
					tendencies['suit:' + suit] =
						(tendencies['suit:' + suit] ?? 0) + count * this.profile.learning;
				}
			}
		}
	}

	loadLongTermMemory(data: AiLongTermMemory | null): void {
		this.longTerm = data ?? emptyLongTerm();
	}

	exportLongTermMemory(): AiLongTermMemory {
		return this.longTerm;
	}

	memorySnapshot(): AiMemorySnapshot {
		const seenCards: string[] = [];
		for (const [tag, count] of this.seen) {
			for (let i = 0; i < count; i++) seenCards.push(tag);
		}
		return { seenCards, opponentModel: this.opponentModel, longTerm: this.longTerm };
	}

	// ============================================================
	// VOCE
	// ============================================================

	comment(event: TableEvent, view: GameView): string | null {
		if (event.kind === 'game_start' || event.kind === 'hand_start') return this.banter(view);

		const relation = this.relationOf(event.actor, view);
		const quality = event.quality ?? assessQuality(event);
		if (quality === 'neutral') return null; // non commenta il banale

		// Loquacità: gate sulla frequenza dei commenti.
		if (this.rng() > this.profile.talkativeness) return null;
		// Autoironia: commenta sé stesso solo se ci scherza su.
		if (relation === 'self' && this.rng() > this.profile.selfIrony) return null;
		// Cattiveria: lo sfottò all'avversario in difficoltà solo se provocatore.
		if (relation === 'opponent' && quality === 'bad' && this.rng() > this.profile.meanness) {
			return null;
		}

		return this.pick(`${relation}:${quality}` as PhraseKey);
	}

	/** Battuta d'apertura, eventualmente basata sul record testa-a-testa. */
	protected banter(view: GameView): string | null {
		if (this.rng() > this.profile.talkativeness) return null;
		const hasRival = view.opponents.some((o) => (this.longTerm.headToHead[o]?.games ?? 0) >= 3);
		return this.pick(hasRival ? 'banter:rival' : 'banter:greeting');
	}

	protected relationOf(actor: RoundPlayer, view: GameView): Relation {
		if (actor === view.me) return 'self';
		if (actor === view.partner) return 'partner';
		return 'opponent';
	}

	/** Sceglie una battuta dal repertorio per la chiave data (null se assente). */
	protected pick(key: PhraseKey): string | null {
		const bank = this.phrases[key];
		if (!bank || !bank.length) return null;
		const index = Math.min(Math.floor(this.rng() * bank.length), bank.length - 1);
		return bank[index];
	}
}

// ============================================================
// HELPERS DI MODULO
// ============================================================

/** Valore in punti di una carta (Art. 1 FIBUR). */
function pointsOf(card: DeckItem): number {
	switch (card.value) {
		case '*':
			return 30;
		case '2':
			return 20;
		case 'A':
			return 15;
		case 'K':
		case 'Q':
		case 'J':
		case '10':
			return 10;
		default:
			return 5;
	}
}

/** Valutazione qualitativa di default di un evento (per la voce). */
function assessQuality(event: TableEvent): PlayQuality {
	switch (event.kind) {
		case 'burraco':
		case 'close':
		case 'take_pot':
			return 'good';
		case 'take_discard':
			return (event.cards?.length ?? 0) >= 5 ? 'lucky' : 'neutral';
		case 'open':
			return (event.cards?.length ?? 0) >= 5 ? 'good' : 'neutral';
		default:
			return 'neutral';
	}
}

function emptyLongTerm(): AiLongTermMemory {
	return { headToHead: {}, opponentTendencies: {}, tuning: {} };
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
	const map = new Map<K, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = map.get(k) ?? [];
		list.push(item);
		map.set(k, list);
	}
	return map;
}

/** Seleziona giochi non sovrapposti, preferendo i più lunghi (più vicini al burraco). */
function pickNonOverlapping(melds: DeckItem[][]): DeckItem[][] {
	const picked: DeckItem[][] = [];
	const used = new Set<number>();
	for (const meld of melds.slice().sort((a, b) => b.length - a.length)) {
		if (meld.some((c) => used.has(c.uid))) continue;
		meld.forEach((c) => used.add(c.uid));
		picked.push(meld);
	}
	return picked;
}

function totalCards(melds: DeckItem[][]): number {
	return melds.reduce((sum, m) => sum + m.length, 0);
}

function playedCards(plays: AiPlay[]): number {
	return plays.reduce((sum, p) => sum + p.cards.length, 0);
}

/** Repertorio di battute di base (italiano: sono testi a schermo, non identificatori). */
const DEFAULT_PHRASES: PhraseBank = {
	'partner:good': ['Bravo! 👏', 'Bella giocata, compagno. 😃'],
	'partner:lucky': ['Che fortuna, compagno! 🍀'],
	'partner:bad': ['Ahi... occhio. 😬'],
	'opponent:good': ['Uff... 😒', 'Ci mancava. 🙄'],
	'opponent:lucky': ['Che fortuna sfacciata! 😤'],
	'opponent:bad': ['Eh eh. 😏'],
	'self:good': ['Come si fa. 😎'],
	'self:bad': ['Ops. 😅'],
	'banter:greeting': ['Buona partita a tutti. 🙂'],
	'banter:rival': ['Vediamo come va oggi. 👀'],
};
