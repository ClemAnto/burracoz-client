# Burracoz — Roadmap verso il prodotto completo

> Angular 21 (standalone, signals) · ng-zorro + Tailwind 4 · client-only
> Stato documento: aggiornato al 2026-07-05 (3ª sessione). **Giocabile davvero da un umano** (default "gioco vero": SUD umano+scoperto, EST/NORD/OVEST IA+coperti) tramite la **modale Impostazioni** (per-posto IA/carte scoperte + velocità). Suite 68/68 verde. **Committato e pubblicato** su GitHub Pages (commit `2822429`).

Gioco di Burraco (regole F.I.Bur. italiane). Architettura:
**Game** (facade multi-mano) → **Round** (logica di una mano) → **Rules** (validazione giochi).
UI: **Board** → **Deck** → **Card** con FLIP custom (**Tweener**).
**IA** in `src/app/ai/` (contratto puro stato→decisioni). Sito live: https://clemanto.github.io/burracoz-client/

---

## 📊 Stato attuale (sintesi)

| Modulo                     | Stato       | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motore regole (`rules.ts`) | 🟢 maturo   | set/run/attach con matte, incastri, assi, 2 naturale, canasta pulita. **`getCardAbsPos` order-independent** (fix estensione scala con matta-incastro). **Audit vs regolamento ufficiale** (`rules-audit.spec.ts`): conforme.                                                                                                                                                                                                                                                            |
| Modello carte (`cards.ts`) | 🟢 maturo   | entità `DeckItem`/`DeckItems`, parsing, mazzo, rank, ordinamento. Modulo foglia.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Round (`round.ts`)         | 🟢 maturo   | deal, turni, calate, pozzetto, chiusura, punteggio, **takeDiscardPile**, **Art.14 (no chiusura con matta)**, **eventi di gioco fini** (`gameplayEvents`). **Undo** ora gestito dalla Board via snapshot `getState`/`restoreState`. Manca fine-tallone.                                                                                                                                                                                                                                  |
| Game (`game.ts`)           | 🟢 maturo   | multi-mano, storico, eventi, **fine partita** (soglia 2005 + `GameEnded`), **persistenza F5 attiva** (`suspendHistory` durante replay).                                                                                                                                                                                                                                                                                                                                                 |
| IA (`ai/`)                 | 🟡 base     | contratto+`DefaultAi`+personalità (sergio/maria)+registro; conduttore in Board (0..4 posti, velocità, manuale/AVANTI), memoria episodica+lungo termine, voce+emoji. Strategia semplice (no scale asso-alto).                                                                                                                                                                                                                                                                            |
| UI Board/Deck              | 🟢 buona    | **layout centrale a 3 righe** (LORO / pesca-scarti-pozzetti / NOI), pozzetti sovrapposti concentrici (prospettiva condivisa `.pot-3d`), **etichette posti uniformi in alto-a-sx** (`.seat`), **modale Impostazioni**, **colonna mosse in `nz-drawer`**, **undo/scarto-via-click/PESCA-PRENDI**, **drag&drop riordino mano** + inserimento intelligente carte nuove, overlay fine-mano estratto in `ui-hand-result`. **Icone `<nz-icon>`** (no emoji). Mani coperte per-posto (default). |
| Notazione/replay           | 🟢 fatto    | `move-notation.ts` (formato testo leggibile IT) + player mosse (avanti/indietro) nel pannello debug.                                                                                                                                                                                                                                                                                                                                                                                    |
| Pubblicazione              | 🟢 fatto    | repo PUBBLICA, GitHub Pages via Actions (`deploy.yml`), CI (`ci.yml`: format+build+test).                                                                                                                                                                                                                                                                                                                                                                                               |
| Avversari — strategia      | 🟡 base     | i bot giocano ma in modo semplice/greedy; da potenziare.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Multiplayer/backend        | 🔴 assente  | nessun server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Test                       | 🟡 68 verdi | rules (+ `rules-audit.spec.ts` conformità regolamento), round, cards, deck, tweener, game, move-notation, board/stage (smoke, con `NzIconService.addIcon`). Manca copertura IA e harness `tests.ts` da migrare.                                                                                                                                                                                                                                                                         |

---

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
- [ ] **Potenziare la strategia**: sequenze con asso alto, meld-finder migliore, scarto più intelligente, uso reale di `patience`/`pointGreed`/`cooperation`.
- [ ] Livelli di difficoltà (preset di profili).

### Fase 3 — UX e struttura app

- [x] Persistenza (F5), [x] responsive/mobile (no overflow, ≤2 righe giochi), [x] pubblicazione.
- [x] **Modalità "gioco vero"** via modale Impostazioni: per-posto IA on/off + carte scoperte on/off (default SUD umano+scoperto, resto IA+coperto).
- [x] **Riordino mano** (drag&drop) + inserimento intelligente delle carte nuove.
- [ ] Menu iniziale (Nuova partita / Continua / Impostazioni) + routing; selettore personalità.
- [ ] Pulizia UI residua e tema tavolo definitivo.

### Fase 4 — Qualità e affidabilità

- [x] CI (format+build+test). [ ] copertura test IA + edge case FIBUR; migrare `services/tests.ts`.

### Fase 5 — Espansione _(opzionale)_

- [ ] **Profiler-clone**: osserva lo stile del giocatore e produce un `AiProfile` (inverso dell'IA, riusa gli eventi). [ ] Multiplayer online. [ ] statistiche, varianti, audio, PWA.

---

## 🎯 Prossimo passo consigliato

**Potenziare la strategia IA** (Fase 2: scale asso-alto, meld-finder, scarto intelligente, uso di `patience`/`pointGreed`/`cooperation`). Poi commenti di zona nel template. Il **profiler-clone** è il grande "nice to have" successivo.

## 🐞 Debito tecnico noto

- **Strategia IA semplice**: greedy, niente scale con asso alto; `patience`/`pointGreed`/`cooperation` non ancora sfruttati nelle decisioni.
- **Dimensione carta globale** (`CARD_SIZE` in deck.ts): su mobile con MOLTI giochi non si rimpiccioliscono le carte come fallback (oggi si riduce solo l'offset verticale) → in casi estremi l'area `overflow-hidden` potrebbe clippare oltre le 2 righe.
- **Deploy Pages transitorio**: lo step `deploy-pages` fallisce spesso con "try again later" (build ok); rilanciare `gh workflow run deploy.yml`.
- **Ramo asso/`mayBeCleanCanasta`** in `validateRun`: intricato/fragile (passa i test, candidato a semplificazione). fine-tallone mancante; `strictNullChecks:false`; CSS ~790KB (tema ng-zorro completo, usati button/tag/icon/drawer).
