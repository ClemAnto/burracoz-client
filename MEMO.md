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

## Sessione 4 (2026-07-05): strategia, personalità e voce dell'IA + fine-tallone

Tutto in `DefaultAi` (`default.ai.ts`), **IA sempre pura sullo stato** (ritorna decisioni con `reason`, non muta nulla). Principi vincolanti:

- **`decidePlays` orchestra, non genera regole**: la validità dei giochi resta di `Rules` (fonte di verità). La strategia sceglie SOLO cosa/quando calare tra i giochi già validi. Non introdurre validazioni regole nell'IA.
- **Preferenza scale sui tris**: `pickNonOverlapping` ordina scale (`isRunMeld`) prima dei set, poi per lunghezza. I tris bloccano il gioco.
- **Trattenere per allungare** (`shouldHoldMeld`): si tiene una scala corta in mano se ha completatori **vivi**; soglia di pazienza più bassa se il burraco sarà **pulito** (`runUsesWild` = proxy di `classifyBurraco`: joker sempre matta, il `2` solo se fuori-seme) o **vicino** (≥6). SEMPRE calare: un burraco (≥7); con tallone ≤`LOW_STOCK`; in stance `rush`.
- **Giochi bloccati** (`liveExtensionCount`/`completerTags`): completatori = naturali adiacenti agli estremi (scala) o altre copie dello stesso valore (set). "Vivo" = ancora in memoria come non uscito. Se 0 → non aspettare.
- **Stance chiusura** (`closingStance`): senza pozzetto+burraco → `accumulate`; le IA con `experience ≥ GLOBAL_EVAL_MIN_EXPERIENCE(0.6)` leggono `matchScore` vs `targetScore` (`NEAR_WIN_FRACTION 0.85` → `rush`), le altre su `pointGreed`.
- **Riserva scarto sicuro** (`isSafeDiscard`/`hasSafeDiscardAfter`/`pickMeldToHoldForDiscard`): non svuotarsi al punto di dover servire l'avversario; sicuro = non-matta e non appoggiabile ai LORO giochi a terra (visibili a tutti). Gate: `experience ≥ HOLD_MIN_EXPERIENCE(0.4)` + `discardCaution`, mai in `rush`. Le legate (`attach`) non si spezzano mai.
- **`experience` (nuovo asse)**: sotto 0.4 il neofita cala tutto subito (anche tris), niente attese/riserve; da 0.6 la valutazione globale del punteggio. `patience`/`discardCaution` sono il temperamento, `experience` è il "saperlo fare".
- **`memory` → `attention`**: unico knob di percezione. `observe` registra ogni carta vista con probabilità = `attention` (memoria LOSSY, non più perfetta) → niente più moltiplicatori `*memory` sparsi (rimossi da `liveExtensionCount` e `discardRanking`; `liveCopies` si legge a valore pieno). `attendsBoard()` (piena da `BOARD_FOCUS_FULL 0.3` in su, lineare fino a 0) gate su `decideDraw`/`decidePlays`/`decideDiscard`: ad attention 0 ignora mano+tavolo e gioca a caso (`carelessDiscard`). **Le decisioni sono ora STOCASTICHE via `rng`** → nei test iniettare `rng` deterministico.
- **Sempre visibile a tutti** (anche neofita/distratto): mano, giochi a terra (`myMelds`/`theirMelds`), top scarti. Solo lo STORICO delle carte uscite dipende da `attention`.
- **Aggiungere un asse ad `AiProfile`** = aggiornarlo nei 3 profili (`personalities.ts` BALANCED, `sergio.ai.ts`, `maria.ai.ts`), altrimenti TS rompe.
- **Conteggi mano PUBBLICI nella `GameView`**: `partnerHandCount`/`opponentHandCounts`/`opponentsTookPot` sono informazione lecita (nel Burraco si vede QUANTE carte ha ognuno, non il contenuto). Popolati in `buildView` (board.ts). NON esporre mai il contenuto delle mani altrui: ciò che l'IA sa del contenuto sta solo nella memoria `seen`.
- **Cooperazione** (`cooperativeStance`, gate `cooperation ≥ COOP_MIN`): ha PRIORITÀ sulla scelta individuale/globale dello stance. Ruoli pozzetto via `partnerHandCount` (`PARTNER_FULL 8` → vado io; `PARTNER_LOW 4` → accumulo); non chiude sul compagno pieno; `coopPenalty = cooperation*0.3` alza la soglia di hold in `shouldHoldMeld` (apre di più, costruisce meno in mano). Auto-correttiva: appena il pozzetto è preso il ramo si disattiva.
- **Difesa dalla chiusura avversaria**: `opponentClosingThreat` = loro pozzetto + burraco (≥7 in `theirMelds`) + un avversario ≤`OPPONENT_CLOSE_HAND(4)` → `closingStance` forza `rush` con **priorità massima**, `allowsWild(view)` diventa true, `findOpenMelds(..., forceBurraco)` chiama `dirtyToComplete` (sporca un gioco da 6 con matta → 7), lo scarto passa a `defensiveDiscard` (massimizza `pointsOf` sgombrato, malus −100 se appoggiabile ai loro, −60 se matta: le matte si CALANO, non si regalano). `opponentClosingImminent` (≤`OPPONENT_CLOSE_IMMINENT(1)`) in `decideDiscard` **salta il gate `attendsBoard`** (attenzione massima anche da distratti). Regola: contro la chiusura, jolly/pinelle si neutralizzano CALANDOLI, mai scartandoli a chi sta per chiudere.
- **Scale con asso alto**: la generazione dei giochi (`findOpenMelds`) fa un DOPPIO passaggio per seme via `collectRunSegments(group, aceHigh, wild)` — asso basso sempre, asso alto se c'è un asso. Non duplicare la logica dei segmenti altrove; il verso/posizionamento dell'asso è comunque deciso da `Rules` (fonte di verità), l'IA propone solo i candidati.
- **Modello del contenuto delle mani avversarie**: `opponentWantsValue(value)` legge l'`opponentModel` episodico (`discardsByValue`, raccolto in `observe`) — un valore MAI scartato da un avversario che ha già scartato ≥`WANT_MIN_DISCARDS` volte è probabilmente raccolto → alza il `danger` nello scarto, pesato da `attention`. È l'unico consumo dell'`opponentModel` nelle decisioni (prima era raccolto e basta). Modello volutamente grezzo (solo valori, no semi, no `take_discard`).
- **Test IA** (`default.ai.spec.ts`): SEMPRE iniettare `rng` (decisioni stocastiche); `rng = () => 0` = "sempre attenta / ricorda tutto". Sottoclasse `TestAi` per esporre i metodi protetti (`closingStance`/`opponentClosingThreat`/`opponentClosingImminent`/`opponentWantsValue`/`frameByAttribution`); il resto si testa dal comportamento pubblico. `new Rules()` diretto, carte da tag via `new DeckItem('7♥️')`.
- **Opportunismo** (asse `opportunism`, sia gioco sia voce): _gioco_ — in `closingStance`, potendo chiudere e con avversari carichi (`opponentsLoaded`, media ≥`OPPONENT_LOADED 8`) forza `rush` per infliggere penalità (la cooperazione può comunque frenare se il compagno è pieno). _Voce_ — un altro "in difficoltà" (`actorInDifficulty`: ha appena SCARTATO con mano ≥`DIFFICULTY_HAND 9` a giochi in tavola): compassionevole (≤`COMPASSION_MAX 0.4`) → `encourage`; opportunista (≥`OPPORTUNISM_MIN 0.6`) → sfotte (`opponent:bad`) e si vanta su self:good scavalcando `selfIrony`. Lo sfottò a chi sbaglia usa `max(meanness, opportunism)`.
- **`luckAttribution`** (voce): `frameByAttribution` rilegge `good`↔`lucky` prima di scegliere la battuta (basso ≤0.4 → merito; alto ≥0.6 → fortuna), con fallback alla qualità reale se manca la battuta. Aggiunta chiave `self:lucky`.
- **Voce che legge la PARTITA** (`standingBanter`): a `hand_start`/`game_end` legge `matchScore`; distacco ≥`STANDING_GAP 200` sotto → `standing:behind` (rimonta), sopra → `standing:ahead` (sfottò, solo `max(opportunism,meanness)`). L'apertura partita (`openingBanter`, ex `banter`) resta a `game_start` (saluto/rivale). NB: la `quality` degli eventi non è calcolata dal conduttore e `assessQuality` non emette mai `bad` → la "difficoltà" NON si basa su `bad` ma sui conteggi mano pubblici.
- **Fine-tallone** (`round.ts`, regolamento §6): `nextTurn` se `!drawPile().length` → `endByStockExhaustion` (mano chiusa SENZA +100; `computeScore(closer: RoundTeam|null)`; vince il totale più alto). Reachability: il monte scarti si ristabilizza sempre a ≥1 carta, quindi "tallone esaurito a inizio turno" è l'unica condizione terminale deterministica (both-empty è irraggiungibile). Flag `endedByStockExhaustion` (persistito in get/restoreState) → Game → Board → dicitura "Fine tallone!" in `ui-hand-result`. Scelta: la mano finisce appena il tallone finisce (niente riciclo del monte dopo l'esaurimento).

## Sessione 5 (2026-07-05): fumetti (balloon) delle IA per-posto

- **Un fumetto per posto, dal proprio lato**: `ui/speech-bubble/` (componente presentazionale `ui-speech-bubble`, input `text`/`side`/`label`) va posto DENTRO il seat `relative` di ciascun giocatore; si posiziona in assoluto verso il centro con la coda che punta al posto. In Board `aiSpeech` è un **record per-posto** (`Record<PlayerSide, string|null>`, non più una singola battuta globale) e `say()` tiene un **timer di scomparsa per posto** (2800 ms, resettato solo dal proprio) → più IA possono parlare insieme, ciascuna dal proprio lato.
- **`w-max` + `max-w-*` obbligatori sul wrapper del fumetto**: i posti EST/OVEST sono contenitori larghi ~40px e fanno da containing block; un elemento `absolute` senza larghezza naturale vi collassa a `min-content` (una parola per riga) e `max-w` da solo NON basta. `w-max` (width: max-content) prende la larghezza del testo, cappata da `max-w-*`, poi va a capo. Nord/Sud non ne avrebbero bisogno (containing block largo) ma lo usano per uniformità.
- **Coda del fumetto = quadratino ruotato 45° dello STESSO bg** che si fonde col box (niente shadow/z propri): la parte che sporge fa da punta. Orientata via `side` verso il posto.
- **Le animazioni/transition CSS su elementi NON-carta dentro `uiTweenScope` sono sicure**: il Tweener fa pairing SOLO per `tween-id`, quindi un overlay senza `tween-id` (il fumetto) è ignorato. La regola madre "un solo motore anima il MOVIMENTO delle carte" vale per le proprietà del FLIP delle carte (top/left/transform/rotate/translate degli elementi con `tween-id`), non per gli overlay UI: il fumetto può avere la sua `@keyframes` (`bubble-in`) anche stando dentro lo scope.

## Sessione 6 (2026-07-05): consolidamento — fix di correttezza, allineamento FIBUR, ottimizzazioni

Passata di consolidamento (analisi dell'intero progetto). Principi vincolanti che ne restano:

- **`getIncastroTag` è DIREZIONALE** (`rules.ts`): il tag di sostituzione della matta-incastro si calcola con `STARTER_DECK.indexOf(card.tag) - rankDirection(cards) * offset`, come `getCardAbsPos`. Con `- offset` (senza verso) su una scala memorizzata DECRESCENTE (l'ordine reale a terra) restituiva il tag sbagliato e rifiutava una mossa legale comune (liberare la matta). Regola: qualunque calcolo di posizione su un gioco a terra deve tenere conto del verso dell'array.
- **L'IA non deve MAI incastrarsi in uno scarto illegale** (`default.ai.ts`): `decidePlays` ha una rete anti soft-lock (`hasLegalDiscardAfter`) SEMPRE attiva (ogni stance, anche `rush`), che ritira calate finché resta uno scarto LEGALE. Illegali (rifiutati dal Round): chiudere scartando una matta (Art. 14) e svuotarsi senza poter chiudere (§6). La riserva di scarto SICURO (`hasSafeDiscardAfter`) resta separata e opzionale (da esperti, non in rush); la rete LEGALE è obbligatoria. Doppia difesa: il conduttore (Board) se `game.discard` è rifiutato ripiega su un naturale e, se impossibile, **sospende il turno senza ri-schedularlo** (mai loop infinito).
- **Regolamento FIBUR — allineamenti nel Round** (`round.ts`): (a) monte di UNA carta non ri-scartabile subito dopo la presa salvo duplicato in mano (Art. 7, flag transitorio `collectedSingleValue`); (b) dopo aver preso il pozzetto ci si svuota la mano SOLO chiudendo (scarto dell'ultima carta senza burraco rifiutato); (c) penalità pozzetto solo se ALMENO una coppia l'ha preso (`anyPotTaken`; rilevante nel fine-tallone precoce). **Fine-tallone verificato conforme** (§6 nomina il fine-tallone come chiusura senza +100, senza obbligo di far raccogliere il monte al successivo): comportamento attuale invariato.
- **Contratto IA read-only blindato**: `buildView` (Board) passa COPIE shallow degli array esposti (`hand`/`myMelds`/`theirMelds`/`discardPile`); un `.sort()`/`.push()` in-place dell'IA non può corrompere lo stato del Game (single-writer).
- **`OnPush` sui componenti signal-driven**: `Card`/`Deck`/`Board`/`SpeechBubble`/`HandResult` sono `ChangeDetectionStrategy.OnPush` (tutto lo stato reattivo è signal/input; sicuro con zoneless). Non introdurre in questi template letture di campi mutati imperativamente senza un signal.
- **Board ripulisce le sue risorse** (`ngOnDestroy`): subscription a `Game` (singleton) via `takeUntilDestroyed`, `ResizeObserver.disconnect`, listener `matchMedia` rimosso, `speechTimers` cancellati. Le subscription a un singleton non ripulite = leak + doppio handling.
- **Turno IA invalidato dalla generazione** (`resetGen`): `runAiTurn` cattura `gen = resetGen` all'avvio; `reset`/`apply-state` incrementano `resetGen` e sbloccano lo `stepResolver` (pausa manuale) → il turno sospeso, ripreso, esce subito via `turnStale(gen)` e il `finally` azzera `busy` (prima RESET in manuale lasciava `busy=true` per sempre).
- **`board.lastError` = passthrough di `game.lastError`**: gli errori delle mosse (umane illegali) ora sono VISIBILI (prima un signal locale sempre null li nascondeva).
- **`completerTags` consapevole dell'asso alto** e **`findOpenMelds` costruisce scale col 2 naturale**: la generazione candidati dell'IA copre `…-Q-K-A` (rank con `aceHigh`) e `A-2-3`/`2-3-4` (il 2 come naturale, jolly/2-di-altro-seme come matta-completatore). La validità resta di `Rules`.
- **`tween-data` via metodo `Deck.tweenData(...)`** (stringa già serializzata) invece di oggetto letterale + `| json` nel template (nuova reference/ristringa a ogni CD).
- **`getCardRank`**: le figure sono una costante di modulo (`FIGURE_RANKS`), niente riallocazione nell'hot-path dei sort. `isNatural2`/`aceMayBeHigh` accettano `readonly DeckItem[]` (niente `DeckItems.fromArray` ridondante per carta in `getCardAbsPos`).
- **NON riordinare il check `suspendHistory`** nell'effect di persistenza (`game.ts`) mettendolo PRIMA della lettura dei signal: perderebbe le dipendenze reattive e la persistenza non ripartirebbe dopo un replay. (Ottimizzazione valutata e SCARTATA per questo motivo.)

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
