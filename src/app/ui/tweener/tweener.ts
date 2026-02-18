import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, input, output, signal } from '@angular/core';

const { round } = Math;

@Component({
	selector: 'ui-tweener',
	imports: [CommonModule],
	templateUrl: './tweener.html',
	styleUrl: './tweener.scss',
})
export class Tweener implements AfterViewInit {
	private host = signal<HTMLElement>(null);
	private mutations: MutationObserver;
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
	allTweenCompleteds = output<any>();

	constructor(protected ref: ElementRef) {}

	ngAfterViewInit() {
		const host = this.ref.nativeElement.parentElement;
		console.log('[TWEENER] HOST', { host });
		this.host.set(host);
		this.startTracking();
	}

	startTracking() {
		this.refreshPositions();

		this.mutations = new MutationObserver((mutations) => {
			if (this.disabled()) return;

			for (const mutation of mutations) {
				// Controlla i nodi rimossi
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

				// Controlla i nodi rimossi
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
			this.refreshPositions();
		});

		const options = {
			childList: true,
			subtree: true,
		};
		this.mutations.observe(this.host(), options);
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

		//console.log("[TWEENER] clear tween "+tweenId);
		clearTimeout(this.hash[tweenId].timeoutId);
		delete this.hash[tweenId];
		//console.log("[TWEENER] clear tween "+tweenId+", remainings "+Object.values(this.hash).length+"...",this.hash)
		//console.log("[TWEENER] clear tween "+tweenId+", remainings "+Object.values(this.hash).length)
	}

	refreshPositions() {
		var count = 0;
		this.host()
			.querySelectorAll('[tween-id]:not(.tweening)')
			.forEach((node) => {
				if (node instanceof HTMLElement) {
					const tweenId = node.getAttribute('tween-id');
					const tweening = node.classList.contains('tweening');
					if (tweening) {
						//LA POSIZIONE DEL NODO E' IN TRANSIZIONE
						//CHE SUCCEDE IN QUESTO CASO?
						debugger;
					}
					/*
				if (tweening) {
					//node.style.transition = "none";
					node.classList.add('no-transitions');	
					node.style.translate = "";
					node.classList.remove('tweening');	
					node.removeAttribute("tween-data");
					node.removeAttribute("tween-data-prev");
					delete node.ontransitionend;
					//this.clearTween(tweenId);
				} 
				*/
					var { x, y } = node.getBoundingClientRect();
					const prevPos = node.getAttribute('pos');
					if (prevPos) {
						const [ox, oy] = prevPos.split(',');
						const dx = +ox - x;
						const dy = +oy - y;

						if (!round(dx) && !round(dy)) return;

						//node.style.transition = "none";
						node.classList.add('no-transitions');
						node.style.translate = `${dx}px ${dy}px`;

						const tweenData = JSON.parse(node.getAttribute('tween-data-prev') || '{}');
						for (let key in tweenData) {
							//console.log("[TWEENER] set key " + key + " --> " + tweenData[key]);
							node.style.setProperty(key, tweenData[key]);
						}

						node.classList.add('tweening');
						this.clearTween(tweenId);

						onAllTransitionsDone(node, () => {
							node.classList.remove('tweening');
							node.removeAttribute('tween-data');
							node.removeAttribute('tween-data-prev');
							delete node.ontransitionend;
							this.pendings--;
							this.tweenComplete.emit({
								id: tweenId,
								target: node,
								pendings: this.pendings,
							});
						});

						node.ontransitionrun;

						requestAnimationFrame(() => {
							//const delay = 1000 //Math.min(1000,count*100);
							//node.style.transition = `all 3s ease ${delay}ms`;
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

function onAllTransitionsDone(el: HTMLElement, callback: Function, { once = true } = {}) {
	let pending = 0;
	let running = false;

	const onStart = (e: TransitionEvent) => {
		// Evita di contare transizioni di elementi figli
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

	const cleanup = () => {
		el.removeEventListener('transitionstart', onStart);
		el.removeEventListener('transitionend', onFinish);
		el.removeEventListener('transitioncancel', onFinish);
	};

	el.addEventListener('transitionstart', onStart);
	el.addEventListener('transitionend', onFinish);
	el.addEventListener('transitioncancel', onFinish);

	if (once) {
		// opzionale: rimuovi automaticamente dopo il primo giro
		const originalCb = callback;
		callback = () => {
			cleanup();
			originalCb();
		};
	}

	return () => cleanup(); // per annullare manualmente se serve
}
