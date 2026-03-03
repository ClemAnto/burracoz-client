import { AfterViewInit, Component, ElementRef, input, OnDestroy, output, signal } from '@angular/core';

const { round } = Math;

@Component({
	selector: 'ui-tweener',
	imports: [],
	templateUrl: './tweener.html',
	styleUrl: './tweener.scss',
})
export class Tweener implements AfterViewInit, OnDestroy {
	private host = signal<HTMLElement>(null);
	private mutations: MutationObserver;
	private resizeObserver: ResizeObserver;
	private hash: {
		[key: string]: {
			from: any;
			data: any;
			target: any;
			timeoutId: any;
		};
	} = {};

	disabled = input<boolean>(false);

	pendings = 0;
	tweenComplete = output<any>();

	constructor(protected ref: ElementRef) {}

	ngAfterViewInit() {
		const host = this.ref.nativeElement.parentElement;
		this.host.set(host);
		this.startTracking();
	}

	ngOnDestroy() {
		this.mutations?.disconnect();
		this.resizeObserver?.disconnect();
	}

	startTracking() {
		this.silentRefresh();

		this.mutations = new MutationObserver((mutations) => {
			if (this.disabled()) {
				// Keep positions current so toggling disabled back on doesn't
				// cause spurious animations.
				this.silentRefresh();
				return;
			}

			for (const mutation of mutations) {
				mutation.removedNodes.forEach((node) => {
					if (node instanceof HTMLElement) {
						const tweeners = [node].concat(
							Array.from(node.querySelectorAll('[tween-id]')),
						);
						tweeners.forEach((tweener) => {
							const tweenId = tweener.getAttribute('tween-id');
							if (!tweenId) return;
							this.hash[tweenId] = {
								...this.hash[tweenId],
								from: tweener.getAttribute('pos'),
								data: tweener.getAttribute('tween-data'),
							};
						});
					}
				});

				mutation.addedNodes.forEach((node) => {
					if (node instanceof HTMLElement) {
						const tweeners = [node].concat(
							Array.from(node.querySelectorAll('[tween-id]')),
						);
						tweeners.forEach((tweener) => {
							const tweenId = tweener.getAttribute('tween-id');
							if (!tweenId) return;
							this.hash[tweenId] = {
								...this.hash[tweenId],
								target: tweener,
							};
						});
					}
				});
			}

			this.checkTweens();
			this.animatePositions();
		});

		this.mutations.observe(this.host(), { childList: true, subtree: true });

		// When the container resizes (e.g. window resize, layout reflow), all
		// bounding rects shift uniformly. Reset stored positions so the next
		// animatePositions call doesn't mistake a layout shift for card movement.
		this.resizeObserver = new ResizeObserver(() => this.silentRefresh());
		this.resizeObserver.observe(this.host());
	}

	checkTweens() {
		Object.keys(this.hash).forEach((tweenId) => {
			const tween = this.hash[tweenId];
			if (tween.from && tween.target) {
				clearTimeout(this.hash[tweenId].timeoutId);
				tween.timeoutId = setTimeout(() => this.clearTween(tweenId), 2000);
				tween.target.setAttribute('pos', tween.from);
				tween.target.setAttribute('tween-data-prev', tween.data);
			}
		});
	}

	clearTween(tweenId: string) {
		if (!(tweenId in this.hash)) return;
		clearTimeout(this.hash[tweenId].timeoutId);
		delete this.hash[tweenId];
	}

	/** Updates stored positions only — does not trigger any animation. */
	silentRefresh() {
		this.host()?.querySelectorAll('[tween-id]').forEach((node) => {
			if (node instanceof HTMLElement) {
				const { x, y } = node.getBoundingClientRect();
				node.setAttribute('pos', `${round(x)},${round(y)}`);
			}
		});
	}

	/** Compares stored vs current positions and triggers FLIP animations. */
	animatePositions() {
		var count = 0;
		this.host()
			.querySelectorAll('[tween-id]:not(.tweening)')
			.forEach((node) => {
				if (node instanceof HTMLElement) {
					const tweenId = node.getAttribute('tween-id');
					const { x, y } = node.getBoundingClientRect();
					const prevPos = node.getAttribute('pos');
					if (prevPos) {
						const [ox, oy] = prevPos.split(',');
						const dx = +ox - x;
						const dy = +oy - y;

						if (!round(dx) && !round(dy)) return;

						node.classList.add('no-transitions');
						node.style.translate = `${dx}px ${dy}px`;

						const tweenData = JSON.parse(node.getAttribute('tween-data-prev') || '{}');
						for (let key in tweenData) {
							node.style.setProperty(key, tweenData[key]);
						}

						node.classList.add('tweening');
						this.clearTween(tweenId);

						onAllTransitionsDone(node, () => {
							node.classList.remove('tweening');
							node.removeAttribute('tween-data');
							node.removeAttribute('tween-data-prev');
							this.pendings = Math.max(0, this.pendings - 1);
							this.tweenComplete.emit({
								id: tweenId,
								target: node,
								pendings: this.pendings,
							});
						});

						requestAnimationFrame(() => {
							node.classList.remove('no-transitions');
							count++;
							this.pendings++;
							node.style.translate = '';
							node.style.setProperty('--tween-scatter-delay', `${count * 10}`);
							for (let key in tweenData) {
								node.style.setProperty(key, '');
							}
						});
					}
					node.setAttribute('pos', `${round(x)},${round(y)}`);
				}
			});
	}
}

function onAllTransitionsDone(el: HTMLElement, callback: () => void) {
	let pending = 0;
	let running = false;

	const cleanup = () => {
		el.removeEventListener('transitionstart', onStart);
		el.removeEventListener('transitionend', onFinish);
		el.removeEventListener('transitioncancel', onFinish);
	};

	const onStart = (e: TransitionEvent) => {
		if (e.target !== el) return;
		running = true;
		pending++;
	};

	const onFinish = (e: TransitionEvent) => {
		if (e.target !== el) return;
		if (pending > 0) pending--;
		if (running && pending === 0) {
			cleanup();
			callback();
		}
	};

	el.addEventListener('transitionstart', onStart);
	el.addEventListener('transitionend', onFinish);
	el.addEventListener('transitioncancel', onFinish);
}
