import { NgClass, UpperCasePipe } from '@angular/common';
import {
	AfterViewInit,
	Component,
	computed,
	effect,
	inject,
	signal,
	ViewChild,
} from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { AiLongTermMemory, AiPlayer, GameView, TableEvent } from '../../ai/ai-player';
import { createAi } from '../../ai/personalities';
import { Game, GameEvent, GameEventType } from '../../services/game';
import { LocalStorage } from '../../services/local-storage';
import { Rules } from '../../services/rules';
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
	ReplayMove,
	splitTurns,
} from '../../services/move-notation';
import { Deck } from '../deck/deck';
import { Tweener } from '../tweener/tweener';

@Component({
	selector: 'ui-board',
	imports: [NzButtonModule, NzTagModule, Deck, Tweener, UpperCasePipe, NgClass],
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
	 * Configurazione dei posti: null = umano, altrimenti l'IA che lo gioca.
	 * Numero di IA arbitrario 0..4. Config attuale: 4 IA (demo autonoma).
	 * Per giocare come umano: `[PlayerSide.South]: null`.
	 */
	seats: Record<PlayerSide, AiPlayer | null> = {
		[PlayerSide.South]: createAi('bot'),
		[PlayerSide.North]: createAi('maria'),
		[PlayerSide.East]: createAi('sergio'),
		[PlayerSide.West]: createAi('maria'),
	};

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
	/** Player: turni caricati + deal (null = player non attivo). */
	playback = signal<{ setup: RoundSavedState; turns: ReplayMove[][] } | null>(null);
	playbackTurn = signal(0);
	/** True mentre si riproducono mosse (player/replay): niente registrazione/voce. */
	private replaying = false;

	private viewReady = false;
	private aiScheduled = false;
	private readonly AI_TURN_DELAY = 350;
	private readonly AI_ACTION_DELAY = 180;

	// Modalità debug: tutte le mani scoperte (true = carte visibili per tutti)
	debug = signal(true);
	playAsEveryone = computed(() => this.debug());

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

	/** True quando tocca a un posto UMANO (seats[player] === null). */
	isHumanTurn = computed(() => {
		const player = this.currentPlayer();
		return !!player && this.seats[player] === null;
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

	canUndo = computed(() => false);
	isHandClosed = computed(() => this.roundPhase() === RoundPhase.Closed);

	roundPhase = this.game.roundPhase;

	lastError = signal<string>(null);

	private dealAbort: AbortController | null = null;

	/** True mentre un'azione animata (pesca/scarto) è in corso: blocca la rientranza da doppio click. */
	private busy = false;

	constructor() {
		// Loop dei turni: quando tocca a un posto IA, il conduttore esegue il turno.
		effect(() => {
			// dipendenze reattive dell'effect
			this.currentPlayer();
			this.turnStep();
			this.roundPhase();
			this.maybeRunAiTurn();
		});

		// Registra le mosse e le trasmette alle IA (memoria + voce).
		this.game.gameplayEvents.subscribe((event) => this.onGameplayEvent(event));
		// Eventi di partita: banter, reset memoria, apprendimento, persistenza.
		this.game.gameEvents.subscribe((event) => this.onGameEvent(event));
	}

	attachToMeld(meldIndex: number) {
		const deck = this.playerDecks[this.currentPlayer()];
		if (!deck) return;
		// Istanze, non tag: nel mazzo doppio il tag è ambiguo (due copie identiche)
		// e il Round rimuoverebbe potenzialmente la copia sbagliata dalla mano.
		const cards = deck.selecteds();
		if (!cards.length) return;
		this.game.attachToMeld(meldIndex, cards);
		deck.selecteds.set([]);
		deck.autosortNow();
	}

	addMeld() {
		const deck = this.playerDecks[this.currentPlayer()];
		if (!deck) return;
		const cards = deck.selecteds();
		if (!cards.length) return;
		this.game.openMeld(cards);
		deck.selecteds.set([]);
		deck.autosortNow();
	}

	async willTakeFromDrawPile() {
		if (this.busy) return;
		if (!this.game.drawPile().length) return;
		const player = this.currentPlayer();

		this.busy = true;
		try {
			// Commit diretto: i signal del Round spostano la carta e il FLIP
			// dello scope anima da solo il volo tallone → mano.
			if (!this.game.drawFromStock()) return;

			await this.tweener.whenIdle();
			// Riordino solo ora, a pesca (animazione) conclusa.
			this.playerDecks[player]?.autosortNow();
		} finally {
			this.busy = false;
		}
	}

	async willTakeDiscardPile() {
		if (this.busy) return;
		if (!this.game.discardPile().length) return;
		const player = this.currentPlayer();

		this.busy = true;
		try {
			// Commit diretto: i signal del Round spostano l'intero monte in mano
			// e il FLIP dello scope anima da solo il volo scarti → mano.
			if (!this.game.takeDiscardPile()) return;

			await this.tweener.whenIdle();
			// Riordino solo ora, a raccolta (animazione) conclusa.
			this.playerDecks[player]?.autosortNow();
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
		this.maybeRunAiTurn();
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

	/** Riordina tutte le mani per seme→rank (da chiamare a animazioni concluse). */
	private sortHands() {
		for (const p of [PlayerSide.North, PlayerSide.East, PlayerSide.South, PlayerSide.West]) {
			this.playerDecks[p]?.autosortNow();
		}
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

	undoTurn() {}

	async discard() {
		if (this.busy) return;
		const player = this.currentPlayer();
		const deck = this.playerDecks[player];
		if (!deck) return;
		const [card] = deck.selecteds();
		if (!card) return;

		this.busy = true;
		try {
			// L'istanza, non il tag: col tag il Round potrebbe rimuovere dalla mano
			// l'ALTRA copia identica della stessa carta (mazzo doppio).
			// Commit diretto: il Round scopre la carta e la sposta negli scarti,
			// il FLIP dello scope anima da solo il volo mano → scarti.
			if (!this.game.discard(card)) return;
			deck.selecteds.update((s) => s.filter((c) => c.uid !== card.uid));

			await this.tweener.whenIdle();
			// Riordino della mano di chi ha giocato (copre l'eventuale presa del pozzetto).
			deck.autosortNow();
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
		if (!player || !this.seats[player]) return;
		if (this.roundPhase() !== RoundPhase.InProgress) return;
		if (this.turnStep() !== RoundTurnStep.DrawOrCollect) return;
		this.aiScheduled = true;
		setTimeout(() => {
			this.aiScheduled = false;
			void this.runAiTurn();
		}, this.AI_TURN_DELAY);
	}

	/** Esegue l'intero turno del bot corrente: pesca → giochi → scarto. */
	private async runAiTurn(): Promise<void> {
		if (this.busy) return;
		const player = this.currentPlayer();
		if (!player) return;
		const ai = this.seats[player];
		if (!ai) return;
		if (this.roundPhase() !== RoundPhase.InProgress) return;
		if (this.turnStep() !== RoundTurnStep.DrawOrCollect) return;

		this.busy = true;
		try {
			// PESCA
			const draw = ai.decideDraw(this.buildView(player));
			this.logAi(player, draw.reason);
			const wantsPile = draw.value === 'discard' && this.game.discardPile().length > 0;
			let drew = wantsPile ? this.game.takeDiscardPile() : this.game.drawFromStock();
			if (!drew) {
				// Fallback sull'altra fonte se la preferita non è disponibile.
				drew = this.game.discardPile().length
					? this.game.takeDiscardPile()
					: this.game.drawFromStock();
			}
			if (!drew) {
				// Tallone e monte vuoti: turno impossibile. Sospende il bot senza
				// rischedulare (niente busy-loop). Fine tallone da gestire a parte.
				this.logAi(
					player,
					'Nessuna pesca possibile: turno bot sospeso (tallone esaurito).',
				);
				return;
			}
			await this.tweener.whenIdle();
			this.playerDecks[player]?.autosortNow();
			await sleep(this.AI_ACTION_DELAY);
			if (this.playback()) return; // player aperto a metà turno: interrompi

			// GIOCHI (calate + appoggi)
			const plays = ai.decidePlays(this.buildView(player));
			this.logAi(player, plays.reason);
			for (const play of plays.value) {
				if (this.roundPhase() !== RoundPhase.InProgress) break;
				if (this.turnStep() !== RoundTurnStep.PlayAndDiscard) break;
				const ok =
					play.kind === 'open'
						? this.game.openMeld(play.cards)
						: this.game.attachToMeld(play.meldIndex, play.cards);
				if (!ok) continue;
				await this.tweener.whenIdle();
				this.playerDecks[player]?.autosortNow();
				await sleep(this.AI_ACTION_DELAY);
			}

			if (this.playback()) return; // player aperto a metà turno: interrompi
			// SCARTO (se la mano non è già chiusa dalle giocate)
			if (
				this.roundPhase() === RoundPhase.InProgress &&
				this.turnStep() === RoundTurnStep.PlayAndDiscard
			) {
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
		const melds = this.game.melds();
		const total = this.game.totalScore();
		const potFlags = this.game.playerHasTakenPot();
		const discardPile = this.game.discardPile();
		return {
			me: player,
			team,
			partner,
			opponents: this.opponentsOf(player),
			hand: this.game.hands()[player],
			discardPile,
			discardTop: discardPile.at(-1) ?? null,
			drawPileCount: this.game.drawPile().length,
			myMelds: melds[team],
			theirMelds: melds[otherTeam],
			potTakenByTeam: potFlags[player] || potFlags[partner],
			teamHasBurraco: this.game.teamHasBurraco()[team],
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
			const ai = this.seats[seat];
			if (!ai) continue;
			const view = this.buildView(seat);
			ai.observe(event, view);
			const line = ai.comment(event, view);
			if (line) this.say(seat, line);
		}
	}

	private broadcastSystem(kind: TableEvent['kind']): void {
		for (const seat of ALL_SEATS) {
			const ai = this.seats[seat];
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
		for (const seat of ALL_SEATS) {
			const ai = this.seats[seat];
			if (!ai) continue;
			ai.loadLongTermMemory(this.storage.get<AiLongTermMemory>('ai_ltm_' + seat) ?? null);
		}
	}

	private saveAiMemories(): void {
		for (const seat of ALL_SEATS) {
			const ai = this.seats[seat];
			if (!ai) continue;
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
		return this.seats[player]?.memorySnapshot() ?? null;
	}

	/** Nome dell'IA di un posto (o "umano"). */
	aiNameOf(player: PlayerSide): string {
		return this.seats[player]?.name ?? 'umano';
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
