import { CardValue, DeckItem, getCardRank, SuitTag } from '../services/cards';
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

/** Atteggiamento nella fase gioca: chiudere presto o accumulare punti (punto 4). */
type PlayStance = 'rush' | 'accumulate';

/** Sotto questa soglia di carte nel tallone si smette di attendere e si concreta. */
const LOW_STOCK = 6;

/** Frazione del target oltre la quale una squadra è "vicina alla vittoria" (punto 4). */
const NEAR_WIN_FRACTION = 0.85;

/** Esperienza minima per attendere combinazioni migliori invece di calare subito:
 *  sotto questa soglia è un neofita che mette i punti a terra senza strategia. */
const HOLD_MIN_EXPERIENCE = 0.4;

/** Esperienza minima per leggere il punteggio partita e decidere se affrettare la chiusura. */
const GLOBAL_EVAL_MIN_EXPERIENCE = 0.6;

/** Attenzione da cui in su la valutazione di mano+tavolo è SEMPRE attiva; sotto, cala
 *  linearmente fino a spegnersi a 0 (giocatore completamente distratto). */
const BOARD_FOCUS_FULL = 0.3;

/** Cooperazione minima per il gioco di squadra (ruoli pozzetto, non chiudere sul compagno pieno). */
const COOP_MIN = 0.5;

/** Mano del compagno considerata "piena" (parte da 11): non chiudere, e vado io al pozzetto. */
const PARTNER_FULL = 8;

/** Mano del compagno "quasi pronta": si sta svuotando (va lui al pozzetto), accumulo io. */
const PARTNER_LOW = 4;

/** Carte in mano a un avversario sotto cui la sua chiusura è imminente (parte da 11). */
const OPPONENT_CLOSE_HAND = 4;

/** Carte avversarie sotto cui la chiusura è al turno successivo: attenzione MASSIMA allo scarto. */
const OPPONENT_CLOSE_IMMINENT = 1;

/** Scarti minimi osservati da un avversario per inferire cosa NON scarta (→ raccoglie). */
const WANT_MIN_DISCARDS = 4;

/** Media carte in mano agli avversari sopra cui sono "carichi": chiuderli infligge più penalità. */
const OPPONENT_LOADED = 8;

/** Opportunismo minimo per affrettare la chiusura e punire gli avversari carichi. */
const OPPORTUNISM_MIN = 0.6;

/** Opportunismo ≤ questo = compassionevole: incoraggia chi è in difficoltà invece di sfottere. */
const COMPASSION_MAX = 0.4;

/** Carte in mano (a giochi già in tavola) sopra cui un giocatore è "in difficoltà". */
const DIFFICULTY_HAND = 9;

/** Distacco in punti PARTITA oltre cui si legge la classifica (rimonta / sfottò a chi perde). */
const STANDING_GAP = 200;

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
 * avversari, azzerata a ogni mano, fedeltà = `attention`) e a lungo termine
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

		// Attenzione: se sono distratto non valuto nemmeno il monte scarti.
		if (!this.attendsBoard()) {
			return { value: 'stock', reason: 'Distratto: non guardo il monte, pesco dal tallone.' };
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
		const allowWild = this.allowsWild(view);

		const before = totalCards(this.findOpenMelds(view.hand, view.rules, allowWild));
		const after = totalCards(this.findOpenMelds([...view.hand, top], view.rules, allowWild));
		if (after > before) return true;

		return view.myMelds.some((m) => !!view.rules.validateMeld([top], m));
	}

	// ============================================================
	// FASE GIOCA
	// ============================================================

	decidePlays(view: GameView): AiDecision<AiPlay[]> {
		// Attenzione: se sono distratto non scandaglio mano e tavolo per i giochi.
		if (!this.attendsBoard()) {
			return { value: [], reason: 'Distratto: non valuto mano e tavolo, non calo nulla.' };
		}

		const allowWild = this.allowsWild(view);
		// Sotto minaccia si completano i burraco anche sporcandoli con le matte.
		const opens = this.findOpenMelds(
			view.hand,
			view.rules,
			allowWild,
			this.opponentClosingThreat(view),
		);
		const usedByOpens = new Set<number>(opens.flat().map((c) => c.uid));
		const remaining = view.hand.filter((c) => !usedByOpens.has(c.uid));
		const attachments = this.findAttachments(remaining, view.myMelds, view.rules);

		// Punto 4: chiudere presto o accumulare punti.
		const stance = this.closingStance(view);

		// Punti 2-3: alcuni giochi li TRATTENIAMO invece di calarli subito (aspettando
		// di allungarli o di farne un burraco). Le carte trattenute restano in mano
		// (già escluse da `remaining`, quindi non vengono nemmeno appoggiate). Le legate
		// ai giochi già a terra le facciamo sempre: avanzano verso il burraco senza esporci.
		const held: DeckItem[][] = [];
		const opensToPlay = opens.filter((meld) => {
			const hold = this.shouldHoldMeld(meld, view, stance);
			if (hold) held.push(meld);
			return !hold;
		});

		let plays: AiPlay[] = [
			...opensToPlay.map((cards) => ({ kind: 'open' as const, cards })),
			...attachments,
		];

		// Non svuotare la mano: serve almeno una carta da scartare per finire il turno.
		let trimmed = false;
		while (plays.length && playedCards(plays) >= view.hand.length) {
			plays.pop();
			trimmed = true;
		}

		// Riserva di scarto sicuro: non calare fino a restare con soli scarti che
		// servono l'avversario. Meglio tenere un gioco in mano (preferibilmente un
		// tris: blocca poco ed è ottimo come banca scarti) che essere costretti a
		// dare punti/appoggi. I prudenti (`discardCaution`) ci tengono di più, ma è
		// comunque un accorgimento da esperti (il neofita cala e basta). In 'rush' si
		// ignora: si punta a svuotare la mano e chiudere.
		if (
			this.profile.experience >= HOLD_MIN_EXPERIENCE &&
			this.profile.discardCaution >= 0.4 &&
			stance !== 'rush'
		) {
			let guard = plays.length;
			while (guard-- > 0 && !this.hasSafeDiscardAfter(plays, view)) {
				const index = pickMeldToHoldForDiscard(plays);
				if (index < 0) break;
				held.push(plays.splice(index, 1)[0].cards);
			}
		}

		return { value: plays, reason: this.explainPlays(plays, held, stance, allowWild, trimmed) };
	}

	/**
	 * Una carta è uno scarto SICURO se non serve l'avversario: non è una matta e non
	 * è appoggiabile a un loro gioco a terra (non dà punti né sblocca legate).
	 */
	protected isSafeDiscard(card: DeckItem, view: GameView): boolean {
		if (isWild(card)) return false;
		return !view.theirMelds.some((m) => !!view.rules.validateMeld([card], m));
	}

	/** Dopo aver calato `plays`, resterebbe in mano almeno uno scarto sicuro? */
	protected hasSafeDiscardAfter(plays: AiPlay[], view: GameView): boolean {
		const played = new Set<number>(plays.flatMap((p) => p.cards.map((c) => c.uid)));
		return view.hand.some((c) => !played.has(c.uid) && this.isSafeDiscard(c, view));
	}

	/**
	 * Strategia di chiusura (punto 4). Finché non possiamo chiudere (pozzetto preso +
	 * burraco in campo) l'obiettivo è COSTRUIRE → 'accumulate'.
	 *
	 * Quando POSSIAMO chiudere, le IA ESPERTE (`experience` alta) fanno una valutazione
	 * GLOBALE sul punteggio partita: se qualcuno è vicino alla vittoria affrettano la
	 * chiusura ('rush'), altrimenti sfruttano la mano per fare più punti ('accumulate').
	 * I neofiti non guardano il tabellone: decidono solo sull'avidità di punti.
	 *
	 * La COOPERAZIONE (`cooperativeStance`) ha priorità: coordina i ruoli col compagno
	 * per il pozzetto e impedisce di chiudere lasciandolo pieno di carte.
	 */
	protected closingStance(view: GameView): PlayStance {
		// Minaccia di chiusura avversaria: sgombra la mano (rush) per non farti sorprendere
		// con molte carte — e penalità — in mano. Priorità massima.
		if (this.opponentClosingThreat(view)) return 'rush';

		const canClose = view.potTakenByTeam && view.teamHasBurraco;

		let base: PlayStance;
		if (!canClose) {
			base = 'accumulate';
		} else if (this.profile.experience >= GLOBAL_EVAL_MIN_EXPERIENCE) {
			const nearWin = view.matchScore.ours >= view.targetScore * NEAR_WIN_FRACTION;
			const oppNearWin = view.matchScore.opponents >= view.targetScore * NEAR_WIN_FRACTION;
			// Pochi punti alla vittoria (nostra o loro) → chiudi e porta a casa; altrimenti
			// la mano vale: prova a fare più punti evitando di chiudere in fretta.
			base = nearWin || oppNearWin ? 'rush' : 'accumulate';
		} else {
			base = this.profile.pointGreed >= 0.6 ? 'accumulate' : 'rush';
		}

		// Opportunista: se posso già chiudere e gli avversari sono ancora carichi, chiudo
		// per infliggere più penalità. Il compassionevole non ci marcia. (La cooperazione
		// può comunque frenare, sotto, se il compagno è pieno.)
		if (canClose && this.profile.opportunism >= OPPORTUNISM_MIN && this.opponentsLoaded(view)) {
			base = 'rush';
		}

		return this.cooperativeStance(view, base);
	}

	/** Gli avversari sono ancora carichi di carte (media ≥ `OPPONENT_LOADED`)? */
	protected opponentsLoaded(view: GameView): boolean {
		const counts = view.opponentHandCounts;
		if (!counts.length) return false;
		return counts.reduce((sum, n) => sum + n, 0) / counts.length >= OPPONENT_LOADED;
	}

	/**
	 * Correzione di squadra allo stance (punti 2-3), attiva con `cooperation` ≥ `COOP_MIN`.
	 * - Ruoli per il POZZETTO: finché la squadra non l'ha preso, se il compagno accumula
	 *   (mano piena) mi svuoto io per prenderlo ('rush'); se è lui a svuotarsi (mano quasi
	 *   pronta) lo lascio fare e accumulo ('accumulate').
	 * - Non CHIUDERE lasciando il compagno pieno di carte: annulla un 'rush' → 'accumulate'.
	 */
	protected cooperativeStance(view: GameView, base: PlayStance): PlayStance {
		if (this.profile.cooperation < COOP_MIN) return base;
		const partnerCards = view.partnerHandCount;

		if (!view.potTakenByTeam) {
			if (partnerCards >= PARTNER_FULL) return 'rush'; // compagno carico → vado io al pozzetto
			if (partnerCards <= PARTNER_LOW) return 'accumulate'; // compagno pronto → glielo lascio
		}

		if (base === 'rush' && partnerCards >= PARTNER_FULL) return 'accumulate'; // non chiudo sul compagno pieno
		return base;
	}

	/**
	 * Un avversario sta per chiudere? (vista delle carte avversarie): la loro squadra
	 * ha preso il pozzetto e ha già un burraco (≥7) e uno di loro ha pochissime carte
	 * (≤`OPPONENT_CLOSE_HAND`). In tal caso conviene sgombrare la mano e le penalità
	 * pesanti (jolly/pinelle valgono -30/-20 se ci sorprendono con esse in mano).
	 */
	protected opponentClosingThreat(view: GameView): boolean {
		if (!view.opponentsTookPot) return false;
		if (!view.theirMelds.some((m) => m.length >= 7)) return false;
		return view.opponentHandCounts.some((n) => n <= OPPONENT_CLOSE_HAND);
	}

	/**
	 * Un avversario può chiudere con UNA sola carta (pozzetto + burraco già in campo):
	 * chiusura al turno successivo → attenzione MASSIMA allo scarto (mai servirlo, mai
	 * distrarsi). Sottoinsieme più stretto di `opponentClosingThreat`.
	 */
	protected opponentClosingImminent(view: GameView): boolean {
		if (!view.opponentsTookPot) return false;
		if (!view.theirMelds.some((m) => m.length >= 7)) return false;
		return view.opponentHandCounts.some((n) => n <= OPPONENT_CLOSE_IMMINENT);
	}

	/**
	 * Vale la pena TRATTENERE un gioco invece di calarlo subito (punti 1-2-3)?
	 * - Un burraco (≥7) si cala sempre: sono punti concreti.
	 * - In 'rush' (punto 4) o con tallone quasi finito si concreta tutto.
	 * - Un gioco BLOCCATO (nessun completatore ancora vivo, punto 3) non si aspetta.
	 * - Un tris nudo (punto 1: i tris bloccano) i pazienti lo tengono per non impegnarsi.
	 * - Una scala corta con completatori vivi (punto 2) i pazienti la aspettano per
	 *   allungarla verso il burraco: tanto più volentieri quanto più il burraco che
	 *   ne verrebbe è PULITO (nessuna matta) o VICINO (già ≥6 carte).
	 *
	 * L'attesa è però una scelta da GIOCATORE ESPERTO: un neofita cala subito i punti
	 * a terra (anche i tris), quindi sotto `HOLD_MIN_EXPERIENCE` non trattiene mai.
	 * La COOPERAZIONE spinge ad aprire più giochi a terra e costruire meno in mano
	 * (punto 1): alza la soglia di pazienza necessaria per trattenere.
	 */
	protected shouldHoldMeld(meld: DeckItem[], view: GameView, stance: PlayStance): boolean {
		if (meld.length >= 7) return false;
		if (stance === 'rush') return false;
		if (this.profile.experience < HOLD_MIN_EXPERIENCE) return false;
		if (view.drawPileCount <= LOW_STOCK) return false;
		if (this.liveExtensionCount(meld) === 0) return false;
		// Il cooperativo costruisce meno in mano: gli serve più pazienza per trattenere.
		const coopPenalty = this.profile.cooperation * 0.3;
		if (!isRunMeld(meld))
			return meld.length === 3 && this.profile.patience >= 0.6 + coopPenalty;
		// Un burraco pulito vale di più (bonus +200 vs +100/+150): lo si aspetta anche
		// da meno pazienti; se è già vicino (≥6) ancora di più.
		const clean = !runUsesWild(meld);
		const threshold = (clean ? (meld.length >= 6 ? 0.2 : 0.4) : 0.6) + coopPenalty;
		return this.profile.patience >= threshold;
	}

	/**
	 * Quanti "completatori" del gioco risultano ancora VIVI SECONDO LA MIA MEMORIA
	 * (punto 3). Per una scala sono le carte naturali adiacenti agli estremi nel seme;
	 * per un set le altre copie dello stesso valore. 0 = lo so bloccato (le carte
	 * cruciali le ricordo uscite). Chi ha poca `attention` ha un quadro parziale e può
	 * contarne di vive più del reale (attese a vuoto).
	 */
	protected liveExtensionCount(meld: DeckItem[]): number {
		return completerTags(meld).reduce((sum, tag) => sum + this.liveCopies({ tag }), 0);
	}

	/** Motivazione leggibile della fase gioca (per il debug delle decisioni). */
	private explainPlays(
		plays: AiPlay[],
		held: DeckItem[][],
		stance: PlayStance,
		allowWild: boolean,
		trimmed: boolean,
	): string {
		if (!plays.length && !held.length) return 'Nessun gioco valido da calare o appoggiare.';
		const opens = plays.filter((p) => p.kind === 'open').length;
		const attaches = plays.filter((p) => p.kind === 'attach').length;
		const parts = [
			plays.length ? `Calo ${opens} giochi e appoggio ${attaches} volte` : 'Non calo nulla',
			stance === 'rush' ? 'punto a chiudere' : 'accumulo punti',
		];
		if (held.length) parts.push(`trattengo ${held.length} gioco/i (allungo o scarto sicuro)`);
		parts.push(`matte ${allowWild ? 'ammesse' : 'evitate'}`);
		if (trimmed) parts.push('tengo una carta per lo scarto');
		return parts.join('; ') + '.';
	}

	/** Matte ammesse nei giochi: in base al profilo, o SEMPRE se un avversario sta per
	 *  chiudere (meglio calare jolly/pinelle sul tavolo che tenerli in mano come penalità). */
	protected allowsWild(view: GameView): boolean {
		return this.profile.wildUsage >= 0.35 || this.opponentClosingThreat(view);
	}

	/**
	 * Trova giochi apribili nella mano (set e sequenze), validati dal motore
	 * regole (fonte di verità), e ne seleziona un insieme non sovrapposto.
	 * Con `forceBurraco` sporca i giochi vicini al burraco con una matta per
	 * completarli subito (`dirtyToComplete`). Limite noto v1: no asso alto.
	 */
	protected findOpenMelds(
		cards: DeckItem[],
		rules: Rules,
		allowWild: boolean,
		forceBurraco = false,
	): DeckItem[][] {
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

		// SEQUENZA: per seme, segmenti di rank consecutivi (≥3, o 2 + matta). Doppio
		// passaggio: asso BASSO (A-2-3…) e, se c'è un asso, anche ALTO (…-Q-K-A).
		const bySuit = groupBy(naturals, (c) => c.suit);
		const wild = allowWild ? wilds[0] : undefined;
		for (const group of bySuit.values()) {
			candidates.push(...collectRunSegments(group, false, wild));
			if (group.some((c) => c.value === 'A')) {
				candidates.push(...collectRunSegments(group, true, wild));
			}
		}

		const valid = candidates.filter((c) => !!rules.validateMeld(c));
		const picked = pickNonOverlapping(valid);
		if (forceBurraco) this.dirtyToComplete(picked, cards, rules);
		return picked;
	}

	/**
	 * Sotto minaccia di chiusura: sporca i giochi vicini al burraco (6 carte) con una
	 * matta ancora libera in mano per portarli a 7 SUBITO — meglio un burraco sporco
	 * ora che un pulito domani, quando l'avversario potrebbe aver già chiuso. Muta
	 * `picked` in place inserendo la matta nel gioco.
	 */
	private dirtyToComplete(picked: DeckItem[][], cards: DeckItem[], rules: Rules): void {
		const used = new Set<number>(picked.flat().map((c) => c.uid));
		const spareWilds = cards.filter((c) => isWild(c) && !used.has(c.uid));
		for (const meld of picked) {
			if (meld.length !== 6) continue; // solo 6 carte: +1 matta → burraco (7)
			for (const wild of spareWilds) {
				const completed = rules.validateMeld([wild], meld);
				if (!completed) continue;
				meld.splice(0, meld.length, ...Array.from(completed));
				spareWilds.splice(spareWilds.indexOf(wild), 1);
				break;
			}
		}
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
		// Attenzione MASSIMA se un avversario può chiudere con una sola carta: non ci si
		// distrae MAI in quel frangente (si salta lo scarto sbadato anche da distratti).
		const critical = this.opponentClosingImminent(view);
		if (!critical && !this.attendsBoard()) return this.carelessDiscard(view);

		// Minaccia di chiusura avversaria: sgombro le penalità pesanti (vedi metodo).
		if (this.opponentClosingThreat(view)) return this.defensiveDiscard(view);

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

	/**
	 * Sto valutando mano e tavolo in questa decisione? Probabilità = `attention`, ma
	 * piena da `BOARD_FOCUS_FULL` in su: solo l'attenzione bassa comincia a ignorare
	 * lo stato visibile, fino a spegnersi del tutto a 0.
	 */
	protected attendsBoard(): boolean {
		return this.rng() < Math.min(1, this.profile.attention / BOARD_FOCUS_FULL);
	}

	/** Scarto sbadato: nessuna valutazione, una carta a caso (evitando le matte). */
	protected carelessDiscard(view: GameView): AiDecision<DeckItem> {
		const naturals = view.hand.filter((c) => !isWild(c));
		const pool = naturals.length ? naturals : view.hand;
		const chosen = pool[Math.min(Math.floor(this.rng() * pool.length), pool.length - 1)];
		return { value: chosen, reason: 'Distratto: scarto senza valutare mano e tavolo.' };
	}

	/**
	 * Scarto difensivo con un avversario in chiusura: mi libero della penalità più
	 * pesante che NON serva a un loro gioco (per non regalargliela). Le matte non si
	 * scartano — vanno calate sul tavolo (vedi `allowsWild` + stance `rush`), non
	 * regalate a chi sta per chiudere; restano ultima risorsa solo se non c'è altro.
	 */
	protected defensiveDiscard(view: GameView): AiDecision<DeckItem> {
		const ranked = view.hand
			.map((card) => {
				const servesThem = view.theirMelds.some(
					(m) => !!view.rules.validateMeld([card], m),
				);
				// Priorità di scarto (più alta = prima): penalità alta, ma pesante malus se
				// appoggiabile ai loro giochi o se è una matta (da calare, non da regalare).
				const shed = pointsOf(card) - (servesThem ? 100 : 0) - (isWild(card) ? 60 : 0);
				return { card, shed };
			})
			.sort((a, b) => b.shed - a.shed);
		const chosen = ranked[0]?.card ?? view.hand[0];
		return {
			value: chosen,
			reason: `Scarto ${chosen?.tag}: rischio chiusura avversaria, sgombro le penalità pesanti.`,
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

				// Pericolo di servire gli avversari (pesato dalla prudenza). Le copie ancora
				// "vive" sono quelle che RICORDO non uscite: chi ha poca attenzione le vede
				// tutte vive uniformemente (contributo costante) → di fatto non conta le carte.
				let danger = 0;
				if (view.theirMelds.some((m) => !!view.rules.validateMeld([card], m))) {
					danger += 6;
					notes.push('appoggiabile dai loro');
				}
				danger += this.liveCopies(card);
				const wanted = this.opponentWantsValue(card.value);
				if (wanted) {
					danger += wanted * 4;
					notes.push('cercata dai loro');
				}
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
	protected liveCopies(card: { tag: string }): number {
		return Math.max(0, 2 - (this.seen.get(card.tag) ?? 0));
	}

	/**
	 * Quanto un avversario sembra CERCARE questo valore (modello del contenuto delle
	 * mani altrui): chi scarta parecchio ma non ha MAI scartato questo valore
	 * probabilmente lo sta raccogliendo → rischioso servirglielo. Segnale 0..n pesato
	 * dall'attenzione (chi non osserva non lo coglie).
	 */
	protected opponentWantsValue(value: string): number {
		let signal = 0;
		for (const model of Object.values(this.opponentModel)) {
			const total = Object.values(model.discardsByValue).reduce((sum, n) => sum + n, 0);
			if (total < WANT_MIN_DISCARDS) continue;
			if (!model.discardsByValue[value]) signal += 1;
		}
		return signal * this.profile.attention;
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

		// Fedeltà di registrazione = `attention`: la pienamente attenta (1) registra ogni
		// carta vista uscire, la distratta (0) nulla, la via di mezzo dimentica ~metà →
		// quadro parziale (può credere ancora viva una carta già uscita).
		if (event.cards) {
			for (const card of event.cards) {
				if (this.rng() < this.profile.attention) {
					this.seen.set(card.tag, (this.seen.get(card.tag) ?? 0) + 1);
				}
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
		// Apertura partita: saluto / battuta col rivale storico.
		if (event.kind === 'game_start') return this.openingBanter(view);
		// A ogni nuova mano e a fine partita si legge l'andamento dell'INTERA PARTITA.
		if (event.kind === 'hand_start' || event.kind === 'game_end')
			return this.standingBanter(view);

		const relation = this.relationOf(event.actor, view);

		// Momento di difficoltà di un altro (mano carica a giochi già in tavola): segue
		// `opportunism`. Il compassionevole incoraggia (compagno E avversario);
		// l'opportunista sfotte l'avversario in affanno.
		if (relation !== 'self' && this.actorInDifficulty(event, view)) {
			if (this.rng() > this.profile.talkativeness) return null;
			if (this.profile.opportunism <= COMPASSION_MAX) return this.pick('encourage');
			if (relation === 'opponent' && this.profile.opportunism >= OPPORTUNISM_MIN) {
				return this.pick('opponent:bad');
			}
			return null;
		}

		const quality = event.quality ?? assessQuality(event);
		if (quality === 'neutral') return null; // non commenta il banale

		// Loquacità: gate sulla frequenza dei commenti.
		if (this.rng() > this.profile.talkativeness) return null;
		// Autoironia: commenta sé stesso solo se ci scherza su... ma l'opportunista si
		// VANTA comunque delle proprie buone giocate (sottolinea la superiorità).
		if (relation === 'self') {
			const boast = quality === 'good' && this.profile.opportunism >= OPPORTUNISM_MIN;
			if (!boast && this.rng() > this.profile.selfIrony) return null;
		}
		// Sfottò all'avversario in difficoltà: da provocatore (meanness) o da opportunista.
		if (relation === 'opponent' && quality === 'bad') {
			if (this.rng() > Math.max(this.profile.meanness, this.profile.opportunism)) return null;
		}

		// Attribuzione fortuna/bravura: rilegge good↔lucky (fallback alla qualità reale
		// se manca la battuta riletta).
		const framed = this.frameByAttribution(quality);
		return (
			this.pick(`${relation}:${framed}` as PhraseKey) ??
			this.pick(`${relation}:${quality}` as PhraseKey)
		);
	}

	/**
	 * Un compagno/avversario che ha appena SCARTATO è "in difficoltà" se resta con la
	 * mano carica (≥`DIFFICULTY_HAND`) a giochi già in tavola — non a inizio mano, quando
	 * tutti hanno molte carte. Conteggi PUBBLICI, dalla vista del commentatore.
	 */
	protected actorInDifficulty(event: TableEvent, view: GameView): boolean {
		if (event.kind !== 'discard') return false;
		if (!view.myMelds.length && !view.theirMelds.length) return false;
		const count =
			event.actor === view.partner
				? view.partnerHandCount
				: (view.opponentHandCounts[view.opponents.indexOf(event.actor)] ?? 0);
		return count >= DIFFICULTY_HAND;
	}

	/**
	 * Rilegge la qualità di un evento secondo `luckAttribution`: chi crede che "la
	 * bravura è tutto" (basso) vede anche gli eventi fortunati come merito ('lucky'→
	 * 'good'); chi pensa che "è tutta fortuna" (alto) vede anche le belle giocate come
	 * culo ('good'→'lucky'). Le vie di mezzo non rileggono nulla.
	 */
	protected frameByAttribution(quality: PlayQuality): PlayQuality {
		if (quality === 'good' && this.profile.luckAttribution >= 0.6) return 'lucky';
		if (quality === 'lucky' && this.profile.luckAttribution <= 0.4) return 'good';
		return quality;
	}

	/** Battuta d'apertura, eventualmente basata sul record testa-a-testa. */
	protected openingBanter(view: GameView): string | null {
		if (this.rng() > this.profile.talkativeness) return null;
		const hasRival = view.opponents.some((o) => (this.longTerm.headToHead[o]?.games ?? 0) >= 3);
		return this.pick(hasRival ? 'banter:rival' : 'banter:greeting');
	}

	/**
	 * Legge l'andamento dell'INTERA PARTITA (punteggio, non solo la mano): sotto di
	 * ≥`STANDING_GAP` → battuta di rimonta; avanti di altrettanto → sfottò a chi perde,
	 * ma solo se opportunista/provocatore. Partita in equilibrio → tace.
	 */
	protected standingBanter(view: GameView): string | null {
		if (this.rng() > this.profile.talkativeness) return null;
		const gap = view.matchScore.ours - view.matchScore.opponents;
		if (gap <= -STANDING_GAP) return this.pick('standing:behind');
		if (
			gap >= STANDING_GAP &&
			this.rng() < Math.max(this.profile.opportunism, this.profile.meanness)
		) {
			return this.pick('standing:ahead');
		}
		return null;
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

/**
 * Seleziona giochi non sovrapposti preferendo le SCALE ai set (punto 1: i tris
 * bloccano, le scale si gestiscono meglio nel lungo periodo) e, a parità, i più
 * lunghi (più vicini al burraco).
 */
function pickNonOverlapping(melds: DeckItem[][]): DeckItem[][] {
	const picked: DeckItem[][] = [];
	const used = new Set<number>();
	const ordered = melds.slice().sort((a, b) => {
		const runDiff = +isRunMeld(b) - +isRunMeld(a);
		return runDiff || b.length - a.length;
	});
	for (const meld of ordered) {
		if (meld.some((c) => used.has(c.uid))) continue;
		meld.forEach((c) => used.add(c.uid));
		picked.push(meld);
	}
	return picked;
}

/**
 * Segmenti di rank consecutivi (≥3, o 2 + matta) tra le naturali di un seme.
 * `aceHigh` posiziona l'asso in alto (rank 14) per generare le scale ...-Q-K-A.
 */
function collectRunSegments(group: DeckItem[], aceHigh: boolean, wild?: DeckItem): DeckItem[][] {
	const out: DeckItem[][] = [];
	const rankOf = (c: DeckItem) => getCardRank(c.value, aceHigh);
	const sorted = group.slice().sort((a, b) => rankOf(a) - rankOf(b));
	let segment: DeckItem[] = [];
	let prevRank = -99;
	const flush = () => {
		if (segment.length >= 3) out.push(segment.slice());
		else if (segment.length === 2 && wild) out.push([...segment, wild]);
	};
	for (const cardItem of sorted) {
		const rank = rankOf(cardItem);
		if (rank === prevRank) continue; // doppione di rank: non entra nella stessa sequenza
		if (rank === prevRank + 1) segment.push(cardItem);
		else {
			flush();
			segment = [cardItem];
		}
		prevRank = rank;
	}
	flush();
	return out;
}

/** Un gioco è una SCALA se le sue carte naturali non hanno tutte lo stesso valore. */
function isRunMeld(meld: DeckItem[]): boolean {
	const naturals = meld.filter((c) => !isWild(c));
	return naturals.length >= 2 && naturals.some((c) => c.value !== naturals[0].value);
}

/**
 * Una scala usa una MATTA (→ burraco non pulito)? Joker sempre; un 2 solo se non è
 * il 2 naturale del seme della scala. Proxy dell'`classifyBurraco` del Round senza
 * dipendere da rules (l'IA resta pura sullo stato).
 */
function runUsesWild(meld: DeckItem[]): boolean {
	const suit = meld.find((c) => c.value !== '2' && c.value !== '*')?.suit;
	return meld.some((c) => c.value === '*' || (c.value === '2' && c.suit !== suit));
}

/**
 * Indice del gioco da trattenere come banca scarti (punto B): preferisce i SET (i
 * tris bloccano poco ed è meglio scartarli) alle scale, e i più corti. -1 se in
 * `plays` non ci sono aperture (le legate non si spezzano: sono sicure e utili).
 */
function pickMeldToHoldForDiscard(plays: AiPlay[]): number {
	let best = -1;
	let bestKey = Infinity;
	plays.forEach((play, index) => {
		if (play.kind !== 'open') return;
		const key = (isRunMeld(play.cards) ? 1000 : 0) + play.cards.length;
		if (key < bestKey) {
			bestKey = key;
			best = index;
		}
	});
	return best;
}

/**
 * Tag delle carte che ESTENDEREBBERO un gioco, per stimare se è ancora completabile
 * (punti 2-3). Scala: le naturali adiacenti agli estremi nel seme (asso alto escluso,
 * come in `findOpenMelds` v1). Set: le altre copie dello stesso valore, tutti i semi.
 */
function completerTags(meld: DeckItem[]): string[] {
	const naturals = meld.filter((c) => !isWild(c));
	if (!naturals.length) return [];

	if (isRunMeld(meld)) {
		const suit = naturals[0].suit;
		const ranks = naturals.map((c) => getCardRank(c.value));
		const below = rankToValue(Math.min(...ranks) - 1);
		const above = rankToValue(Math.max(...ranks) + 1);
		return [below, above].filter((v): v is CardValue => !!v).map((v) => v + SuitTag[suit]);
	}

	const value = naturals[0].value;
	return Object.values(SuitTag).map((tag) => value + tag);
}

const RANK_VALUES: Record<number, CardValue> = {
	1: 'A',
	2: '2',
	3: '3',
	4: '4',
	5: '5',
	6: '6',
	7: '7',
	8: '8',
	9: '9',
	10: '10',
	11: 'J',
	12: 'Q',
	13: 'K',
};

/** Valore corrispondente a un rank 1..13 (null fuori range: niente asso alto in v1). */
function rankToValue(rank: number): CardValue | null {
	return RANK_VALUES[rank] ?? null;
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
	'self:lucky': ['Che fortuna che ho! 🍀'],
	'self:bad': ['Ops. 😅'],
	encourage: ['Dai, ci sta! 🙂', 'Su, niente drammi. 🤗'],
	'standing:behind': ['Adesso comincia la rimonta! 💪', 'Non è ancora finita. 😤'],
	'standing:ahead': ['Tanto state per perdere. 😏', 'Finalmente avete fatto qualche punto. 🙄'],
	'banter:greeting': ['Buona partita a tutti. 🙂'],
	'banter:rival': ['Vediamo come va oggi. 👀'],
};
