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
