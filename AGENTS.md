# Orario Generale – più sedi

Istruzioni per qualsiasi assistente di programmazione (Codex, Gemini, Cursor e altri). Claude Code legge
`CLAUDE.md`, che contiene tutto (decisioni dell'utente, mappa del codice, controlli prima di un push, anteprime):
leggilo anche tu, vale per tutti. Qui le regole da non dimenticare.

App «Orario Generale»: orario, assenze, sostituzioni e report per più sedi (plessi) dell'istituto comprensivo, nata
dall'app di Rombiolo (`Loucian664/gestione-docenti`, che da qui non va toccata). Sito statico:
https://loucian664.github.io/gestione-docenti-multisede/ (pubblicato da `.github/workflows/pages.yml` a ogni push
su `main`); i dati restano nel browser e si spostano con il backup JSON.

## Calcolo lungo dell'orario

Se il messaggio dell'utente inizia con «Calcolo lungo dell’orario», segui `CALCOLO-LUNGO.md`.

## Regole

- L'utente non programma: rispondi in italiano, parlando dell'app (schermate, tasti, dati), non di comandi o file,
  salvo richiesta.
- Per le modifiche grandi prima si discute: proponi, spiega cosa cambia per chi usa l'app, aspetta l'OK.
- Su GitHub (commit, push, richieste di unione) solo con l'OK esplicito dell'utente.
- I backup JSON dell'utente e le sue schermate contengono nomi veri di colleghi: usali solo nella tua cartella di
  lavoro. Mai in commit, test, anteprime pubbliche o messaggi su GitHub.
- Non cambiare colori, caratteri o logica oltre quanto chiesto.
- Test: `npx tsx --test src/lib/*.test.ts`; controllo dei tipi: `npx tsc --noEmit`.
