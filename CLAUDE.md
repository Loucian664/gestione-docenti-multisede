# Gestione Docenti – più sedi

## Chi e cosa

- L'utente è il responsabile di plesso di Rombiolo e non programma: rispondi sempre in italiano, parlando
  dell'app (schermate, tasti, dati) e non di comandi o file, salvo richiesta.
- Obiettivo: un'app che costruisca l'orario per più sedi (plessi) dell'istituto comprensivo. Rombiolo è
  una di queste.
- L'aspetto resta quello dell'app di Rombiolo (colori, caratteri, impaginazione); l'icona può cambiare,
  ma nello stesso stile. La nuova app ha solo più funzioni.
- Nome dell'app: «Orario Generale» (titolo, scritta in alto, nome sotto l'icona). Icona scelta
  dall'utente: solo un calendario color crema, centrato, sullo stesso identico sfondo dell'icona di
  Rombiolo (verde scuro con la sua grana); nella scheda del browser, lo stesso calendario.
- I test copiati dall'app di Rombiolo contengono cognomi veri: per ora restano (decisione dell'utente,
  se ne riparla alla fine del lavoro). Nei test nuovi solo nomi inventati.
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
- Anteprime private su Claude: dal 18/10/2026 l'utente vuole i dati veri (nomi reali compresi). Nell'anteprima
  la sede Rombiolo viene dal suo backup (con assenze, sostituzioni e orari salvati), accanto alle sedi
  inventate; la copia di prova usa un nome di salvataggio suo (es. `gestione-docenti-multisede-rombiolo`).
  Nel codice, nei test, nei commit e sul sito pubblicato restano gli esempi con nomi inventati.

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
  poi `node --test <cartella>/*.mjs` (156 test al 18/10/2026). `npm test` non li esegue.
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
- `src/lib/sedi.ts`: più sedi (cambio sede, sedi non in uso, docenti in comune con `personId`, × automatiche
  dalle altre sedi con `withOtherSedi`); `src/routes/sedi.tsx`: pagina Sedi; `src/components/campanella-editor.tsx`:
  orari di una sede.
- `src/lib/sedi-insieme.ts`: «Tutte le sedi insieme» (dati di tutte le sedi per il motore con `buildInsieme`,
  risultato di nuovo per sede con `splitInsieme`, ore a disposizione per sede con `insiemeParts`);
  `src/components/vista-generale.tsx`: vista generale (Giorno, Settimana, Docenti, Classe su tutte le sedi).
- `src/lib/timetable-solver.ts`: motore di Costruisci («Da zero», «Migliora l'attuale», Ritocchi, Trova,
  ore a disposizione nelle buche); `timetable-worker.ts` e `timetable-runner.ts` lo fanno girare in
  background.
- `src/lib/saved-timetables.ts` e `src/components/save-slots.tsx`: slot (0 = orario in vigore, 1–5 prove).
- `src/components/costruisci-orario.tsx`: scheda Costruisci.
- `src/lib/export.ts`, `xlsx.ts`, `pdf.ts`, `sheet-image.ts`: backup, Excel, PDF, immagini.
- `src/routes/`: pagine Oggi (`index`), Orario, Assenze, Docenti, Classi, Sedi, Report, Impostazioni.

## Più sedi: com'è oggi

Più sedi nello stesso archivio (tappa 1). La sede in uso tiene i suoi dati in cima, come l'archivio di un
plesso dell'app di Rombiolo: pagine, motore ed esportazioni lavorano su quelli. Le altre stanno in
`altreSedi` (`sedeId`, `ordineSedi`); cambiare sede scambia i dati e fa ripartire la pagina. Un backup
dell'app di Rombiolo diventa una sede sola; un backup di questa app aperto in quella mostra solo la sede in
uso. Chi insegna in più sedi ha una scheda in ognuna con lo stesso `personId` (nome, materie, ruolo e colore
sincronizzati); in Costruisci le sue ore nelle altre sedi diventano × automatiche (`withOtherSedi`), sulla
campanella della sede in uso, e il motore lascia l'ora di spostamento. Le × a mano (`awaySlots`) restano
per giornate intere e impegni; `otherPlesso` a mano vale per chi insegna in sedi fuori dall'app. Gli esempi
hanno due sedi con nomi inventati.

Tappa 2: in Costruisci «Tutte le sedi insieme» (solo sedi con gli stessi giorni e le stesse ore del
mattino; le ore si abbinano per numero). Il motore riceve le classi di tutte le sedi con la sede di ognuna
(`InsiemeInfo` in `timetable-solver.ts`: `nSedi`, `classSede`, `sedeUnavail`, `tSede`); vincoli rigidi: mai
due sedi alla stessa ora, un'ora libera tra lezioni in sedi diverse, al massimo un cambio di sede al giorno,
× valide solo nella loro sede; le giornate in due sedi pesano come «qui e nell'altro plesso». Le ore a
disposizione restano ferme durante la ricerca e si sistemano dopo, sede per sede. «Salva nello slot…» e
«Usa questa proposta» valgono per tutte le sedi con lo stesso numero di slot. In Orario, Quadro e
Settimana hanno «Tutte le sedi» (sola lettura); in Docente, per chi insegna in più sedi, ogni ora porta il nome
della sua sede, anche quelle della sede in uso, e tutte hanno il colore del docente; nella vista Giorno le sedi vanno a capo su più file, in ordine, quante ne
servono per la larghezza dello schermo (`righeSedi`). Da costruire: «Esporta sede» e «Riporta sede» (tappa 3).

Eliminare una sede (pagina Sedi, due avvisi): si cancellano classi, orario, docenti solo lì, orari salvati e
assenze. I docenti in comune conservano le ore di quella sede (`removedSedi`: nome, ore, giorno), perché nella
realtà le insegnano ancora: valgono «Su più plessi» e, finché le × a mano sono meno di quelle ore, Costruisci
mostra l'avviso «Ore in sedi fuori dall'app» e non propone l'orario («Non insegna più lì» toglie la sede).
Ritocchi e «Trova»: una mossa che mette un docente su una ×, senza ora di spostamento, in due classi insieme o
contro le regole tra sedi non si può fare, anche se toglie altri vincoli (`dphys` in `PeekResult`).
«Ritocca a mano» con «Tutte le sedi insieme» (dalla proposta o dagli orari in uso): lo stesso pannello dei
ritocchi sui dati uniti (`insieme` passato a `Ritocchi`), classi con il nome della sede, catene tra sedi;
«Salva nello slot…» e «Usa questo orario» valgono per tutte le sedi; i lucchetti lì non si cambiano.
Scheda docente con più sedi: «Classi e materie» ha un riquadro per ogni sede spuntata in «Sedi in cui insegna»;
salvando, ogni riga va nella scheda della persona in quella sede (`saveTeacherSedi`, `saveTeacherCardSedi` nello
store) e un avviso dice cosa è cambiato nelle altre sedi. «Ore cattedra» è il totale di tutte le sedi
(`cattedraTotal`): nelle altre sedi valgono le ore delle righe, alla sede in uso va il resto. Una sede si toglie
quando non ha più righe né lezioni in orario. Il potenziamento resta per sede.
Classi tolte dalla scheda: se le sue lezioni sono ancora nell'orario di quella sede, il riquadro lo dice e
«Toglile dall'orario quando salvi» (spuntata) le toglie (`drop` in `saveTeacherCard`/`saveTeacherCardSedi`);
tolte quelle, la sede si può togliere. Una cattedra salvata senza docente resta senza docente: il docente si
ricava solo da chi la insegna già nell'orario (`inferTeacherId` con `fromSlotsOnly` in `resolveCattedre`), non
da chiunque abbia quella materia. Con «Tutte le sedi insieme» Costruisci elenca prima le materie senza
docente di ogni sede. «Elimina» nella scheda toglie il docente solo dalla sede in uso.
Materie senza docente (decisione dell'utente: mai senza avviso): `missingTeachers` (build-timetable) e
`missingBySede` (sedi) le contano, con i rientri senza docente e, a parte (`tn`), le righe di Mensa o Laboratorio
in una classe a tempo normale (es. una riga rimasta nella 1ª A di Rombiolo). Compaiono nel riquadro «Materie senza
docente» (`MissingTeachersBox`) in Costruisci e in Docenti, accanto alla classe in Classi, nella scheda della
sede in Sedi e, salvando o eliminando un docente, in un avviso «Restano senza docente: …».
Nella scheda docente «+ Mensa» e «+ Laboratorio» propongono una classe a tempo prolungato della sede (quella
delle sue righe, se c'è; senza classi a T.P. la classe resta da scegliere); su una classe a tempo normale la
riga mostra un avviso.

## Più sedi: decisioni dell'utente (17/10/2026)

- Solo scuole secondarie di I grado. Oggi nessuna sede fa lezione il sabato, ma i giorni restano
  modificabili.
- Le sedi sono 6: alcune con una classe sola, altre con 3, altre con 6 come Rombiolo. Prova del
  18/10/2026 con 6 sedi inventate (6, 6, 3, 3, 1, 1 classi; 600 ore; 19 docenti in più sedi, fino a 4):
  «Tutte le sedi insieme» in 30 secondi mette tutte le ore e rispetta le regole tra sedi, anche con le ×
  su tutta la giornata ricavate da un orario possibile.
- Le × hanno due significati: ore di lezione vere nell'altra sede, oppure giornata intera altrove per
  comodità (anche se lì il docente fa meno ore). Giornate intere in una sola sede: preferenza; chi deve
  stare tutto il giorno in una sede ha la × su tutta la giornata, e quella va sempre rispettata.
- Spostamento tra due sedi: sempre un'ora intera libera. Al massimo un cambio di sede al giorno (mai
  sede A, poi B, poi di nuovo A).
- Docente con le × su tutte le mattine perché fa solo le ore del T.P.: va bene così.
- Laboratori del T.P.: come a Rombiolo. Ogni rientro è Mensa + 2 ore di Laboratorio (7ª e 8ª) con lo stesso
  docente, segnate come materie «Mensa» e «Laboratorio» nella sua scheda; chi fa solo quelle ore ha le × su
  tutte le mattine.
- Dati delle altre sedi: arriveranno i PDF delle assegnazioni dei docenti alle classi (con i nomi delle
  sedi) e degli orari in vigore (solo materia e cognome). Usarli solo in locale; se sedi, omonimie o
  cognomi non sono chiari, chiedere all'utente.
- Strumento (chitarra, pianoforte, flauto): resta nell'elenco docenti senza orario (lezioni individuali
  al pomeriggio); serve per le sostituzioni.
- Le sostituzioni di ogni giorno restano nell'app di Rombiolo: qui Oggi, Assenze e Report restano come
  sono, senza funzioni nuove.
- L'orario lo fa l'utente per tutte le sedi insieme; poi esporta quello di ogni sede per l'app della
  singola scuola, dove si può migliorare. Niente confronto con altri programmi d'orario.

## Piano a tappe

0. Distinguere le due app: icona, nome «Orario Generale», README e GUIDA-GITHUB con il nuovo indirizzo,
   via «Scarica zip per GitHub».
1. Voce «Sedi» nel menu, dopo Classi: per ogni sede nome, responsabile, giorni e campanella. Ogni classe
   in una sede. Docenti: elenco unico con filtri per sede e per materia, ore per sede nella scheda, sede
   scelta a mano per chi non ha classi (strumento, potenziamento); «Su più plessi» automatico. Orario
   una sede alla volta. Il backup dell'app di Rombiolo diventa la sede Rombiolo.
2. Costruisci per tutte le sedi insieme, con le regole qui sopra.
3. «Esporta sede»: un backup che si apre nell'app della singola scuola; docenti in comune «Su più
   plessi» con × su tutta la giornata nei giorni solo altrove e × sulle ore vere nei giorni divisi. Lì
   «Importa backup» sostituisce tutto (anche assenze e coperture): va fatto a inizio anno. Poi,
   facoltativo, «Riporta sede»: rimette qui l'orario migliorato, controllando i docenti in comune.

## Parole dell'app

ora a disposizione («disp.»), ora buca, compresenza, sostegno (nelle caselle delle classi e nelle
stampe compare il docente della lezione, mai il sostegno al suo posto), potenziamento, rientro (tempo
prolungato, T.P.), ore «no» del docente, ore bloccate, «Accetta ore libere» / «Accetta 2 ore libere in
mezzo».
