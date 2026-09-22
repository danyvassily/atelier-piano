import { strFromU8, unzipSync } from "fflate";
import type { NoteEvent, ScoreDocument } from "../types";
import { midiToFrenchName, pitchToMidi } from "./notes";

function text(element: Element | Document, selector: string, fallback = ""): string {
  return element.querySelector(selector)?.textContent?.trim() || fallback;
}

function numberText(element: Element, selector: string, fallback: number): number {
  const raw = text(element, selector);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function parseMusicXml(xml: string, fileName = "Partition MusicXML"): ScoreDocument {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("Le fichier MusicXML n’est pas valide.");
  }

  const scoreRoot = document.querySelector("score-partwise, score-timewise");
  if (!scoreRoot) {
    throw new Error("Aucune partition MusicXML n’a été trouvée dans ce fichier.");
  }

  const title =
    text(document, "work > work-title") ||
    text(document, "movement-title") ||
    fileName.replace(/\.(musicxml|xml|mxl)$/i, "");
  const composer = text(document, 'identification creator[type="composer"]', "Compositeur inconnu");

  const notes: NoteEvent[] = [];
  const part = document.querySelector("part");
  let bpm = Number(document.querySelector("sound[tempo]")?.getAttribute("tempo")) || 80;
  let beatsPerMeasure = 4;
  let beatType = 4;
  let keyFifths = 0;
  let measureCount = 0;

  if (part) {
    let divisions = 1;
    let absoluteBeat = 0;

    Array.from(part.querySelectorAll(":scope > measure")).forEach((measure, measureIndex) => {
      measureCount = measureIndex + 1;
      divisions = numberText(measure, "attributes > divisions", divisions);
      beatsPerMeasure = numberText(measure, "attributes > time > beats", beatsPerMeasure);
      beatType = numberText(measure, "attributes > time > beat-type", beatType);
      keyFifths = numberText(measure, "attributes > key > fifths", keyFifths);
      const tempo = Number(measure.querySelector("sound[tempo]")?.getAttribute("tempo"));
      if (Number.isFinite(tempo) && tempo > 0) bpm = tempo;

      const measureStart = absoluteBeat;
      let cursor = measureStart;
      let furthest = measureStart;
      let previousNoteStart = measureStart;

      Array.from(measure.children).forEach((node) => {
        if (node.tagName === "backup") {
          cursor -= numberText(node, "duration", 0) / divisions;
          return;
        }
        if (node.tagName === "forward") {
          cursor += numberText(node, "duration", 0) / divisions;
          furthest = Math.max(furthest, cursor);
          return;
        }
        if (node.tagName !== "note") return;

        const durationBeats = Math.max(numberText(node, "duration", divisions) / divisions, 0.125);
        const isChord = Boolean(node.querySelector(":scope > chord"));
        const onsetBeats = isChord ? previousNoteStart : cursor;

        if (!node.querySelector(":scope > rest")) {
          const step = text(node, "pitch > step");
          const octave = numberText(node, "pitch > octave", 4);
          const alter = numberText(node, "pitch > alter", 0);
          if (step) {
            const midi = pitchToMidi(step, alter, octave);
            const staff = numberText(node, ":scope > staff", midi < 60 ? 2 : 1);
            notes.push({
              id: `xml-${measureIndex + 1}-${notes.length}`,
              midi,
              name: midiToFrenchName(midi),
              onsetBeats,
              durationBeats,
              measure: measureIndex + 1,
              hand: staff >= 2 ? "left" : "right",
              velocity: 0.72,
            });
          }
        }

        if (!isChord) {
          previousNoteStart = cursor;
          cursor += durationBeats;
          furthest = Math.max(furthest, cursor);
        }
      });

      const nominalLength = beatsPerMeasure * (4 / beatType);
      absoluteBeat = Math.max(furthest, measureStart + nominalLength);
    });
  }

  if (!notes.length) {
    throw new Error("La partition ne contient aucune note lisible.");
  }

  return {
    id: crypto.randomUUID(),
    title,
    composer,
    sourceType: "musicxml",
    importedAt: new Date().toISOString(),
    bpm: Math.round(bpm),
    timeSignature: [beatsPerMeasure, beatType],
    keyFifths,
    measureCount,
    notes: notes.sort((a, b) => a.onsetBeats - b.onsetBeats || a.midi - b.midi),
    rawText: xml,
  };
}

export function extractMusicXmlFromMxl(data: ArrayBuffer): string {
  const files = unzipSync(new Uint8Array(data));
  const container = files["META-INF/container.xml"];
  let rootPath = "";

  if (container) {
    const containerXml = new DOMParser().parseFromString(strFromU8(container), "application/xml");
    rootPath = containerXml.querySelector("rootfile")?.getAttribute("full-path") || "";
  }

  const candidate = rootPath
    ? files[rootPath]
    : Object.entries(files).find(([name]) => /\.(musicxml|xml)$/i.test(name) && !name.includes("META-INF"))?.[1];

  if (!candidate) {
    throw new Error("Aucune partition MusicXML n’a été trouvée dans ce fichier MXL.");
  }
  return strFromU8(candidate);
}
