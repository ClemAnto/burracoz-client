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
		inputs: ['A♥️ 2♥️ 3♥️ 4♥️'],
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️',
	},
	{
		type: 'validateRun',
		inputs: ['K♥️ Q♥️ A♥️ J♥️'],
		outputs: 'J♥️ Q♥️ K♥️ A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['* A♥️ Q♥️'],
		outputs: 'Q♥️ * A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['* 2♥️ A♥️ Q♥️'],
		outputs: null,
	},
	{
		type: 'validateRun',
		inputs: ['2♥️ A♥️ Q♥️'],
		outputs: 'Q♥️ 2♥️ A♥️',
	},
	{
		type: 'validateRun',
		inputs: ['7♥️ A♥️ 2♥️ 3♥️ * 5♥️ 6♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️'],
		outputs: null
	},
	{
		type: 'validateRun',
		inputs: ['7♥️ A♥️ 2♥️ 3♥️ 4♥️ * 5♥️ 6♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️'],
		outputs: '2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ * A♥️',
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
		outputs: 'A♥️ 2♥️ 3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️'
	},
	{
		type: 'validateRun',
		inputs: ['7♥️ A♥️ 2♠️ 3♥️ 4♥️ 5♥️ 6♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️'],
		outputs: '3♥️ 4♥️ 5♥️ 6♥️ 7♥️ 8♥️ 9♥️ 10♥️ J♥️ Q♥️ 2♠️ A♥️'
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
];

@Injectable({
	providedIn: 'root',
})
export class Tests {
	constructor(private rules: Rules) {}

	run() {
		console.groupCollapsed("[TESTS] VALIDATIONS");
		TEST.forEach((test) => {
			const fn = this.rules[test.type] as (...args: unknown[]) => unknown;
			const result = fn.call(this.rules, ...test.inputs);
			const output = result instanceof DeckItems ? result.toString() : (result as string | null);
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
