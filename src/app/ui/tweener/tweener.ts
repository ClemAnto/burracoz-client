import {
	AfterViewInit, Component, DestroyRef, effect,
	ElementRef, inject, input, NgZone, output, signal,
} from '@angular/core';

const { round } = Math;

// ─── Tipi interni ────────────────────────────────────────────────────────────

interface TweenEntry {
	/** Posizione sorgente 'x,y' letta al momento della rimozione. */
	from: string | null;
	/** JSON dei dati di stile aggiuntivi (tween-data). */
	data: string | null;
	/** Elemento di destinazione aggiunto al nuovo deck. */
	target: HTMLElement | null;
	/** Safety timeout: pulisce l'entry se il target non arriva mai. */
	timeoutId: ReturnType<typeof setTimeout> | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

@Component({
	selector: 'ui-tweener',
	imports: [],
	templateUrl: './tweener.html',
	styleUrl: './tweener.scss',
})
export class Tweener implements AfterViewInit {

	// Injection tramite inject() — nessun costruttore necessario
	private readonly el    = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly zone  = inject(NgZone);
	private readonly destroyRef = inject(DestroyRef);

	// ── Input / Output (stesso contratto del vecchio componente) ─────────────
	disabled      = input<boolean>(false);
	pendings      = signal(0);
	tweenComplete = output<any>();

	// ── Stato privato ────────────────────────────────────────────────────────
	private host!: HTMLElement;
	private mutations!: MutationObserver;
	private resizeObserver!: ResizeObserver;

	/** Map<tweenId, TweenEntry> — rimpiazza il plain-object hash. */
	private readonly pending = new Map<string, TweenEntry>();


	// ── Lifecycle ────────────────────────────────────────────────────────────

	constructor() {
		// Quando le animazioni vengono riabilitate, aggiorna le posizioni
		// memorizzate così il prossimo deal parte da coordinate corrette.
		effect(() => {
			if (!this.disabled()) {
				this.zone.runOutsideAngular(() =>
					requestAnimationFrame(() => this.silentRefresh()),
				);
			}
		});
	}

	ngAfterViewInit(): void {
		// Il tweener è il figlio diretto dell'host — le carte vivono nel parent.
		this.host = this.el.nativeElement.parentElement as HTMLElement;
		this.zone.runOutsideAngular(() => this.setup());
		this.destroyRef.onDestroy(() => this.teardown());
	}

	// ── API pubblica ─────────────────────────────────────────────────────────

	/** Annulla lo stato interno senza toccare il DOM. */
	reset(): void {
		for (const entry of this.pending.values()) {
			if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
		}
		this.pending.clear();
		this.pendings.set(0);
	}

	/** Aggiorna le posizioni memorizzate senza avviare animazioni. */
	silentRefresh(): void {
		const els = Array.from(
			this.host?.querySelectorAll<HTMLElement>('[tween-id]:not(.tweening)') ?? [],
		);
		// Batch reads (1 reflow) poi batch writes
		const rects = els.map(el => el.getBoundingClientRect());
		els.forEach((el, i) => el.setAttribute('pos', `${round(rects[i].x)},${round(rects[i].y)}`));
	}

	// ── Setup / Teardown ─────────────────────────────────────────────────────

	private setup(): void {
		this.silentRefresh();

		this.mutations = new MutationObserver(mutations => {
			if (this.disabled()) {
				// Mantieni le posizioni aggiornate anche a disabled=true
				// così la prima animazione dopo il re-enable non parte da coords stantie.
				this.silentRefresh();
				return;
			}
			this.processMutations(mutations);
			this.animatePositions();
		});
		this.mutations.observe(this.host, { childList: true, subtree: true });

		// Resize: shift uniforme del layout → aggiorna pos per tutti
		this.resizeObserver = new ResizeObserver(() => this.silentRefresh());
		this.resizeObserver.observe(this.host);
	}

	private teardown(): void {
		this.mutations?.disconnect();
		this.resizeObserver?.disconnect();
	}

	// ── Elaborazione mutazioni ───────────────────────────────────────────────

	private processMutations(mutations: MutationRecord[]): void {
		for (const { removedNodes, addedNodes } of mutations) {
			for (const node of removedNodes) {
				if (!(node instanceof HTMLElement)) continue;
				for (const el of tweenables(node)) {
					const id = el.getAttribute('tween-id')!;
					const entry = this.pending.get(id) ?? emptyEntry();
					entry.from = el.getAttribute('pos');
					entry.data = el.getAttribute('tween-data');
					this.pending.set(id, entry);
				}
			}
			for (const node of addedNodes) {
				if (!(node instanceof HTMLElement)) continue;
				for (const el of tweenables(node)) {
					const id = el.getAttribute('tween-id')!;
					const entry = this.pending.get(id) ?? emptyEntry();
					entry.target = el;
					this.pending.set(id, entry);
				}
			}
		}

		// Per ogni entry completa (from + target): prime il target con la pos
		// sorgente e arma il safety timeout.
		// Questo avviene in sync — prima che il browser faccia layout al nuovo posto —
		// così animatePositions (chiamata subito dopo) troverà il delta corretto.
		for (const [id, entry] of this.pending) {
			if (!entry.from || !entry.target) continue;
			if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
			entry.target.setAttribute('pos', entry.from);
			if (entry.data) entry.target.setAttribute('tween-data-prev', entry.data);
			entry.timeoutId = setTimeout(() => this.pending.delete(id), 2000);
		}
	}

	// ── Animazione FLIP ──────────────────────────────────────────────────────

	private animatePositions(): void {
		// ── Fase READ: raccoglie tutti gli elementi da animare (letture in batch) ──
		interface TweenWork {
			el: HTMLElement;
			id: string;
			dx: number;
			dy: number;
			tweenData: Record<string, string>;
			scatter: number;
		}
		const work: TweenWork[] = [];
		let scatter = 0;

		this.host.querySelectorAll<HTMLElement>('[tween-id]:not(.tweening)')
			.forEach(el => {
				const { x, y } = el.getBoundingClientRect();
				const stored   = el.getAttribute('pos');

				// Aggiorna sempre pos con la posizione attuale
				el.setAttribute('pos', `${round(x)},${round(y)}`);

				if (!stored) return;
				if (!stored) return;
				const dx = +stored.split(',')[0] - x;
				const dy = +stored.split(',')[1] - y;
				if (!round(dx) && !round(dy)) return;

				work.push({
					el,
					id:       el.getAttribute('tween-id')!,
					dx, dy,
					tweenData: JSON.parse(el.getAttribute('tween-data-prev') ?? '{}'),
					scatter:  scatter++,
				});
			});

		if (!work.length) return;

		// ── Fase WRITE-1: snap alla posizione sorgente senza transizioni (scritture in batch) ──
		for (const { el, dx, dy, tweenData, id } of work) {
			el.classList.add('no-transitions', 'tweening');
			el.style.translate = `${dx}px ${dy}px`;
			for (const key in tweenData) el.style.setProperty(key, tweenData[key]);
			this.pending.delete(id);
		}

		// ── Forced reflow: un singolo getBoundingClientRect "committa" lo stato
		//    intermedio prima che le transizioni partano. Sostituisce il RAF
		//    (nessun frame di ritardo, nessun flash alla posizione finale). ──
		work[0].el.getBoundingClientRect();

		// ── Fase WRITE-2: avvia le transizioni (scritture in batch) ──
		for (const { el, id, tweenData, scatter: idx } of work) {
			el.classList.remove('no-transitions');
			el.style.translate = '';
			el.style.setProperty('--tween-scatter-delay', String(idx * 10));
			for (const key in tweenData) el.style.removeProperty(key);

			this.pendings.update(v => v + 1);

			// Il fallback garantisce che pendings torni a 0 anche se
			// la transizione non parte (translate già 0, property non inclusa, ecc.)
			onTransitionsDone(el, () => {
				el.classList.remove('tweening');
				// silentRefresh aggiorna pos di TUTTI gli elementi stabili (incluso questo
				// e i vicini che si sono spostati per il reflow) in un unico batch sincrono,
				// prima che il microtask del MutationObserver scatti → animatePositions
				// troverà dx=0 per tutti e non partirà nessuna animazione fantasma.
				this.silentRefresh();
				el.removeAttribute('tween-data-prev');
				this.zone.run(() => {
					this.pendings.update(v => Math.max(0, v - 1));
					this.tweenComplete.emit({ id, target: el, pendings: this.pendings() });
				});
			});
		}
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyEntry(): TweenEntry {
	return { from: null, data: null, target: null, timeoutId: null };
}

/** Restituisce l'elemento stesso + tutti i suoi discendenti con tween-id. */
function tweenables(root: HTMLElement): HTMLElement[] {
	const self = root.hasAttribute('tween-id') ? [root] : [];
	return (self as HTMLElement[]).concat(
		Array.from(root.querySelectorAll<HTMLElement>('[tween-id]')),
	);
}

/**
 * Chiama `callback` una volta sola quando tutte le transizioni CSS sull'elemento
 * sono terminate (transitionend) o cancellate (transitioncancel).
 *
 * `fallbackMs` è un timeout di sicurezza per i casi in cui nessuna transizione
 * parte (translate già a 0, transition-property non include translate, ecc.).
 */
function onTransitionsDone(
	el: HTMLElement,
	callback: () => void,
	fallbackMs = 1500,
): void {
	let pending  = 0;
	let started  = false;
	let fallback = setTimeout(fire, fallbackMs);

	function fire(): void {
		clearTimeout(fallback);
		el.removeEventListener('transitionstart',  onStart);
		el.removeEventListener('transitionend',    onFinish);
		el.removeEventListener('transitioncancel', onFinish);
		callback();
	}

	function onStart(e: TransitionEvent): void {
		if (e.target !== el) return;
		clearTimeout(fallback);   // la transizione è partita, il fallback non serve più
		started = true;
		pending++;
	}

	function onFinish(e: TransitionEvent): void {
		if (e.target !== el) return;
		if (pending > 0) pending--;
		if (started && pending === 0) fire();
	}

	el.addEventListener('transitionstart',  onStart);
	el.addEventListener('transitionend',    onFinish);
	el.addEventListener('transitioncancel', onFinish);
}
