import {
	Component,
	computed,
	DestroyRef,
	inject,
	input,
	linkedSignal,
	signal,
} from '@angular/core';
import { Tweener } from '../tweener/tweener';

import { CommonModule } from '@angular/common';
import { DeckItem, sortBySuitThenRank } from '../../services/cards';
import { Card } from '../card/card';

const CARD_SIZE = { W: 32, H: 40 };

@Component({
	selector: 'ui-deck',
	imports: [CommonModule, Card],
	templateUrl: './deck.html',
	styleUrls: ['./deck.scss'],
	host: {
		'[style.--box-h.px]': 'CARD_SIZE.H',
		'[style.--box-w.px]': 'CARD_SIZE.W',
		'[style.--max-box-h.px]': 'gap() + CARD_SIZE.H',
		'[style.--max-box-w.px]': 'gap() + CARD_SIZE.W',
		'[style.--rotate.deg]': 'rotate()',
	},
})
export class Deck {
	CARD_SIZE = CARD_SIZE;

	layout = input<'stack' | 'horizontal' | 'vertical'>('horizontal');

	animate = input<boolean>(true);
	selectable = input<boolean>(false);
	faceDown = input<boolean>(null);
	rotate = input<number>(null);
	/** Spaziatura tra le carte nel layout grid (unità Tailwind spacing, es. 2 = 0.5rem). */
	gap = input<number>(null);
	/** Se true, ordina automaticamente le carte per seme poi per rank. */
	autosort = input<boolean>(false);

	/** Se true, l'utente può riordinare le carte con drag & drop (pointer). */
	reorderable = input<boolean>(false);

	cards = input<DeckItem[]>();

	/**
	 * Ordine manuale scelto dall'utente col drag & drop (lista di uid).
	 * Ha priorità sull'autosort. Le carte non presenti (es. appena pescate)
	 * finiscono in coda ordinate per seme/rank. Se nessuna carta corrente
	 * è nell'ordine (nuova mano) l'ordine manuale viene ignorato.
	 */
	manualOrder = signal<number[] | null>(null);

	/** uid della carta attualmente trascinata (null se nessun drag in corso). */
	draggingUid = signal<number | null>(null);

	list = linkedSignal<DeckItem[]>(() => {
		const items = this.cards() ?? [];

		const order = this.manualOrder();
		if (order?.length) {
			const pos = new Map(order.map((uid, i) => [uid, i]));
			if (items.some((c) => pos.has(c.uid))) {
				return [...items].sort((a, b) => {
					const pa = pos.has(a.uid) ? pos.get(a.uid)! : Number.MAX_SAFE_INTEGER;
					const pb = pos.has(b.uid) ? pos.get(b.uid)! : Number.MAX_SAFE_INTEGER;
					return pa !== pb ? pa - pb : sortBySuitThenRank(a, b);
				});
			}
		}

		if (!this.autosort()) return [...items];
		return [...items].sort(sortBySuitThenRank);
	});

	selecteds = signal<DeckItem[]>([]);
	selectedSet = computed(() => {
		return new Set(this.selecteds().map((c) => c.uid));
	});

	/**
	 * Faccia RESA della carta: l'input `faceDown` del deck è un override di
	 * prospettiva (es. la mia mano scoperta, quelle avversarie coperte, debug
	 * tutto scoperto); se assente vale lo stato fisico dell'istanza, scritto
	 * solo dal dominio (Round). La UI non muta mai `item.faceDown`.
	 */
	renderFaceDown(item: DeckItem): boolean {
		return this.faceDown() ?? item.faceDown;
	}

	/**
	 * Riordina la mano per seme → rank e memorizza l'ordine (via `manualOrder`,
	 * così sopravvive ai ricalcoli). Il Tweener anima lo spostamento.
	 * Va chiamato dalla Board a animazioni concluse.
	 */
	autosortNow() {
		const sorted = [...this.list()].sort(sortBySuitThenRank);
		this.manualOrder.set(sorted.map((c) => c.uid));
	}

	toggleItem(uid: number) {
		// Un click che conclude un drag non deve selezionare la carta.
		if (this.suppressClick) {
			this.suppressClick = false;
			return;
		}
		if (!this.selectable()) return;

		const selecteds = this.selecteds().slice();
		const index = selecteds.findIndex((card) => card.uid == uid);
		if (index >= 0) {
			selecteds.splice(index, 1);
		} else {
			const card = this.getItemByUid(uid);
			selecteds.push(card);
		}

		this.selecteds.set(selecteds);
	}

	// ── Riordino via drag & drop (pointer) ────────────────────────────────────
	// Modello "hop": trascinando, la carta salta allo slot sotto il puntatore
	// riordinando `list`. Il Tweener FLIP anima lo spostamento di tutte le carte.

	/** Scope FLIP più vicino (se presente): i tween vanno sospesi durante il drag,
	 *  altrimenti ogni pointermove innescherebbe un FLIP su tutta la mano. */
	private readonly tweenScope = inject(Tweener, { optional: true });

	constructor() {
		// Deck distrutto a drag in corso (reset, cambio mano): rilascia la
		// sospensione dei tween e i listener globali del drag.
		inject(DestroyRef).onDestroy(() => {
			if (this.drag?.moved) this.tweenScope?.release();
			window.removeEventListener('pointermove', this.onDragMove);
			window.removeEventListener('pointerup', this.onDragEnd);
			window.removeEventListener('pointercancel', this.onDragEnd);
		});
	}

	private static readonly DRAG_THRESHOLD = 6;
	private drag: {
		uid: number;
		pointerId: number;
		pivot: HTMLElement;
		container: HTMLElement;
		startX: number;
		startY: number;
		moved: boolean;
	} | null = null;
	private suppressClick = false;

	onCardPointerDown(ev: PointerEvent, uid: number, pivot: HTMLElement) {
		if (!this.reorderable()) return;
		if (ev.pointerType === 'mouse' && ev.button !== 0) return;
		this.drag = {
			uid,
			pointerId: ev.pointerId,
			pivot,
			container: pivot.parentElement as HTMLElement,
			startX: ev.clientX,
			startY: ev.clientY,
			moved: false,
		};
		window.addEventListener('pointermove', this.onDragMove);
		window.addEventListener('pointerup', this.onDragEnd);
		window.addEventListener('pointercancel', this.onDragEnd);
	}

	private onDragMove = (ev: PointerEvent) => {
		const d = this.drag;
		if (!d || ev.pointerId !== d.pointerId) return;

		if (!d.moved) {
			const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
			if (dist < Deck.DRAG_THRESHOLD) return;
			d.moved = true;
			this.suppressClick = true;
			d.pivot.setPointerCapture?.(d.pointerId);
			this.draggingUid.set(d.uid);
			// Tween sospesi per tutta la durata del drag: la carta "salta" di
			// slot in slot in tempo reale, senza FLIP a ogni pointermove.
			this.tweenScope?.hold();
		}

		this.moveTo(d.uid, this.computeDropIndex(ev, d));
	};

	private onDragEnd = (ev: PointerEvent) => {
		const d = this.drag;
		if (!d) return;
		window.removeEventListener('pointermove', this.onDragMove);
		window.removeEventListener('pointerup', this.onDragEnd);
		window.removeEventListener('pointercancel', this.onDragEnd);
		this.drag = null;
		if (!d.moved) return;

		// Consolida l'ordine scelto così sopravvive ai ricalcoli di `list`.
		this.manualOrder.set(this.list().map((c) => c.uid));
		this.draggingUid.set(null);
		this.tweenScope?.release();
		setTimeout(() => (this.suppressClick = false), 0);
	};

	/** Indice di inserimento in base alla posizione del puntatore fra le altre carte. */
	private computeDropIndex(ev: PointerEvent, d: NonNullable<Deck['drag']>): number {
		const vertical = this.layout() === 'vertical';
		const pointer = vertical ? ev.clientY : ev.clientX;
		let index = 0;
		for (const p of Array.from(d.container.children) as HTMLElement[]) {
			if (p === d.pivot) continue;
			const r = p.getBoundingClientRect();
			const center = vertical ? r.top + r.height / 2 : r.left + r.width / 2;
			if (pointer > center) index++;
		}
		return index;
	}

	/** Sposta la carta `uid` alla posizione `targetIndex` nella lista visibile. */
	private moveTo(uid: number, targetIndex: number) {
		this.list.update((items) => {
			const from = items.findIndex((c) => c.uid === uid);
			if (from < 0) return items;
			const arr = items.slice();
			const [it] = arr.splice(from, 1);
			arr.splice(Math.max(0, Math.min(targetIndex, arr.length)), 0, it);
			return arr;
		});
	}

	// ── Staging animazioni (SOLO per la distribuzione) ────────────────────────
	// Unica eccezione al principio "Round è l'unico scrittore": Board.deal()
	// muove qui le carte in anticipo per la coreografia carta-per-carta, con le
	// STESSE istanze che commitHand() scriverà poi nei signal del Round — il
	// linkedSignal ricalcola identico e non c'è salto visivo. Nessun altro
	// flusso deve usare questi metodi: le azioni committano direttamente.

	removeItems(toRemove: DeckItem[]) {
		if (!toRemove) return;
		this.list.update((items) =>
			items.filter((item) => !toRemove.some((toRemoveItem) => toRemoveItem.uid == item.uid)),
		);
		this.selecteds.update((items) =>
			items.filter((item) => !toRemove.some((toRemoveItem) => toRemoveItem.uid == item.uid)),
		);
	}

	put(toPut: DeckItem[]) {
		if (!toPut) return;
		this.list.update((cards) => cards.concat(toPut));
	}

	getItemByUid(uid: number) {
		return this.list().find((item) => item.uid == uid);
	}

	offsetCurve(index: number) {
		const k = 0.1;
		return 10 * (1 - Math.exp(-k * index));
	}
}
