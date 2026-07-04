import { AiPlayer, AiProfile } from './ai-player';
import { DefaultAi } from './default.ai';
import { MariaAi } from './maria.ai';
import { SergioAi } from './sergio.ai';

/** Crea una nuova istanza di IA data la sua personalità (rng opzionale per i test). */
export type PersonalityFactory = (rng?: () => number) => AiPlayer;

/** Profilo bilanciato: tutti gli assi a metà. */
const BALANCED_PROFILE: AiProfile = {
	risk: 0.5,
	pointGreed: 0.5,
	pileAppetite: 0.5,
	wildUsage: 0.5,
	discardCaution: 0.5,
	cooperation: 0.5,
	patience: 0.5,
	memory: 0.5,
	learning: 0.5,
	talkativeness: 0.5,
	meanness: 0.3,
	selfIrony: 0.5,
};

/**
 * Registro delle personalità disponibili: id → factory. Le IA "specializzate"
 * (sergio, maria) estendono `DefaultAi`; "bot" è la base bilanciata.
 */
export const AI_PERSONALITIES: Record<string, PersonalityFactory> = {
	sergio: (rng) => new SergioAi(rng),
	maria: (rng) => new MariaAi(rng),
	bot: (rng) => new DefaultAi({ id: 'bot', name: 'Bot', profile: BALANCED_PROFILE, rng }),
};

/** Crea un'IA dal suo id di personalità (fallback: bot bilanciato). */
export function createAi(id: string, rng?: () => number): AiPlayer {
	return (AI_PERSONALITIES[id] ?? AI_PERSONALITIES['bot'])(rng);
}
