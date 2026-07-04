import { AiProfile, PhraseBank } from './ai-player';
import { DefaultAi } from './default.ai';

/** Sergio: aggressivo e provocatore. Rischia, prende il monte, sfotte volentieri. */
const SERGIO_PROFILE: AiProfile = {
	risk: 0.8,
	pointGreed: 0.7,
	pileAppetite: 0.7,
	wildUsage: 0.7,
	discardCaution: 0.3,
	cooperation: 0.5,
	patience: 0.3,
	memory: 0.5,
	learning: 0.5,
	talkativeness: 0.85,
	meanness: 0.8,
	selfIrony: 0.3,
};

const SERGIO_PHRASES: PhraseBank = {
	'partner:good': ['Ecco, bravo!', 'Così si ragiona, compagno!'],
	'partner:bad': ['Ma che combini?!', 'Dai su, svegliati.'],
	'opponent:good': ['Mah, fortuna.', 'Non durerà.'],
	'opponent:bad': ['Eh eh, continua così.', 'Grazie del regalo!'],
	'opponent:lucky': ['Ma che culo!', 'Sei nato con la camicia, eh.'],
	'self:good': ['Troppo facile.', 'Guardate e imparate.'],
	'self:bad': ['Vabbè, ci sta.'],
	'banter:greeting': ['Si gioca! Preparatevi a perdere.'],
	'banter:rival': ['Di nuovo tu? Stavolta ti asfalto.', 'Pronto a perdere anche oggi?'],
};

export class SergioAi extends DefaultAi {
	constructor(rng?: () => number) {
		super({
			id: 'sergio',
			name: 'Sergio',
			profile: SERGIO_PROFILE,
			phrases: SERGIO_PHRASES,
			rng,
		});
	}
}
