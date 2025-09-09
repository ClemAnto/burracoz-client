import { Injectable } from '@angular/core';
import { DeckItem } from '../ui/deck/deck';
import { getCardRank } from './cards';

@Injectable({
  providedIn: 'root'
})
export class Rules {

	validateMeld( layOffCards:DeckItem[], tableCards?:DeckItem[]) {
		return this.validateRun(layOffCards, tableCards);
	}

	validateRun(layOffCards: DeckItem[], tableCards?: DeckItem[]) {
		//CartType
		console.group("[RULES] Validate Run...");
		const cards = layOffCards.concat(tableCards ?? []);
		
		const naturals = cards.filter(c => c.value != "2" && c.value != "*").sort((a, b) => getCardRank(a.value) - getCardRank(b.value));
		console.log("naturals: " + naturals);
		if (!naturals.length) return null;
		
		const suit = naturals[0].suit;
		if (naturals.some(c=>c.suit != suit)) return null;

		console.log("cards: " + cards);
		const wildVal = (card:DeckItem) => (card.value == "2" && card.suit == suit) ? 1 : 0;
		const wilds = cards.filter(c => c.value == "2" || c.value == "*").sort((a,b)=>wildVal(a)-wildVal(b));
		console.log("wilds: " + wilds);
		
		

		

		const run = [naturals.shift()];
		if (run[0].value == "A") {
			const suit2index = wilds.findIndex(w=>w.value == "2" && w.suit == suit);
			if (suit2index>=0) {
				const [suit2] = wilds.splice(suit2index, 1);
				run.unshift(suit2);
			}
		}
		
		

		do {
			console.log("run: " + run + " (naturals:"+naturals+")");
			const nextCard = naturals.shift();
			console.log("nextCard: " + nextCard);
			console.log("run[0]: " + run[0]);
			const gap = getCardRank(nextCard.value) - getCardRank(run[0].value);
			console.log("gap: " + gap);
			if (gap > 2) return null; //GAP TOO HIGH
			if (gap < 1) return null;
			if (gap == 2) {
				const wild = wilds.shift();
				if (wild) {
					run.unshift(wild);
				} else return null;
			}
			run.unshift(nextCard);
		} while (naturals.length)

			
		if (run[run.length-1].value == "3") {
			const suit2index = wilds.findIndex(w=>w.value == "2" && w.suit == suit);
			if (suit2index>=0) {
				const [suit2] = wilds.splice(suit2index, 1);
				run.push(suit2);
			}
		}
		

		if (wilds.length > 1) return null;
		
		run.unshift(...wilds);

		console.log("run: " + run);

		console.groupEnd();

		if (run.length < 3) return null;

		return run;
	}
}

