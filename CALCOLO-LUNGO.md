# Calcolo lungo dell'orario

Istruzioni per chi esegue il calcolo: Claude Code, Codex, Gemini o qualsiasi altro assistente che possa aprire
questa repository ed eseguire programmi. Rispondi all'utente in italiano, parlando dell'app (schermate, slot, ore
buche), non di comandi, salvo richiesta.

Chi usa l'app prepara la richiesta in Orario → Costruisci → «Calcolo lungo con un assistente di programmazione»:
l'app salva il backup (file JSON) e copia un messaggio che inizia con «Calcolo lungo dell’orario» e contiene
partenza, slot, durata e il comando già pronto. Lo stesso motore di «Proponi orario» gira molto più a lungo, in più
processi, e le versioni migliori, diverse tra loro, vanno negli slot scelti dentro il backup. Tutto il resto del
backup resta identico.

Si calcola la sede in uso nel backup (con le ore dei docenti nelle altre sedi come ×, come in Costruisci) oppure
tutte le sedi insieme. Con tutte le sedi, le versioni si alternano tra le impostazioni di «Proponi» per tutte le
sedi (equilibrato, giorni in un plesso, meno ore buche) e ognuna va nello stesso slot di ogni sede, collegata come
i salvataggi «Tutte le sedi insieme».

## Regole

- Non scrivere mai un orario a mano e non modificare il file di uscita. Se non puoi eseguire il programma, fermati e
  dillo. Ogni versione scritta dal programma ha un codice di controllo: importando, l'app riconosce le versioni
  scritte o cambiate a mano e avvisa l'utente.
- Il backup contiene nomi veri di persone: tienilo solo nella tua cartella di lavoro. Mai nella repository, in un
  commit, in un test o in un servizio esterno.
- Non modificare il codice e non pubblicare nulla (niente commit, push o richieste di unione).

## Passi

1. Serve Node 22 o più recente. Nella repository: `npm ci`.
2. Esegui il comando del messaggio, con il percorso del backup al posto di `<percorso del backup>`, per esempio:
   `node scripts/calcolo-lungo.mjs --backup backup.json --sedi tutte --modo da-zero --slot 1,4,5 --minuti 60`
   Se il messaggio manca o è incompleto, chiedi all'utente sedi (solo quella in uso o tutte), partenza, slot (e quali
   sostituire) e durata.
3. Il programma si ferma da solo dopo i minuti chiesti. Avvialo in modo che possa durare tutto il tempo: per
   esempio in background, con un limite pari alla durata più 15 minuti. Se il tuo ambiente non permette di tenerlo
   in esecuzione così a lungo, usa un `--minuti` più basso e dillo all'utente.
4. Il file di uscita (`<backup>-calcolo-lungo.json`, oppure quello di `--uscita`) si scrive ogni 5 minuti e quando
   il programma viene fermato (Ctrl+C, SIGTERM): contiene sempre le versioni migliori trovate fino a quel momento.
5. Se il programma si rifiuta di partire (slot occupato da non sostituire, slot in uso nell'app, materie senza
   docente, sedi che non si possono costruire insieme…), stampa il motivo: spiegalo all'utente con parole semplici
   e chiedi come procedere. Non forzare.
6. Alla fine manda all'utente il file di uscita, con un riepilogo in parole semplici: per ogni slot le ore buche e le
   eventuali voci da sistemare, a confronto con l'orario attuale (il programma le stampa). Le versioni sono in
   ordine di valutazione complessiva dell'app, non solo di ore buche.
7. Ricorda all'utente: Impostazioni → Importa backup. Se nel frattempo sul dispositivo ha segnato assenze o
   sostituzioni, l'app avvisa che il backup è più vecchio: meglio non importarlo e rifare il calcolo da un backup
   nuovo.

## Opzioni del programma

| Opzione | Significato |
| --- | --- |
| `--backup <file>` | il backup esportato dall'app (obbligatorio) |
| `--sedi sede` / `--sedi tutte` | solo la sede in uso nel backup, oppure tutte le sedi insieme |
| `--modo da-zero` / `--modo migliora` | partenza: da zero, oppure migliorando l'orario attuale |
| `--slot 1,4,5` | slot da riempire (da 1 a 5), una versione per slot |
| `--sostituisci 4` | tra gli slot scelti, quelli già occupati che si possono sostituire |
| `--minuti 60` | durata del calcolo |
| `--uscita <file>` | file di uscita (di solito accanto al backup, con «-calcolo-lungo» nel nome) |
| `--corsa 120` | secondi di ogni corsa del motore |
| `--processi 3` | processi di calcolo (di solito i processori meno uno) |
| `--salva-ogni 5` | ogni quanti minuti si scrive il file di uscita |

## File

`scripts/calcolo-lungo.mjs` (compila e avvia), `scripts/calcolo-lungo-run.ts` (processi e salvataggi),
`src/lib/calcolo-lungo.ts` (richiesta, messaggio, versioni, codice di controllo; con i test),
`src/components/calcolo-lungo.tsx` (il riquadro dell'app).
