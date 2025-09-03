import { CommonModule } from '@angular/common';
import { AfterContentInit, AfterViewInit, Component, ElementRef, input, signal } from '@angular/core';

@Component({
	selector: 'ui-tweener',
	imports: [
		CommonModule
	],
	templateUrl: './tweener.html',
	styleUrl: './tweener.scss'
})
export class Tweener implements AfterViewInit {

	private host = signal<HTMLElement>(null);
	private mutations: MutationObserver
	private hash:{[key:string]:{
		from:any,
		target: any 
		timeoutId:any
	}} = {};

	disabled = input<boolean>(false);

	constructor(protected ref: ElementRef) {}


	ngAfterViewInit() {
		
		const host = this.ref.nativeElement.parentElement;
		console.log("[TWEENER] HOST", {host});
		this.host.set(host);
		this.startTracking();

	}

	startTracking() {

		this.refreshPositions();


		this.mutations = new MutationObserver(mutations => {
			
			if (this.disabled()) return;

			for (const mutation of mutations) {
				

				// Controlla i nodi rimossi
				mutation.removedNodes.forEach(node => {
					if (node instanceof HTMLElement) {
						const tweeners =  [node].concat(Array.from(node.querySelectorAll('[tween-id]')));
						tweeners.forEach(tweener=>{
							const tweenId = tweener.getAttribute('tween-id');
							if (!tweenId) return;
							this.hash[tweenId] = {
								...this.hash[tweenId],
								from: tweener.getAttribute('pos'),
							}
						});
					}
				})

				// Controlla i nodi rimossi
				mutation.addedNodes.forEach(node => {
					if (node instanceof HTMLElement) {
						const tweeners = [node].concat(Array.from(node.querySelectorAll('[tween-id]')));
						tweeners.forEach(tweener=>{
							const tweenId = tweener.getAttribute('tween-id');
							if (!tweenId) return;
							this.hash[tweenId] = {
								...this.hash[tweenId],
								target: tweener
							};
						})
					}
				})

			}
			
			this.checkTweens();
			this.refreshPositions();
		})

		const options = {
			childList: true,
			subtree: true
		}
		this.mutations.observe(this.host(), options);

		
	}

	checkTweens() {
		Object.keys(this.hash).forEach(tweenId=>{
			const tween = this.hash[tweenId];
			if (tween.from && tween.target) {
				clearTimeout(this.hash[tweenId].timeoutId);
				tween.timeoutId = setTimeout(()=>this.clearTween(tweenId), 2000);
				tween.target.setAttribute('pos', tween.from);
			}
		})
	}

	clearTween(tweenId:string) {
		if (!(tweenId in this.hash)) return;
		
		console.log("[TWEENER] clear tween "+tweenId);
		clearTimeout(this.hash[tweenId].timeoutId);
		delete this.hash[tweenId];
		//console.log("[TWEENER] clear tween "+tweenId+", remainings "+Object.values(this.hash).length+"...",this.hash)
		console.log("[TWEENER] clear tween "+tweenId+", remainings "+Object.values(this.hash).length)
	
	}

	refreshPositions() {
		var count = 0;
		this.host().querySelectorAll("[tween-id]").forEach(node=>{
			if (node instanceof HTMLElement) {
				const tweenId = node.getAttribute("tween-id");
				const tweening = node.classList.contains('tweening');
				if (tweening) {
					node.style.transition = "none";
					node.style.translate = "";
					node.classList.remove('tweening');	
					delete node.ontransitionend;
					//this.clearTween(tweenId);
				} 
				
				var {x,y} = node.getBoundingClientRect();
				const prevPos = node.getAttribute("pos");
				if (prevPos) {

					const [ox,oy] = prevPos.split(",");
					const dx = +ox-x;
					const dy = +oy-y;
					
					if (!Math.round(dx) && !Math.round(dy)) return;

					node.style.transition = "none";
					node.style.translate = `${dx}px ${dy}px`;
					node.classList.add('tweening');
					this.clearTween(tweenId);

					node.ontransitionend = ()=>{
						node.classList.remove('tweening');	
						node.style.transition = "";
						var {x,y} = node.getBoundingClientRect();
						node.setAttribute("dest", `${x},${y}`);
						delete node.ontransitionend;
					}
					
					requestAnimationFrame(()=>{
						const delay = 0 //Math.min(1000,count*100);
						node.style.transition = `translate 1s ease ${delay}ms`;
						count++;
						node.style.translate = "";
					});
					
				} 
				node.setAttribute("pos", `${x},${y}`);
				
			}
		})
	}

}
