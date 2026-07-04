# MEMO — Architettura Deck/Card (analisi 2026-07-04)

## Verdetto

L'idea iniziale è CORRETTA: non ristrutturare, rifattorizzare in modo mirato.
I due pilastri da preservare sempre:

1. **Deck = componente universale di pila** (mano, tallone, scarti, pozzetti, giochi
   sono tutti `ui-deck` con layout parametrico stack/horizontal/vertical).
2. **Identità stabile della carta**: UNA istanza `DeckItem` con `uid` unico, condivisa
   tra logica e UI. `tween-id = uid` è ciò che permette al Tweener di animare i
   passaggi tra deck (FLIP pairing). 108 carte, uid unici, mai clonate né sparite.

## Principi (da rispettare in ogni intervento futuro)

- **Single writer**: i signal di Round (`hands`, `drawPile`, `discardPile`, `pots`,
  `melds`) sono l'UNICA fonte dello stato carte. La UI proietta, non co-possiede.
  Le azioni committano direttamente sul dominio; il Tweener anima la conseguenza.
  (Prova: addMeld/attachToMeld hanno sempre funzionato così.)
- **Eccezione unica**: la distribuzione (`Board.deal`) usa staging imperativo
  (`Deck.put`/`removeItems`) per la coreografia carta-per-carta. È l'unico posto.
  Contratto: le istanze usate nello staging sono le STESSE che commitHand scriverà
  nei signal → il linkedSignal ricalcola identico, nessun salto visivo.
- **Ownership di `faceDown`**: l'istanza porta lo stato FISICO del tavolo e lo
  scrive SOLO Round (mazzo coperto, scarto scoperto, pozzetto scoperto alla presa).
  La prospettiva sulle MANI (io vedo le mie, non le tue) è della view: override di
  rendering nel Deck (`faceDownInput() ?? item.faceDown`), mai mutare le istanze
  dalla UI.
- **Il dominio non importa dalla UI**: `DeckItem`/`DeckItems` vivono in
  `services/cards.ts` (foglia, zero import da ui/). round/rules non devono mai
  importare da `ui/`.
- **Mai passare tag alle azioni di gioco**: nel mazzo doppio ogni tag esiste in due
  copie → si passa sempre l'ISTANZA (risoluzione per uid), mai la stringa.
- **Parsing una volta sola**: la stringa tag si parsa nel costruttore di DeckItem.
  I componenti (Card) ricevono l'istanza già parsata, non ri-parsano.
- **View-state legittimo del Deck**: ordine di visualizzazione (manualOrder /
  autosortNow pilotato dalla Board a tween conclusi), selezione (`selecteds`),
  drag&drop. Questo NON è split-brain: è presentazione.
- **YAGNI sull'API**: niente metodi "che potrebbero servire" (take/takeAll/shuffle/
  freeze sono morti da sempre). L'API del Deck è rendering, selezione, ordine e
  staging per il deal.

## Criticità animazioni (Angular `animate.*`, CSS transition, WAAPI)

Regola madre: **un solo motore anima il movimento delle carte, il Tweener (WAAPI).**
Ogni altro meccanismo che tocca le stesse proprietà gli si sovrappone e produce
scatti o — nel caso peggiore — carte che spariscono. Le tre trappole già pagate:

- **`animate.enter` / `animate.leave` (Angular) — VIETATI sui pivot di un `@for`
  riordinabile.** È stata la causa VERA delle "carte sparite" a ogni sort (non il
  Tweener, non i dati). Il `@for` con `track` per riordinare SPOSTA le view
  (detach + re-insert); `animate.leave` scambia il detach per una rimozione,
  differisce lo smontaggio (~200 ms, classe di uscita) e poi **elimina dal DOM
  elementi ancora vivi** → `game=11`, `list()=11`, ma `DOM=3`. Bug presente da
  sempre, anche prima del porting a WAAPI. Fix: rimossi dai pivot in `deck.html`
  (+ `animations.scss` eliminato). Non servono: lo scorrimento dei vicini in
  ingresso/uscita lo anima già il FLIP dello scope. Il Tweener è comunque blindato
  contro le rimozioni differite (pairing "gemello vivo": misura → nasconde →
  `tween-consumed`, con self-heal a TTL), ma la regola resta **non introdurre
  rimozioni differite nel flusso normale**: le rimozioni devono essere sincrone,
  così il pairing avviene nello stesso batch.

- **`@angular/animations` classico (trigger/state/transition, `BrowserAnimationsModule`)
  — non usato e da NON introdurre** per il movimento delle carte: aggiungerebbe un
  secondo motore (main-thread) sopra il FLIP. Ogni movimento passa SOLO dal Tweener.

- **CSS `transition` — ammessa solo FUORI dal volo, mai sulle proprietà del FLIP.**
  Il Tweener v2 usa `element.animate()` con `fill: 'backwards'`: durante il delay
  tiene l'elemento allo stato sorgente. Una `transition` CSS attiva sulla STESSA
  proprietà (top/left/transform/translate/rotate) parte in parallelo → doppio
  movimento e scatti. In concreto: `translate` è riservato al Tweener (i consumer
  NON lo toccano, il Deck posiziona con `left/top` + `calc` sulle var del Deck); le
  transition proprie del Deck valgono solo `&:not(.tweening)` (vedi `card.scss`:
  `top/left/box-shadow`), spente dalla classe `.tweening` durante il volo; le
  proprietà usate come handoff (`transform: rotateY(--rot-y)` per il fronte/retro,
  `rotate: --rotate`) hanno valore sottostante SECCO senza `transition` propria; ed
  è **vietato `transition: all`**, che animava anche transform/rotate entrando in
  conflitto col flip e col FLIP.

- **`tween-data`: solo proprietà COMPOSITABILI** (`transform`, `rotate`,
  `translate`). Una custom property nei keyframe manda l'INTERA animazione — volo
  compreso — sul main thread in Chrome (deal a scatti); e una custom property NON
  registrata via `@property` non è nemmeno interpolabile nei keyframe WAAPI. Niente
  `--offset` o altre var nei keyframe (`--offset` è registrata in `styles.scss` ma
  resta comunque fuori da `tween-data` per il motivo del main thread).

- **Stagger + `fill: backwards` solo per gli ARRIVI accoppiati** (elementi con
  `tween-data-prev`, cioè giunti da un altro deck): i riordini in place planano
  tutti INSIEME. Scaglionare anche un sort di massa parcheggerebbe ogni carta sul
  vecchio slot (backwards) sotto quelle già atterrate → di nuovo "carte sparite".

## Cosa non toccare

- Tweener v2 (WAAPI, pairing per uid, hold/release nel drag) — solido e testato.
- Formato tag emoji (`7♥️`) come identità serializzabile.
- Struttura Game → Round → Rules e contratto prepareHand/DealResult/commitHand.

## Metodo di verifica collaudato

- Suite unit (44 verdi: rules, round/invarianti 108-uid, cards, deck, tweener).
- Empirico: `ng serve --port 4299` + Playwright headless da scratchpad — audit DOM
  (conteggi per deck, tween-id duplicati, invisibili) + stato interno via
  `window.ng.getComponent(el)`; con `debug=true` il tweener logga e
  `auditUniqueness()` warna a scena ferma.
