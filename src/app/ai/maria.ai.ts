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
	opportunism: 0.2, // compassionevole: non infierisce
	patience: 0.8,
	attention: 0.85,
	learning: 0.6,
	experience: 0.8,
	talkativeness: 0.5,
	meanness: 0.1,
	selfIrony: 0.6,
	luckAttribution: 0.7, // modesta: attribuisce volentieri alla fortuna
};

const MARIA_PHRASES: PhraseBank = {
	'partner:good': ['Benissimo, compagno! 😊', 'Perfetto, continuiamo così. 👏'],
	'partner:bad': ['Tranquillo, capita. 🤗', 'Nessun problema, rimediamo. 🙂'],
	'opponent:good': ['Brava/o davvero. 👏', 'Bel gioco. 😊'],
	'opponent:lucky': ['Che fortunello! 🍀', 'Beato te. 😄'],
	'self:good': ['Oh, bene così. 😌'],
	'self:lucky': ['Che fortunella che sono stata! 😅', 'Mi è andata bene, eh. 🍀'],
	'self:bad': ['Che sbadata, scusate. 😅'],
	encourage: ['Dai, rimonti! 😊', 'Coraggio, capita a tutti. 🤗'],
	'banter:greeting': ['Buona partita a tutti! 😊'],
	'banter:rival': [
		'Con te faccio sempre fatica... 😅',
		'Vediamo se stavolta riesco a batterti. 🙂',
	],
	'standing:behind': ['Dai, recuperiamo con calma. 🙂', 'Non molliamo, si rimonta. 💪'],
	'standing:ahead': ['Bella partita comunque. 😊'],
};

export class MariaAi extends DefaultAi {
	constructor(rng?: () => number) {
		super({ id: 'maria', name: 'Maria', profile: MARIA_PROFILE, phrases: MARIA_PHRASES, rng });
	}
}
