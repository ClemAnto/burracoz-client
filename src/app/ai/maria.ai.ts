import { AiProfile, PhraseBank } from './ai-player';
import { DefaultAi } from './default.ai';

/** Maria: prudente e collaborativa. Gioca sul sicuro, ricorda bene, tono gentile. */
const MARIA_PROFILE: AiProfile = {
	risk: 0.25,
	pointGreed: 0.5,
	pileAppetite: 0.3,
	wildUsage: 0.3,
	discardCaution: 0.8,
	cooperation: 0.8,
	patience: 0.8,
	memory: 0.75,
	learning: 0.6,
	talkativeness: 0.5,
	meanness: 0.1,
	selfIrony: 0.6,
};

const MARIA_PHRASES: PhraseBank = {
	'partner:good': ['Benissimo, compagno! 😊', 'Perfetto, continuiamo così. 👏'],
	'partner:bad': ['Tranquillo, capita. 🤗', 'Nessun problema, rimediamo. 🙂'],
	'opponent:good': ['Brava/o davvero. 👏', 'Bel gioco. 😊'],
	'opponent:lucky': ['Che fortunello! 🍀', 'Beato te. 😄'],
	'self:good': ['Oh, bene così. 😌'],
	'self:bad': ['Che sbadata, scusate. 😅'],
	'banter:greeting': ['Buona partita a tutti! 😊'],
	'banter:rival': [
		'Con te faccio sempre fatica... 😅',
		'Vediamo se stavolta riesco a batterti. 🙂',
	],
};

export class MariaAi extends DefaultAi {
	constructor(rng?: () => number) {
		super({ id: 'maria', name: 'Maria', profile: MARIA_PROFILE, phrases: MARIA_PHRASES, rng });
	}
}
