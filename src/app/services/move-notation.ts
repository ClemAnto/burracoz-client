import {
	PlayerSide,
	RoundEventType,
	RoundGameplayEvent,
	RoundPhase,
	RoundPlayer,
	RoundSavedState,
	RoundTurnStep,
} from './round';

// ============================================================
// NOTAZIONE TESTUALE DELLE MOSSE (formato Burracoz, leggibile)
// ------------------------------------------------------------
// Non esiste uno standard per il Burraco: adottiamo i principi di
// PGN/PBN/PHH (header a tag-pair + sezione mosse), ma con testo in
// ITALIANO discorsivo, leggibile anche da non tecnici e comunque
// ri-parsabile. L'header contiene il DEAL iniziale completo → la
// partita è riproducibile ricostruendo l'inizio mano e rigiocando.
//
// Esempio:
//   [Evento "Burracoz"]
//   [Mazziere "Ovest"]
//   [Inizia "Nord"]
//   [ManoNord "A♥️ 7♦️ ..."]  (+ ManoEst/Sud/Ovest, Pozzetto1/2, Tallone, Scarto)
//
//   1. Nord pesca dal tallone · cala 7♥️ 7♦️ 7♠️ · scarta K♥️
//   2. Est raccoglie il monte · appoggia 8♠️ al gioco 1 · scarta 3♦️
//   3. Sud pesca dal tallone · scarta 2♣️
//
// Presa del pozzetto e chiusura sono conseguenze automatiche in replay.
// ============================================================

/** Una mossa decodificata, pronta per il replay tramite il Game. */
export type ReplayMove =
	| { player: RoundPlayer; type: 'draw' | 'take_discard' }
	| { player: RoundPlayer; type: 'open' | 'discard'; cards: string[] }
	| { player: RoundPlayer; type: 'attach'; meldIndex: number; cards: string[] };

export interface MoveNotationMeta {
	event?: string;
	date?: string;
	seats?: string;
}

export interface DecodedMoveList {
	meta: MoveNotationMeta;
	setup: RoundSavedState;
	moves: ReplayMove[];
}

const NAME: Record<RoundPlayer, string> = {
	[PlayerSide.North]: 'Nord',
	[PlayerSide.East]: 'Est',
	[PlayerSide.South]: 'Sud',
	[PlayerSide.West]: 'Ovest',
};
const BY_NAME: Record<string, RoundPlayer> = {
	Nord: PlayerSide.North,
	Est: PlayerSide.East,
	Sud: PlayerSide.South,
	Ovest: PlayerSide.West,
};

const SEP = ' · ';

// ── Encode ───────────────────────────────────────────────────

/** Serializza deal iniziale + mosse in notazione testuale leggibile. */
export function encodeMoveList(
	setup: RoundSavedState,
	events: RoundGameplayEvent[],
	meta: MoveNotationMeta = {},
): string {
	const tagStr = (cards: { tag: string }[]) => cards.map((c) => c.tag).join(' ');
	const lines: string[] = ['[Evento "' + (meta.event ?? 'Burracoz') + '"]', '[Versione "1"]'];
	if (meta.date) lines.push('[Data "' + meta.date + '"]');
	if (meta.seats) lines.push('[Posti "' + meta.seats + '"]');
	lines.push('[Mazziere "' + (setup.dealer ? NAME[setup.dealer] : '?') + '"]');
	lines.push('[Inizia "' + (setup.currentPlayer ? NAME[setup.currentPlayer] : 'Nord') + '"]');
	lines.push('[ManoNord "' + tagStr(setup.hands.north) + '"]');
	lines.push('[ManoEst "' + tagStr(setup.hands.east) + '"]');
	lines.push('[ManoSud "' + tagStr(setup.hands.south) + '"]');
	lines.push('[ManoOvest "' + tagStr(setup.hands.west) + '"]');
	lines.push('[Pozzetto1 "' + tagStr(setup.pots[0] ?? []) + '"]');
	lines.push('[Pozzetto2 "' + tagStr(setup.pots[1] ?? []) + '"]');
	lines.push('[Tallone "' + tagStr(setup.drawPile) + '"]');
	lines.push('[Scarto "' + tagStr(setup.discardPile) + '"]');
	lines.push('');
	lines.push(...encodeMoves(events));
	return lines.join('\n');
}

/** Raggruppa gli eventi in righe-turno leggibili (pesca → giochi → scarto). */
function encodeMoves(events: RoundGameplayEvent[]): string[] {
	const lines: string[] = [];
	const tags = (cards?: { tag: string }[]) => (cards ?? []).map((c) => c.tag).join(' ');
	let turn = 0;
	let parts: string[] | null = null;
	let prefix = '';
	const flush = () => {
		if (parts) lines.push(prefix + parts.join(SEP));
		parts = null;
	};
	for (const event of events) {
		switch (event.type) {
			case RoundEventType.Draw:
			case RoundEventType.TakeDiscard:
				flush();
				turn++;
				prefix = turn + '. ';
				parts = [
					NAME[event.player] +
						(event.type === RoundEventType.Draw
							? ' pesca dal tallone'
							: ' raccoglie il monte'),
				];
				break;
			case RoundEventType.Open:
				parts?.push('cala ' + tags(event.cards));
				break;
			case RoundEventType.Attach:
				parts?.push(
					'appoggia ' + tags(event.cards) + ' al gioco ' + ((event.meldIndex ?? 0) + 1),
				);
				break;
			case RoundEventType.Discard:
				parts?.push('scarta ' + tags(event.cards));
				flush();
				break;
			// Presa pozzetto / chiusura: automatiche, non annotate.
		}
	}
	flush();
	return lines;
}

// ── Decode ───────────────────────────────────────────────────

/** Analizza la notazione testuale in { meta, setup, moves }. */
export function decodeMoveList(text: string): DecodedMoveList {
	const tags: Record<string, string> = {};
	const moveLines: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const match = line.match(/^\[(\w+)\s+"([\s\S]*)"\]$/);
		if (match) tags[match[1]] = match[2];
		else moveLines.push(line);
	}

	return {
		meta: { event: tags['Evento'], date: tags['Data'], seats: tags['Posti'] },
		setup: buildSetup(tags),
		moves: decodeMoves(moveLines),
	};
}

/** Ricostruisce lo stato di inizio mano dai tag dell'header. */
function buildSetup(tags: Record<string, string>): RoundSavedState {
	const zone = (key: string, faceDown: boolean) =>
		(tags[key] ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.map((tag) => ({ tag, faceDown }));

	const dealer = BY_NAME[tags['Mazziere']] ?? null;
	const first = BY_NAME[tags['Inizia']] ?? PlayerSide.North;

	return {
		phase: RoundPhase.InProgress,
		dealer,
		currentPlayer: first,
		turnStep: RoundTurnStep.DrawOrCollect,
		turnIndex: 1,
		initialized: true,
		hands: {
			north: zone('ManoNord', true),
			east: zone('ManoEst', true),
			south: zone('ManoSud', true),
			west: zone('ManoOvest', true),
		},
		drawPile: zone('Tallone', true),
		discardPile: zone('Scarto', false),
		pots: [zone('Pozzetto1', true), zone('Pozzetto2', true)],
		melds: { ours: [], opponents: [] },
		winnerPlayer: null,
		winnerTeam: null,
		score: null,
		playerHasTakenPot: {
			[PlayerSide.North]: false,
			[PlayerSide.East]: false,
			[PlayerSide.South]: false,
			[PlayerSide.West]: false,
		},
	};
}

function decodeMoves(lines: string[]): ReplayMove[] {
	const moves: ReplayMove[] = [];
	for (const line of lines) {
		const body = line.replace(/^\s*\d+\.\s*/, '');
		const segments = body
			.split(SEP.trim())
			.map((s) => s.trim())
			.filter(Boolean);
		if (!segments.length) continue;

		// Prima parte: "<Nome> pesca dal tallone" | "<Nome> raccoglie il monte".
		const first = segments[0];
		const name = first.split(/\s+/)[0];
		const player = BY_NAME[name];
		if (!player) continue;
		moves.push({ player, type: /raccogli/i.test(first) ? 'take_discard' : 'draw' });

		for (const segment of segments.slice(1)) {
			const tokens = segment.split(/\s+/);
			const verb = tokens[0].toLowerCase();
			if (verb === 'cala') {
				moves.push({ player, type: 'open', cards: tokens.slice(1) });
			} else if (verb === 'scarta') {
				moves.push({ player, type: 'discard', cards: tokens.slice(1) });
			} else if (verb === 'appoggia') {
				// "appoggia <carte> al gioco <n>"
				const alIndex = tokens.findIndex((t) => t.toLowerCase() === 'al');
				const cards = tokens.slice(1, alIndex >= 0 ? alIndex : undefined);
				const meldNo = parseInt(tokens[tokens.length - 1], 10) || 1;
				moves.push({ player, type: 'attach', meldIndex: meldNo - 1, cards });
			}
		}
	}
	return moves;
}

/** Raggruppa le mosse per turno (ciascun turno inizia con una pesca/raccolta). */
export function splitTurns(moves: ReplayMove[]): ReplayMove[][] {
	const turns: ReplayMove[][] = [];
	for (const move of moves) {
		if (move.type === 'draw' || move.type === 'take_discard') turns.push([move]);
		else if (turns.length) turns[turns.length - 1].push(move);
	}
	return turns;
}

/** Riassunto leggibile di un turno (per l'indicatore del player). */
export function describeTurn(turnMoves: ReplayMove[]): string {
	if (!turnMoves.length) return '';
	const player = NAME[turnMoves[0].player];
	const parts = turnMoves.map((m) => {
		switch (m.type) {
			case 'draw':
				return 'pesca';
			case 'take_discard':
				return 'raccoglie il monte';
			case 'open':
				return 'cala ' + m.cards.join(' ');
			case 'attach':
				return 'appoggia ' + m.cards.join(' ') + ' al gioco ' + (m.meldIndex + 1);
			case 'discard':
				return 'scarta ' + m.cards.join(' ');
		}
	});
	return player + ': ' + parts.join(', ');
}
