# Burracoz — Roadmap verso il prodotto completo

> Angular 21 (standalone, signals) · ng-zorro + Tailwind 4 · client-only
> Stato documento: aggiornato al 2026-07-04 — **baseline consolidata**: suite 44/44 verde (riverificata), audit Playwright end-to-end OK. Fondamenta (entità carte, single-writer, Tweener v2, univocità 108 carte) considerate stabili: da qui si costruisce solo logica di gioco.

Gioco di Burraco (regole F.I.Bur. italiane). Architettura:
**Game** (facade multi-mano) → **Round** (logica di una mano) → **Rules** (validazione giochi).
La UI (**Board** + **Deck**) usa un layer di animazione FLIP custom (**Tweener**).

---

## 📊 Stato attuale (sintesi)

| Modulo                     | Stato       | Note                                                                                                                                                                                                                     |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Motore regole (`rules.ts`) | 🟢 maturo   | set/run/attach con matte, incastri, assi, 2 naturale, canasta pulita. Testato.                                                                                                                                           |
| Modello carte (`cards.ts`) | 🟢 maturo   | **entità `DeckItem`/`DeckItems` (dal refactoring)**, parsing, mazzo, rank, ordinamento. Modulo foglia.                                                                                                                   |
| Round (`round.ts`)         | 🟡 parziale | deal, turni, calate, pozzetto, chiusura + **punteggio (fatto)**. Unico scrittore dello stato carte (`faceDown` incluso). Mancano `takeDiscardPile`, `undoTurn`.                                                          |
| Game (`game.ts`)           | 🟡 parziale | multi-mano, storico, eventi. Mancano fine partita e persistenza attiva.                                                                                                                                                  |
| UI Board/Deck              | 🟡 parziale | tavolo 4 giocatori, overlay punteggio, autosort + drag&drop, **refactoring single-writer (fatto)**, **Tweener v2 WAAPI/`uiTweenScope` (fatto)**: FLIP su compositor, fix carte sparite, audit univocità. Styling da dev. |
| Avversari (AI)             | 🔴 assente  | nessun bot; oggi l'umano controlla tutti in modalità debug.                                                                                                                                                              |
| Multiplayer/backend        | 🔴 assente  | nessun server.                                                                                                                                                                                                           |
| Test                       | 🟡 parziale | 44 verdi: rules, invarianti round (108/uid), cards (parsing/entità), deck (riordino), tweener. Manca copertura scoring/chiusura; harness `tests.ts` da migrare.                                                          |

---

## ✅ Completato di recente

- **Tweener v2 + caccia al bug "carte sparite"** (2026-07-04): layer FLIP riscritto su Web Animations API come direttiva riusabile `uiTweenScope` (pairing per uid anche con rimozioni differite, retarget dei voli con soglia, `hold()/release()` nel drag, `whenIdle`, audit di univocità); trovata e rimossa la causa VERA delle carte sparite ai riordini — `animate.enter/leave` sui pivot del `@for` interpretava gli SPOSTAMENTI come rimozioni ed eliminava dal DOM elementi vivi; azioni di gioco per ISTANZA/uid (`CardRef`) perché il tag è ambiguo nel mazzo doppio (+ fix pozzetto mancante in `attachToMeld`); test d'invariante 108-carte-uniche in `round.spec.ts`; fluidità deal su compositor GPU (keyframe solo compositabili) verificata con Playwright (zero frame >20ms); log di fase `[burracoz]` e diagnostici `[tween]`.
- **Refactoring Deck/Card "single writer"** (2026-07-04, vedi MEMO.md): entità carta (`DeckItem`) spostata in `services/cards.ts` (il dominio non importa più dalla UI); pesca e scarto committano direttamente sul Game e il FLIP anima da solo i cross-deck (staging imperativo SOLO nel deal); ownership di `faceDown` al Round con override di prospettiva nel Deck (`renderFaceDown` — il toggle debug ora riflippa le mani reattivamente); API Deck snellita dal codice morto; `ui-card` riceve l'istanza già parsata. Verificato: 44 test verdi + audit Playwright end-to-end.
- **Ordinamento funzionale automatico** delle carte in mano (seme → rank) su tutti i giocatori (`autosort`).
- **Drag & drop** per riordinare la propria mano (`reorderable` sul deck South), integrato col Tweener FLIP; l'ordine manuale viene preservato tra pesca/scarto e resettato a nuova mano.
- **Calcolo del punteggio** reale in `Round.computeScore()`: valori carta (Jolly 30 / Pinella 20 / Asso 15 / K-Q-J-10 = 10 / 9-3 = 5), bonus burraco (pulito +200, semipulito +150, sporco +100), bonus chiusura +100, penalità carte in mano e pozzetto non preso (-100).

---

## 🗺️ Fasi

### Fase 1 — Completare la logica di una partita _(«il gioco funziona davvero»)_

Obiettivo: una mano completa, punteggiata correttamente, che porta a fine partita.

- [x] **Calcolo punteggio** in `closeRound()` (valori carta, bonus, penalità).
- [ ] **`takeDiscardPile()`**: raccolta del monte scarti + presa del pozzetto/regola ultima carta; animazione in `Board.willTakeDiscardPile()`.
- [ ] **Fine partita**: soglia punti configurabile (es. 2000/3000), `Game.endGame()`, evento `GameEnded`, schermata risultato finale.
- [ ] **Undo turno**: snapshot a inizio turno + ripristino (`undoTurn()`, `canUndoTurn`).
- [ ] **Chiusura — casi limite** (Art. 14): niente chiusura con scarto matta; caso «unico scarto è una matta».
- [ ] **Test** su `round.ts` (scoring, chiusura, pozzetto) e classificazione burraco.

### Fase 2 — Avversari (AI) _(«giocabile da soli»)_

- [ ] Servizio `AiPlayer` con strategia base: pesca, cerca calate/attacchi validi (riusa `Rules`), scarta la carta meno utile.
- [ ] Loop automatico dei turni non umani in `Game`/`Board` con delay leggibile.
- [ ] Disattivare `debug`/`playAsEveryone`; nascondere le mani avversarie.
- [ ] (Opz.) livelli di difficoltà.

### Fase 3 — UX e struttura app _(«sembra un prodotto»)_

- [ ] Menu iniziale (Nuova partita / Continua / Regole / Impostazioni) + routing.
- [ ] Riattivare la **persistenza** (rimuovere il `return;` in `Game.loadFromStorage()`, testare ripresa).
- [ ] Pulizia UI: rimuovere outline/`debug` di sviluppo, tema tavolo definitivo, feedback errori.
- [ ] Bottone «riordina» (reset ordinamento manuale → autosort).
- [ ] **Responsive/mobile** e accessibilità di base.

### Fase 4 — Qualità e affidabilità

- [ ] Suite di test completa (round, game, scoring, AI) + CI.
- [ ] Copertura edge case regolamento FIBUR (`docs/burraco_regole_ufficiali_fibur_2026.txt`).
- [ ] Migrare l'harness `services/tests.ts` in veri spec; rimuovere codice morto.

### Fase 5 — Espansione _(opzionale)_

- [ ] **Multiplayer online** (backend + WebSocket) — il salto più grande.
- [ ] Statistiche/profilo, varianti (2/3/4 giocatori), audio, PWA/deploy.

---

## 🎯 Prossimo passo consigliato

**`takeDiscardPile()`** (Fase 1): completa il core loop del turno ed è l'ultimo tassello per una mano giocabile end-to-end. Da implementare col pattern single-writer (commit diretto in `Round`, il Tweener anima; `faceDown` scritto dal Round — vedi MEMO.md), NON con staging imperativo nella Board. Subito dopo, la **fine partita** per chiudere il ciclo Game.

## 🐞 Debito tecnico noto

- **Baseline non committata**: tutto il lavoro di consolidamento (Tweener v2, single-writer, univocità, scoring, questi .md) è nel working tree; ultimo commit `a4c8ffe`. Committare come punto di ripartenza prima di iniziare Fase 1.
- Styling da sviluppo: outline colorati, `debug=true`, tratteggio amber sulle carte.
- `Game.loadFromStorage()` disabilitato (`return;` iniziale) ma l'effect salva comunque → salvataggio autodistrutto al reload.
- Copertura test: mancano scoring/chiusura/classifyBurraco; harness `services/tests.ts` (casi regole preziosi) da migrare in spec veri.
- `strictNullChecks:false` in tsconfig; CSS ~790KB per import completo del tema ng-zorro (usati solo button+tag).
