import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Lato del tavolo da cui parla il giocatore: orienta posizione e coda del fumetto. */
export type BubbleSide = 'north' | 'south' | 'east' | 'west';

/**
 * Fumetto di dialogo di un'IA, ancorato al proprio posto: appare verso il centro
 * del tavolo con una coda che punta al giocatore. Componente presentazionale
 * (solo input); la comparsa/scomparsa temporizzata è gestita dalla Board.
 * Va posto dentro un contenitore `relative` (il posto): si posiziona in assoluto.
 */
@Component({
	selector: 'ui-speech-bubble',
	templateUrl: './speech-bubble.html',
	changeDetection: ChangeDetectionStrategy.OnPush,
	host: { class: 'contents' },
	styles: [
		`
			@keyframes bubble-in {
				from {
					opacity: 0;
					transform: scale(0.8) translateY(4px);
				}
				to {
					opacity: 1;
					transform: scale(1) translateY(0);
				}
			}
			.bubble {
				animation: bubble-in 0.18s ease-out;
				transform-origin: center;
			}
		`,
	],
})
export class SpeechBubble {
	/** Testo della battuta. */
	text = input.required<string>();
	/** Lato del giocatore (dove punta la coda). */
	side = input.required<BubbleSide>();
	/** Etichetta/nome opzionale mostrato sopra la battuta. */
	label = input<string>('');

	/** Posizionamento del fumetto verso il centro, in base al lato. `w-max` è
	 *  necessario per est/ovest: il posto fa da containing block largo ~40px e
	 *  senza larghezza naturale il fumetto collasserebbe a min-content (una parola
	 *  per riga). `w-max` + `max-w-*` = larghezza del testo, cappata, poi a capo. */
	private readonly WRAPPER: Record<BubbleSide, string> = {
		north: 'left-1/2 top-full -translate-x-1/2 mt-1.5 w-max max-w-56',
		south: 'left-1/2 bottom-full -translate-x-1/2 mb-1.5 w-max max-w-56',
		east: 'left-full top-1/2 -translate-y-1/2 ml-1.5 w-max max-w-48',
		west: 'right-full top-1/2 -translate-y-1/2 mr-1.5 w-max max-w-48',
	};

	/** Coda (quadratino ruotato) sul bordo che punta al giocatore. */
	private readonly TAIL: Record<BubbleSide, string> = {
		north: '-top-1 left-1/2 -translate-x-1/2',
		south: '-bottom-1 left-1/2 -translate-x-1/2',
		east: '-left-1 top-1/2 -translate-y-1/2',
		west: '-right-1 top-1/2 -translate-y-1/2',
	};

	wrapperClass = computed(() => `absolute z-40 pointer-events-none ${this.WRAPPER[this.side()]}`);
	tailClass = computed(() => this.TAIL[this.side()]);
}
