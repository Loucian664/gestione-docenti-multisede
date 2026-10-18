export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6;

export type Period = {
  id: string;
  index: number;
  label: string;
  start: string;
  end: string;
  /** 7ª / 8ª: solo classi a tempo prolungato. La fascia 14:00 è per tutte. */
  tpOnly?: boolean;
};

export type TeacherRole = "cattedra" | "potenziamento" | "sostegno" | "religione";

export type Tempo = "TN" | "TP";

export type Teacher = {
  id: string;
  lastName: string;
  firstName: string;
  subjects: string[];
  weeklyHours: number;
  role: TeacherRole;
  notes: string;
  color: string;
  assignedClassIds: string[];
  /** Insegna anche in un altro plesso: in Costruisci si segnano le ore altrove. */
  otherPlesso?: boolean;
  awaySlots?: { day: DayOfWeek; periodId: string }[];
  /** Giorni di rientro T.P.: Costruisci mette 4ª–6ª (pomeriggio a mano). */
  rientroDays?: DayOfWeek[];
  /** Ore a disposizione su questo plesso. In Costruisci i buchi, se servono, vanno prima a loro (fino a questo numero). */
  dispHours?: number;
  /** Ore a disposizione (non lezione). In copertura non sono eccedenti. */
  dispSlots?: { day: DayOfWeek; periodId: string }[];
  /** Versione precedente («Vorrei», ✓): quando i dati si aprono diventa «Classe · se possibile · tutte». */
  preferSlots?: { day: DayOfWeek; periodId: string }[];
  /** Ore «no» (es. famiglia): mai in quell’ora, ma solo quella (niente ora di spostamento come per ×). */
  avoidSlots?: { day: DayOfWeek; periodId: string }[];
  /**
   * In quell’ora, una delle classi indicate. `level`: "preferenza" (se possibile, predefinito)
   * oppure "obbligo" (deve stare lì).
   */
  mustSlots?: {
    day: DayOfWeek;
    periodId: string;
    classId?: string;
    classIds?: string[];
    /** «Tutte»: una qualunque classe del docente, anche assegnata dopo (`classIds` ne tiene una copia). */
    allClasses?: boolean;
    level?: "preferenza" | "obbligo";
  }[];
  /**
   * Ore al giorno scelte in Costruisci: una o più suddivisioni, in qualsiasi ordine
   * (es. [[4, 4, 4, 3, 3], [4, 4, 4, 4, 2]]); ne basta una. Contano lezioni, pomeriggio e ore a
   * disposizione. Vuoto = decide l’app.
   */
  dayPatterns?: number[][];
  /** Versione precedente, con una sola suddivisione: vale come `dayPatterns: [dayPattern]`. */
  dayPattern?: number[];
  /** Ore bloccate: in Costruisci la lezione di quel giorno, ora e classe resta dov’è. */
  lockedSlots?: { day: DayOfWeek; periodId: string; classId: string }[];
  /** Tutta la settimana del docente bloccata. */
  lockWeek?: boolean;
  /**
   * Su richiesta del docente: in un giorno accetta 2 ore libere tra le lezioni (buche o a disposizione).
   * Di norma ne è ammessa al massimo una.
   */
  allowTwoFree?: boolean;
  /**
   * Su richiesta del docente: nessuna ora buca tra le lezioni. Assente = le accetta (di norma al
   * massimo una al giorno); con questa opzione «accetta 2 ore libere» non vale.
   */
  noGaps?: boolean;
  /** Righe della scheda (classe, materia, ore). Restano sul docente anche se le cattedre globali si perdono. */
  cardRows?: { classId: string; subject: string; hours: number }[];
  /** Stessa persona in più sedi: le sue schede nelle varie sedi hanno lo stesso valore. */
  personId?: string;
};

export type SchoolClass = {
  id: string;
  name: string;
  grade: 1 | 2 | 3;
  section: string;
  students: number;
  tempo: Tempo;
};

export type TimetableSlot = {
  id: string;
  day: DayOfWeek;
  periodId: string;
  classId: string;
  teacherId: string;
  subject: string;
};

export type AbsenceReason =
  | "malattia"
  | "permesso"
  | "l104"
  | "formazione"
  | "assemblea_sindacale"
  | "visita"
  | "permesso_breve"
  | "altro";

export type Absence = {
  id: string;
  teacherId: string;
  dateFrom: string;
  dateTo: string;
  reason: AbsenceReason;
  notes: string;
  allDay: boolean;
  periodIds: string[];
};

export type SubstitutionType =
  | "disposizione"
  | "potenziamento"
  | "recupero"
  | "eccedente"
  | "sostegno"
  | "compresenza"
  | "divisione"
  | "altro"
  | "entra"
  | "esce"
  | "non_entra";

export type Substitution = {
  id: string;
  date: string;
  periodId: string;
  classId: string;
  absentTeacherId: string;
  substituteId: string | null;
  type: SubstitutionType | null;
  activity: string;
  notes: string;
  subject: string;
};

export type MonteOreRow = { subject: string; hours: number };

export type Cattedra = {
  classId: string;
  subject: string;
  teacherId: string;
  hours: number;
};

export type Settings = {
  schoolName: string;
  plesso: string;
  schoolYear: string;
  responsabile: string;
  days: DayOfWeek[];
  periods: Period[];
  monteOre?: MonteOreRow[];
  /** Mostra mensa, 7ª e 8ª sulle classi T.P. Costruisci non le usa. */
  tpAfternoon?: boolean;
};

/**
 * Orario salvato in uno slot: 0 è l’orario in vigore (qui solo mentre se ne usa un altro), 1–5 le
 * prove. Contiene ciò che Costruisci cambia: lezioni e ore a disposizione del mattino dei docenti di
 * materia.
 */
export type SavedTimetable = {
  n: number;
  name: string;
  savedAt: number;
  lessons: TimetableSlot[];
  /** ore a disposizione del mattino, per docente */
  disp: Record<string, { day: DayOfWeek; periodId: string }[]>;
};

export type PersistedData = {
  settings: Settings;
  teachers: Teacher[];
  classes: SchoolClass[];
  slots: TimetableSlot[];
  absences: Absence[];
  substitutions: Substitution[];
  selectedDate: string;
  cattedre?: Cattedra[];
  cattedraBackup?: TimetableSlot[];
  /** Disposizioni prima dell'ultima proposta di Costruisci (per Annulla). */
  cattedraDispBackup?: Record<string, { day: DayOfWeek; periodId: string }[]>;
  /** Orari salvati negli slot (0 in vigore, 1–5 prove). Quello dello slot in uso è l’orario dell’app. */
  savedTimetables?: SavedTimetable[];
  /** Slot dell’orario in uso nell’app: 0 l’orario in vigore (predefinito), 1–5 una prova. */
  activeSlot?: number;
  /** Orario in vigore prima dell’ultimo «Rendi in vigore» (per «Annulla»). */
  officialBackup?: SavedTimetable;
  /** Unix ms of last user save. 0 = example seed, never overwrite a real save. */
  savedAt?: number;
  /** "user" = this device's registro. "seed" = example data. */
  origin?: "seed" | "user";
  /** Last imported backup filename, if any. */
  importedBackupName?: string;
  /**
   * Sede in uso: i suoi dati sono quelli qui sopra (impostazioni, docenti, classi, orario…), come
   * nell'archivio di un plesso solo. Assente in un backup dell'app di Rombiolo: c'è una sede sola.
   */
  sedeId?: string;
  /** Le altre sedi dell'istituto, ciascuna con i suoi dati. */
  altreSedi?: SedeArchive[];
  /** Ordine delle sedi nella pagina Sedi e nella scelta della sede (id). */
  ordineSedi?: string[];
};

/** I dati che ogni sede ha per conto suo: tutto tranne data scelta e informazioni di salvataggio. */
export type SedeData = Pick<
  PersistedData,
  | "settings"
  | "teachers"
  | "classes"
  | "slots"
  | "absences"
  | "substitutions"
  | "cattedre"
  | "cattedraBackup"
  | "cattedraDispBackup"
  | "savedTimetables"
  | "activeSlot"
  | "officialBackup"
>;

export type SedeArchive = { id: string; data: SedeData };

export const ABSENCE_REASONS: { value: AbsenceReason; label: string }[] = [
  { value: "malattia", label: "Malattia" },
  { value: "permesso", label: "Permesso personale" },
  { value: "l104", label: "Permesso L. 104" },
  { value: "formazione", label: "Formazione / aggiornamento" },
  { value: "assemblea_sindacale", label: "Assemblea sindacale" },
  { value: "visita", label: "Visita medica" },
  { value: "permesso_breve", label: "Permesso breve (ore)" },
  { value: "altro", label: "Altro" },
];

export const SUBSTITUTION_TYPES: { value: SubstitutionType; label: string; short: string; hint: string }[] = [
  { value: "disposizione", label: "Ora a disposizione", short: "DISP", hint: "Ora di servizio senza classe" },
  { value: "potenziamento", label: "Potenziamento", short: "POT", hint: "Docente dell’organico di potenziamento" },
  { value: "recupero", label: "Recupero", short: "REC", hint: "Recupero di ore non prestate" },
  { value: "eccedente", label: "Ora eccedente", short: "ECC", hint: "Ora eccedente, retribuita a parte" },
  { value: "sostegno", label: "Sostegno", short: "SOS", hint: "Docente di sostegno disponibile" },
  { value: "compresenza", label: "Compresenza", short: "COMP", hint: "Docente già in classe" },
  { value: "divisione", label: "Divisione classe", short: "DIV", hint: "Alunni distribuiti in altre classi" },
  { value: "altro", label: "Altro", short: "ALT", hint: "" },
];

export const CURRICULAR_SUBJECTS = [
  "Italiano",
  "Storia",
  "Geografia",
  "Matematica",
  "Scienze",
  "Inglese",
  "Francese",
  "Spagnolo",
  "Tecnologia",
  "Arte e Immagine",
  "Musica",
  "Scienze Motorie",
  "Religione",
  "Educazione civica",
];

export const ACTIVITY_SUBJECTS = [
  "Sostegno",
  "Potenziamento",
  "Mensa",
  "Laboratorio",
  "Altro",
];

export const SUBJECTS = [...CURRICULAR_SUBJECTS, ...ACTIVITY_SUBJECTS];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  1: "Lunedì",
  2: "Martedì",
  3: "Mercoledì",
  4: "Giovedì",
  5: "Venerdì",
  6: "Sabato",
};

export function dayNameUpper(day: DayOfWeek): string {
  return DAY_LABELS[day].toLocaleUpperCase("it-IT");
}

export const DAY_SHORT: Record<DayOfWeek, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mer",
  4: "Gio",
  5: "Ven",
  6: "Sab",
};

export const ROLE_LABELS: Record<TeacherRole, string> = {
  cattedra: "Cattedra",
  potenziamento: "Potenziamento",
  sostegno: "Sostegno",
  religione: "Religione",
};
