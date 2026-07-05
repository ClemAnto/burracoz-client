import { NgClass, UpperCasePipe } from '@angular/common';
import {
	AfterViewInit,
	Component,
	computed,
	effect,
	ElementRef,
	inject,
	signal,
	ViewChild,
} from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { AiLongTermMemory, AiPlayer, GameView, TableEvent } from '../../ai/ai-player';
import { createAi } from '../../ai/personalities';
import { DeckItem, getCardRank } from '../../services/cards';
import { Game, GameEvent, GameEventType } from '../../services/game';
import { LocalStorage } from '../../services/local-storage';
import { Rules, isWild } from '../../services/rules';
import {
	DealResult,
	PlayerSide,
	Round,
	RoundEventType,
	RoundGameplayEvent,
	RoundPhase,
	RoundPlayer,
	RoundSavedState,
	RoundTeam,
	RoundTurnStep,
	TEAM_BY_PLAYER,
} from '../../services/round';
import {
	decodeMoveList,
	describeTurn,
	encodeMoveList,
	formatMoveLog,
	ReplayMove,
	splitTurns,
} from '../../services/move-notation';
import { Deck } from '../deck/deck';
import { HandResult } from '../hand-result/hand-result';
import { Tweener } from '../tweener/tweener';

/** Velocità delle mosse IA. 'manual' = un passo per ogni "AVANTI". */
export type AiSpeed = 'manual' | 'slow' | 'medium' | 'fast';

@Component({
	selector: 'ui-board',
	imports: [
		NzButtonModule,
		NzDrawerModule,
		NzIconModule,
		NzTagModule,
		Deck,
		HandResult,
		Tweener,
		UpperCasePipe,
		NgClass,
	],
	templateUrl: './board.html',
	host: {
		class: 'flex flex-col flex-1 min-h-0 w-full relative overflow-hidden',
	},
})
export class Board implements AfterViewInit {
	@ViewChild('tweener') tweener: Tweener;
	@ViewChild('drawPile') drawPile: Deck;
	@ViewChild('discardPile') discardPile: Deck;
	@ViewChild('pot1') pot1: Deck;
	@ViewChild('pot2') pot2: Deck;
	@ViewChild('northDeck') northDeck: Deck;
	@ViewChild('southDeck') southDeck: Deck;
	@ViewChild('eastDeck') eastDeck: Deck;
	@ViewChild('westDeck') westDeck: Deck;
	@ViewChild('meldArea') meldArea?: ElementRef<HTMLElement>;

	game = inject(Game);
	private rules = inject(Rules);
	private storage = inject(LocalStorage);
	private round = inject(Round);

	readonly RoundPhase = RoundPhase;
	readonly RoundTurnStep = RoundTurnStep;
	readonly PlayerSide = PlayerSide;

	readonly PLAYER_LABELS: Record<PlayerSide, string> = {
		[PlayerSide.North]: 'NORD',
		[PlayerSide.East]: 'EST',
		[PlayerSide.South]: 'SUD',
		[PlayerSide.West]: 'OVEST',
	};

	/**
	 * Istanza IA che presidia ciascun posto (personalità fissa per posto): esiste
	 * sempre, così la memoria e la personalità sopravvivono all'attivazione/disattivazione.
	 * Se il posto è "umano" (vedi `aiEnabled`) l'istanza resta ma non gioca.
	 */
	private readonly seatAi: Record<PlayerSide, AiPlayer> = {
		[PlayerSide.South]: createAi('bot'),
		[PlayerSide.North]: createAi('maria'),
		[PlayerSide.East]: createAi('sergio'),
		[PlayerSide.West]: createAi('maria'),
	};

	/** Posto giocato dall'IA (true) o da un umano (false). Persistito.
	 *  Default "gioco vero": SUD umano, gli altri tre IA. */
	aiEnabled = signal<Record<PlayerSide, boolean>>({
		[PlayerSide.South]: false,
		[PlayerSide.North]: true,
		[PlayerSide.East]: true,
		[PlayerSide.West]: true,
	});

	/** IA che gioca il posto, oppure null se il posto è umano. */
	aiAt(player: PlayerSide): AiPlayer | null {
		return this.aiEnabled()[player] ? this.seatAi[player] : null;
	}

	/** Ultima battuta pronunciata da un'IA (per il fumetto a schermo). */
	aiSpeech = signal<{ player: PlayerSide; text: string } | null>(null);

	/** Log delle decisioni IA (per il debug). */
	aiLog = signal<string[]>([]);

	// ---- Pannello di debug ----
	debugPanelOpen = signal(false);
	/** Editor JSON dello stato del tavolo (RoundSavedState serializzato). */
	debugStateJson = signal('');
	/** Esito dell'ultima operazione di debug. */
	debugMessage = signal('');

	// ---- Notazione mosse + player ----
	private moveLog = signal<RoundGameplayEvent[]>([]);
	private moveSetup: RoundSavedState | null = null;
	moveNotationText = signal('');
	/** Drawer delle mosse aperto/chiuso (persistito). */
	moveListOpen = signal(false);
	/** Righe leggibili delle mosse della mano corrente (per la colonna desktop). */
	moveLines = computed(() => formatMoveLog(this.moveLog()));
	/** Player: turni caricati + deal (null = player non attivo). */
	playback = signal<{ setup: RoundSavedState; turns: ReplayMove[][] } | null>(null);
	playbackTurn = signal(0);
	/** True mentre si riproducono mosse (player/replay): niente registrazione/voce. */
	private replaying = false;

	private viewReady = false;
	private aiScheduled = false;

	/** Velocità delle mosse IA (persistita). 'manual' = avanzamento con "AVANTI". */
	aiSpeed = signal<AiSpeed>('slow');
	/** True quando una mossa IA è in attesa di "AVANTI" (modalità manuale). */
	stepPending = signal(false);
	private stepResolver: (() => void) | null = null;
	readonly SPEED_OPTIONS = [
		{ value: 'manual', label: 'Manuale' },
		{ value: 'slow', label: 'Lento' },
		{ value: 'medium', label: 'Medio' },
		{ value: 'fast', label: 'Veloce' },
	] as const;

	/** Carte scoperte per posto (true = mano visibile). Persistito.
	 *  Default "gioco vero": vedo solo la mia mano (SUD). */
	faceUp = signal<Record<PlayerSide, boolean>>({
		[PlayerSide.South]: true,
		[PlayerSide.North]: false,
		[PlayerSide.East]: false,
		[PlayerSide.West]: false,
	});

	/** Modale impostazioni aperta/chiusa. */
	settingsOpen = signal(false);
	/** Ordine dei posti nella modale impostazioni. */
	readonly SEATS = [
		PlayerSide.South,
		PlayerSide.East,
		PlayerSide.North,
		PlayerSide.West,
	] as const;

	// Log [tween] + audit di univocità: separato dal debug delle mani perché i
	// console.log per-batch costano durante le animazioni di massa (deal).
	tweenDebug = signal(false);

	animate = signal(true);
	private resetGen = 0;

	currentPlayer = this.game.currentPlayer;
	eastCards = computed(() => this.game.hands().east);
	westCards = computed(() => this.game.hands().west);
	northCards = computed(() => this.game.hands().north);
	southCards = computed(() => this.game.hands().south);
	drawPileCards = this.game.drawPile;
	discardPileCards = this.game.discardPile;
	pot1Cards = computed(() => this.game.pots()[0] ?? []);
	pot2Cards = computed(() => this.game.pots()[1] ?? []);
	turnStep = this.game.turnStep;
	totalScore = this.game.totalScore;

	winnerPlayer = this.game.winnerPlayer;
	handScore = this.game.handScore;
	handEndedByStockExhaustion = this.game.handEndedByStockExhaustion;
	isGameEnded = this.game.isGameEnded;
	gameWinner = this.game.gameWinner;

	ourZoneActive = computed(
		() =>
			this.canPlay() &&
			(this.currentPlayer() === PlayerSide.North ||
				this.currentPlayer() === PlayerSide.South),
	);
	theirZoneActive = computed(
		() =>
			this.canPlay() &&
			(this.currentPlayer() === PlayerSide.East || this.currentPlayer() === PlayerSide.West),
	);

	ourMeldsData = computed(() => this.game.melds().ours);
	theirMeldsData = computed(() => this.game.melds().opponents);

	/**
	 * Carte coricate a 90° per marcare il burraco, gioco per gioco:
	 * 2 = pulito, 1 = semipulito/sporco, 0 = non è (ancora) un burraco.
	 * Convenzione tradizionale: pulito = ultime due orizzontali, sporco = ultima.
	 */
	ourMeldTails = computed(() => this.ourMeldsData().map((m) => this.burracoTail(m)));
	theirMeldTails = computed(() => this.theirMeldsData().map((m) => this.burracoTail(m)));

	private burracoTail(meld: DeckItem[]): number {
		const type = this.game.classifyBurraco(meld);
		return type === 'pulito' ? 2 : type ? 1 : 0;
	}

	/** True su viewport mobile (per compattare i giochi verticalmente). */
	mobile = signal(false);
	/** Altezza disponibile dell'area giochi in px (aggiornata da ResizeObserver). */
	private meldAreaHeight = signal(0);
	/** Lunghezza del gioco più lungo in campo (per dimensionare l'offset). */
	maxMeldLen = computed(() =>
		[...this.ourMeldsData(), ...this.theirMeldsData()].reduce(
			(max, meld) => Math.max(max, meld.length),
			1,
		),
	);
	/**
	 * Offset verticale per carta nei giochi. Desktop: fisso. Mobile: ridotto
	 * quanto serve perché anche il gioco più lungo stia in metà area, così i
	 * giochi non superano 2 righe; scende fino a un minimo compatto (12px).
	 */
	meldCardOffset = computed(() => {
		if (!this.mobile()) return 34;
		const areaH = this.meldAreaHeight();
		const len = this.maxMeldLen();
		if (!areaH || len <= 1) return 26;
		const rowH = (areaH - 24) / 2; // due righe, meno gap-y/padding
		return Math.max(12, Math.min(26, Math.floor((rowH - 18) / len)));
	});

	/** True quando tocca a un posto UMANO (nessuna IA sul posto). */
	isHumanTurn = computed(() => {
		const player = this.currentPlayer();
		return !!player && !this.aiAt(player);
	});

	canDraw = computed(
		() =>
			this.roundPhase() === RoundPhase.InProgress &&
			this.turnStep() === RoundTurnStep.DrawOrCollect &&
			this.isHumanTurn(),
	);

	canPlay = computed(
		() =>
			this.roundPhase() === RoundPhase.InProgress &&
			this.turnStep() === RoundTurnStep.PlayAndDiscard &&
			this.isHumanTurn(),
	);

	/**
	 * Stack di snapshot per annullare le mosse del turno umano. Ogni azione
	 * annullabile (prendi scarti, cala, appoggia) vi salva lo stato PRECEDENTE;
	 * la pesca dal tallone NON è annullabile (svelerebbe la carta) e azzera lo stack.
	 */
	private undoStack = signal<{ state: RoundSavedState; moveLogLen: number }[]>([]);
	canUndo = computed(
		() =>
			this.isHumanTurn() &&
			this.roundPhase() === RoundPhase.InProgress &&
			this.undoStack().length > 0,
	);
	isHandClosed = computed(() => this.roundPhase() === RoundPhase.Closed);

	/** Il monte scarti è interattivo al turno umano: prende (fase pesca) o riceve lo scarto (fase gioca). */
	discardPileActive = computed(() => this.canDraw() || this.canPlay());

	roundPhase = this.game.roundPhase;

	lastError = signal<string>(null);

	private dealAbort: AbortController | null = null;

	/** True mentre un'azione animata (pesca/scarto) è in corso: blocca la rientranza da doppio click. */
	private busy = false;

	constructor() {
		// Impostazioni persistite (velocità IA, posti IA/umani, carte scoperte):
		// carica all'avvio (merge sui default per tollerare stati parziali), salva a ogni cambio.
		const settings = this.storage.get<{
			aiSpeed?: AiSpeed;
			moveListOpen?: boolean;
			aiEnabled?: Record<PlayerSide, boolean>;
			faceUp?: Record<PlayerSide, boolean>;
		}>('burracoz_settings');
		if (settings?.aiSpeed) this.aiSpeed.set(settings.aiSpeed);
		if (settings?.moveListOpen !== undefined) this.moveListOpen.set(settings.moveListOpen);
		if (settings?.aiEnabled) this.aiEnabled.set({ ...this.aiEnabled(), ...settings.aiEnabled });
		if (settings?.faceUp) this.faceUp.set({ ...this.faceUp(), ...settings.faceUp });
		effect(() =>
			this.storage.set('burracoz_settings', {
				aiSpeed: this.aiSpeed(),
				moveListOpen: this.moveListOpen(),
				aiEnabled: this.aiEnabled(),
				faceUp: this.faceUp(),
			}),
		);

		// Adatta l'offset verticale dei giochi al viewport mobile.
		if (typeof matchMedia === 'function') {
			const mq = matchMedia('(max-width: 640px)');
			this.mobile.set(mq.matches);
			mq.addEventListener('change', (e) => this.mobile.set(e.matches));
		}

		// Loop dei turni: quando tocca a un posto IA, il conduttore esegue il turno.
		effect(() => {
			// dipendenze reattive dell'effect
			this.currentPlayer();
			this.turnStep();
			this.roundPhase();
			this.aiEnabled(); // riattivare l'IA sul posto di turno la fa partire subito
			this.maybeRunAiTurn();
		});

		// Registra le mosse e le trasmette alle IA (memoria + voce).
		this.game.gameplayEvents.subscribe((event) => this.onGameplayEvent(event));
		// Eventi di partita: banter, reset memoria, apprendimento, persistenza.
		this.game.gameEvents.subscribe((event) => this.onGameEvent(event));
	}

	attachToMeld(meldIndex: number) {
		const player = this.currentPlayer();
		const deck = this.playerDecks[player];
		if (!deck) return;
		// Istanze, non tag: nel mazzo doppio il tag è ambiguo (due copie identiche)
		// e il Round rimuoverebbe potenzialmente la copia sbagliata dalla mano.
		const cards = deck.selecteds();
		if (!cards.length) return;

		// Log della validazione del gioco risultante (carte + gioco a terra).
		const team = TEAM_BY_PLAYER[player];
		const target = this.game.melds()[team][meldIndex] ?? [];
		const validated = this.rules.validateMeld(cards, target);
		console.log(
			`%c[attacco] ${player} → gioco ${meldIndex}: ` +
				`${cards.map((c) => c.tag).join(' ')} + [${target.map((c) => c.tag).join(' ')}] ⇒ ` +
				(validated ? `VALIDO (${validated.map((c) => c.tag).join(' ')})` : 'NON VALIDO'),
			`color:${validated ? '#4ade80' : '#f87171'};font-weight:bold`,
		);

		const snapshot = this.undoSnapshot();
		// `game.attachToMeld` è l'autorità: rivalida e, se ok, procede (altrimenti lastError).
		if (!this.game.attachToMeld(meldIndex, cards)) return;
		this.pushUndo(snapshot);
		deck.selecteds.set([]);
		// Le carte calate escono dalla mano; `list()` mantiene l'ordine delle
		// rimanenti. Niente riordino: l'ordine è del giocatore (drag & drop).
	}

	addMeld() {
		const deck = this.playerDecks[this.currentPlayer()];
		if (!deck) return;
		const cards = deck.selecteds();
		if (!cards.length) return;
		const snapshot = this.undoSnapshot();
		if (!this.game.openMeld(cards)) return;
		this.pushUndo(snapshot);
		deck.selecteds.set([]);
	}

	/** Cattura lo stato corrente (Round + lunghezza log mosse) per un eventuale undo. */
	private undoSnapshot(): { state: RoundSavedState; moveLogLen: number } {
		return { state: this.round.getState(), moveLogLen: this.moveLog().length };
	}

	private pushUndo(snapshot: { state: RoundSavedState; moveLogLen: number }): void {
		this.undoStack.update((stack) => [...stack, snapshot]);
	}

	/** Annulla l'ultima mossa annullabile del turno, ripristinando lo stato salvato. */
	undoTurn(): void {
		if (this.busy) return;
		const stack = this.undoStack();
		if (!stack.length) return;
		const { state, moveLogLen } = stack[stack.length - 1];
		this.undoStack.set(stack.slice(0, -1));
		this.round.restoreState(state);
		// Riallinea la notazione mosse; le istanze sono nuove → azzera le selezioni.
		this.moveLog.update((log) => log.slice(0, moveLogLen));
		this.playerDecks[this.currentPlayer()]?.selecteds.set([]);
	}

	/** Click sul monte scarti: prende il monte (fase pesca) o scarta la carta selezionata (fase gioca). */
	onDiscardPileClick(): void {
		if (this.canDraw()) this.willTakeDiscardPile();
		else if (this.canPlay()) this.discard();
	}

	async willTakeFromDrawPile() {
		if (this.busy) return;
		if (!this.game.drawPile().length) return;
		const player = this.currentPlayer();
		const before = this.handUids(player);

		this.busy = true;
		try {
			// Commit diretto: i signal del Round spostano la carta e il FLIP
			// dello scope anima da solo il volo tallone → mano.
			if (!this.game.drawFromStock()) return;
			// La pesca dal tallone svela una carta coperta: non è annullabile.
			this.undoStack.set([]);

			await this.tweener.whenIdle();
			// Sistema le carte appena arrivate (inserimento intelligente se umano).
			this.arrangeIncoming(player, before);
		} finally {
			this.busy = false;
		}
	}

	async willTakeDiscardPile() {
		if (this.busy) return;
		if (!this.game.discardPile().length) return;
		const player = this.currentPlayer();
		const before = this.handUids(player);
		// Prendere il monte è annullabile (info pubblica): salva lo stato precedente.
		const snapshot = this.undoSnapshot();

		this.busy = true;
		try {
			// Commit diretto: i signal del Round spostano l'intero monte in mano
			// e il FLIP dello scope anima da solo il volo scarti → mano.
			if (!this.game.takeDiscardPile()) return;
			this.pushUndo(snapshot);

			await this.tweener.whenIdle();
			// Sistema le carte raccolte (inserimento intelligente se umano).
			this.arrangeIncoming(player, before);
		} finally {
			this.busy = false;
		}
	}

	private playerDecks: Partial<Record<RoundPlayer, Deck>> = {};

	ngAfterViewInit() {
		this.playerDecks = {
			[PlayerSide.North]: this.northDeck,
			[PlayerSide.East]: this.eastDeck,
			[PlayerSide.South]: this.southDeck,
			[PlayerSide.West]: this.westDeck,
		};
		this.viewReady = true;
		this.loadAiMemories(); // memoria IA persistita (anche dopo F5)
		this.maybeRunAiTurn();

		// Osserva l'altezza dell'area giochi per dimensionare l'offset dei giochi.
		const meldEl = this.meldArea?.nativeElement;
		if (meldEl && typeof ResizeObserver === 'function') {
			const observer = new ResizeObserver(() => this.meldAreaHeight.set(meldEl.clientHeight));
			observer.observe(meldEl);
			this.meldAreaHeight.set(meldEl.clientHeight);
		}
	}

	/**
	 * Anima la distribuzione delle carte usando le istanze DeckItem già calcolate
	 * da game.prepareHand(). Al termine, i Deck component hanno le stesse istanze
	 * che commitHand() scriverà nei signal → nessun salto visivo.
	 */
	private async deal(result: DealResult, signal: AbortSignal): Promise<void> {
		const check = () => {
			if (signal.aborted) throw new DOMException('aborted', 'AbortError');
		};
		const dealOrder: RoundPlayer[] = this.buildDealOrder(result.firstPlayer);

		// 11 giri × 4 giocatori, una carta per volta
		for (let i = 0; i < 11; i++) {
			for (const player of dealOrder) {
				const card = result.hands[player][i];
				if (!card) continue;
				this.drawPile.removeItems([card]);
				this.playerDecks[player].put([card]);
				await sleep(10);
				check();
			}
		}

		await this.tweener.whenIdle();
		check();
		await sleep(500);
		check();

		// Pozzetti
		for (let i = 0; i < 2; i++) {
			const cards = result.pots[i];
			this.drawPile.removeItems(cards);
			[this.pot1, this.pot2][i].put(cards);
			await sleep(500);
			check();
		}

		await this.tweener.whenIdle();
		check();

		// Prima carta degli scarti
		if (result.discard) {
			this.drawPile.removeItems([result.discard]);
			this.discardPile.put([result.discard]);
		}
	}

	private buildDealOrder(firstPlayer: RoundPlayer): RoundPlayer[] {
		const ORDER: PlayerSide[] = [
			PlayerSide.North,
			PlayerSide.East,
			PlayerSide.South,
			PlayerSide.West,
		];
		const start = ORDER.indexOf(firstPlayer);
		return [...ORDER.slice(start), ...ORDER.slice(0, start)];
	}

	async startGame() {
		this.dealAbort?.abort();
		this.dealAbort = new AbortController();
		this.game.startGame();
		const deal = await this.game.prepareHand();
		try {
			await this.deal(deal, this.dealAbort.signal);
			this.game.commitHand(deal);
			// Riordino delle mani solo a distribuzione conclusa.
			this.sortHands();
		} catch (e: any) {
			if (e?.name !== 'AbortError') throw e;
		}
	}

	/** Riordina tutte le mani per seme→rank (sort iniziale, a distribuzione conclusa). */
	private sortHands() {
		for (const p of [PlayerSide.North, PlayerSide.East, PlayerSide.South, PlayerSide.West]) {
			this.playerDecks[p]?.autosortNow();
		}
	}

	/** uid delle carte attualmente in mano al posto. */
	private handUids(player: RoundPlayer): Set<number> {
		return new Set(this.game.hands()[player].map((c) => c.uid));
	}

	/** Vero se il posto è giocato da un umano (che riordina la propria mano). */
	private isHuman(player: RoundPlayer): boolean {
		return !this.aiAt(player);
	}

	/**
	 * Sistema le carte appena entrate in mano (pesca, presa da terra, pozzetto).
	 * Umano: NON si riordina tutta la mano (l'ordine è del giocatore, drag & drop),
	 * le nuove carte si inseriscono in modo intelligente. IA: autosort completo.
	 * @param before uid delle carte PRIMA dell'azione (le nuove sono quelle assenti).
	 */
	private arrangeIncoming(player: RoundPlayer, before: Set<number>): void {
		const deck = this.playerDecks[player];
		if (!deck) return;
		if (!this.isHuman(player)) {
			deck.autosortNow();
			return;
		}
		const incoming = this.game.hands()[player].filter((c) => !before.has(c.uid));
		if (incoming.length) this.smartArrangeHand(player, incoming);
	}

	/**
	 * Inserisce le carte `incoming` nell'ordine manuale della mano: se una carta
	 * forma un potenziale gioco con carte già in mano (set: stesso valore; scala:
	 * stesso seme in sequenza) la mette accanto ad esse, altrimenti in fondo.
	 * Le carte già presenti mantengono l'ordine scelto dal giocatore.
	 */
	private smartArrangeHand(player: RoundPlayer, incoming: DeckItem[]): void {
		const deck = this.playerDecks[player];
		if (!deck) return;
		const hand = this.game.hands()[player];
		const byUid = new Map(hand.map((c) => [c.uid, c] as const));
		const isIncoming = new Set(incoming.map((c) => c.uid));
		// Base = ordine manuale corrente (solo carte ancora in mano, escluse le nuove).
		const baseOrder = (deck.manualOrder() ?? hand.map((c) => c.uid)).filter(
			(uid) => byUid.has(uid) && !isIncoming.has(uid),
		);
		const arranged = baseOrder.map((uid) => byUid.get(uid)!);
		for (const card of incoming) {
			const idx = this.smartInsertIndex(card, arranged);
			if (idx < 0) arranged.push(card);
			else arranged.splice(idx, 0, card);
		}
		deck.manualOrder.set(arranged.map((c) => c.uid));
	}

	/**
	 * Posizione in cui inserire `card` fra le carte `hand` per affiancarla a un
	 * potenziale gioco valido; -1 se non c'è (→ va in fondo).
	 */
	private smartInsertIndex(card: DeckItem, hand: DeckItem[]): number {
		if (isWild(card)) return -1; // le matte non guidano l'inserimento → in fondo
		// SET: almeno 2 carte dello stesso valore già in mano → potenziale tris.
		const sameValue = hand
			.map((c, i) => [c, i] as const)
			.filter(([c]) => !isWild(c) && c.value === card.value);
		if (sameValue.length >= 2) {
			return sameValue[sameValue.length - 1][1] + 1;
		}
		// SCALA: stesso seme, la carta estende una sequenza (≥2 consecutivi con essa).
		const rank = getCardRank(card.value);
		const suitRanks = hand
			.filter((c) => !isWild(c) && c.suit === card.suit)
			.map((c) => getCardRank(c.value));
		const has = (r: number) => suitRanks.includes(r);
		const extendsRun =
			(has(rank - 1) && has(rank - 2)) ||
			(has(rank - 1) && has(rank + 1)) ||
			(has(rank + 1) && has(rank + 2));
		if (extendsRun) {
			const before = hand.findIndex(
				(c) => !isWild(c) && c.suit === card.suit && getCardRank(c.value) > rank,
			);
			if (before >= 0) return before;
			for (let i = hand.length - 1; i >= 0; i--) {
				if (hand[i].suit === card.suit && !isWild(hand[i])) return i + 1;
			}
		}
		return -1;
	}

	async resetGame() {
		const gen = ++this.resetGen;
		this.dealAbort?.abort();
		this.animate.set(false);
		this.tweener?.reset();
		await sleep(0); // attende che Angular processi animate=false (e azzeri le leave animations) prima di cambiare i segnali delle carte
		if (gen !== this.resetGen) return;
		await this.game.resetGame();
		if (gen === this.resetGen) this.animate.set(true);
	}

	async discard() {
		if (this.busy) return;
		const player = this.currentPlayer();
		const deck = this.playerDecks[player];
		if (!deck) return;
		const [card] = deck.selecteds();
		if (!card) return;
		const before = this.handUids(player);

		this.busy = true;
		try {
			// L'istanza, non il tag: col tag il Round potrebbe rimuovere dalla mano
			// l'ALTRA copia identica della stessa carta (mazzo doppio).
			// Commit diretto: il Round scopre la carta e la sposta negli scarti,
			// il FLIP dello scope anima da solo il volo mano → scarti.
			if (!this.game.discard(card)) return;
			// Lo scarto chiude il turno: non c'è più nulla da annullare.
			this.undoStack.set([]);
			deck.selecteds.update((s) => s.filter((c) => c.uid !== card.uid));

			await this.tweener.whenIdle();
			// Se lo scarto ha svuotato la mano e preso il pozzetto, sistema le carte
			// entrate (inserimento intelligente se umano; autosort per l'IA).
			this.arrangeIncoming(player, before);
		} finally {
			this.busy = false;
		}
		// Passa la mano: se il prossimo è un bot, parte il suo turno.
		this.maybeRunAiTurn();
	}

	async nextHand() {
		// Stesso AbortController di startGame: così un RESET durante la
		// distribuzione della nuova mano può interrompere l'animazione.
		this.dealAbort?.abort();
		this.dealAbort = new AbortController();
		// prepareHand ricostituisce e rimescola il mazzo (le carte tornano al tallone):
		// attende che l'animazione di raccolta si concluda prima di ridistribuire.
		const deal = await this.game.prepareHand();
		await this.tweener.whenIdle();
		try {
			await this.deal(deal, this.dealAbort.signal);
			this.game.commitHand(deal);
			this.sortHands();
		} catch (e: any) {
			if (e?.name !== 'AbortError') throw e;
		}
	}

	// ============================================================
	// CONDUTTORE IA (loop turni bot, broadcast eventi, persistenza)
	// ============================================================

	/** Programma il turno del bot corrente, se è il momento (fuori dall'effect). */
	private maybeRunAiTurn(): void {
		if (this.aiScheduled || this.busy || !this.viewReady || this.replaying || this.playback())
			return;
		const player = this.currentPlayer();
		if (!player || !this.aiAt(player)) return;
		if (this.roundPhase() !== RoundPhase.InProgress) return;
		// setTimeout(0) esce dall'effect (i signal write avvengono fuori dal contesto
		// reattivo); il ritmo vero è dentro runAiTurn (waitStep). Nessun filtro sulla
		// fase: così dopo un F5 si riprende anche a metà turno (gioca-e-scarta).
		this.aiScheduled = true;
		setTimeout(() => {
			this.aiScheduled = false;
			void this.runAiTurn();
		}, 0);
	}

	/** Pausa prima di una mossa IA: attende "AVANTI" in manuale, altrimenti il delay. */
	private async waitStep(): Promise<void> {
		if (this.aiSpeed() === 'manual') {
			this.stepPending.set(true);
			await new Promise<void>((resolve) => (this.stepResolver = resolve));
			return;
		}
		await sleep(this.speedDelay());
	}

	private speedDelay(): number {
		switch (this.aiSpeed()) {
			case 'slow':
				return 850;
			case 'fast':
				return 90;
			default:
				return 350; // medio
		}
	}

	/** Sblocca la prossima mossa IA in modalità manuale. */
	advanceStep(): void {
		const resolve = this.stepResolver;
		this.stepResolver = null;
		this.stepPending.set(false);
		resolve?.();
	}

	/** Imposta la velocità (persistita dall'effect); se esce da manuale, sblocca. */
	setAiSpeed(speed: AiSpeed): void {
		this.aiSpeed.set(speed);
		if (speed !== 'manual' && this.stepResolver) this.advanceStep();
	}

	/** Turno interrotto (player aperto o reset). */
	private aborted(): boolean {
		return !!this.playback();
	}

	/** Esegue il turno del bot corrente: pesca → giochi → scarto, col ritmo scelto. */
	private async runAiTurn(): Promise<void> {
		if (this.busy) return;
		const player = this.currentPlayer();
		if (!player) return;
		const ai = this.aiAt(player);
		if (!ai) return;
		if (this.roundPhase() !== RoundPhase.InProgress) return;

		this.busy = true;
		try {
			// PESCA (saltata se, dopo un F5, il turno è già in fase gioca-e-scarta).
			if (this.turnStep() === RoundTurnStep.DrawOrCollect) {
				await this.waitStep();
				if (this.aborted()) return;
				const draw = ai.decideDraw(this.buildView(player));
				this.logAi(player, draw.reason);
				const wantsPile = draw.value === 'discard' && this.game.discardPile().length > 0;
				let drew = wantsPile ? this.game.takeDiscardPile() : this.game.drawFromStock();
				if (!drew) {
					drew = this.game.discardPile().length
						? this.game.takeDiscardPile()
						: this.game.drawFromStock();
				}
				if (!drew) {
					// Tallone e monte vuoti: turno impossibile, sospende il bot.
					this.logAi(
						player,
						'Nessuna pesca possibile: turno sospeso (tallone esaurito).',
					);
					return;
				}
				await this.tweener.whenIdle();
				this.playerDecks[player]?.autosortNow();
			}

			if (this.aborted()) return;
			// GIOCHI (calate + appoggi)
			const plays = ai.decidePlays(this.buildView(player));
			this.logAi(player, plays.reason);
			for (const play of plays.value) {
				if (this.roundPhase() !== RoundPhase.InProgress) break;
				if (this.turnStep() !== RoundTurnStep.PlayAndDiscard) break;
				await this.waitStep();
				if (this.aborted()) return;
				const ok =
					play.kind === 'open'
						? this.game.openMeld(play.cards)
						: this.game.attachToMeld(play.meldIndex, play.cards);
				if (!ok) continue;
				await this.tweener.whenIdle();
				this.playerDecks[player]?.autosortNow();
			}

			if (this.aborted()) return;
			// SCARTO (se la mano non è già chiusa dalle giocate)
			if (
				this.roundPhase() === RoundPhase.InProgress &&
				this.turnStep() === RoundTurnStep.PlayAndDiscard
			) {
				await this.waitStep();
				if (this.aborted()) return;
				const discard = ai.decideDiscard(this.buildView(player));
				this.logAi(player, discard.reason);
				if (discard.value) this.game.discard(discard.value);
				await this.tweener.whenIdle();
				this.playerDecks[player]?.autosortNow();
			}
		} finally {
			this.busy = false;
		}
		// Concatena il turno successivo (se anch'esso IA).
		this.maybeRunAiTurn();
	}

	/** Costruisce la vista read-only per l'IA del posto indicato. */
	private buildView(player: PlayerSide): GameView {
		const team = TEAM_BY_PLAYER[player];
		const otherTeam: RoundTeam = team === 'ours' ? 'opponents' : 'ours';
		const partner = this.partnerOf(player);
		const opponents = this.opponentsOf(player);
		const melds = this.game.melds();
		const total = this.game.totalScore();
		const potFlags = this.game.playerHasTakenPot();
		const hands = this.game.hands();
		const discardPile = this.game.discardPile();
		return {
			me: player,
			team,
			partner,
			opponents,
			hand: hands[player],
			partnerHandCount: hands[partner].length,
			discardPile,
			discardTop: discardPile.at(-1) ?? null,
			drawPileCount: this.game.drawPile().length,
			myMelds: melds[team],
			theirMelds: melds[otherTeam],
			potTakenByTeam: potFlags[player] || potFlags[partner],
			teamHasBurraco: this.game.teamHasBurraco()[team],
			opponentsTookPot: opponents.some((o) => potFlags[o]),
			opponentHandCounts: opponents.map((o) => hands[o].length),
			matchScore: team === 'ours' ? total : { ours: total.opponents, opponents: total.ours },
			targetScore: this.game.targetScore(),
			handIndex: this.game.handIndex(),
			rules: this.rules,
		};
	}

	private partnerOf(player: PlayerSide): PlayerSide {
		const team = TEAM_BY_PLAYER[player];
		return ALL_SEATS.find((p) => p !== player && TEAM_BY_PLAYER[p] === team)!;
	}

	private opponentsOf(player: PlayerSide): PlayerSide[] {
		const team = TEAM_BY_PLAYER[player];
		return ALL_SEATS.filter((p) => TEAM_BY_PLAYER[p] !== team);
	}

	// ---- Broadcast eventi → IA (memoria + voce) ----

	/** Un evento di gioco: lo registra (per l'export) e lo trasmette alle IA. */
	private onGameplayEvent(event: RoundGameplayEvent): void {
		if (this.replaying) return; // durante il player non si registra né si commenta
		this.moveLog.update((log) => [...log, event]);
		this.broadcast(this.toTableEvent(event));
	}

	private broadcast(event: TableEvent): void {
		for (const seat of ALL_SEATS) {
			const ai = this.aiAt(seat);
			if (!ai) continue;
			const view = this.buildView(seat);
			ai.observe(event, view);
			const line = ai.comment(event, view);
			if (line) this.say(seat, line);
		}
	}

	private broadcastSystem(kind: TableEvent['kind']): void {
		for (const seat of ALL_SEATS) {
			const ai = this.aiAt(seat);
			if (!ai) continue;
			const event: TableEvent = { kind, actor: seat };
			const view = this.buildView(seat);
			ai.observe(event, view);
			const line = ai.comment(event, view);
			if (line) this.say(seat, line);
		}
	}

	private toTableEvent(event: RoundGameplayEvent): TableEvent {
		return {
			kind: EVENT_KIND[event.type],
			actor: event.player,
			cards: event.cards,
			meldIndex: event.meldIndex,
		};
	}

	private onGameEvent(event: GameEvent): void {
		switch (event.type) {
			case GameEventType.GameStarted:
				this.loadAiMemories();
				this.broadcastSystem('game_start');
				break;
			case GameEventType.HandStarted:
				// Nuova mano: fotografa il deal e azzera la registrazione delle mosse.
				this.moveSetup = this.round.getState();
				this.moveLog.set([]);
				this.broadcastSystem('hand_start');
				break;
			case GameEventType.HandEnded:
				this.broadcastSystem('hand_end');
				break;
			case GameEventType.GameEnded:
				this.broadcastSystem('game_end');
				this.saveAiMemories();
				break;
		}
	}

	private say(player: PlayerSide, text: string): void {
		this.aiSpeech.set({ player, text });
		setTimeout(() => {
			const current = this.aiSpeech();
			if (current?.player === player && current?.text === text) this.aiSpeech.set(null);
		}, 2800);
	}

	private logAi(player: PlayerSide, reason: string): void {
		const line = `${this.PLAYER_LABELS[player]}: ${reason}`;
		if (this.tweenDebug()) console.log('%c[ai]', 'color:#60a5fa', line);
		this.aiLog.update((log) => [...log.slice(-40), line]);
	}

	// ---- Persistenza memoria a lungo termine (apprendimento tra partite) ----

	private loadAiMemories(): void {
		// Sempre su tutte le istanze (anche posti umani): la memoria per posizione
		// non va persa se un posto viene disattivato e poi riattivato.
		for (const seat of ALL_SEATS) {
			const ai = this.seatAi[seat];
			ai.loadLongTermMemory(this.storage.get<AiLongTermMemory>('ai_ltm_' + seat) ?? null);
		}
	}

	private saveAiMemories(): void {
		for (const seat of ALL_SEATS) {
			const ai = this.seatAi[seat];
			this.storage.set('ai_ltm_' + seat, ai.exportLongTermMemory());
		}
	}

	// ============================================================
	// DEBUG: stato tavolo (salva / carica / modifica / riprendi)
	// ============================================================

	toggleDebugPanel(): void {
		this.debugPanelOpen.update((v) => !v);
		if (this.debugPanelOpen()) this.captureState();
	}

	// ---- Modale impostazioni (velocità IA, posti IA/umano, carte scoperte) ----

	toggleSettings(): void {
		this.settingsOpen.update((v) => !v);
	}

	setSeatAi(player: PlayerSide, enabled: boolean): void {
		this.aiEnabled.update((m) => ({ ...m, [player]: enabled }));
	}

	setSeatFaceUp(player: PlayerSide, up: boolean): void {
		this.faceUp.update((m) => ({ ...m, [player]: up }));
	}

	/** Apre/chiude la colonna mosse (solo desktop). */
	toggleMoveList(): void {
		this.moveListOpen.update((v) => !v);
	}

	/** Cattura lo stato corrente del tavolo nell'editor. */
	captureState(): void {
		this.debugStateJson.set(JSON.stringify(this.round.getState(), null, 2));
		this.debugMessage.set('Stato catturato dal tavolo.');
	}

	/**
	 * Applica lo stato dall'editor e riprende: il conduttore fa reagire l'IA
	 * da sola (l'effect osserva i signal di Round appena ripristinati).
	 */
	applyState(): void {
		let parsed: RoundSavedState;
		try {
			parsed = JSON.parse(this.debugStateJson());
		} catch (e) {
			this.debugMessage.set('JSON non valido: ' + (e as Error).message);
			return;
		}
		this.tweener?.reset();
		this.round.restoreState(parsed);
		this.sortHands();
		this.maybeRunAiTurn();
		this.debugMessage.set("Stato applicato: l'IA riprende dal nuovo stato.");
	}

	/** Scarica lo stato del tavolo come file JSON. */
	downloadState(): void {
		this.captureState();
		const blob = new Blob([this.debugStateJson()], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'burracoz-state.json';
		link.click();
		URL.revokeObjectURL(url);
	}

	/** Carica lo stato del tavolo da un file selezionato (poi premere "Applica"). */
	loadStateFile(event: Event): void {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			this.debugStateJson.set(String(reader.result ?? ''));
			this.debugMessage.set('File caricato: premi "Applica".');
		};
		reader.readAsText(file);
		input.value = '';
	}

	/** Salva lo stato corrente in uno slot locale. */
	saveStateSlot(): void {
		this.storage.set('burracoz_debug_state', this.round.getState());
		this.captureState();
		this.debugMessage.set('Stato salvato nello slot locale.');
	}

	/** Carica lo stato dallo slot locale nell'editor (poi premere "Applica"). */
	loadStateSlot(): void {
		const saved = this.storage.get<RoundSavedState>('burracoz_debug_state');
		if (!saved) {
			this.debugMessage.set('Nessuno slot salvato.');
			return;
		}
		this.debugStateJson.set(JSON.stringify(saved, null, 2));
		this.debugMessage.set('Slot caricato: premi "Applica".');
	}

	/** Tag delle carte in mano a un giocatore (per il pannello). */
	handTags(player: PlayerSide): string {
		return (
			this.game
				.hands()
				[player].map((c) => c.tag)
				.join(' ') || '—'
		);
	}

	/** Tag di un insieme di carte (mano, gioco, scarti…). */
	tagsOf(cards: { tag: string }[]): string {
		return cards.map((c) => c.tag).join(' ') || '—';
	}

	/** Snapshot della memoria dell'IA di un posto (null se umano). */
	aiMemoryOf(player: PlayerSide) {
		return this.aiAt(player)?.memorySnapshot() ?? null;
	}

	/** Nome dell'IA di un posto (o "umano"). */
	aiNameOf(player: PlayerSide): string {
		return this.aiAt(player)?.name ?? 'umano';
	}

	// ============================================================
	// NOTAZIONE MOSSE (export/import) + PLAYER (avanti/indietro)
	// ============================================================

	/** Esporta le mosse della mano corrente in notazione testuale leggibile. */
	exportMoves(): void {
		const setup = this.moveSetup ?? this.round.getState();
		const seats =
			`Nord=${this.aiNameOf(PlayerSide.North)} Est=${this.aiNameOf(PlayerSide.East)} ` +
			`Sud=${this.aiNameOf(PlayerSide.South)} Ovest=${this.aiNameOf(PlayerSide.West)}`;
		this.moveNotationText.set(encodeMoveList(setup, this.moveLog(), { seats }));
		this.debugMessage.set('Mosse esportate nella casella.');
	}

	/** Scarica la notazione come file di testo. */
	downloadMoves(): void {
		this.exportMoves();
		const blob = new Blob([this.moveNotationText()], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'burracoz-mosse.txt';
		link.click();
		URL.revokeObjectURL(url);
	}

	/** Carica una notazione da file nella casella (poi "Apri player"). */
	loadMovesFile(event: Event): void {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			this.moveNotationText.set(String(reader.result ?? ''));
			this.debugMessage.set('Notazione caricata: premi "Apri player".');
		};
		reader.readAsText(file);
		input.value = '';
	}

	/** Apre il player dalla notazione nella casella (turno 0 = inizio mano). */
	openPlayer(): void {
		let decoded;
		try {
			decoded = decodeMoveList(this.moveNotationText());
		} catch (e) {
			this.debugMessage.set('Notazione non valida: ' + (e as Error).message);
			return;
		}
		const turns = splitTurns(decoded.moves);
		this.animate.set(false);
		this.playback.set({ setup: decoded.setup, turns });
		this.gotoTurn(0);
		this.debugMessage.set(`Player aperto: ${turns.length} turni.`);
	}

	/** Ricostruisce lo stato fino al turno `target` (0 = solo deal). */
	gotoTurn(target: number): void {
		const pb = this.playback();
		if (!pb) return;
		const t = Math.max(0, Math.min(target, pb.turns.length));
		this.replaying = true;
		this.game.suspendHistory = true;
		try {
			this.tweener?.reset();
			this.round.restoreState(pb.setup);
			for (let i = 0; i < t; i++) {
				for (const move of pb.turns[i]) this.applyReplayMove(move);
			}
		} finally {
			this.replaying = false;
			this.game.suspendHistory = false;
		}
		this.playbackTurn.set(t);
		this.sortHands();
	}

	playerNext(): void {
		this.gotoTurn(this.playbackTurn() + 1);
	}
	playerPrev(): void {
		this.gotoTurn(this.playbackTurn() - 1);
	}
	playerStart(): void {
		this.gotoTurn(0);
	}
	playerEnd(): void {
		const pb = this.playback();
		if (pb) this.gotoTurn(pb.turns.length);
	}

	/** Etichetta leggibile del turno corrente del player. */
	playerLabel(): string {
		const pb = this.playback();
		if (!pb) return '';
		const t = this.playbackTurn();
		if (t === 0) return `Inizio mano · 0 / ${pb.turns.length}`;
		return `Turno ${t} / ${pb.turns.length} — ${describeTurn(pb.turns[t - 1])}`;
	}

	/** Chiude il player; se `resume`, riprende la partita dallo stato mostrato. */
	closePlayer(resume: boolean): void {
		this.playback.set(null);
		this.tweener?.reset();
		this.animate.set(true);
		if (resume) {
			this.moveSetup = this.round.getState();
			this.moveLog.set([]);
			this.debugMessage.set('Partita ripresa da questo turno.');
			this.maybeRunAiTurn();
		} else {
			this.debugMessage.set('Player chiuso.');
		}
	}

	private applyReplayMove(move: ReplayMove): void {
		switch (move.type) {
			case 'draw':
				this.game.drawFromStock();
				break;
			case 'take_discard':
				this.game.takeDiscardPile();
				break;
			case 'open':
				this.game.openMeld(move.cards);
				break;
			case 'attach':
				this.game.attachToMeld(move.meldIndex, move.cards);
				break;
			case 'discard':
				this.game.discard(move.cards[0]);
				break;
		}
	}
}

/** Ordine fisso dei quattro posti. */
const ALL_SEATS: PlayerSide[] = [
	PlayerSide.North,
	PlayerSide.East,
	PlayerSide.South,
	PlayerSide.West,
];

/** Mappa evento di Round → tipo di evento per l'IA. */
const EVENT_KIND: Record<RoundEventType, TableEvent['kind']> = {
	[RoundEventType.Draw]: 'draw_stock',
	[RoundEventType.TakeDiscard]: 'take_discard',
	[RoundEventType.Open]: 'open',
	[RoundEventType.Attach]: 'attach',
	[RoundEventType.Discard]: 'discard',
	[RoundEventType.TakePot]: 'take_pot',
	[RoundEventType.Close]: 'close',
};

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}
