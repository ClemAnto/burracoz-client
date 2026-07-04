import {
	AfterViewInit,
	computed,
	DestroyRef,
	Directive,
	effect,
	ElementRef,
	inject,
	Injector,
	input,
	output,
	signal,
} from '@angular/core';

const { round, abs, max } = Math;

// ─── Tipi interni ────────────────────────────────────────────────────────────

interface TweenEntry {
	/** Posizione sorgente 'x,y' (viewport) letta alla rimozione o dal gemello vivo. */
	from: string | null;
	/** JSON dei dati di stile sorgente (tween-data) letti alla rimozione. */
	data: string | null;
	/** Elemento di destinazione aggiunto al nuovo deck. */
	target: HTMLElement | null;
	/** TTL: elimina l'entry se la controparte (from o target) non arriva mai. */
	timeoutId: ReturnType<typeof setTimeout> | null;
}

interface ActiveTween {
	anim: Animation;
	/** Chiavi di stile animate oltre a translate (per il carry al retarget). */
	props: string[];
	/** Layout dello slot alla partenza, in base offsetParent (trasform-indipendente):
	 *  cambia ⇔ lo slot si è spostato sotto il volo. */
	layout: { x: number; y: number } | null;
	/** Delay/durata effettivi del volo, per calcolare residuo e tempo
	 *  rimanente in caso di retarget. */
	delay: number;
	duration: number;
}

interface TweenWork {
	el: HTMLElement;
	id: string;
	dx: number;
	dy: number;
	/** Valori di stile della sorgente (tween-data-prev o carry dal volo interrotto). */
	prevData: Record<string, string>;
	delay: number;
	duration: number;
	easing: string;
	layout: { x: number; y: number } | null;
	/** false = retarget di un volo già contato in pendings. */
	fresh: boolean;
}

// ─── Directive ───────────────────────────────────────────────────────────────

/**
 * FLIP animato via Web Animations API, pilotato da MutationObserver.
 * Si applica a un contenitore qualunque e osserva il suo sottoalbero:
 * ogni elemento con `tween-id` che cambia posizione (stesso parent o meno)
 * viene animato dal punto A al punto B.
 *
 * Contratto con i consumer:
 * - `tween-id`        identità visiva dell'elemento (unica nello scope:
 *                     un id = un oggetto, mai due istanze visibili insieme)
 * - `tween-data`      JSON { proprietà → valore sorgente } con proprietà CSS reali
 *                     o custom property REGISTRATE via @property (le non registrate
 *                     non sono interpolabili nei keyframe)
 * - `--tween-delay`   ritardo extra in ms (inline style var, opzionale)
 * - `translate` è riservato allo scope: i consumer non devono toccarlo
 * - `.tweening` viene applicata durante il volo: è l'hook di stile del consumer
 *   (z-index, disattivazione di transition proprie, ecc.)
 */
@Directive({
	selector: '[uiTweenScope]',
	exportAs: 'uiTweenScope',
})
export class Tweener implements AfterViewInit {
	private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
	private readonly destroyRef = inject(DestroyRef);
	private readonly injector = inject(Injector);

	// ── Input / Output ───────────────────────────────────────────────────────
	disabled = input<boolean>(false);
	/** Durata del singolo tween (ms). */
	duration = input<number>(350);
	/** Timing function dei tween appena creati. */
	easing = input<string>('ease');
	/** Ritardo incrementale tra gli elementi di uno stesso batch (ms). */
	stagger = input<number>(10);
	/** TTL delle coppie sorgente/destinazione rimaste orfane (ms). */
	pairingTtl = input<number>(2000);
	/**
	 * Spostamento minimo (px) dello slot sotto un volo perché scatti il retarget.
	 * Sotto soglia il volo prosegue indisturbato: il micro-salto laterale è
	 * impercettibile, mentre cancellare e ricreare decine di animazioni a ogni
	 * batch (deal di massa) costa main thread e si sente in FPS. I riordini veri
	 * spostano gli slot di decine di px e retargettano comunque.
	 */
	retargetThreshold = input<number>(16);
	/** Log diagnostici in console ([tween]) + audit di univocità a fine animazioni. */
	debug = input<boolean>(false);

	pendings = signal(0);
	tweenComplete = output<any>();

	// ── Stato privato ────────────────────────────────────────────────────────
	private host!: HTMLElement;
	private mutations!: MutationObserver;
	private resizeObserver!: ResizeObserver;

	/** Map<tweenId, TweenEntry> — accoppia nodo rimosso (o gemello) e nodo aggiunto. */
	private readonly pending = new Map<string, TweenEntry>();

	/** Tween in volo: elemento → animazione e dati per il retarget. */
	private readonly active = new Map<HTMLElement, ActiveTween>();

	/** prefers-reduced-motion: il Tweener si comporta come disabled. */
	private readonly reducedMotion = signal(false);

	/** Sospensioni attive via hold()/release() (es. drag&drop in corso). */
	private readonly holds = signal(0);

	private readonly off = computed(
		() => this.disabled() || this.reducedMotion() || this.holds() > 0,
	);

	// ── Lifecycle ────────────────────────────────────────────────────────────

	constructor() {
		const mq =
			typeof matchMedia === 'function'
				? matchMedia('(prefers-reduced-motion: reduce)')
				: null;
		if (mq) {
			this.reducedMotion.set(mq.matches);
			const onChange = (e: MediaQueryListEvent) => this.reducedMotion.set(e.matches);
			mq.addEventListener('change', onChange);
			this.destroyRef.onDestroy(() => mq.removeEventListener('change', onChange));
		}

		// Quando le animazioni vengono riabilitate, aggiorna le posizioni
		// memorizzate così il prossimo deal parte da coordinate corrette.
		effect(() => {
			if (!this.off()) {
				requestAnimationFrame(() => this.silentRefresh());
			}
		});
	}

	ngAfterViewInit(): void {
		// Lo scope osserva il sottoalbero dell'elemento su cui è applicato.
		this.host = this.el.nativeElement;
		this.setup();
		this.destroyRef.onDestroy(() => this.teardown());
	}

	// ── API pubblica ─────────────────────────────────────────────────────────

	/** Annulla i tween in volo e lo stato interno, poi ritimbra le posizioni. */
	reset(): void {
		for (const el of [...this.active.keys()]) this.cancelTween(el);
		for (const entry of this.pending.values()) {
			if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
		}
		this.pending.clear();
		this.pendings.set(0);
		this.silentRefresh();
	}

	/**
	 * Risolve quando non ci sono più tween in corso.
	 * Attende prima un doppio rAF: i tween innescati dalle modifiche appena
	 * fatte (render → MutationObserver) risultano così già contati in pendings.
	 * Il setTimeout in gara copre le tab in background, dove rAF non scatta.
	 */
	whenIdle(): Promise<void> {
		return new Promise<void>((resolve) => {
			const onSettled = () => {
				if (this.pendings() === 0) return resolve();
				const ref = effect(
					() => {
						if (this.pendings() === 0) {
							ref.destroy();
							resolve();
						}
					},
					{ injector: this.injector },
				);
			};
			let settled = false;
			const settle = () => {
				if (!settled) {
					settled = true;
					onSettled();
				}
			};
			requestAnimationFrame(() => requestAnimationFrame(settle));
			setTimeout(settle, 100);
		});
	}

	/**
	 * Sospende i tween finché non viene chiamata `release()`: le mutazioni si
	 * applicano istantaneamente e le posizioni memorizzate restano aggiornate.
	 * Da usare per interazioni continue (es. drag&drop) dove un FLIP per ogni
	 * pointermove sarebbe solo rumore. Bilanciata a contatore: componibile.
	 */
	hold(): void {
		this.holds.update((v) => v + 1);
	}

	/** Riattiva i tween sospesi da `hold()` (al rientro ritara le posizioni). */
	release(): void {
		this.holds.update((v) => Math.max(0, v - 1));
	}

	/** Aggiorna le posizioni memorizzate senza avviare animazioni. */
	silentRefresh(): void {
		const els = Array.from(
			this.host?.querySelectorAll<HTMLElement>(
				'[tween-id]:not(.tweening):not([tween-consumed])',
			) ?? [],
		);
		// Batch reads (1 reflow) poi batch writes
		const rects = els.map((el) => el.getBoundingClientRect());
		els.forEach((el, i) => el.setAttribute('pos', `${round(rects[i].x)},${round(rects[i].y)}`));
	}

	// ── Setup / Teardown ─────────────────────────────────────────────────────

	private setup(): void {
		this.silentRefresh();

		this.mutations = new MutationObserver((mutations) => {
			if (this.off()) {
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
		for (const el of [...this.active.keys()]) this.cancelTween(el);
	}

	// ── Elaborazione mutazioni ───────────────────────────────────────────────

	private processMutations(mutations: MutationRecord[]): void {
		const removed: HTMLElement[] = [];
		const added: HTMLElement[] = [];
		for (const rec of mutations) {
			for (const node of rec.removedNodes) {
				if (node instanceof HTMLElement) removed.push(...tweenables(node));
			}
			for (const node of rec.addedNodes) {
				if (node instanceof HTMLElement) added.push(...tweenables(node));
			}
		}

		// Nodi SPOSTATI (rimossi ma ancora connessi, es. riordino @for): niente
		// pairing — restano vivi e l'eventuale volo viene retargetato dallo scan.
		const moved = new Set(removed.filter((el) => el.isConnected));

		// 1) Nodi rimossi per davvero: il tween non renderà mai più → cancel
		//    e registrazione della sorgente per il pairing.
		for (const el of removed) {
			if (el.isConnected) continue;
			this.cancelTween(el);
			// Sorgente già consumata dal pairing col gemello: non ri-primare.
			if (el.hasAttribute('tween-consumed')) continue;
			const id = el.getAttribute('tween-id')!;
			const entry = this.pending.get(id) ?? emptyEntry();
			entry.from = el.getAttribute('pos');
			entry.data = el.getAttribute('tween-data');
			this.pending.set(id, entry);
		}

		// Indice lazy degli elementi vivi per id (per il pairing col gemello).
		let liveById: Map<string, HTMLElement[]> | null = null;
		const live = (id: string): HTMLElement[] => {
			if (!liveById) {
				liveById = new Map();
				this.host.querySelectorAll<HTMLElement>('[tween-id]').forEach((el) => {
					const key = el.getAttribute('tween-id')!;
					const list = liveById!.get(key) ?? [];
					list.push(el);
					liveById!.set(key, list);
				});
			}
			return liveById.get(id) ?? [];
		};

		// 2) Nodi aggiunti: destinazione del pairing.
		for (const el of added) {
			if (!el.isConnected || moved.has(el)) continue;
			const id = el.getAttribute('tween-id')!;
			const entry = this.pending.get(id) ?? emptyEntry();
			if (!entry.from) {
				// Nessuna rimozione registrata: cerca un GEMELLO vivo con lo stesso id
				// (rimozione differita da animate.leave, stato duplicato transitorio…).
				// Un tween-id = un'identità visiva: la copia preesistente è la sorgente,
				// va misurata ADESSO, nascosta e marcata consumata — mai due istanze
				// visibili contemporaneamente.
				const twin = live(id).find(
					(other) =>
						other !== el && other.isConnected && !other.hasAttribute('tween-consumed'),
				);
				if (twin) {
					const r = twin.getBoundingClientRect(); // posizione VISIVA (anche a metà volo)
					entry.from = `${round(r.x)},${round(r.y)}`;
					entry.data = twin.getAttribute('tween-data');
					this.cancelTween(twin);
					twin.setAttribute('tween-consumed', '');
					twin.style.visibility = 'hidden';
					this.log(
						`gemello consumato per id=${id} (rimozione differita), volo da ${entry.from}`,
					);
					// Self-heal: se il gemello non era davvero in uscita (nessuna
					// rimozione entro il TTL), torna visibile invece di restare
					// nascosto per sempre. Se succede è un'anomalia dei DATI
					// (stesso tween-id su due oggetti vivi): va sempre segnalata.
					setTimeout(() => {
						if (twin.isConnected) {
							twin.removeAttribute('tween-consumed');
							twin.style.visibility = '';
							console.warn(
								`[tween] gemello id=${id} mai rimosso entro il TTL: ripristinato. ` +
									'Possibile duplicato di tween-id nei dati.',
								twin,
							);
						}
					}, this.pairingTtl());
				}
			}
			entry.target = el;
			this.pending.set(id, entry);
		}

		// 3) Entry complete (from + target): prime del target con la pos sorgente
		//    e consumo immediato — animatePositions gira subito dopo, in sync,
		//    prima che il browser dipinga il nuovo stato.
		//    Entry incomplete: TTL di sicurezza, la controparte potrebbe non arrivare mai.
		for (const [id, entry] of this.pending) {
			if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
			if (entry.from && entry.target) {
				entry.target.setAttribute('pos', entry.from);
				if (entry.data) entry.target.setAttribute('tween-data-prev', entry.data);
				this.pending.delete(id);
				this.log(`pair id=${id}: volerà da ${entry.from}`);
			} else {
				entry.timeoutId = setTimeout(() => this.pending.delete(id), this.pairingTtl());
			}
		}
	}

	// ── Animazione FLIP (WAAPI) ──────────────────────────────────────────────

	private animatePositions(): void {
		const els = Array.from(
			this.host.querySelectorAll<HTMLElement>('[tween-id]:not([tween-consumed])'),
		);
		const flying = els.filter((el) => this.active.has(el));
		const still = els.filter((el) => !this.active.has(el));

		const work: TweenWork[] = [];
		let scatter = 0;

		// ── Elementi fermi: FLIP classico da `pos` memorizzata (letture in batch,
		//    un solo reflow; le scritture di attributi non sporcano il layout) ──
		const stillRects = still.map((el) => el.getBoundingClientRect());
		still.forEach((el, i) => {
			const rect = stillRects[i];
			const stored = el.getAttribute('pos');
			el.setAttribute('pos', `${round(rect.x)},${round(rect.y)}`);
			if (!stored) return;
			const [sx, sy] = stored.split(',');
			const dx = +sx - rect.x;
			const dy = +sy - rect.y;
			if (!round(dx) && !round(dy)) {
				el.removeAttribute('tween-data-prev');
				return;
			}
			const prevRaw = el.getAttribute('tween-data-prev');
			// Accoppiato = arrivato da un altro contenitore (pairing). Solo questi
			// ricevono lo stagger: trattenere a scalare anche i RIORDINI in place
			// parcheggerebbe le carte sul vecchio slot sotto quelle già atterrate
			// ("carte sparite" nei sort di massa). Un riordino plana tutto insieme.
			const paired = prevRaw !== null;
			const prevData: Record<string, string> = JSON.parse(prevRaw ?? '{}');
			el.removeAttribute('tween-data-prev');
			const freeze = parseFloat(el.style.getPropertyValue('--tween-delay')) || 0;
			work.push({
				el,
				id: el.getAttribute('tween-id')!,
				dx,
				dy,
				prevData,
				delay: freeze + (paired ? scatter++ * this.stagger() : 0),
				duration: this.duration(),
				easing: this.easing(),
				layout: offsetBasis(el),
				fresh: true,
			});
		});

		// ── Voli in corso: INTOCCATI finché il loro slot non si sposta.
		//    Il layout si legge in base offsetParent (trasform-indipendente),
		//    quindi non serve cancellare l'animazione per misurare: niente
		//    riavvii di massa, ogni volo resta una singola planata fluida. ──
		interface Retarget {
			el: HTMLElement;
			a: ActiveTween;
			basis: { x: number; y: number };
			dx: number;
			dy: number;
			values: Record<string, string>;
			residualDelay: number;
			remaining: number;
			elapsed: number;
		}
		const retargets: Retarget[] = [];
		const threshold = this.retargetThreshold();
		for (const el of flying) {
			const a = this.active.get(el)!;
			const basis = offsetBasis(el);
			if (!a.layout || !basis) continue;
			const sx = a.layout.x - basis.x;
			const sy = a.layout.y - basis.y;
			// Sotto soglia il volo resta indisturbato (a.layout NON si aggiorna:
			// gli assestamenti si accumulano e prima o poi superano la soglia).
			if (abs(sx) <= threshold && abs(sy) <= threshold) continue;

			// Slot spostato sotto il volo: si riparte dalla posizione visiva
			// corrente verso il nuovo layout, conservando il delay residuo
			// (la coreografia a scatter non ricomincia) e il tempo rimanente
			// (il volo atterra nei tempi previsti, niente effetto elastico).
			const cs = getComputedStyle(el);
			const [tx, ty] = parseTranslate(cs.translate);
			const values: Record<string, string> = {};
			for (const key of a.props) values[key] = cs.getPropertyValue(key);
			const t = (a.anim.currentTime as number | null) ?? 0;
			const residualDelay = max(0, a.delay - t);
			const elapsed = max(0, t - a.delay);
			retargets.push({
				el,
				a,
				basis,
				dx: sx + tx,
				dy: sy + ty,
				values,
				residualDelay,
				remaining: max(a.duration - elapsed, 120),
				elapsed,
			});
		}
		for (const r of retargets) {
			r.a.anim.cancel();
			// `pos` segue il nuovo layout: se l'elemento venisse rimosso per
			// davvero a metà volo, il pairing partirebbe da qui.
			r.el.setAttribute('pos', `${round(r.basis.x)},${round(r.basis.y)}`);
			work.push({
				el: r.el,
				id: r.el.getAttribute('tween-id')!,
				dx: r.dx,
				dy: r.dy,
				prevData: r.values,
				delay: r.residualDelay,
				duration: r.remaining,
				// A volo già iniziato riparte alla velocità giusta (ease-out);
				// se era ancora in delay non si è mai mosso: easing pieno.
				easing: r.elapsed > 0 ? 'ease-out' : this.easing(),
				layout: r.basis,
				fresh: false,
			});
		}

		// ── PLAY: un'unica animazione per elemento, dal keyframe sorgente al layout.
		//    Il keyframe finale implicito segue il valore sottostante: se i binding
		//    cambiano a metà volo, il browser retargetta da solo. ──
		for (const w of work) {
			if (w.fresh) this.pendings.update((v) => v + 1);
			const from: Keyframe = { translate: `${w.dx}px ${w.dy}px` };
			const props: string[] = [];
			for (const key in w.prevData) {
				if (!w.prevData[key]) continue; // valori vuoti: nessun handoff
				from[key] = w.prevData[key];
				props.push(key);
			}
			const keyframes: Keyframe[] = [from, { translate: '0px 0px' }];
			const options: KeyframeAnimationOptions = {
				duration: w.duration,
				delay: w.delay,
				easing: w.easing,
				// backwards: durante il delay l'elemento resta allo stato sorgente
				fill: 'backwards',
			};
			w.el.classList.add('tweening');
			let anim: Animation;
			try {
				anim = w.el.animate(keyframes, options);
			} catch {
				// Keyframe non animabile: niente volo, ma stato sempre coerente
				// (mai pendings appesi o carte bloccate con classe .tweening).
				this.active.delete(w.el);
				w.el.classList.remove('tweening');
				this.pendings.update((v) => Math.max(0, v - 1));
				continue;
			}
			this.active.set(w.el, {
				anim,
				props,
				layout: w.layout,
				delay: w.delay,
				duration: w.duration,
			});
			// cancel (retarget/reset/rimozione) rigetta `finished`: bookkeeping altrove.
			anim.finished.then(() => this.finishTween(w.el, anim)).catch(() => {});
		}

		if (work.length) {
			const fresh = work.filter((w) => w.fresh).length;
			this.log(
				`batch: ${still.length} fermi, ${flying.length} in volo → ` +
					`${fresh} nuovi tween, ${retargets.length} retarget (pendings=${this.pendings()})`,
			);
		}
	}

	// ── Bookkeeping ──────────────────────────────────────────────────────────

	private finishTween(el: HTMLElement, anim: Animation): void {
		if (this.active.get(el)?.anim !== anim) return; // volo rimpiazzato nel frattempo
		this.active.delete(el);
		el.classList.remove('tweening');
		if (el.isConnected) {
			// A effetto concluso translate è tornato neutro: rect = posizione di layout.
			const r = el.getBoundingClientRect();
			el.setAttribute('pos', `${round(r.x)},${round(r.y)}`);
		}
		this.pendings.update((v) => Math.max(0, v - 1));
		this.tweenComplete.emit({
			id: el.getAttribute('tween-id'),
			target: el,
			pendings: this.pendings(),
		});
		// A scena ferma: audit dell'invariante "un id = un elemento visibile".
		if (this.pendings() === 0 && this.debug()) {
			queueMicrotask(() => this.auditUniqueness());
		}
	}

	/**
	 * Audit (solo debug): ogni tween-id deve corrispondere a UN elemento
	 * visibile. Duplicati o elementi invisibili a scena ferma = carte
	 * "clonate" o "sparite": va segnalato, mai tollerato in silenzio.
	 */
	private auditUniqueness(): void {
		if (this.pendings() !== 0) return; // nel frattempo è ripartito qualcosa
		const byId = new Map<string, HTMLElement[]>();
		this.host.querySelectorAll<HTMLElement>('[tween-id]').forEach((el) => {
			const id = el.getAttribute('tween-id')!;
			const list = byId.get(id) ?? [];
			list.push(el);
			byId.set(id, list);
		});
		for (const [id, els] of byId) {
			const visible = els.filter(
				(el) =>
					!el.hasAttribute('tween-consumed') &&
					getComputedStyle(el).visibility !== 'hidden',
			);
			if (els.length > 1) {
				console.warn(
					`[tween] audit: id=${id} presente ${els.length} volte nel DOM ` +
						`(${visible.length} visibili)`,
					els,
				);
			} else if (visible.length === 0) {
				console.warn(`[tween] audit: id=${id} presente ma NON visibile`, els[0]);
			}
		}
	}

	private log(...args: unknown[]): void {
		if (this.debug()) console.log('[tween]', ...args);
	}

	/** Annulla il volo di `el` (se esiste) e scala pendings. Idempotente. */
	private cancelTween(el: HTMLElement): void {
		const a = this.active.get(el);
		if (!a) return;
		this.active.delete(el);
		a.anim.cancel();
		el.classList.remove('tweening');
		this.pendings.update((v) => Math.max(0, v - 1));
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

/** '12px 34px' | '12px' | 'none' → [x, y] in px. */
function parseTranslate(value: string): [number, number] {
	if (!value || value === 'none') return [0, 0];
	const parts = value.split(' ');
	return [parseFloat(parts[0]) || 0, parseFloat(parts[1] ?? '0') || 0];
}

/**
 * Posizione di layout (viewport) ricavata da offsetParent + offsetLeft/Top:
 * ignora i transform dell'elemento, quindi si legge anche a metà volo senza
 * cancellare l'animazione. La base è coerente solo con se stessa: va
 * confrontata esclusivamente con valori calcolati allo stesso modo.
 */
function offsetBasis(el: HTMLElement): { x: number; y: number } | null {
	const parent = el.offsetParent;
	if (!parent) return null;
	const r = parent.getBoundingClientRect();
	return { x: r.x + el.offsetLeft, y: r.y + el.offsetTop };
}
