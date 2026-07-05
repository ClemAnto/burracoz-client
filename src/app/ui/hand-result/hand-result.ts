import { Component, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { RoundScore, RoundTeam } from '../../services/round';

/**
 * Overlay di fine mano: esito (mano chiusa / partita finita), punteggio della
 * mano con breakdown, cumulato di partita e azione per proseguire.
 * Componente presentazionale: riceve i dati via input ed emette gli eventi.
 */
@Component({
	selector: 'ui-hand-result',
	imports: [NzButtonModule],
	templateUrl: './hand-result.html',
})
export class HandResult {
	/** true = partita finita ("NUOVA PARTITA"); false = solo mano chiusa ("NUOVA MANO"). */
	gameEnded = input<boolean>(false);
	/** Squadra vincitrice della partita (messaggio di fine partita). */
	gameWinner = input<RoundTeam | null>(null);
	/** La mano si è chiusa per FINE TALLONE (nessuna chiusura reale, niente +100). */
	byStockExhaustion = input<boolean>(false);
	/** Etichetta del giocatore che ha chiuso la mano. */
	winnerLabel = input<string>('');
	/** Punteggio della mano (breakdown per squadra). */
	score = input<RoundScore | null>(null);
	/** Punteggio cumulato di partita. */
	totalScore = input<{ ours: number; opponents: number }>({ ours: 0, opponents: 0 });

	/** Avvia una nuova partita. */
	newGame = output<void>();
	/** Avvia la mano successiva. */
	nextHand = output<void>();
}
