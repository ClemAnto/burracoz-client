# Burracoz — Roadmap verso il prodotto completo

> Angular 21 (standalone, signals) · ng-zorro + Tailwind 4 · client-only
> Stato documento: aggiornato al 2026-07-05 (4ª sessione). **Giocabile davvero da un umano** (default "gioco vero": SUD umano+scoperto, EST/NORD/OVEST IA+coperti) tramite la **modale Impostazioni** (per-posto IA/carte scoperte + velocità). **4ª sessione: revisione della strategia IA** (scale>tris, attesa burrachi puliti, stance chiusura, riserva scarti, assi `experience`/`attention`, gioco di squadra `cooperation`, difesa dalla chiusura avversaria, scale asso-alto, modello base mani avversarie) + **copertura test IA** (`default.ai.spec.ts`) — non ancora committata. Suite 93/93 verde.

Gioco di Burraco (regole F.I.Bur. italiane). Architettura:
**Game** (facade multi-mano) → **Round** (logica di una mano) → **Rules** (validazione giochi).
UI: **Board** → **Deck** → **Card** con FLIP custom (**Tweener**).
**IA** in `src/app/ai/` (contratto puro stato→decisioni). Sito live: https://clemanto.github.io/burracoz-client/

---

## 📊 Stato attuale (sintesi)

| Modulo                     | Stato       | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motore regole (`rules.ts`) | 🟢 maturo   | set/run/attach con matte, incastri, assi, 2 naturale, canasta pulita. **`getCardAbsPos` order-independent** (fix estensione scala con matta-incastro). **Audit vs regolamento ufficiale** (`rules-audit.spec.ts`): conforme.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Modello carte (`cards.ts`) | 🟢 maturo   | entità `DeckItem`/`DeckItems`, parsing, mazzo, rank, ordinamento. Modulo foglia.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Round (`round.ts`)         | 🟢 maturo   | deal, turni, calate, pozzetto, chiusura, punteggio, **takeDiscardPile**, **Art.14 (no chiusura con matta)**, **eventi di gioco fini** (`gameplayEvents`). **Undo** ora gestito dalla Board via snapshot `getState`/`restoreState`. Manca fine-tallone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Game (`game.ts`)           | 🟢 maturo   | multi-mano, storico, eventi, **fine partita** (soglia 2005 + `GameEnded`), **persistenza F5 attiva** (`suspendHistory` durante replay).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| IA (`ai/`)                 | 🟡 media    | contratto+`DefaultAi`+personalità (sergio/maria)+registro; conduttore in Board (0..4 posti, velocità, manuale/AVANTI), memoria episodica+lungo termine, voce+emoji. **Strategia** con stance chiusura (rush/accumulate), attesa di scale/burrachi puliti, evita giochi bloccati, preferisce scale ai tris, riserva di scarto sicuro, **gioco di squadra** (`cooperation`: apre di più, ruoli pozzetto, non chiude sul compagno pieno) e **difesa dalla chiusura avversaria** (vede i conteggi mano pubblici: sgombra mano, sporca i burraco, scarto difensivo). Genera anche **scale con asso alto**; **modello base del contenuto mani avversarie** (dai loro scarti). Assi **`experience`** (neofita→pro) e **`attention`** (ex `memory`: card-counting + se valutare mano/tavolo). Copertura test in `default.ai.spec.ts`. |
| UI Board/Deck              | 🟢 buona    | **layout centrale a 3 righe** (LORO / pesca-scarti-pozzetti / NOI), pozzetti sovrapposti concentrici (prospettiva condivisa `.pot-3d`), **etichette posti uniformi in alto-a-sx** (`.seat`), **modale Impostazioni**, **colonna mosse in `nz-drawer`**, **undo/scarto-via-click/PESCA-PRENDI**, **drag&drop riordino mano** + inserimento intelligente carte nuove, overlay fine-mano estratto in `ui-hand-result`. **Icone `<nz-icon>`** (no emoji). Mani coperte per-posto (default).                                                                                                                                                                                                                                                                                                                                       |
| Notazione/replay           | 🟢 fatto    | `move-notation.ts` (formato testo leggibile IT) + player mosse (avanti/indietro) nel pannello debug.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Pubblicazione              | 🟢 fatto    | repo PUBBLICA, GitHub Pages via Actions (`deploy.yml`), CI (`ci.yml`: format+build+test).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Avversari — strategia      | 🟡 media    | ragionamento sulla calata (scale > tris, attesa combinazioni/burrachi puliti, giochi non bloccati, chiudi-subito vs più-punti, riserva scarti, **scale asso-alto**), gioco di squadra (`cooperation`), difesa dalla chiusura avversaria e **modello base delle mani altrui** (dai loro scarti), guidati da `experience`/`attention`. Manca: modello mani più fine, uso di `cooperation` negli appoggi.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Multiplayer/backend        | 🔴 assente  | nessun server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Test                       | 🟢 93 verdi | rules (+ `rules-audit.spec.ts` conformità regolamento), round, cards, deck, tweener, game, move-notation, board/stage (smoke), **IA (`default.ai.spec.ts`, `rng` iniettato: pesca/calata/stance/cooperazione/difesa/attenzione/asso-alto/modello-mani)**. Resta l'harness `tests.ts` da migrare.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

## ✅ Completato nella 4ª sessione (2026-07-05)

**Revisione della strategia IA** (tutto in `default.ai.ts`, IA sempre pura sullo stato: ragionamento su cosa/quando calare, gioco di squadra, difesa dalla chiusura avversaria):

- **Preferenza scale sui tris** (i tris bloccano): `pickNonOverlapping` ordina scale prima dei set, poi per lunghezza.
- **Attesa di combinazioni migliori** (`shouldHoldMeld`): trattiene in mano scale corte con completatori ancora vivi per allungarle verso il burraco, tanto più volentieri se il burraco sarà **pulito** (nessuna matta, proxy `runUsesWild`) o **vicino** (≥6). Guardie: un burraco (≥7) si cala sempre; con tallone ≤`LOW_STOCK` si concreta; in `rush` non si trattiene.
- **Evita giochi bloccati** (`liveExtensionCount`/`completerTags`): stima i completatori ancora vivi (naturali adiacenti per le scale, altre copie per i set) secondo la memoria; se sono morti, non aspetta.
- **Stance chiusura** (`closingStance`): se non si può chiudere → `accumulate`; le IA **esperte** leggono il punteggio (vicino alla vittoria propria/altrui → `rush`, altrimenti più punti → `accumulate`), le altre decidono su `pointGreed`.
- **Riserva di scarto sicuro** (`isSafeDiscard`/`hasSafeDiscardAfter`): non cala fino a restare con soli scarti che servono l'avversario; ritira un gioco (preferendo un tris come banca scarti). Da esperti + `discardCaution`.
- **Nuovo asse `experience`** (0 neofita → 1 pro): sotto `HOLD_MIN_EXPERIENCE=0.4` cala tutto subito senza strategia; sopra `GLOBAL_EVAL_MIN_EXPERIENCE=0.6` fa la valutazione globale del punteggio.
- **`memory` → `attention`**: governa la fedeltà di registrazione delle carte uscite (`observe` lossy: registra con probabilità = `attention`) **e** se valutare mano+tavolo (`attendsBoard`, piena da `BOARD_FOCUS_FULL=0.3` in su, spenta a 0 → gioca a caso). Tolti i moltiplicatori `*memory` sparsi.
- **Cooperazione** (asse `cooperation`, ora **usato**): gioco di squadra — apre più giochi a terra e trattiene meno in mano (`coopPenalty` su `shouldHoldMeld`); non chiude se il compagno è pieno; **divisione ruoli pozzetto** (`cooperativeStance` legge `partnerHandCount`: compagno carico → vado io al pozzetto, quasi pronto → accumulo io).
- **Visione avversari + difesa chiusura**: la `GameView` espone i **conteggi pubblici** `partnerHandCount`/`opponentHandCounts`/`opponentsTookPot`. `opponentClosingThreat` (loro: pozzetto + burraco + un avversario ≤`OPPONENT_CLOSE_HAND(4)` carte) → `rush` prioritario, `allowsWild` on, `defensiveDiscard` (sgombra le penalità pesanti NON appoggiabili ai loro giochi, non regala matte), `dirtyToComplete` (sporca un gioco da 6 con una matta → burraco subito). `opponentClosingImminent` (≤`OPPONENT_CLOSE_IMMINENT(1)`) → **attenzione massima allo scarto** (mai careless, mai servirli).
- **Profili aggiornati**: bot `experience 0.5`/`attention 0.5`/`cooperation 0.5`; Sergio `0.6`/`0.5`/`0.5` (esperto ma distratto); Maria `0.8`/`0.85`/`0.8` (pro collaborativa). **Decisioni ora stocastiche** (`rng` in `observe`/`attendsBoard`/`carelessDiscard`).
- **Scale con asso alto**: `findOpenMelds` fa un doppio passaggio per seme (asso basso + asso alto, helper `collectRunSegments`) → genera scale …-Q-K-A.
- **Modello del contenuto delle mani avversarie**: `opponentWantsValue` legge l'`opponentModel` (prima raccolto ma mai usato) — un valore che un avversario non scarta MAI (dopo ≥`WANT_MIN_DISCARDS` scarti) è probabilmente cercato → lo scarto lo evita, pesato da `attention`.
- **Copertura test IA** (`default.ai.spec.ts`, `rng` iniettato): pesca, calata, stance, cooperazione/ruoli, difesa chiusura, attenzione/memoria, asso alto, modello mani. **Suite 93 verdi**.

## ✅ Completato nella 3ª sessione (2026-07-05)

- **Marcatura burraco**: ultime carte coricate a 90° (`horizontalTail` sul Deck; pulito=2, semi/sporco=1); `classifyBurraco` pubblico + passthrough Game. **Fix sfondo su Pages** (path relativo).
- **Modale Impostazioni**: per-posto **IA on/off** + **carte scoperte on/off**, **velocità IA**; default "gioco vero" (SUD umano+scoperto, resto IA+coperto, lento). Rimosso il flag globale `debug`; `seats`→`seatAi`+`aiEnabled`+`aiAt()`, `faceUp` per-posto (persistiti). **Controllo umano per-posto** corretto.
- **Turno umano**: **undo** (`ANNULLA`) ultima mossa via snapshot (tranne pesca dal tallone); **scarto = seleziona + click sul monte scarti** (niente tasto SCARTA); **PESCA/PRENDI** evidenziati; **drag&drop** riordino mano; **inserimento intelligente** delle carte nuove (autosort off per l'umano, sort solo al deal).
- **Layout**: area centrale a **3 righe** (LORO/pesca-scarti-pozzetti/NOI); **pozzetti** sovrapposti concentrici (`grid-stack`, prospettiva condivisa `.pot-3d`+`preserve-3d`, no outline); **etichette posti** uniformi in alto-a-sx (`.seat`/`.seat-label`); **colonna mosse → `nz-drawer`**.
- **Convenzioni**: **`<nz-icon>`** (elemento) al posto delle emoji (`provideNzIcons`+`nz-icons.ts`); **classi helper Tailwind** per gli stati; **`ui-hand-result`** component estratto; **tsconfig** modernizzati; **log validazione** sull'attacco.
- **Regole**: fix estensione scala con matta-incastro (`getCardAbsPos` order-independent) + test; **audit** vs regolamento ufficiale (`rules-audit.spec.ts`).

## ✅ Completato in questa sessione (2026-07-04, 2ª)

- **Core loop mano completo**: `Round.takeDiscardPile()` (raccolta monte, single-writer); **fine partita** (`Game.targetScore` 2005 + `maybeEndGame`/`GameEnded` + overlay "Partita finita"); **Art.14** (rifiuta la chiusura scartando una matta). Test relativi in `round.spec.ts`/`game.spec.ts`.
- **Sottosistema IA** in `src/app/ai/`: contratto puro `ai-player.ts` (`AiProfile` 12 assi, `GameView`, `AiPlay`, `TableEvent`, `PhraseBank`, memoria a lungo termine); `DefaultAi` (pesca/calate/scarto greedy + memoria episodica/lungo-termine + voce); personalità `sergio`/`maria` (profili + frasi con emoji); registro `personalities.ts`. L'IA NON muta lo stato (single-writer): ritorna decisioni, la Board esegue via Game.
- **Eventi di gioco fini** nel Round (`RoundEventType`/`gameplayEvents`), broadcastati a tutte le IA (memoria+voce).
- **Conduttore** nella Board: config posti 0..4 (default 4 IA demo; SUD=`bot`), loop turni autoplay con **velocità** (manuale/lento/medio/veloce, persistita; manuale → tasto AVANTI), delay via `waitStep`, `tweener.whenIdle()`. Voce a fumetto + `aiLog`.
- **Persistenza**: stato partita salvato e **ripreso al refresh (F5)** (riabilitato `loadFromStorage`; salvataggio sospeso durante replay/player via `Game.suspendHistory`); impostazioni (`burracoz_settings`: velocità, colonna mosse) e memoria IA a lungo termine (`ai_ltm_*`) persistite.
- **Notazione mosse leggibile** (`move-notation.ts`, stile PGN/PBN in italiano — nessuno standard esiste per il Burraco) con import/export e **player** (avanti/indietro tra i turni) nel pannello debug.
- **Pannello di debug** (🛠): stato tavolo completo + snapshot memoria IA + log decisioni + salva/carica/modifica stato (`getState`/`restoreState`) + notazione mosse + player.
- **Layout**: carte più grandi (40×56), giochi come gruppi verticali sviluppati e spaziati (su mobile max 2 righe con offset adattivo via `ResizeObserver`), etichette NORD/EST/SUD/OVEST non sovrapposte, colonna mosse collassabile su desktop, niente scrollbar in animazione, niente overflow su mobile.
- **Pubblicazione**: repo resa pubblica, GitHub Pages (Actions) + CI su push/PR.

---

## 🗺️ Fasi

### Fase 1 — Logica di una partita _(FATTA)_

- [x] Calcolo punteggio, [x] `takeDiscardPile()`, [x] fine partita, [x] Art.14 (no chiusura con matta), [x] test round/scoring/chiusura/pozzetto.
- [x] **Undo turno** (Board: snapshot `getState`/`restoreState` per mossa; la pesca dal tallone NON è annullabile).
- [ ] **Fine tallone** senza chiusura (oggi il turno bot si sospende se non può pescare); caso "unico scarto è una matta" (annullo ultimo gioco).

### Fase 2 — Avversari (AI) _(BASE FATTA)_

- [x] Servizio IA (contratto + `DefaultAi` + personalità), [x] loop turni autoplay, [x] velocità/manuale.
- [x] **Ragionamento sulla calata**: scale>tris, attesa combinazioni/burrachi puliti, giochi non bloccati, stance chiusura (rush/accumulate), riserva scarto sicuro; assi `experience`/`attention`; uso reale di `patience`/`pointGreed`/`discardCaution`.
- [x] **Gioco di squadra** (`cooperation`): apre di più, ruoli pozzetto, non chiude sul compagno pieno. **Difesa chiusura avversaria** (vede i conteggi mano pubblici): sgombra mano, sporca i burraco, scarto difensivo, attenzione massima con avversario a 1 carta.
- [x] **Scale con asso alto** (`collectRunSegments` doppio passaggio) e **modello base del contenuto mani avversarie** (`opponentWantsValue` dai loro scarti osservati).
- [ ] **Restano**: gestione fine-tallone; modello mani avversarie più fine (raccolte da `take_discard`, suit oltre al valore); uso di `cooperation` anche negli appoggi/tenute per il compagno.
- [ ] **Copertura test IA** (nessuna spec finora) — vedi Fase 4.
- [ ] Livelli di difficoltà (preset di profili, ora possibili via `experience`/`attention`).

### Fase 3 — UX e struttura app

- [x] Persistenza (F5), [x] responsive/mobile (no overflow, ≤2 righe giochi), [x] pubblicazione.
- [x] **Modalità "gioco vero"** via modale Impostazioni: per-posto IA on/off + carte scoperte on/off (default SUD umano+scoperto, resto IA+coperto).
- [x] **Riordino mano** (drag&drop) + inserimento intelligente delle carte nuove.
- [ ] Menu iniziale (Nuova partita / Continua / Impostazioni) + routing; selettore personalità.
- [ ] Pulizia UI residua e tema tavolo definitivo.

### Fase 4 — Qualità e affidabilità

- [x] CI (format+build+test). [x] copertura test IA (`default.ai.spec.ts`, `rng` iniettato). [ ] edge case FIBUR aggiuntivi; migrare `services/tests.ts`.

### Fase 5 — Espansione _(opzionale)_

- [ ] **Profiler-clone**: osserva lo stile del giocatore e produce un `AiProfile` (inverso dell'IA, riusa gli eventi). [ ] Multiplayer online. [ ] statistiche, varianti, audio, PWA.

---

## 🎯 Prossimo passo consigliato

**Menu iniziale + selettore personalità/difficoltà** (Fase 3): ora che `experience`/`attention`/`cooperation` esistono, si possono esporre preset di difficoltà. In alternativa **fine-tallone** (Fase 1, ultimo buco del core loop) o affinare il modello mani avversarie (raccolte da `take_discard`). Il **profiler-clone** resta il grande "nice to have".

## 🐞 Debito tecnico noto

- **Strategia IA — lacune residue**: il modello delle mani avversarie è di base (solo valori mai scartati; non usa `take_discard` né i semi); `cooperation` non guida ancora appoggi/tenute per il compagno; decisioni stocastiche via `rng` (fissate nei test con rng iniettato).
- **Dimensione carta globale** (`CARD_SIZE` in deck.ts): su mobile con MOLTI giochi non si rimpiccioliscono le carte come fallback (oggi si riduce solo l'offset verticale) → in casi estremi l'area `overflow-hidden` potrebbe clippare oltre le 2 righe.
- **Deploy Pages transitorio**: lo step `deploy-pages` fallisce spesso con "try again later" (build ok); rilanciare `gh workflow run deploy.yml`.
- **Ramo asso/`mayBeCleanCanasta`** in `validateRun`: intricato/fragile (passa i test, candidato a semplificazione). fine-tallone mancante; `strictNullChecks:false`; CSS ~790KB (tema ng-zorro completo, usati button/tag/icon/drawer).
