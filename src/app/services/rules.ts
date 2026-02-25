import { Injectable } from '@angular/core';
import { DeckItem, DeckItems } from '../ui/deck/deck';
import { getCardRank, howMany, STARTER_DECK } from './cards';
import { extractFrom, hasDuplicates, last } from '../utils/arrays';

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
		const cards = DeckItems.fromArray(
			this.toDeckItems(layOffCards).concat(this.toDeckItems(tableCards)),
		).sort((a, b) => +isWild(a) - +isWild(b));

		//NOT ENOUGH CARDS?
		if (cards.length < 3) return null;

		//TOO MANY WILDS?
		const wilds = cards.filter(isWild);
		if (wilds.length > 1) return null;

		//SAME VALUE?
		const naturals = cards.filter((c) => !isWild(c));
		const value = naturals[0].value;
		if (naturals.some((c) => c.value != value)) return null;

		//TOO MANY EQUAL CARDS!
		if (naturals.some((c) => howMany(c, naturals) > 2)) return null;

		//console.log('[RULES] Set validated: ' + cards);
		return cards;
	}

	validateRun(layOffCards: MeldInput, tableCards?: MeldInput): DeckItems | null {
		const layedOff = this.toDeckItems(layOffCards);
		const onTable = this.toDeckItems(tableCards);
		let tableSuit: string | undefined;

		// Diventa true quando il "budget matta" è già consumato:
		// - matta bloccata a incastro sul tavolo non liberata
		// - matta usata per coprire un buco durante la costruzione.
		let wildBudgetUsed = false;

		// 1) Pre-process tavolo: il blocco sul tavolo è già valido/ordinato.
		if (onTable.length) {
			if (!layedOff.length) {
				// Con tavolo presente devo appoggiare almeno una carta.
				return null;
			}

			tableSuit = onTable.find((c) => !isWild(c))?.suit;
			if (!tableSuit) {
				// Senza naturali sul tavolo non posso determinare il seme della scala.
				return null;
			}

			if (layedOff.some((c) => !isWild(c) && c.suit != tableSuit)) {
				// Le naturali calate devono essere dello stesso seme del gioco sul tavolo.
				return null;
			}

			// Se c'è un wild a incastro provo a sostituirlo; altrimenti resta bloccato.
			const { tag: replacementTag, index: wildIndex } = getWildNaturalTag(onTable);
			if (replacementTag) {
				const [replacement] = extractFrom(layedOff, (c) => c.tag == replacementTag, 1);
				if (replacement) {
					const [releasedWild] = onTable.splice(wildIndex, 1, replacement);
					layedOff.push(releasedWild);
				} else {
					// Wild a incastro non liberabile: non posso usare altre matte per coprire buchi.
					wildBudgetUsed = true;
				}
			} else {
				// Se il wild è a un'estremità è mobile:
				// preferisco spostare joker/2 fuori seme, lasciando il 2 naturale al suo posto.
				const edgeIndexes = [0, onTable.length - 1].filter(
					(index, pos, list) => list.indexOf(index) == pos,
				);
				const preferredEdge = edgeIndexes.find(
					(i) =>
						isWild(onTable[i]) &&
						(onTable[i].value == '*' || onTable[i].suit != tableSuit),
				);
				const fallbackEdge = edgeIndexes.find((i) => isWild(onTable[i]));
				const edgeToRelease = preferredEdge ?? fallbackEdge;
				if (edgeToRelease !== undefined) {
					const [releasedWild] = onTable.splice(edgeToRelease, 1);
					layedOff.push(releasedWild);
				}
			}
		} else {
			// 2) Apertura (nessun gioco sul tavolo).
			if (layedOff.length < 3) {
				// In apertura servono almeno 3 carte.
				return null;
			}
			if (layedOff.filter((c) => isWild(c)).length > 2) {
				// In apertura non posso avere più di due matte complessive.
				return null;
			}
		}

		if (
			wildBudgetUsed &&
			layedOff.some((c) => isWild(c) && !(c.value == '2' && tableSuit && c.suit == tableSuit))
		) {
			// Con wild a incastro bloccato sul tavolo non posso aggiungere una seconda matta:
			// eccezione ammessa solo per la pinella di stesso seme usata come 2 naturale.
			return null;
		}

		// 3) Nessuna naturale duplicata nella stessa scala.
		if (hasDuplicates([...layedOff, ...onTable].filter((c) => !isWild(c)).map((c) => c.tag))) {
			// Due naturali identiche nella stessa scala rendono la combinazione impossibile.
			return null;
		}

		// 4) Classificazione carte calate.
		const naturals = extractFrom(layedOff, (c) => !isWild(c));
		const runSuit = (naturals[0] ?? onTable.find((c) => !isWild(c)))?.suit;
		if (!runSuit) {
			// Senza una naturale non posso stabilire il seme della scala.
			return null;
		}
		if (naturals.some((c) => c.suit != runSuit)) {
			// Le naturali calate appartengono a semi diversi.
			return null;
		}

		let [ace] = extractFrom(naturals, (c) => c.value == 'A', 1);
		let [natural2] = extractFrom(layedOff, (c) => c.value == '2' && c.suit == runSuit, 1);
		const wilds = extractFrom(layedOff, (c) => isWild(c));
		if (wilds.length > 1) {
			// Oltre al 2 naturale può rimanere al massimo una sola matta libera.
			return null;
		}
		let wild = wilds[0] ?? null;

		// 5) Costruzione backbone della scala (dal rango minimo fino al K).
		const run: DeckItems = DeckItems.fromArray([]);
		const fixedRanks = [...naturals, ...onTable.filter((c) => !isWild(c) && c.value != 'A')].map(
			(c) => getCardRank(c.value),
		);
		let currentRank = fixedRanks.length ? Math.min(...fixedRanks) : Number.POSITIVE_INFINITY;
		const naturalsByRank = new Map<number, DeckItem>(
			naturals.map((c) => [getCardRank(c.value), c]),
		);

		do {
			const natural = naturalsByRank.get(currentRank);
			if (natural) {
				naturalsByRank.delete(currentRank);
				run.push(natural);
				currentRank++;
				continue;
			}

			if (onTable.length) {
				const firstTableRank = getCardRank(onTable[0].value);
				const tableFits = run.length
					? firstTableRank == currentRank
					: firstTableRank <= currentRank;
				if (tableFits) {
					run.push(...onTable);
					currentRank = firstTableRank + onTable.length;
					onTable.length = 0;
					continue;
				}
			}

			const filler = wild ?? natural2;
			if (wildBudgetUsed || !filler) {
				// C'è un buco nella progressione e non ho una matta utilizzabile per coprirlo.
				return null;
			}
			run.push(filler);
			if (wild) wild = null;
			else natural2 = null;
			wildBudgetUsed = true;
			currentRank++;
		} while (currentRank <= 13 && (naturalsByRank.size || onTable.length));

		if (naturalsByRank.size || onTable.length) {
			// La progressione si e' fermata (o ha superato il K) lasciando carte non integrate:
			// non posso validare una scala parziale che "perde" carte del gioco.
			return null;
		}

		// 6) Posizionamento di un eventuale 2 naturale rimasto.
		if (natural2) {
			if (wild) {
				if (+run[0].value == 3) {
					run.unshift(natural2);
				} else if (+run[0].value == 4) {
					run.unshift(wild);
					wild = null;
					run.unshift(natural2);
				} else {
					// 2 naturale + matta residua non sono collocabili senza rompere la continuità.
					return null;
				}
			} else {
				if (wildBudgetUsed && +run[0].value != 3 && !isWild(run[0])) {
					// Il 2 naturale non può essere inserito e la matta è già stata consumata.
					return null;
				}

				const aceLowAlreadyBuilt =
					run[0]?.value == 'A' &&
					(run[1]?.value == '2' || (isWild(run[1]) && run[2]?.value == '3'));
				if (aceLowAlreadyBuilt) {
					// Se la scala è già A-2-3..., un ulteriore 2 di seme è necessariamente matta libera.
					wild = natural2;
				} else if (
					ace &&
					+run[0].value == 2 &&
					(+run[1]?.value == 3 || isWild(run[1]))
				) {
					// Con asso ancora da collocare e scala già avviata da 2-3,
					// un secondo 2 di seme non può restare in testa: diventa matta libera.
					wild = natural2;
				} else if (ace && last(run).value == 'Q' && +run[0].value != 3) {
					wild = natural2;
				} else {
					run.unshift(natural2);
				}
			}
			natural2 = null;
		}

		// 7) Posizionamento asso (basso o alto).
		if (ace) {
			if (last(run).value == 'K') {
				run.push(ace);
			} else if (!wildBudgetUsed && wild && last(run).value == 'Q') {
				run.push(wild);
				run.push(ace);
				wild = null;
				wildBudgetUsed = true;
			} else if (+run[0].value == 2 && (+run[1].value == 3 || isWild(run[1]))) {
				run.unshift(ace);
			} else if (wild && +run[0].value == 3) {
				run.unshift(wild);
				run.unshift(ace);
				wild = null;
				wildBudgetUsed = true;
			} else {
				// L'asso non può essere collocato né in testa né in coda alla scala.
				return null;
			}
			ace = null;
		}

		// 8) Matta residua sempre su un'estremità.
		if (wild) {
			if (run[0].value == 'A') run.push(wild);
			else run.unshift(wild);
		}

		// 9) Lunghezza finale valida.
		if (run.length < 3 || run.length > 14) {
			// Una scala valida deve contenere tra 3 e 14 carte.
			return null;
		}

		return run.reverse();
	}

	validateRun2(layOffCards: MeldInput, tableCards?: MeldInput): DeckItems | null {
		const layedOff = this.toDeckItems(layOffCards);
		const onTable = this.toDeckItems(tableCards);

		// Diventa true quando il wild è già impegnato (incastro non liberabile o usato nel loop),
		// impedendo l'uso di un secondo wild.
		let wildAlreadyUsed = false;

		// ── 1. PRE-PROCESS CARTE SUL TAVOLO ─────────────────────────────────────
		if (onTable?.length) {
			if (!layedOff.length) {
				// Serve almeno una carta per appoggiare
				return null;
			}

			const tableSuit = onTable.find((c) => !isWild(c)).suit;
			if (layedOff.some((c) => !isWild(c) && c.suit != tableSuit)) {
				// Le carte calate devono avere lo stesso seme di quelle a terra
				return null;
			}

			// Controllo jolly ad incastro (non agli estremi): se c'è, provo a liberarlo
			// con la carta naturale corrispondente nelle carte calate.
			const { tag: incastroTag, index: incastroIdx } = getWildNaturalTag(onTable);
			if (incastroTag) {
				const [replacer] = extractFrom(layedOff, (c) => c.tag == incastroTag);
				if (replacer) {
					// Sostituisco l'incastro con la naturale; il jolly passa alle carte calate
					const [wild] = onTable.splice(incastroIdx, 1, replacer);
					layedOff.push(wild);
				} else {
					// L'incastro rimane sul tavolo: il wild è già occupato
					wildAlreadyUsed = true;
				}
			} else {
				// Nessun incastro: sposto il jolly mobile (all'estremità) tra le carte calate
				[0, onTable.length - 1].some((i) => {
					if (!isWild(onTable[i])) return false;
					const [wild] = onTable.splice(i, 1);
					layedOff.push(wild);
					return true;
				});
			}
		} else {
			// ── APERTURA (senza tavolo) ──────────────────────────────────────────
			if (layedOff.length < 3) {
				// Servono almeno 3 carte per aprire un gioco
				return null;
			}
			if (layedOff.filter((c) => isWild(c)).length > 2) {
				// Troppi jolly
				return null;
			}
		}

		// ── 2. NESSUN DUPLICATO ──────────────────────────────────────────────────
		if (hasDuplicates([...layedOff, ...onTable].filter((c) => !isWild(c)).map((c) => c.tag))) {
			// Carte duplicate nella scala
			return null;
		}

		// ── 3. CLASSIFICAZIONE CARTE ─────────────────────────────────────────────
		// Separo le naturali (non-wild) dal mazzo calato e determino il seme della scala
		const naturals = extractFrom(layedOff, (c) => !isWild(c));
		const runSuit = (naturals[0] ?? onTable.find((c) => !isWild(c))).suit;
		if (naturals.some((c) => c.suit != runSuit)) {
			// Tutti i semi delle naturali devono coincidere
			return null;
		}

		// L'asso viene estratto separatamente perché può andare in testa (basso) o in coda (alto)
		let [ace] = extractFrom(naturals, (c) => c.value == 'A');
		// natural2: un 2 dello stesso seme della scala → occupa il rango 2 come carta NATURALE
		// (non è una matta), ma la sua presenza consente un jolly aggiuntivo nella scala
		let [natural2] = extractFrom(layedOff, (c) => +c.value == 2 && c.suit == runSuit, 1);
		const wilds = extractFrom(layedOff, (c) => isWild(c));
		if (wilds.length > 1) {
			// Al massimo un jolly (joker o 2 di seme diverso)
			return null;
		}
		let wild = wilds[0] ?? null;

		// ── 4. COSTRUZIONE DELLA SCALA ───────────────────────────────────────────
		const run: DeckItems = DeckItems.fromArray([]);

		// Rango minimo tra tutte le naturali (escluso l'asso) come punto di partenza
		const allRanks = [...naturals, ...onTable.filter((c) => !isWild(c) && c.value != 'A')]
			.map((c) => getCardRank(c.value));
		let currentRank = Math.min(...allRanks);

		// Map rank→carta per ricerca O(1) durante il loop
		const naturalsMap = new Map<number, DeckItem>(naturals.map((c) => [getCardRank(c.value), c]));

		do {
			const natural = naturalsMap.get(currentRank);
			if (natural) {
				// Carta naturale calata: la inserisco nella scala
				naturalsMap.delete(currentRank);
				run.push(natural);
				currentRank++;
			} else if (onTable.length) {
				// Nessuna naturale calata: verifico se il blocco a terra si incastra qui
				const firstTableRank = getCardRank(onTable[0].value);
				const tableBlockFits = run.length
					? firstTableRank == currentRank       // la scala è già iniziata: il blocco deve connettersi
					: firstTableRank <= currentRank;      // la scala non è ancora iniziata: il blocco può precedere
				if (tableBlockFits) {
					run.push(...onTable);
					currentRank = firstTableRank + onTable.length;
					onTable.length = 0;
				} else {
					// Il blocco non si incastra: uso il wild per coprire il rango mancante
					if (wildAlreadyUsed || !(wild ?? natural2)) return null; // nessuna carta disponibile
					run.push(wild ?? natural2);
					if (wild) wild = null; else natural2 = null;
					wildAlreadyUsed = true;
					currentRank++;
				}
			} else {
				// Nessuna carta disponibile per il rango corrente: uso wild o natural2
				if (wildAlreadyUsed || !(wild ?? natural2)) {
					// Nessuna carta valida per la posizione corrente
					return null;
				}
				run.push(wild ?? natural2);
				if (wild) wild = null; else natural2 = null;
				wildAlreadyUsed = true;
				currentRank++;
			}
		} while (currentRank <= 13 && (naturalsMap.size || onTable.length));

		// ── 5. SISTEMAZIONE natural2 RESIDUO ────────────────────────────────────
		if (natural2) {
			if (wild) {
				// Ho sia natural2 che wild: posso coprire due posizioni consecutive prima del run
				if (+run[0].value == 3) {
					run.unshift(natural2); // [2=natural2, 3, ...]
				} else if (+run[0].value == 4) {
					run.unshift(wild); wild = null; // [3=wild, 4, ...]
					run.unshift(natural2);            // [2=natural2, 3=wild, 4, ...]
				} else {
					// Troppi jolly: impossibile sistemare natural2 e wild
					return null;
				}
			} else {
				if (wildAlreadyUsed && +run[0].value != 3 && !isWild(run[0])) {
					// Wild già occupato e non c'è posto per la natural2
					return null;
				}
				if (ace && last(run).value == 'Q' && +run[0].value != 3) {
					// Caso asso-alto con K mancante: il natural2 copre il K come se fosse wild
					wild = natural2;
				} else {
					run.unshift(natural2); // [2=natural2, ...]
				}
			}
			natural2 = null;
		}

		// ── 6. SISTEMAZIONE ASSO (basso o alto) ──────────────────────────────────
		if (ace) {
			if (last(run).value == 'K') {
				// Asso alto: ..., K, A
				run.push(ace);
			} else if (!wildAlreadyUsed && wild && last(run).value == 'Q') {
				// Asso alto con K coperto dal wild: ..., Q, wild(K), A
				run.push(wild); run.push(ace);
				wild = null; wildAlreadyUsed = true;
			} else if (+run[0].value == 2 && (+run[1].value == 3 || isWild(run[1]))) {
				// Asso basso: A, 2, 3, ...
				run.unshift(ace);
			} else if (wild && +run[0].value == 3) {
				// Asso basso con 2 coperto dal wild: A, wild(2), 3, ...
				run.unshift(wild); run.unshift(ace);
				wild = null; wildAlreadyUsed = true;
			} else {
				// L'asso non trova posto né in testa né in coda
				return null;
			}
			ace = null;
		}

		// ── 7. WILD RESIDUO ALL'ESTREMITÀ ────────────────────────────────────────
		if (wild) {
			if (run[0].value == 'A') {
				run.push(wild);    // Scala asso-basso: wild all'estremità alta
			} else {
				run.unshift(wild); // Wild all'estremità bassa
			}
		}

		// ── 8. CONTROLLO LUNGHEZZA FINALE ────────────────────────────────────────
		if (run.length < 3 || run.length > 14) {
			return null;
		}

		return run.reverse();
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

export function aceMayBeHigh(cards: DeckItems) {
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

export function getWildNaturalTag(cards: DeckItems): { tag: string; index: number } {
	const wildIndex = cards.findIndex(
		(current, i) => {
			if (i < 1 || i > cards.length - 2 || !isWild(current)) return false;

			const prev = cards[i - 1];
			const next = cards[i + 1];
			if (!prev || !next) return false;

			// Un incastro è sempre tra carte "leggibili": il joker non può fare da ancoraggio.
			if (prev.value == '*' || next.value == '*') return false;
			if (!prev.suit || prev.suit != next.suit) return false;

			const prevIndex = STARTER_DECK.findIndex((tag) => tag == prev.tag);
			if (prevIndex < 0) return false;
			const expectedTag = STARTER_DECK[prevIndex + 1];
			if (!expectedTag) return false;
			const expectedCard = new DeckItem(expectedTag);

			// Evita il salto di seme dopo K (Q♥ -> K♥ è valido, K♥ -> A♦ no).
			if (expectedCard.suit != prev.suit || expectedCard.value == '*') return false;

			// In A-2-3 il 2 di stesso seme è naturale, quindi non è un incastro da liberare.
			const naturalTwoInPlace =
				current.value == '2' &&
				current.suit == prev.suit &&
				prev.value == 'A' &&
				next?.value == '3' &&
				next.suit == prev.suit;
			if (naturalTwoInPlace) return false;

			// Supporta i casi standard (5-* -7) e asso alto (Q-* -A).
			if (expectedCard.value == 'K') {
				return next.value == 'A' && next.suit == expectedCard.suit;
			}
			return (
				next.suit == expectedCard.suit &&
				getCardRank(next.value) == getCardRank(expectedCard.value) + 1
			);
		},
	);
	if (wildIndex < 1 || wildIndex > cards.length - 2) return { tag: null, index: -1 };

	const prevCard = cards[wildIndex - 1];
	const starterDeckIndex = STARTER_DECK.findIndex((tag) => tag == prevCard.tag);
	if (starterDeckIndex < 0) return { tag: null, index: -1 };

	const expectedTag = STARTER_DECK[starterDeckIndex + 1];
	if (!expectedTag) return { tag: null, index: -1 };
	const expectedCard = new DeckItem(expectedTag);
	if (expectedCard.suit != prevCard.suit || expectedCard.value == '*') {
		return { tag: null, index: -1 };
	}

	return {
		tag: expectedTag,
		index: wildIndex,
	};
}
