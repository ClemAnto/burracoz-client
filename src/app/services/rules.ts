import { Injectable } from '@angular/core';
import {
	CardValue,
	DeckItem,
	DeckItems,
	getCardRank,
	howMany,
	STARTER_DECK,
	SuitTag,
} from './cards';
import { extractFrom } from '../utils/arrays';

type MeldInput = DeckItems | DeckItem[] | string;

@Injectable({
	providedIn: 'root',
})
export class Rules {
	validateMeld(layOffCards: MeldInput, tableCards?: MeldInput): DeckItems | null {
		return (
			this.validateSet(layOffCards, tableCards) || this.validateRun(layOffCards, tableCards)
		);
	}

	validateSet(layOffCards: MeldInput, tableCards?: MeldInput): DeckItems | null {
		const layedOff = this.toDeckItems(layOffCards);
		if (!layedOff.length) {
			//E' necessario giocare almeno una carta dalla mano
			return null;
		}

		const onTable = this.toDeckItems(tableCards);
		const cards = DeckItems.fromArray(layedOff.concat(onTable)).sort(
			(a, b) => +isWild(a) - +isWild(b),
		);

		if (!onTable.length && layedOff.length < 3) {
			//Non è possibile creare un gioco con meno di 3 carte
			return null;
		}

		//TOO MANY WILDS?
		const wilds = cards.filter(isWild);
		if (wilds.length > 1) return null;

		//SET SIZE LIMIT: 3..8 naturals (+ optional 1 wild)
		if (cards.length < 3 || cards.length > 9) return null;

		//SAME VALUE?
		const naturals = cards.filter((c) => !isWild(c));
		if (!naturals.length || naturals.length > 8) return null;
		const value = naturals[0].value;
		if (naturals.some((c) => c.value != value)) return null;

		//TOO MANY EQUAL CARDS!
		if (naturals.some((c) => howMany(c, naturals) > 2)) return null;

		//console.log('[RULES] Set validated: ' + cards);
		return cards;
	}

	validateRun(layOffCards: MeldInput, tableCards?: MeldInput): DeckItems | null {
		const layedOff = this.toDeckItems(layOffCards);
		if (!layedOff.length) {
			//E' necessario giocare almeno una carta dalla mano
			return null;
		}

		const onTable = this.toDeckItems(tableCards);

		if (!onTable.length && layedOff.length < 3) {
			//Non è possibile creare un gioco con meno di 3 carte
			return null;
		}

		const tableSuit = onTable.find((c) => !isWild(c))?.suit;
		const runSuit = tableSuit || layedOff.find((c) => !isWild(c))?.suit;

		if (layedOff.some((c) => !isWild(c) && c.suit != runSuit)) {
			//Le carte naturali devono essere dello stesso seme
			return null;
		}

		var wildAlreadyUsed = false;

		// Sul tavolo posso liberare un incastro sostituendolo.
		const { tag: incastroTag, index: incastroIdx } = getIncastroTag(onTable);
		if (incastroTag) {
			const [replacement] = extractFrom(layedOff, (c) => c.tag == incastroTag, 1);
			if (replacement) {
				const [releasedWild] = onTable.splice(incastroIdx, 1, replacement);
				layedOff.push(releasedWild);
			} else {
				wildAlreadyUsed = true;
			}
		} else {
			// Sul tavolo posso muovere eventuali matte alle estremità
			if (isWild(onTable.at(-1))) layedOff.push(onTable.pop());
			else if (isWild(onTable.at(0))) layedOff.push(onTable.shift());
		}
		// Piazziamo tutte le carte naturali
		const run = new Map<number, DeckItem>();

		function addToRun(p: number, c: DeckItem) {
			if (run.has(p)) return false;
			run.set(p, c);
			return true;
		}

		const tableOk = onTable.every((c, i) => {
			let pos = getCardAbsPos(i, onTable);
			return addToRun(pos, c);
		});
		if (!tableOk) return null;

		var [ace] = extractFrom(layedOff, (c) => c.value == 'A', 1);
		const naturals = extractFrom(layedOff, (c) => !isWild(c) && c.value != 'A');

		const naturalOk = naturals.every((c) => {
			var pos = getCardRank(c.value);
			return addToRun(pos, c);
		});
		if (!naturalOk) return null;

		var [natural2] = extractFrom(layedOff, (c) => +c.value == 2 && c.suit == runSuit, 1);
		var [wild] = extractFrom(layedOff, (c) => isWild(c), 1);

		if (natural2) {
			if (wild || wildAlreadyUsed) {
				if (!addToRun(2, natural2)) {
					//Posizione 2 già occupata
					return null;
				}
				natural2 = null;
			} else {
				let mayBeCleanCanasta = Math.min(...run.keys()) == 3;
				if (ace && run.has(12) && !run.has(13) && !mayBeCleanCanasta) {
					if (!addToRun(13, natural2)) {
						//Posizione 2 già occupata
						return null;
					}
					natural2 = null;
				}

				wild = natural2;
				natural2 = null;
			}
		}

		if (ace) {
			//if (aceMayBeHigh(layedOff.concat(onTable))) {
			const mayBeCleanCanasta =
				(!wild || (wild.suit == runSuit && +wild.value == 2)) &&
				!wildAlreadyUsed &&
				run.size == 10;
			const nogap = Math.max(...run.keys()) - Math.min(...run.keys()) == run.size - 1;
			if (
				(run.has(13) || (run.has(12) && wild && !wildAlreadyUsed && nogap)) &&
				!mayBeCleanCanasta
			) {
				if (!addToRun(14, ace)) {
					//Posizione 14 già occupata
					return null;
				}
			} else {
				if (!addToRun(1, ace)) {
					//Posizione 1 già occupata
					return null;
				}
			}
			ace = null;
		}

		const positions = Array.from(run.keys());
		const first = Math.min(...positions);
		const last = Math.max(...positions);
		const gaps = last - first - (positions.length - 1);

		if (gaps > 1) {
			//Ci sono troppi buchi
			return null;
		}

		if (gaps == 1) {
			if (wildAlreadyUsed || !wild) {
				//Jolly già usato o non presente
				return null;
			}
			let p = first;
			while (run.has(p)) p++;
			if (!addToRun(p, wild)) {
				//Posizione già occupata
				return null;
			}
			wild = null;
			wildAlreadyUsed = true;
		}

		if (wild) {
			if (wildAlreadyUsed) {
				//Jolly eccedente
				return null;
			} else {
				if (run.get(first)?.value == 'A') {
					if (!addToRun(last + 1, wild)) {
						return null;
					}
				} else {
					if (!addToRun(first - 1, wild)) {
						return null;
					}
				}
			}
			wild = null;
		}

		if (ace || natural2 || wild || layedOff.length) {
			// Sono rimaste carte non posizionate
			return null;
		}

		const result = this.toDeckItems(
			[...run.keys()].sort((a, b) => +b - a).map((pos) => run.get(pos)),
		);

		//console.log(layOffCards.toString() + "   +   " + tableCards.toString() + "   ->   " + result.toString())
		return result;
	}

	private toDeckItems(cards?: MeldInput): DeckItems {
		if (!cards) return new DeckItems();
		if (cards instanceof DeckItems) return DeckItems.fromArray(cards);
		if (typeof cards == 'string') {
			const tokenPattern =
				/(?:10|[2-9AJQK])(?:♥️|♦️|♠️|♣️)|(?:\*|🃏)(?:⚫|🔴|♥️|♦️|♠️|♣️)?/gu;
			return DeckItems.fromArray(
				(cards.match(tokenPattern) ?? []).map((tag) => new DeckItem(tag)),
			);
		}
		return DeckItems.fromArray(cards);
	}
}

export function isWild(card: DeckItem) {
	return card && (card.value == '2' || card.value == '*');
}

export function aceMayBeHigh(cards: readonly DeckItem[]) {
	const thereIsK = cards.some((c) => c.value == 'K');
	if (thereIsK) return true;

	const thereIsQ = cards.find((c) => c.value == 'Q');
	if (!thereIsQ) return false;

	const wilds = cards.filter((c) => isWild(c));
	if (!wilds.length) return false;

	//if (wilds.length > 1) return false;

	const sameSuit = cards.every((c) => c.suit === thereIsQ.suit);
	const allValues = [2, 3, 4, 5, 6, 7, 8, 9, 'J', 'Q'].every((v) =>
		cards.find((c) => c.value == v),
	);
	const mayBeCleanCanasta = sameSuit && allValues;

	return !mayBeCleanCanasta;
}

export function getIncastroTag(cards: DeckItems): { tag: string; index: number } {
	const wildIndex = cards.findIndex((c, i) => {
		return isWild(c) && !isNatural2(cards, i);
	});

	if (wildIndex < 1 || wildIndex > cards.length - 2) return { tag: null, index: -1 };

	const { card, offset } = getNaturalNear(cards, wildIndex);
	// STARTER_DECK è ascendente per rank dentro ogni seme, quindi ±1 sull'indice = ±1 di
	// rank. Il tag rappresentato dalla matta si trova spostandosi dal naturale vicino di un
	// rank verso la matta: la direzione dipende dal VERSO dell'array (i giochi a terra sono
	// memorizzati DECRESCENTI, l'input di gioco CRESCENTE), come in `getCardAbsPos`. Senza il
	// fattore `rankDirection` la sostituzione falliva sulle scale memorizzate decrescenti.
	const tagIndex = STARTER_DECK.indexOf(card.tag) - rankDirection(cards) * offset;

	return {
		tag: STARTER_DECK[tagIndex] ?? null,
		index: wildIndex,
	};
}

export function isNatural2(cards: readonly DeckItem[], index: number): boolean {
	const target = cards[index];
	if (+target.value != 2) return false;

	// Un 2 è "naturale" (occupa il rank 2, tra A e 3) se nel gioco è adiacente,
	// nello stesso seme, a un A o a un 3; oppure a un 4 saltando una matta.
	// Il controllo è simmetrico su entrambi i lati perché un gioco già validato
	// viene memorizzato in ordine decrescente, mentre l'input di gioco è crescente.
	const sameSuitAt = (offset: number, value: string): boolean => {
		const near = cards[index + offset];
		return !!near && near.suit === target.suit && near.value === value;
	};

	return (
		sameSuitAt(-1, 'A') ||
		sameSuitAt(+1, 'A') ||
		sameSuitAt(-1, '3') ||
		sameSuitAt(+1, '3') ||
		sameSuitAt(-2, '4') ||
		sameSuitAt(+2, '4')
	);
}

export function getNaturalNear(cards: DeckItem[], index: number) {
	const offset = [-1, +1].find((o) => getCardRank(cards[index + o]?.value));
	return {
		card: cards[index + offset],
		offset,
	};
}

/**
 * Posizione assoluta (rank) di una carta all'interno di una sequenza.
 * Spostata qui da cards.ts perché dipende da isNatural2/aceMayBeHigh/getNaturalNear:
 * mantenerla in cards.ts creava la dipendenza circolare cards↔rules.
 */
export function getCardAbsPos(cardIndex: number, cards: DeckItem[]): number {
	let cardValue: CardValue = cards[cardIndex].value;
	// `cards` è già un array: `isNatural2`/`aceMayBeHigh` accettano `readonly DeckItem[]`,
	// niente più copie con `DeckItems.fromArray` a ogni carta (era O(n²) in validazione).
	if (+cardValue == 2 && !isNatural2(cards, cardIndex)) cardValue = '*';

	let pos = getCardRank(cardValue, cardValue == 'A' && aceMayBeHigh(cards));
	if (!pos) {
		// Matta: la posizione si deduce dal naturale vicino. Il verso dell'array
		// (rank crescente o decrescente con l'indice) determina il segno: i giochi
		// a terra sono memorizzati in ordine DECRESCENTE, l'input di gioco è
		// CRESCENTE. Senza rilevare il verso la matta-incastro finiva alla posizione
		// sbagliata (es. scala 10♠9♠[8=2♥]7♠ non si estendeva più — collisione a 10).
		const { card, offset } = getNaturalNear(cards, cardIndex);
		pos = getCardRank(card.value) - rankDirection(cards) * offset;
	}

	return pos;
}

/** +1 se i rank crescono con l'indice, -1 se decrescono (dai primi due naturali). */
function rankDirection(cards: DeckItem[]): number {
	const ranked = cards.map((c) => getCardRank(c.value)).filter((r) => r > 0);
	if (ranked.length < 2) return 1;
	return ranked[1] - ranked[0] >= 0 ? 1 : -1;
}
