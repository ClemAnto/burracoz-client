import { Injectable } from '@angular/core';
import { Rules } from './rules';
import { DeckItems } from '../ui/deck/deck';

type TestType = 'validateRun' | 'validateSet' | 'validateMeld';

type TestCase = {
	type: TestType;
	inputs: unknown[];
	outputs: string | null;
};

const TEST: TestCase[] = [
	{
		type: 'validateRun',
		inputs: ['3♠️ 6♠️', 'A♠️ 2♠️ 2♠️ 4♠️'],
		outputs: 'A♠️ 2♠️ 3♠️ 4♠️ 2♠️ 6♠️',
	},

	{
		type: 'validateRun',
		inputs: ['6♥️', '5♥️ * 7♥️'],
		outputs: '* 5♥️ 6♥️ 7♥️',
	},
	{
		type: 'validateRun',
		inputs: ['2♠️', '5♥️ * 7♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['*', '5♥️ * 7♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♠️', 'Q♥️ 2♥️ A♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['*', 'Q♥️ 2♥️ A♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♥️', 'A♥️ * 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ *',
	},
	{
		type: 'validateRun',
		inputs: ['*', 'A♥️ * 3♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♠️', 'A♥️ * 3♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♥️', 'A♥️ 2♠️ 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 2♠️',
	},
	{
		type: 'validateRun',
		inputs: ['*', 'A♥️ 2♠️ 3♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♦️', 'A♥️ 2♠️ 3♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['J♥️ Q♥️', 'A♥️ 2♥️ *'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['J♥️ K♥️', 'A♥️ 2♥️ *'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['Q♥️ K♥️', 'A♥️ 2♥️ *'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['10♥️ J♥️ Q♥️', 'A♥️ 2♥️ *'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['J♥️ Q♥️', 'A♥️ 2♥️ 2♠️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['A♥️', '* 2♥️ 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ *',
	},
	{
		type: 'validateRun',
		inputs: ['A♥️ 4♥️', '* 2♥️ 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ *',
	},
	{
		type: 'validateRun',
		inputs: ['A♠️', '* 2♠️ 3♠️'],
		outputs: 'A♠️ 2♠️ 3♠️ *',
	},
	{
		type: 'validateRun',
		inputs: ['A♦️', '* 2♦️ 3♦️'],
		outputs: 'A♦️ 2♦️ 3♦️ *',
	},
	{
		type: 'validateRun',
		inputs: ['A♣️', '* 2♣️ 3♣️'],
		outputs: 'A♣️ 2♣️ 3♣️ *',
	},
	{
		type: 'validateRun',
		inputs: ['*🔴', '*⚫ 2♠️ 3♠️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♥️', 'A♥️ 2♥️ 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 2♥️',
	},
	{
		type: 'validateRun',
		inputs: ['A♥️', '2♥️ 2♥️ 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 2♥️',
	},
	{
		type: 'validateRun',
		inputs: ['A♥️ 4♥️', '2♥️ 2♥️ 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ 2♥️',
	},
	{
		type: 'validateRun',
		inputs: ['A♦️', '2♦️ 2♦️ 3♦️'],
		outputs: 'A♦️ 2♦️ 3♦️ 2♦️',
	},
	{
		type: 'validateRun',
		inputs: ['A♣️', '2♣️ 2♣️ 3♣️'],
		outputs: 'A♣️ 2♣️ 3♣️ 2♣️',
	},
	{
		type: 'validateRun',
		inputs: ['A♥️', '2♥️ 2♥️ 3♥️ 4♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ 2♥️',
	},
	{
		type: 'validateRun',
		inputs: ['A♥️ 5♥️', '2♥️ 2♥️ 3♥️ 4♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 2♥️',
	},
	{
		type: 'validateRun',
		inputs: ['A♥️ 2♥️ 3♥️ 4♥️', '5♥️ * 7♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ 5♥️ * 7♥️',
	},
	{
		type: 'validateRun',
		inputs: ['2♥️ 3♥️ 4♥️', '5♥️ * 7♥️'],
		outputs: '2♥️ 3♥️ 4♥️ 5♥️ * 7♥️',
	},
	{
		type: 'validateRun',
		inputs: ['A♥️ 2♥️ 3♥️ 4♥️', '5♥️ 2♠️ 7♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 2♠️ 7♥️',
	},
	{
		type: 'validateRun',
		inputs: ['2♠️', '2♥️ 3♥️ 4♥️ *'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['*', '2♥️ 3♥️ 4♥️ *'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♠️', 'A♥️ 2♥️ 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 2♠️',
	},
	{
		type: 'validateRun',
		inputs: ['*', 'A♥️ 2♥️ 3♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ *',
	},

	{
		type: 'validateRun',
		inputs: ['J♥️', 'Q♥️ 2♥️ A♥️'],
		outputs: 'J♥️ Q♥️ 2♥️ A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['K♥️', 'Q♥️ 2♥️ A♥️'],
		outputs: '2♥️ Q♥️ K♥️ A♥️',
	},

	{
		type: 'validateRun',
		inputs: ['A♥️ 2♥️ 4♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['A♥️ 2♠️ 3♥️ 4♥️'],
		outputs: 'A♥️ 2♠️ 3♥️ 4♥️',
	},

	{
		type: 'validateRun',
		inputs: ['2♥️ * A♥️'],
		outputs: 'A♥️ 2♥️ *',
	},

	{
		type: 'validateRun',
		inputs: ['3♥️ 4♥️'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['A♥️ 2♥️ 3♠️ 4♥️'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['A♥️ 2♥️ 3♥️ 4♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️',
	},

	{
		type: 'validateRun',
		inputs: ['A♥️ 2♥️ 9♥️ 10♥️ J♥️'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['2♥️ A♥️ Q♥️'],
		outputs: 'Q♥️ 2♥️ A♥️',
	},

	{
		type: 'validateRun',
		inputs: ['* A♥️ Q♥️'],
		outputs: 'Q♥️ * A♥️',
	},

	{
		type: 'validateRun',
		inputs: ['* A♥️ K♥️'],
		outputs: '* K♥️ A♥️',
	},

	{
		type: 'validateRun',
		inputs: ['3♠️ 7♠️ 2♥️', '* 4♠️ 5♠️'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['3♠️ 7♠️ 2♠️', '* 4♠️ 5♠️'],
		outputs: '2♠️ 3♠️ 4♠️ 5♠️ * 7♠️',
	},

	{
		type: 'validateRun',
		inputs: ['5♠️', '* 7♠️ 8♠️'],
		outputs: '5♠️ * 7♠️ 8♠️',
	},

	{
		type: 'validateRun',
		inputs: ['2♠️', '* 4♠️ 5♠️'],
		outputs: '2♠️ * 4♠️ 5♠️',
	},

	{
		type: 'validateRun',
		inputs: ['7♠️', '* 4♠️ 5♠️'],
		outputs: '4♠️ 5♠️ * 7♠️',
	},

	{
		type: 'validateRun',
		inputs: ['3♠️ 6♥️', 'A♠️ 2♠️ 2♠️ 4♠️'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['8♠️ 5♠️ 10♠️', '7♠️ * 9♠️'],
		outputs: '5♠️ * 7♠️ 8♠️ 9♠️ 10♠️',
	},

	{
		type: 'validateRun',
		inputs: ['6♠️ 5♠️ 10♠️ 2♥️', '7♠️ 8♠️ 9♠️'],
		outputs: '2♥️ 5♠️ 6♠️ 7♠️ 8♠️ 9♠️ 10♠️',
	},

	{
		type: 'validateRun',
		inputs: ['10♠️ ', '2♥️ 7♠️ 8♠️'],
		outputs: '7♠️ 8♠️ 2♥️ 10♠️',
	},

	{
		type: 'validateRun',
		inputs: ['* 6♥️', 'A♥️ 2♥️ 2♥️ 4♥️'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['* 6♥️', 'A♥️ 2♥️ 3♥️ 4♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ * 6♥️',
	},

	{
		type: 'validateRun',
		inputs: ['3♥️ 7♥️', 'A♥️ 2♥️ * 4♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['8♥️', '5♥️ * 7♥️'],
		outputs: '5♥️ * 7♥️ 8♥️',
	},
	{
		type: 'validateRun',
		inputs: ['4♥️', '5♥️ * 7♥️'],
		outputs: '4♥️ 5♥️ * 7♥️',
	},
	{
		type: 'validateRun',
		inputs: ['', 'A♥️ 2♥️ 3♥️'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['K♥️ Q♥️ A♥️ J♥️'],
		outputs: 'J♥️ Q♥️ K♥️ A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['K♥️ A♥️ 2♥️'],
		outputs: '2♥️ K♥️ A♥️',
	},

	{
		type: 'validateRun',
		inputs: ['* 2♥️ A♥️ Q♥️'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['7♥️ A♥️ 2♥️ 3♥️ * 5♥️ 6♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ * 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️',
	},
	{
		type: 'validateRun',
		inputs: ['7♥️ A♥️ 2♥️ 3♥️ 4♥️ * 5♥️ 6♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️'],
		outputs: '2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ * A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['7♥️ A♥️ 2♥️ 3♥️ 4♥️ * 5♥️ 6♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ 4♥️'],
		outputs: null,
	},
	{
		type: 'validateSet',
		inputs: ['7♥️ 7♥️ 7♠️'],
		outputs: '7♠️ 7♥️ 7♥️',
	},
	{
		type: 'validateSet',
		inputs: ['7♥️ 7♥️ 7♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️ A♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['7♥️ A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️',
	},
	{
		type: 'validateRun',
		inputs: ['7♥️ A♥️ 2♠️ 3♥️ 4♥️ 5♥️ 6♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️'],
		outputs: '3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ 2♠️ A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['7♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ A♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️ *🔴'],
		outputs: '*🔴 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️ A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['3♥️ 4♥️ 8♥️ 9♥️ 10♥️ J♥️ 5♥️ 6♥️ 7♥️ A♥️ 2♠️ Q♥️ K♥️ *'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♥️ 3♥️ 4♥️ 5♥️ 6♥️ A♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️ 7♥️'],
		outputs: '2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️ A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['2♠️ 4♥️ A♥️ 2♥️'],
		outputs: 'A♥️ 2♥️ 2♠️ 4♥️',
	},

	{
		type: 'validateRun',
		inputs: ['2♠️ 4♥️ A♥️ *'],
		outputs: null,
	},

	{
		type: 'validateRun',
		inputs: ['A♠️ A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ K♥️'],
		outputs: null,
	},
];

@Injectable({
	providedIn: 'root',
})
export class Tests {
	constructor(private rules: Rules) {}

	run() {
		console.groupCollapsed('[TESTS] VALIDATIONS');

		TEST.forEach((test) => {
			const fn = this.rules[test.type] as (...args: unknown[]) => unknown;
			const result = fn.call(this.rules, ...test.inputs);
			const output =
				result instanceof DeckItems ? result.toString() : (result as string | null);
			const isValid = output === test.outputs;
			if (!isValid) {
				console.log(
					`[TESTS] ${test.type} \n input:\t\t${JSON.stringify(test.inputs)} \n output:\t ${JSON.stringify(output)} \n expected:\t ${JSON.stringify(test.outputs)} | risultato: ${isValid ? 'VALIDO' : 'NON VALIDO'}\n`,
				);
			}
		});
		console.groupEnd();
	}
}
