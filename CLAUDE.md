# CLAUDE.md — Burracoz Client

Gioco di Burraco (regole F.I.Bur.) in Angular standalone + signals, ng-zorro + Tailwind 4, client-only.
Architettura: **Game** (facade multi-mano) → **Round** (logica di una mano) → **Rules** (validazione giochi).
UI: **Board** → **Deck** (pila universale di carte) → **Card**, con animazioni FLIP custom (**Tweener**, direttiva `uiTweenScope`).

## Comandi

Il repo usa **yarn 4** (`packageManager` in package.json).

- `yarn start` — dev server (`npx ng serve --port 4299` per gli script di verifica Playwright: porta dedicata, non collide col serve dell'utente)
- `yarn ng build` — build di produzione (usarla come typecheck completo, template inclusi)
- `yarn ng test --watch=false --browsers=ChromeHeadless` — suite unit completa (Karma/Jasmine)
- `yarn test:rules` — solo i test del motore regole
- `yarn format` — prettier su tutto il repo (tab, apici singoli, printWidth 100; per gli .html parser `angular`)

## Regole d'oro

- Rispondere sempre in italiano.
- Prima di toccare Deck/Card/Tweener o i flussi delle carte: leggere **MEMO.md** (principi architetturali vincolanti: single writer, ownership di `faceDown`, identità uid, staging solo nel deal).
- Stati e fasi sempre `enum`; stato UI sempre con signals; stili con classi Tailwind inline nel template.
- Alle azioni di gioco si passano ISTANZE `DeckItem` (mai il tag: nel mazzo doppio è ambiguo).
- Quando l'utente dice **"chiudi"**: aggiornare gli .md con gli spunti della sessione (ROADMAP.md: fatti/stato/prossimo passo; MEMO.md: nuovi principi vincolanti; questo file: comandi/convenzioni/indice; memoria persistente: cronaca), correggendo anche le note diventate obsolete.

## File .md del progetto

| File                        | Cosa contiene / come funziona                                                                                                                                                                                                | Quando usarlo                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLAUDE.md** (questo file) | Istruzioni operative per Claude: architettura in sintesi, comandi, regole d'oro e questo indice dei documenti.                                                                                                               | Caricato automaticamente a inizio sessione. Aggiornarlo quando cambiano comandi, convenzioni o l'elenco dei documenti.                                                     |
| **MEMO.md**                 | Conclusioni dell'analisi architetturale Deck/Card (2026-07-04): verdetto, principi vincolanti (single writer, ownership `faceDown`, uid identity, YAGNI sull'API), cosa non toccare, metodo di verifica empirica collaudato. | PRIMA di qualunque modifica a `deck.ts`, `card.ts`, `board.ts`, `round.ts` o ai flussi di movimentazione carte; come checklist nei refactoring e nelle code review.        |
| **ROADMAP.md**              | Roadmap verso il prodotto completo: stato per modulo (tabella 🟢🟡🔴), lavori completati di recente, fasi future (completare logica partita → AI avversari → rifinitura → multiplayer).                                      | Per decidere COSA fare dopo: prioritizzare nuove feature, controllare cosa manca (`takeDiscardPile`, `undoTurn`, fine partita, AI). Aggiornarla a ogni feature completata. |
| **README.md**               | Boilerplate Angular CLI standard: comandi di scaffolding, build, test. Non contiene informazioni specifiche del progetto.                                                                                                    | Solo per i comandi Angular CLI generici; per tutto il resto preferire questo file e ROADMAP.md.                                                                            |

Note:

- Le regole ufficiali del gioco NON sono in un .md ma in `docs/burraco_regole_ufficiali_fibur_2026.txt` (italiano) e `docs/burraco_official_rules_fibur_2026_en.txt` (inglese) — da consultare per qualunque dubbio sulle regole (articoli citati nei commenti come "Art. 14").
- Esiste anche la memoria persistente di Claude (MEMORY.md fuori dal repo, in `~/.claude/projects/...`): contiene la cronaca delle sessioni e i dettagli implementativi (es. internals del Tweener). Non va confusa con questi file: ciò che è vincolante per il progetto sta in MEMO.md, ciò che è pianificazione sta in ROADMAP.md.
