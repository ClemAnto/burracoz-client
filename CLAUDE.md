# CLAUDE.md — Burracoz Client

Gioco di Burraco (regole F.I.Bur.) in Angular standalone + signals, ng-zorro + Tailwind 4, client-only.
Architettura: **Game** (facade multi-mano) → **Round** (logica di una mano) → **Rules** (validazione giochi).
UI: **Board** → **Deck** (pila universale di carte) → **Card**, con animazioni FLIP custom (**Tweener**, direttiva `uiTweenScope`).
**IA**: `src/app/ai/` (contratto puro stato→decisioni: `ai-player.ts` + `DefaultAi` + personalità + registro); il **conduttore** vive nella Board (posti 0..4, velocità, voce). **Notazione mosse**: `services/move-notation.ts` (testo leggibile IT) con import/export + player.
**Board**: modale **Impostazioni** (per-posto IA on/off + carte scoperte on/off, velocità; `seatAi`+`aiEnabled`+`faceUp`, `aiAt()`), **undo** (snapshot `getState`/`restoreState`), scarto via click sul monte scarti, drag&drop riordino mano + inserimento intelligente carte nuove, colonna mosse in `nz-drawer`, overlay fine-mano in `ui/hand-result/`.
Pubblicato live: https://clemanto.github.io/burracoz-client/ (GitHub Pages via Actions, repo pubblica).

## Comandi

Il repo usa **yarn 4** (`packageManager` in package.json).

- `yarn start` — dev server (`npx ng serve --port 4299` per gli script di verifica Playwright: porta dedicata, non collide col serve dell'utente)
- `yarn ng build` — build di produzione (usarla come typecheck completo, template inclusi)
- `yarn ng test --watch=false --browsers=ChromeHeadless` — suite unit completa (Karma/Jasmine)
- `yarn test:rules` — solo i test del motore regole
- `yarn format` — prettier su tutto il repo (tab, apici singoli, printWidth 100; per gli .html parser `angular`). **Eseguirlo SEMPRE prima di un push**: `format:check` è un gate della CI.
- **CI/Pages**: `.github/workflows/ci.yml` (format+build+test) e `deploy.yml` (Pages) girano su push a `main`. Il deploy Pages a volte fallisce col transitorio "try again later" → rilanciare `gh workflow run deploy.yml --ref main`.

## Regole d'oro

- Rispondere sempre in italiano; identificatori TS in inglese (commenti/UI/doc in italiano).
- Prima di toccare Deck/Card/Tweener o i flussi delle carte: leggere **MEMO.md** (single writer, ownership di `faceDown`, uid, staging solo nel deal, criticità animazioni, IA pura, altezza giochi, `table_bg` in `relative`). Prima di toccare l'IA: leggere `ai/ai-player.ts` (contratto).
- Stati e fasi sempre `enum`; stato UI sempre con signals; stili con classi Tailwind inline nel template.
- **UI**: icone = elemento `<nz-icon nzType="…">` (mai emoji, mai `<span nz-icon>`; registrate in `nz-icons.ts` via `provideNzIcons`). Evidenziazioni/stati = **classi helper Tailwind** (`.seat`, `.pile`, … in `styles/tailwind.css`) + toggle `[class.x]`, mai sfilze di classi condizionali inline. Specializzare i template in component dedicati.
- Alle azioni di gioco si passano ISTANZE `DeckItem` (mai il tag: nel mazzo doppio è ambiguo).
- **Niente commit/push automatici**: committare SOLO su richiesta esplicita dell'utente.
- Quando l'utente dice **"chiudi"**: aggiornare gli .md con gli spunti della sessione (ROADMAP.md: fatti/stato/prossimo passo; MEMO.md: nuovi principi vincolanti; questo file: comandi/convenzioni/indice; memoria persistente: cronaca), correggendo anche le note diventate obsolete.

## File .md del progetto

| File                        | Cosa contiene / come funziona                                                                                                                                                                                                                                                                                   | Quando usarlo                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLAUDE.md** (questo file) | Istruzioni operative per Claude: architettura in sintesi, comandi, regole d'oro e questo indice dei documenti.                                                                                                                                                                                                  | Caricato automaticamente a inizio sessione. Aggiornarlo quando cambiano comandi, convenzioni o l'elenco dei documenti.                                                          |
| **MEMO.md**                 | Principi vincolanti: analisi Deck/Card (single writer, ownership `faceDown`, uid, criticità animazioni), IA/conduttore, layout, e **sessione 3** (`getCardAbsPos` order-independent, posti `seatAi`/`aiEnabled`/`faceUp`, ordine mano umana + undo, convenzioni UI nz-icon/Tailwind, tsconfig, asset relativi). | PRIMA di qualunque modifica a `deck.ts`, `card.ts`, `board.ts`, `round.ts`, `rules.ts` o ai flussi di movimentazione carte; come checklist nei refactoring e nelle code review. |
| **ROADMAP.md**              | Roadmap verso il prodotto completo: stato per modulo (tabella 🟢🟡🔴), lavori completati di recente, fasi future (completare logica partita → AI avversari → rifinitura → multiplayer).                                                                                                                         | Per decidere COSA fare dopo: prioritizzare nuove feature, controllare cosa manca (`takeDiscardPile`, `undoTurn`, fine partita, AI). Aggiornarla a ogni feature completata.      |
| **README.md**               | Boilerplate Angular CLI standard: comandi di scaffolding, build, test. Non contiene informazioni specifiche del progetto.                                                                                                                                                                                       | Solo per i comandi Angular CLI generici; per tutto il resto preferire questo file e ROADMAP.md.                                                                                 |

Note:

- Le regole ufficiali del gioco NON sono in un .md ma in `docs/burraco_regole_ufficiali_fibur_2026.txt` (italiano) e `docs/burraco_official_rules_fibur_2026_en.txt` (inglese) — da consultare per qualunque dubbio sulle regole (articoli citati nei commenti come "Art. 14").
- Esiste anche la memoria persistente di Claude (MEMORY.md fuori dal repo, in `~/.claude/projects/...`): contiene la cronaca delle sessioni e i dettagli implementativi (es. internals del Tweener). Non va confusa con questi file: ciò che è vincolante per il progetto sta in MEMO.md, ciò che è pianificazione sta in ROADMAP.md.
