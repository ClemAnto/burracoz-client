import { CommonModule } from '@angular/common';
import { AfterContentInit, AfterViewInit, Component, ElementRef, signal } from '@angular/core';

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
	private hash:{[key:string]:string} = {};

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
			
			for (const mutation of mutations) {
				

				// Controlla i nodi rimossi
				mutation.removedNodes.forEach(node => {
					if (node instanceof HTMLElement) {
						const tweenId = node.getAttribute('tween-id');
						if (tweenId) {
							console.log("[TWEENER] REMOVED "+tweenId, node);
							this.hash[tweenId] = node.getAttribute('pos');
						}
					}
				})

				// Controlla i nodi rimossi
				mutation.addedNodes.forEach(node => {
					if (node instanceof HTMLElement) {
						const tweenId = node.getAttribute('tween-id');
						if (tweenId && tweenId in this.hash) {
							console.log("[TWEENER] ADDED "+tweenId, node);
							node.setAttribute('pos', this.hash[tweenId]);
							delete this.hash[tweenId];
						}
					}
				})
			}
		
			
			this.refreshPositions();
		})
		const options = {
			childList: true,
			subtree: true
		}
		this.mutations.observe(this.host(), options);

		/*
		const ro = new ResizeObserver(() => this.refreshPositions());
        ro.observe(this.host());
		*/
	}

	refreshPositions() {
		this.host().querySelectorAll("[tween-id]").forEach(node=>{
			if (node instanceof HTMLElement) {
				const tweening = node.classList.contains('tweening');
				if (tweening) {
					node.style.transition = "none";
					node.style.translate = "";
					node.classList.remove('tweening');	
					delete node.ontransitionend;
				} 
				
				var {x,y} = node.getBoundingClientRect();
				const prevPos = node.getAttribute("pos");
				if (prevPos) {

					const [ox,oy] = prevPos.split(",");
					node.style.transition = "none";
					node.style.translate = `${+ox-x}px ${+oy-y}px`;
					node.classList.add('tweening');
					node.ontransitionend = ()=>{
						node.classList.remove('tweening');	
						delete node.ontransitionend;
					}
					
					requestAnimationFrame(()=>{
						node.style.transition = "translate 1s ease";
						node.style.translate = "";
					});
					
				} 
				node.setAttribute("pos", `${x},${y}`);
				
			}
		})
	}

}
