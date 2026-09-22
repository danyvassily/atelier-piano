export type SourceType = "musicxml" | "midi" | "pdf" | "lilypond" | "transcription";
export type Hand = "right" | "left" | "both";
export type NoteNaming = "french" | "letters";

export interface NoteEvent {
  id: string;
  midi: number;
  name: string;
  onsetBeats: number;
  durationBeats: number;
  measure: number;
  hand: Exclude<Hand, "both">;
  velocity: number;
  confidence?: number;
}

export interface TranscriptionInfo {
  engine: "basic-pitch";
  sourceFileName: string;
  sourceMimeType: string;
  createdAt: string;
  averageConfidence: number;
}

export interface VideoLessonLink {
  id: string;
  stageId: string;
  videoId: string;
  startSeconds: number;
  endSeconds?: number;
  measureStart: number;
  measureEnd: number;
}

export interface PdfSourceLink {
  /** Id de la partition PDF d'origine dans la bibliothèque locale. */
  pdfScoreId: string;
  pdfFileName: string;
  linkedAt: string;
  /** Calibration du suivi : nombre de mesures par page du PDF (v0.3, 100 % local). */
  measuresPerPage?: number;
}

export interface ScoreDocument {
  id: string;
  title: string;
  composer: string;
  sourceType: SourceType;
  importedAt: string;
  bpm: number;
  timeSignature: [number, number];
  keyFifths?: number;
  measureCount: number;
  notes: NoteEvent[];
  rawText?: string;
  binaryData?: ArrayBuffer;
  sourceFileName?: string;
  transcription?: TranscriptionInfo;
  videoLessons?: VideoLessonLink[];
  /** PDF d'origine associé (v0.3 « PDF personnel ») : le scan ou l'édition source. */
  pdfSource?: PdfSourceLink;
  /** Mesures signalées comme douteuses (typiquement après Audiveris), à revérifier. */
  flaggedMeasures?: number[];
  /** Vrai si le MusicXML a été généré par Audiveris (compagnon local). */
  audiverisGenerated?: boolean;
}

export type LessonKind = "listen" | "right" | "left" | "together" | "performance";

export interface LessonStage {
  id: string;
  kind: LessonKind;
  title: string;
  instruction: string;
  hand: Hand;
  measureStart: number;
  measureEnd: number;
  tempoFactor: number;
}

export interface PracticeStats {
  correct: number;
  errors: number;
  streak: number;
  bestStreak: number;
  completedNoteIds: string[];
  errorsByMeasure?: Record<number, number>;
}

export interface StoredProgress {
  scoreId: string;
  stageId: string;
  completedStageIds: string[];
  bestAccuracy: number;
  errorsByMeasure?: Record<number, number>;
}
