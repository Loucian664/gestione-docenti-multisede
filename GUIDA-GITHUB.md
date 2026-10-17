# Orario Generale su GitHub (senza saper programmare)

La repository c’è già: si chiama **`gestione-docenti-multisede`** ed è separata da quella dell’app di Rombiolo (`gestione-docenti`), che resta com’è.

Non caricare mai su GitHub il file JSON dei tuoi dati: contiene i nomi dei colleghi. Quello resta sul Mac e sull’iPhone.

---

## 1. I due indirizzi

- **Il sito (l’app):** [https://loucian664.github.io/gestione-docenti-multisede/](https://loucian664.github.io/gestione-docenti-multisede/)
- **Il cassetto (il codice):** [https://github.com/Loucian664/gestione-docenti-multisede](https://github.com/Loucian664/gestione-docenti-multisede)

L’app si usa sempre dall’indirizzo con **github.io** nel mezzo.

---

## 2. Come si aggiorna il sito

Ogni modifica approvata e messa su `main` ripubblica il sito da sola.

1. Nel cassetto: scheda **Actions**
2. In cima all’elenco: **Pubblica sito**, con il messaggio dell’ultima modifica
3. Aspetta 1–2 minuti: il pallino deve diventare **verde**

Se è **rosso**: apri quella riga, fai uno screenshot e mandamelo. Non è il tuo registro: è solo la pubblicazione.

Se un giorno la scheda Actions non pubblica più nulla:

1. **Settings** (ingranaggio in alto) → a sinistra, in fondo: **Pages**
2. **Source**: **GitHub Actions**
3. Torna su **Actions** → **Pubblica sito** → **Run workflow** → **Run workflow**

---

## 3. Sul telefono

1. Apri il sito su iPhone, in Safari
2. Pulsante Condividi → **Aggiungi a Home**
3. Il nome proposto è **Orario Generale**: se sotto l’icona esce tagliato, puoi accorciarlo qui
4. **Aggiungi**

Sulla Home le due app si distinguono dall’icona: **due persone** con le frecce è Gestione Docenti (Rombiolo), il **calendario** è Orario Generale.

Se avevi già aggiunto questa app con l’icona vecchia, l’icona non cambia da sola. Prima fai **Impostazioni → Esporta backup**, poi togli l’icona dalla Home e aggiungila di nuovo. Se i dati non ci sono più: **Impostazioni → Importa backup**.

---

## 4. I tuoi dati

I dati di questa app sono **separati** da quelli di Gestione Docenti, anche sullo stesso telefono.

Per partire dai dati di Rombiolo:

1. In Gestione Docenti: **Impostazioni → Esporta backup**
2. Salva il file su iCloud / File
3. In Orario Generale: **Impostazioni → Importa backup** e scegli quel file

Ogni dispositivo ha i **suoi** dati. Se vuoi gli stessi dati su iPhone e Mac, importa lo stesso JSON su entrambi.

Ogni tanto: esporta di nuovo il JSON e tieni una copia.

---

## Se qualcosa non si apre

- **Link 404:** controlla che l’indirizzo finisca con `/gestione-docenti-multisede/`
- **Pagina bianca:** Actions rossa → screenshot
- **«Non è questo il programma»:** stai aprendo github.com/Loucian664/gestione-docenti-multisede (il cassetto) invece del link `github.io` (il sito)
- **Si apre l’app di Rombiolo:** l’indirizzo è quello senza `-multisede`
