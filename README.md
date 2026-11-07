# Orario Generale

Applicazione web per costruire l’**orario** delle sedi di scuola secondaria di I grado di un istituto comprensivo, tenendo conto dei docenti in comune tra le sedi.

Nasce come copia di **Gestione Docenti**, l’app del responsabile di plesso di Rombiolo (sostituzioni e orario di una sede): stesso aspetto, più funzioni.

## Uso

[https://loucian664.github.io/gestione-docenti-multisede/](https://loucian664.github.io/gestione-docenti-multisede/)

Si apre nel browser. Può essere aggiunta alla schermata Home: compare come **Orario Generale**, con l’icona del calendario.

---

## Le due app

| | Gestione Docenti | Orario Generale |
|---|---|---|
| Indirizzo | [loucian664.github.io/gestione-docenti](https://loucian664.github.io/gestione-docenti/) | [loucian664.github.io/gestione-docenti-multisede](https://loucian664.github.io/gestione-docenti-multisede/) |
| Serve per | sostituzioni e orario di una sede | orario di tutte le sedi |
| Icona | due persone con le frecce | calendario |

I dati delle due app sono **separati**: quello che si fa in una non compare nell’altra. Per passare i dati si usa il backup.

## Funzioni

- Sedi: le sedi dell’istituto, con il backup di una sola sede per l’app della singola scuola («Esporta sede»)
- Orario per classe, per docente e quadro settimanale
- Costruisci: proposta di orario per una sede o per tutte le sedi insieme, a partire da cattedre, vincoli e ore dei docenti in altre sedi
- Calcolo lungo dell’orario con un assistente di programmazione (istruzioni in `CALCOLO-LUNGO.md`)
- Registro quotidiano: assenze, coperture, disponibilità
- Esportazione in Excel, PDF e immagine
- Backup e ripristino in JSON

I dati restano **locali al browser**. Il sito ospita solo il programma: ogni dispositivo ha i suoi dati, salvo importazione di un backup.

## Avvio

1. Aprire il [sito](https://loucian664.github.io/gestione-docenti-multisede/)
2. Per partire dai dati di Rombiolo: nell’app Gestione Docenti **Impostazioni → Esporta backup**, poi qui **Impostazioni → Importa backup**
3. In alternativa compilare docenti, classi e orario
4. Periodicamente: **Esporta backup** e conservare il file `.json`

L’esportazione Excel non sostituisce il backup: per trasferire i dati serve il JSON.

## Repository

Questo progetto contiene il codice sorgente, non i dati operativi della scuola.

Le modifiche pubblicate su `main` aggiornano automaticamente il sito (GitHub Pages).

## Nota

Uso interno scolastico. Non sostituisce il registro ufficiale.
