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

## Sottosistema IA e conduttore (2026-07-04, 2ª sessione)

- **IA pura sullo stato**: ogni IA (`ai/`) riceve una `GameView` read-only e RITORNA
  decisioni (pesca/calate/scarto) + eventuale commento; NON muta lo stato. È la Board
  che esegue via `Game` → single-writer intatto. L'IA è stateful solo nella PROPRIA
  memoria (episodica + lungo termine). Contratto in `ai/ai-player.ts` (fonte di verità).
- **Il conduttore non scrive signal dentro l'effect**: `maybeRunAiTurn` defer con
  `setTimeout(0)` prima di far girare `runAiTurn` (che scrive i signal via le azioni di
  gioco). Il ritmo è dentro `runAiTurn` via `waitStep()` (sleep per lento/medio/veloce;
  attesa di "AVANTI" in manuale). `runAiTurn` può riprendere anche a metà turno
  (fase gioca-e-scarta) dopo un F5.
- **Persistenza**: lo stato partita è salvato da un `effect` in `Game` e ripristinato in
  `loadFromStorage` (F5). Durante replay/player impostare `Game.suspendHistory = true`
  così NON si registra la mano (`onRoundClosed`) né si persiste lo stato intermedio.
  Impostazioni in `burracoz_settings`, memoria IA in `ai_ltm_<posto>`.
- **Notazione mosse**: non esiste uno standard per il Burraco; formato testo LEGGIBILE
  in italiano in `move-notation.ts` (header col deal + una riga per turno). Import/export
  e player riusano gli stessi eventi `RoundGameplayEvent`.

## Layout giochi / etichette (2026-07-04, 2ª sessione)

- **Giochi verticali = servono un'ALTEZZA esplicita**: la `deck` in `layout="vertical"`
  si sviluppa solo se il suo host ha altezza (le mani laterali hanno `h-full`; i giochi
  no → altezza 0 → carte collassate). Dare al deck del gioco `[style.height.px]`
  proporzionale al numero di carte. Su mobile l'offset per carta è ADATTIVO
  (`meldCardOffset`, da `ResizeObserver` sull'area) così i giochi stanno in ≤2 righe.
- **`table_bg` va in un contenitore `relative`**: l'`<img>` di sfondo è assoluto e si
  aggancia al primo antenato posizionato; senza `relative` sul div del tavolo sfugge
  all'`overflow-hidden` e copre le colonne adiacenti (es. la colonna mosse desktop).
- **Etichette (aggiornato sessione 3)**: ora SONO `absolute` ma con `relative` sul
  contenitore e `padding` che riserva lo spazio così NON coprono le carte. Posti
  NORD/EST/SUD/OVEST → `.seat-label` in alto a sinistra (classe helper Tailwind);
  zone NOI/LORO → etichetta `absolute` centrata in alto + `pt-6` sulla zona.
  `pointer-events-none` sull'etichetta così il click sulla zona (calata) passa.

## Sessione 3 (2026-07-05): principi vincolanti

- **`getCardAbsPos` order-independent (rules.ts)**: i giochi a terra sono memorizzati in ordine DECRESCENTE, l'input di gioco è CRESCENTE. La posizione di una matta-incastro si deduce dal naturale vicino, ma il segno dipende dal VERSO dell'array (`rankDirection`). Non assumere mai un verso fisso: romperebbe l'estensione di scale con matta-incastro (es. `J♠ + [10♠ 9♠ 2♥ 7♠]`). Conformità al regolamento coperta da `rules-audit.spec.ts`.
- **Posti = `seatAi` (istanze fisse) + `aiEnabled` (signal per-posto) + `faceUp` (signal per-posto)**. `aiAt(seat)` = IA o null(umano). NIENTE più flag globale `debug`. La memoria IA a lungo termine si carica/salva SEMPRE su `seatAi` (anche posti umani), così sopravvive all'attivazione/disattivazione. Il conduttore reagisce ai cambi via `aiEnabled()` letto nell'effect dei turni.
- **Ordine mano del giocatore umano**: autosort automatico DISATTIVO (riordina lui col drag `reorderable`); sort SOLO alla distribuzione (`sortHands`); le carte in ingresso (pesca/presa/pozzetto) si inseriscono in modo INTELLIGENTE (`smartArrangeHand`/`smartInsertIndex`: accanto a un potenziale gioco, altrimenti in fondo) preservando l'ordine manuale delle altre; calate/scarto NON riordinano (il `list()` del Deck filtra). Le IA continuano con `autosortNow`.
- **Undo (Board)**: snapshot `round.getState()` PRIMA di ogni mossa annullabile (prendi-scarti, cala, appoggia); `undoTurn` fa `restoreState` + trim `moveLog`. La **pesca dal tallone NON è annullabile** (svela una carta) e azzera lo stack; lo scarto chiude il turno e azzera. `restoreState` crea NUOVE istanze → dopo un undo il Tweener non appaia (accettabile).
- **Convenzioni UI**: icone = elemento `<nz-icon nzType="…">` (mai emoji né `<span nz-icon>`), registrate in `nz-icons.ts` via `provideNzIcons`; negli spec che renderizzano componenti con icone → `TestBed.inject(NzIconService).addIcon(...NZ_ICONS)`. Evidenziazioni/stati = **classi helper Tailwind** (`.seat`/`.seat--turn`/`.seat-label`, `.pile*`, `.pot-3d`) + toggle `[class.x]`, MAI sfilze di classi condizionali inline. Specializzare i template estraendo component (es. `ui-hand-result`).
- **tsconfig moderni**: `tsconfig.app.json` = `files:["src/main.ts"]`+`include:["src/**/*.d.ts"]`; `tsconfig.spec.json` = `include:["src/**/*.spec.ts","src/**/*.d.ts"]`.
- **Asset relativi**: riferire le immagini con path RELATIVI (`images/…`), mai con `/` iniziale, altrimenti si rompono sotto il base-href `/burracoz-client/` di Pages.

## Cosa non toccare

- Tweener v2 (WAAPI, pairing per uid, hold/release nel drag) — solido e testato.
- Formato tag emoji (`7♥️`) come identità serializzabile.
- Struttura Game → Round → Rules e contratto prepareHand/DealResult/commitHand.

## Metodo di verifica collaudato

- Suite unit (68 verdi: rules + `rules-audit`, round/invarianti 108-uid, cards, deck, tweener,
  game, move-notation, board/stage smoke). `yarn test:rules` per il solo motore regole.
- Empirico: `ng serve --port 4299` + Playwright headless da scratchpad — audit DOM
  (conteggi per deck, tween-id duplicati, invisibili) + stato interno via
  `window.ng.getComponent(el)`; con `tweenDebug()` il tweener logga e
  `auditUniqueness()` warna a scena ferma.
