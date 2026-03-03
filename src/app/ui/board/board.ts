import { NgClass, UpperCasePipe } from '@angular/common';
import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { Game } from '../../services/game';
import { Deck } from '../deck/deck';
import { Tweener } from '../tweener/tweener';

@Component({
	selector: 'ui-board',
	imports: [NzButtonModule, Deck, Tweener, UpperCasePipe, NgClass],
	templateUrl: './board.html',
	host: {
		class: 'flex flex-col flex-1 min-h-0 w-full relative overflow-hidden',
	},
})
export class Board {
	@ViewChild('drawPile')    drawPileRef:    Deck;
	@ViewChild('discardPile') discardPileRef: Deck;
	@ViewChild('northDeck')   northDeck:      Deck;
	@ViewChild('southDeck')   southDeck:      Deck;
	@ViewChild('eastDeck')    eastDeck:       Deck;
	@ViewChild('westDeck')    westDeck:       Deck;

	private game = inject(Game);

	// Modalità debug: tutte le mani scoperte (true = carte visibili per tutti)
	debug = signal(true);

	// ----------------------------------------------------------
	// Dati di gioco dai signal del Game service
	// ----------------------------------------------------------

	readonly drawPileCards    = computed(() => this.game.drawPile());
	readonly discardPileCards = computed(() => this.game.discardPile());
	readonly ourMeldsData     = computed(() => this.game.melds().ours);
	readonly theirMeldsData   = computed(() => this.game.melds().opponents);

	// Mano fissa per ogni giocatore (ognuno resta nel suo lato)
	readonly northCards  = computed(() => this.game.hands().north ?? []);
	readonly eastCards = computed(() => this.game.hands().east ?? []);
	readonly westCards = computed(() => this.game.hands().west ?? []);
	readonly southCards = computed(() => this.game.hands().south ?? []);

	// ----------------------------------------------------------
	// Stato della partita
	// ----------------------------------------------------------

	readonly roundPhase   = computed(() => this.game.roundPhase());
	readonly currentPlayer = computed(() => this.game.currentPlayer());
	readonly currentTeam   = computed(() => this.game.currentTeam());
	readonly turnStep     = computed(() => this.game.turnStep());
	readonly lastError    = computed(() => this.game.lastError());
	readonly isHandClosed = computed(() => this.game.roundPhase() === 'closed');
	readonly handScore    = computed(() => this.game.handScore());
	readonly totalScore   = computed(() => this.game.totalScore());
	readonly winnerPlayer = computed(() => this.game.winnerPlayer());

	readonly playerLabel = computed(() => {
		const labels: Record<string, string> = { north: 'NORD', south: 'SUD', east: 'EST', west: 'OVEST' };
		return labels[this.game.currentPlayer()] ?? '';
	});

	readonly canDraw = computed(() =>
		this.game.roundPhase() === 'in_progress' && this.game.turnStep() === 'draw_or_collect',
	);

	readonly canPlay = computed(() =>
		this.game.roundPhase() === 'in_progress' && this.game.turnStep() === 'play_and_discard',
	);

	/** True se ci sono giocate nel turno corrente annullabili con INDIETRO */
	readonly canUndo = computed(() => this.game.canUndoTurn());

	/** Zona NOI attiva: si può calare/legare su questa zona */
	readonly ourZoneActive   = computed(() => this.currentTeam() === 'ours'      && this.canPlay());
	/** Zona LORO attiva: si può calare/legare su questa zona */
	readonly theirZoneActive = computed(() => this.currentTeam() === 'opponents' && this.canPlay());

	readonly animate = signal<boolean>(true);

	// ----------------------------------------------------------
	// Azioni di partita
	// ----------------------------------------------------------

	startGame() { this.game.startGame(); }
	nextHand()  { this.game.startNextHand(); }

	resetGame() {
		[this.northDeck, this.southDeck, this.eastDeck, this.westDeck]
			.filter(Boolean)
			.forEach(deck => deck.selecteds.set([]));
		this.game.startGame();
	}

	// ----------------------------------------------------------
	// Azioni del turno
	// ----------------------------------------------------------

	willTakeFromDrawPile() {
		const player = this.game.currentPlayer();
		console.log(`[Board] Pesca dal tallone — ${player}`);
		if (this.game.drawFromTallone()) {
			console.log(`[Board] Pesca OK`);
		} else {
			console.warn(`[Board] Pesca FALLITA: ${this.game.lastError()}`);
		}
	}

	willTakeDiscardPile() {
		const player = this.game.currentPlayer();
		console.log(`[Board] Raccoglie gli scarti — ${player}`);
		if (this.game.takeDiscardPile()) {
			console.log(`[Board] Raccolta OK`);
		} else {
			console.warn(`[Board] Raccolta FALLITA: ${this.game.lastError()}`);
		}
	}

	/** Cala un nuovo gioco con le carte selezionate dal deck del giocatore corrente */
	addMeld() {
		const deck = this.getActiveDeck();
		if (!deck) return;
		const cards = deck.selecteds().map(i => i.tag);
		const player = this.game.currentPlayer();
		console.log(`[Board] Nuova calata — ${player} → [${cards.join(', ')}]`);
		if (this.game.openMeld(cards)) {
			console.log(`[Board] Calata OK`);
			deck.selecteds.set([]);
		} else {
			console.warn(`[Board] Calata FALLITA: ${this.game.lastError()}`);
		}
	}

	/** Aggiunge le carte selezionate a un gioco già calato dalla squadra corrente */
	attachToMeld(meldIndex: number) {
		const deck = this.getActiveDeck();
		if (!deck) return;
		const cards = deck.selecteds().map(i => i.tag);
		const player = this.game.currentPlayer();
		console.log(`[Board] Legata al gioco #${meldIndex} — ${player} → [${cards.join(', ')}]`);
		if (this.game.attachToMeld(meldIndex, cards)) {
			console.log(`[Board] Legata OK`);
			deck.selecteds.set([]);
		} else {
			console.warn(`[Board] Legata FALLITA: ${this.game.lastError()}`);
		}
	}

	/** Annulla tutte le giocate del turno corrente, restituendo le carte in mano */
	undoTurn() {
		const player = this.game.currentPlayer();
		console.log(`[Board] Annulla turno — ${player}`);
		if (this.game.undoTurn()) {
			console.log(`[Board] Annulla OK`);
			this.getActiveDeck()?.selecteds.set([]);
		} else {
			console.warn(`[Board] Annulla FALLITO: ${this.game.lastError()}`);
		}
	}

	/** Scarta la singola carta selezionata, terminando il turno */
	discard() {
		const deck = this.getActiveDeck();
		if (!deck) return;
		const selected = deck.selecteds();
		const player = this.game.currentPlayer();
		if (selected.length !== 1) {
			console.warn(`[Board] Scarto FALLITO: selezionare esattamente 1 carta (selezionate: ${selected.length})`);
			return;
		}
		const card = selected[0].tag;
		console.log(`[Board] Scarto — ${player} → ${card}`);
		if (this.game.discard(card)) {
			console.log(`[Board] Scarto OK`);
			deck.selecteds.set([]);
		} else {
			console.warn(`[Board] Scarto FALLITO: ${this.game.lastError()}`);
		}
	}

	// Restituisce il Deck ViewChild del giocatore corrente
	private getActiveDeck(): Deck | null {
		switch (this.game.currentPlayer()) {
			case 'north': return this.northDeck;
			case 'east':  return this.eastDeck;
			case 'west':  return this.westDeck;
			case 'south': return this.southDeck;
			default:      return null;
		}
	}

	onTweenComplete() {}
}
