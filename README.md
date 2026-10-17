# Gestione Docenti

Applicazione web per la gestione delle **sostituzioni** e dell’**orario** nella scuola secondaria di I grado, pensata per il responsabile di plesso.

## Uso

[https://loucian664.github.io/gestione-docenti/](https://loucian664.github.io/gestione-docenti/)

Si apre nel browser. Può essere aggiunta alla schermata home come applicazione.

---

## Funzioni

- Registro quotidiano: assenze, coperture, disponibilità
- Orario per classe, per docente e quadro settimanale
- Esportazione in Excel, PDF e immagine
- Proposta di orario a partire da cattedre, plessi e vincoli
- Backup e ripristino in JSON

I dati restano **locali al browser**. Il sito ospita solo il programma: ogni sessione è indipendente, salvo importazione di un backup.

## Avvio

1. Aprire il [sito](https://loucian664.github.io/gestione-docenti/)
2. Con un backup esistente: **Impostazioni → Importa backup**
3. In alternativa compilare docenti, classi e orario
4. Periodicamente: **Esporta backup** e conservare il file `.json`

L’esportazione Excel non sostituisce il backup: per trasferire il registro serve il JSON.

## Repository

Questo progetto contiene il codice sorgente, non i dati operativi della scuola.

Le modifiche pubblicate su `main` aggiornano automaticamente il sito (GitHub Pages).

## Nota

Uso interno scolastico. Non sostituisce il registro ufficiale.

Fatto da Grok Build (beta)
