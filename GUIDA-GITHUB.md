# Mettere Gestione Docenti su GitHub (senza saper programmare)

Fallo al computer (Mac). Il telefono serve solo alla fine, per aprire il link.

Non caricare il file JSON dei tuoi dati. Quello resta sul Mac/iPhone.

---

## 1. Account

1. Apri [github.com](https://github.com)
2. **Sign up** con la tua email
3. Conferma il messaggio che arriva in posta
4. Piano **Free**

---

## 2. Crea il cassetto (repository)

1. In alto a sinistra (o il + in alto a destra) → **New repository**
2. Nome: **`gestione-docenti`** (scritto così, con il trattino)
3. Scegli **Private** se non vuoi che il codice sia pubblico
4. Non spuntare “Add a README”
5. **Create repository**

---

## 3. Carica i file

Usa lo zip **`gestione-docenti-github.zip`** (quello preparato con l’app).

1. Scompatta lo zip sul Mac (doppio clic)
2. Si apre una cartella. Dentro devi vedere `package.json`, `src`, `public`, `.github`
3. Su GitHub, nella pagina vuota del repository: **uploading an existing file**
4. Trascina **il contenuto** della cartella (tutti i file e le sottocartelle), non lo zip chiuso
5. Non deve comparire una cartella `node_modules` (è enorme e inutile)
6. Scorri in basso → **Commit changes**

Se GitHub dice che i file sono troppi: carica prima `package.json`, `src`, `public`, `scripts`, `.github`, poi gli altri. In caso scrivimi.

---

## 4. Accendi il sito (Pages)

1. Nel repository: **Settings** (ingranaggio in alto)
2. A sinistra, in fondo: **Pages**
3. **Source**: **GitHub Actions**
4. Torna in alto sul repository → scheda **Actions**
5. Se chiede di abilitare le Actions: **I understand** / Enable
6. Sulla sinistra dovrebbe comparire **Pubblica sito**
7. Se non parte da sola: **Run workflow** → **Run workflow**

Aspetta 1–2 minuti. Il pallino deve diventare **verde**.

Se è **rosso**: apri quella riga, fai uno screenshot e mandamelo. Non è il tuo registro: è solo la pubblicazione.

---

## 5. Il tuo link

Quando è verde:

**Settings → Pages** in alto mostra un indirizzo tipo:

`https://TUONOME.github.io/gestione-docenti/`

(TUONOME è il tuo username GitHub.)

1. Aprilo sul Mac
2. Aprilo su iPhone, Safari
3. iPhone: pulsante Condividi → **Aggiungi a Home**

---

## 6. I tuoi dati

Sul sito nuovo l’orario è vuoto o di esempio.

1. Nell’app di Grok: **Esporta** il JSON
2. Salvalo su iCloud / File
3. Sul sito GitHub: **Impostazioni → Importa** quel JSON

Ogni dispositivo ha i **suoi** dati. Se vuoi lo stesso registro su iPhone e Mac, importa lo stesso JSON su entrambi.

Ogni tanto: esporta di nuovo il JSON e tieni una copia.

---

## Se qualcosa non si apre

- Link 404: controlla che il repository si chiami esattamente `gestione-docenti`
- Pagina bianca: Actions rossa → screenshot
- “Non è questo il programma”: stai aprendo github.com/tuonome/gestione-docenti (il cassetto) invece del link `github.io` (il sito). Il sito è quello con **github.io** nel mezzo.
