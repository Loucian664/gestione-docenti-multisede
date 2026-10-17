# Gestione Docenti – più sedi

## Chi e cosa

- L'utente è il responsabile di plesso di Rombiolo e non programma: rispondi sempre in italiano, parlando
  dell'app (schermate, tasti, dati) e non di comandi o file, salvo richiesta.
- Obiettivo: un'app che costruisca l'orario per più sedi (plessi) dell'istituto comprensivo. Rombiolo è
  una di queste.
- Punto di partenza: copia, al 17/10/2026, dell'app di Rombiolo (repository `Loucian664/gestione-docenti`,
  sito https://loucian664.github.io/gestione-docenti/). Quella repository e quel sito restano separati:
  da qui non vanno toccati.

## Come lavorare

1. Per le modifiche grandi prima si discute: proponi, spiega cosa cambia per chi usa l'app, aspetta l'OK.
2. Le prove vanno prima in un'anteprima privata su Claude (Artifact, vedi sotto), non su GitHub.
3. Su GitHub solo con l'OK esplicito dell'utente. Un commit per modifica, messaggio in italiano che dice
   cosa cambia nell'app. Rami con nomi che ricordano la modifica (es. `slot-salvataggio-orari`).
4. Non cambiare colori, caratteri o logica oltre quanto chiesto. Mai `prettier --write` (né
   `npm run format`) su file interi.
5. Chiudi i server temporanei dopo le prove.

## Nomi veri: mai pubblicarli

- I backup JSON dell'utente e le sue schermate contengono nomi veri di colleghi. Usali solo in locale,
  in una cartella temporanea: mai in commit, anteprime, test o messaggi su GitHub.
- Prima di pubblicare un'anteprima, controlla che non contenga nessun nome (o cognome) dei docenti del
  backup.

## Dati nel browser

- Niente server, database o login: il sito è statico (GitHub Pages) e i dati restano nel browser
  (localStorage, sessionStorage, IndexedDB) con il nome `gestione-docenti-multisede`
  (`src/lib/persist-storage.ts`, `src/lib/store.ts`).
- Le due app stanno sullo stesso indirizzo (`loucian664.github.io`), quindi il browser le tratta come un
  unico sito. Mai usare `copertura-plesso` né `copertura-plesso-v2` … `-v5`: sono i dati dell'app di
  Rombiolo, da non leggere né cancellare. Condivise restano solo la scelta del tema
  (`gestione-docenti-theme`, `gestione-docenti-theme-hours`) e `gestione-docenti-ritocchi-dettagli`.
- I dati si spostano col backup JSON (Impostazioni → Importa / Esporta backup). Se il formato cambia,
  i backup dell'app di Rombiolo devono continuare ad aprirsi (`PERSIST_VERSION` e `migrate` nello store,
  `parseBackupJson` in `src/lib/export.ts`).

## Pubblicazione

- `.github/workflows/pages.yml`: a ogni push su `main` esegue `npm run build:pages` (con
  `GITHUB_PAGES=true` e `BASE_PATH=/<nome repository>/`) e pubblica su
  https://loucian664.github.io/gestione-docenti-multisede/. Non esegue i test.
- `server/`, `migrations/`, `src/lib/auth`, `src/lib/db.ts`, `startup.sh`, `public/__grok` sono resti
  del modello iniziale (Grok App Builder): il sito pubblicato non usa server, database né login, e le
  regole di quel modello (porta 8080, `startup.sh`, ecc.) qui non valgono.

## Controlli prima di un push

- Test di `src/lib`: per ogni `src/lib/*.test.ts`
  `node_modules/.bin/rolldown <file> --platform node --format esm --file <cartella>/<nome>.mjs`,
  poi `node --test <cartella>/*.mjs` (121 test al 17/10/2026). `npm test` non li esegue.
- `npx tsc --noEmit`: 10 errori già presenti; non devono aumentare.
- `GITHUB_PAGES=true BASE_PATH=/gestione-docenti-multisede/ npm run build:pages` deve riuscire.
- Nei test del motore usa l'orologio finto (`now: ticks()` in `src/lib/timetable-solver.test.ts`), così
  il risultato non dipende dalla velocità del computer. Il test «al massimo un'ora libera tra le
  lezioni…» usa ancora il tempo reale e sotto carico può fallire di rado.

## Anteprima su Claude

Una copia di prova, non il codice vero:

1. In una copia di `src` e `public`, il router usa `createHashHistory()` (in `src/router.tsx`:
   `history: typeof window !== "undefined" ? createHashHistory() : undefined`).
2. `GITHUB_PAGES=true BASE_PATH=./ npm run build:pages`, poi `dist/client` → cartella `app/`, con
   `_shell.html` rinominato `index.html` e senza `__grok/install`.
3. In `app/index.html` sostituisci `"/./assets/` con `"./assets/` e i caratteri NUL con `\u0000`; nei
   `.js` e `.css` di `assets/` scrivi `�` al posto del carattere U+FFFD.
4. Una pagina `index.html` che apre `app/index.html` in un iframe a tutto schermo, pubblicata come
   Artifact.

## Mappa del codice

- `src/lib/types.ts`: modello dati (`Teacher`, `SchoolClass`, impostazioni con `plesso`, `PersistedData`).
- `src/lib/store.ts`: stato dell'app e slot degli orari; `src/lib/persist-storage.ts`: salvataggio.
- `src/lib/timetable-solver.ts`: motore di Costruisci («Da zero», «Migliora l'attuale», Ritocchi, Trova,
  ore a disposizione nelle buche); `timetable-worker.ts` e `timetable-runner.ts` lo fanno girare in
  background.
- `src/lib/saved-timetables.ts` e `src/components/save-slots.tsx`: slot (0 = orario in vigore, 1–5 prove).
- `src/components/costruisci-orario.tsx`: scheda Costruisci.
- `src/lib/export.ts`, `xlsx.ts`, `pdf.ts`, `sheet-image.ts`: backup, Excel, PDF, immagini.
- `src/routes/`: pagine Oggi (`index`), Orario, Assenze, Docenti, Classi, Report, Impostazioni.

## Più sedi: com'è oggi

L'app gestisce un plesso alla volta (`plesso` nelle impostazioni). Chi insegna anche altrove ha
`otherPlesso` e le ore occupate nell'altra sede in `awaySlots` (le «×»), segnate a mano; il motore ne
tiene conto e lascia un'ora libera di spostamento prima e dopo. Da costruire: più sedi nello stesso
archivio e docenti condivisi coordinati dall'app.

## Parole dell'app

ora a disposizione («disp.»), ora buca, compresenza, sostegno (nelle caselle delle classi e nelle
stampe compare il docente della lezione, mai il sostegno al suo posto), potenziamento, rientro (tempo
prolungato, T.P.), ore «no» del docente, ore bloccate, «Accetta ore libere» / «Accetta 2 ore libere in
mezzo».
