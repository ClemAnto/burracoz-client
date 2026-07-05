import { DeckItem } from '../services/cards';
import { RoundPlayer, RoundTeam } from '../services/round';
import { Rules } from '../services/rules';

// ============================================================
// CONTRATTO DELL'IA
// ------------------------------------------------------------
// L'IA riceve una VISTA read-only dello stato (gioco + partita) e
// restituisce decisioni (mosse) + eventualmente un commento. NON muta
// lo stato: è la Board a eseguire le mosse via Game (single-writer).
// È però STATEFUL internamente: mantiene una memoria privata delle carte
// uscite e del modo di giocare degli avversari (vedi `observe`).
// Ogni decisione porta con sé una `reason` per il debug delle scelte.
// ============================================================

/**
 * Parametri di personalità: assi 0..1. I profili delle varie IA sono solo
 * preset diversi di questi numeri; la logica di base li pesa allo stesso modo.
 */
export interface AiProfile {
	// ── Gioco ──
	/** 0 = prudente, gioca sul sicuro · 1 = azzardato, chiude/cala presto e osa. */
	risk: number;
	/** 0 = chiude appena può · 1 = accumula punti/burrachi prima di chiudere. */
	pointGreed: number;
	/** 0 = quasi mai il monte scarti · 1 = lo raccoglie spesso. */
	pileAppetite: number;
	/** 0 = parsimonioso con jolly/pinelle · 1 = le usa liberamente nei giochi. */
	wildUsage: number;
	/** 0 = indifferente a cosa scarta · 1 = evita di servire gli avversari. */
	discardCaution: number;
	/** 0 = gioca per sé · 1 = gioca di SQUADRA: apre più giochi a terra (costruisce meno
	 *  combinazioni in mano), evita di chiudere se il compagno è pieno di carte, e coordina
	 *  i RUOLI per il pozzetto (se il compagno accumula si svuota lui per prenderlo, e
	 *  viceversa). Legge il conteggio carte del compagno (`partnerHandCount`). */
	cooperation: number;
	/** 0 = compassionevole (non infierisce) · 1 = opportunista: sfrutta la debolezza
	 *  altrui — es. affretta la chiusura quando gli avversari sono ancora pieni di carte,
	 *  per infliggere più penalità. Legge `opponentHandCounts`. */
	opportunism: number;
	/** 0 = impulsivo, decide sul momento · 1 = pianifica a lungo termine. */
	patience: number;
	/** Attenzione: quanto l'IA percepisce e VALUTA lo stato. 0 = distratta, ignora
	 *  perfino le carte in mano e sul tavolo (gioca a caso) e non ricorda nulla di ciò
	 *  che è uscito · 0.5 = via di mezzo, valuta mano+tavolo ma dimentica parte delle
	 *  carte uscite (quadro parziale, possibili attese a vuoto) · 1 = pienamente attenta:
	 *  valuta tutto e ricorda esattamente le carte uscite (card counting). Governa la
	 *  memoria EPISODICA (azzerata a ogni mano). Di norma cresce con `experience`, ma
	 *  resta un asse a sé (si può avere un esperto distratto). */
	attention: number;
	/** 0 = non impara nulla tra le partite · 1 = accumula conoscenza a lungo
	 *  termine (tendenze avversari, auto-taratura) persistita localmente. */
	learning: number;
	/** Esperienza: 0 = neofita (gioca in modo locale/ingenuo) · 1 = professionista
	 *  (fa una valutazione strategica GLOBALE leggendo il punteggio partita: affretta
	 *  la chiusura se è vicino alla vittoria; rinuncia a chiudere per fare più punti
	 *  quando la vittoria è lontana). Solo i valori alti attivano questo ragionamento. */
	experience: number;

	// ── Voce ──
	/** 0 = silenzioso · 1 = chiacchierone (frequenza dei commenti). */
	talkativeness: number;
	/** 0 = gentile · 1 = provocatore / sfottò. */
	meanness: number;
	/** 0 = mai su di sé · 1 = ironizza spesso sulle proprie giocate. */
	selfIrony: number;
	/** A cosa attribuisce gli esiti: 0 = "la bravura è tutto" (anche gli eventi fortunati
	 *  li legge come merito/abilità) · 1 = "è tutta fortuna" (anche le belle giocate le
	 *  legge come culo). Tratto di sola VOCE: rilegge la qualità dell'evento tra
	 *  'good' e 'lucky' nei commenti, non tocca le decisioni di gioco. */
	luckAttribution: number;
}

/** Scelta della fase di pesca. */
export type DrawChoice = 'stock' | 'discard';

/** Una singola giocata nella fase gioca-e-scarta. */
export type AiPlay =
	| { kind: 'open'; cards: DeckItem[] }
	| { kind: 'attach'; meldIndex: number; cards: DeckItem[] };

/** Valutazione qualitativa di un evento (per la voce). */
export type PlayQuality = 'good' | 'neutral' | 'bad' | 'lucky';

/** Relazione tra chi osserva e chi ha agito. */
export type Relation = 'self' | 'partner' | 'opponent';

/**
 * Chiave di una battuta: relazione col protagonista + qualità dell'evento,
 * più chiavi speciali per il "banter" storico basato sul record testa-a-testa.
 */
export type PhraseKey =
	| `${Relation}:${PlayQuality}`
	| 'banter:rival' // es. "con te perdo sempre" / "vediamo se stavolta mi batti"
	| 'banter:greeting'
	| 'encourage' // incoraggiamento a chi è in difficoltà (compagno o avversario)
	| 'standing:behind' // siamo sotto in partita → battuta di rimonta
	| 'standing:ahead'; // siamo avanti in partita → sfottò a chi sta perdendo

/**
 * Repertorio di battute di una personalità: per ogni situazione una lista di
 * testi tra cui scegliere. Interamente personalizzabile per definire il
 * registro (infantile, professionale, sarcastico…). `DefaultAi` ne fornisce
 * uno di base; ogni personalità lo sovrascrive col proprio.
 */
export type PhraseBank = Partial<Record<PhraseKey, string[]>>;

/**
 * Evento pubblico del tavolo: alimenta la memoria (`observe`) e la voce
 * (`comment`). Contiene solo informazione visibile a tutti.
 */
export interface TableEvent {
	kind:
		| 'draw_stock'
		| 'take_discard'
		| 'open'
		| 'attach'
		| 'discard'
		| 'take_pot'
		| 'burraco'
		| 'close'
		| 'hand_start'
		| 'hand_end'
		| 'game_start' // buono per il "banter" storico (record testa-a-testa)
		| 'game_end';
	actor: RoundPlayer;
	/** Carte coinvolte (scarto, calata, monte raccolto…), se pertinenti. */
	cards?: DeckItem[];
	/** Indice del gioco per gli appoggi. */
	meldIndex?: number;
	/** Valutazione dell'evento, se già calcolata dal conduttore. */
	quality?: PlayQuality;
}

/**
 * Vista read-only dello stato passata all'IA per decidere. Proietta sia lo
 * stato della mano corrente sia quello della partita. Non contiene il CONTENUTO
 * delle mani altrui (informazione nascosta): ciò che l'IA sa degli altri sta nella
 * sua memoria privata (`observe`). Il solo CONTEGGIO delle carte è invece pubblico.
 */
export interface GameView {
	// Identità del giocatore IA
	me: RoundPlayer;
	team: RoundTeam;
	partner: RoundPlayer;
	opponents: RoundPlayer[];

	// Stato della mano corrente
	hand: DeckItem[];
	/** Quante carte ha in mano il compagno (conteggio PUBBLICO, non il contenuto).
	 *  Usato dal gioco di squadra: ruoli per il pozzetto, non chiudere lasciandolo pieno. */
	partnerHandCount: number;
	discardPile: DeckItem[];
	discardTop: DeckItem | null;
	drawPileCount: number;
	myMelds: DeckItem[][];
	theirMelds: DeckItem[][];
	potTakenByTeam: boolean;
	teamHasBurraco: boolean;
	/** La squadra avversaria ha preso il proprio pozzetto (stato PUBBLICO). */
	opponentsTookPot: boolean;
	/** Carte in mano a ciascun avversario (parallelo a `opponents`; conteggio PUBBLICO).
	 *  Usato per fiutare una chiusura imminente e sgombrare le penalità pesanti. */
	opponentHandCounts: number[];

	// Stato della partita
	matchScore: { ours: number; opponents: number };
	targetScore: number;
	handIndex: number;

	// Motore regole per validare i giochi candidati (fonte di verità).
	rules: Rules;
}

/** Ranking di una carta candidata allo scarto (per il debug delle decisioni). */
export interface CardScore {
	tag: string;
	uid: number;
	score: number;
	note?: string;
}

/**
 * Esito di una decisione: il valore + la motivazione (sempre presente, per il
 * debug) + un dettaglio opzionale (es. il ranking dello scarto).
 */
export interface AiDecision<T> {
	value: T;
	reason: string;
	detail?: CardScore[];
}

/**
 * Conoscenza persistente accumulata tra le partite (oggetto piatto,
 * serializzabile in LocalStorage). Le classi IA sono storage-agnostiche:
 * la esportano/importano, è il conduttore a salvarla e ricaricarla.
 */
export interface AiLongTermMemory {
	/** Record testa-a-testa per avversario (per battute tipo "con te perdo sempre"). */
	headToHead: Record<string, { wins: number; losses: number; games: number }>;
	/** Tendenze aggregate osservate per avversario (conteggi per seme/valore, ecc.). */
	opponentTendencies: Record<string, Record<string, number>>;
	/** Eventuale auto-taratura dei parametri appresa nel tempo. */
	tuning?: Partial<AiProfile>;
}

/** Fotografia della memoria dell'IA, per il pannello di debug. */
export interface AiMemorySnapshot {
	/** Tag delle carte viste uscire, con la fedeltà consentita da `memory`. */
	seenCards: string[];
	/** Tendenze modellate per avversario nella partita corrente (episodica). */
	opponentModel: Record<string, unknown>;
	/** Conoscenza persistente accumulata tra le partite. */
	longTerm: AiLongTermMemory;
}

/**
 * Interfaccia comune a tutte le IA. `DefaultAi` la implementa e le personalità
 * la estendono ridefinendo profilo, voce e all'occorrenza singoli metodi.
 */
export interface AiPlayer {
	readonly id: string;
	readonly name: string;
	readonly profile: AiProfile;

	/** Aggiorna la memoria privata con un evento pubblico del tavolo. */
	observe(event: TableEvent, view: GameView): void;

	/** Fase pesca: tallone o monte scarti. */
	decideDraw(view: GameView): AiDecision<DrawChoice>;

	/** Fase gioca-e-scarta: giochi da calare/appoggiare. */
	decidePlays(view: GameView): AiDecision<AiPlay[]>;

	/** Fase gioca-e-scarta: carta da scartare (con ranking in `detail`). */
	decideDiscard(view: GameView): AiDecision<DeckItem>;

	/** Commento reattivo a un evento (proprio o altrui). null = tace. */
	comment(event: TableEvent, view: GameView): string | null;

	/** Carica la memoria a lungo termine (da LocalStorage) all'avvio. */
	loadLongTermMemory(data: AiLongTermMemory | null): void;

	/** Esporta la memoria a lungo termine per la persistenza locale. */
	exportLongTermMemory(): AiLongTermMemory;

	/** Stato della memoria (episodica + lungo termine) per il debug. */
	memorySnapshot(): AiMemorySnapshot;
}
