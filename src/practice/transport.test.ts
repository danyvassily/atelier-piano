import { describe, expect, it } from "vitest";
import type { NoteEvent } from "../types";
import type { TransportPendingNote } from "./transport";
import {
  beatsPerMeasureOf,
  clampMeasure,
  createTransport,
  measureRangeToSec,
  rescaleTimeForTempo,
  scoreDurationSec,
  secToMeasure,
} from "./transport";

/** Partition de référence des conversions : 4/4, 120 BPM (1 temps = 0,5 s). */
const SCORE = { bpm: 120, timeSignature: [4, 4] as [number, number], measureCount: 8, notes: [] as NoteEvent[] };

/** Notes attendues de test : attaques en secondes, comme les reçoit le transport. */
function pending(...onsets: number[]): TransportPendingNote[] {
  return onsets.map((onsetSec, index) => ({ id: `n${index}`, onsetSec }));
}

describe("création et état initial", () => {
  it("démarre au début de la plage, à l’arrêt et sans gel", () => {
    const transport = createTransport({ bpm: 120, rangeStartSec: 2, rangeEndSec: 8, waitMode: true });

    expect(transport.time).toBe(2);
    expect(transport.playing).toBe(false);
    expect(transport.frozen).toBe(false);
    expect(transport.completed).toBe(false);
    expect(transport.snapshot()).toEqual({ time: 2, frozen: false, completed: false });
    expect(transport.bpm).toBe(120);
    expect(transport.tempoFactor).toBe(1);
    expect(transport.timeSignature).toEqual([4, 4]);
  });

  it("corrige les options inexploitables au lieu de les propager", () => {
    const broken = createTransport({
      bpm: Number.NaN,
      timeSignature: [0, 0],
      tempoFactor: 0,
      rangeStartSec: 6,
      rangeEndSec: 2,
      loop: { startSec: 3, endSec: 3 },
    });

    expect(broken.bpm).toBe(120);
    expect(broken.timeSignature).toEqual([4, 4]);
    expect(broken.tempoFactor).toBe(1);
    // Bornes inversées remises d’aplomb, boucle vide ignorée.
    expect(broken.range).toEqual({ startSec: 2, endSec: 6 });
    expect(broken.loop).toBeNull();
    expect(broken.time).toBe(2);
  });
});

describe("lecture, pause et déplacement", () => {
  it("ne fait rien tant que la lecture n’a pas démarré", () => {
    const transport = createTransport({ rangeStartSec: 1, rangeEndSec: 5 });

    expect(transport.advance(0.5, pending(1.2))).toEqual({ time: 1, frozen: false, completed: false });
  });

  it("avance de la durée écoulée et cumule les pas", () => {
    const transport = createTransport({ rangeStartSec: 0, rangeEndSec: 10 });
    transport.play();

    expect(transport.advance(0.25).time).toBeCloseTo(0.25, 10);
    expect(transport.advance(0.25).time).toBeCloseTo(0.5, 10);
    expect(transport.playing).toBe(true);
  });

  it("ignore un pas de temps inexploitable", () => {
    const transport = createTransport({ rangeEndSec: 10 });
    transport.play();

    expect(transport.advance(Number.NaN).time).toBe(0);
    expect(transport.advance(-2).time).toBe(0);
    expect(transport.advance(Number.POSITIVE_INFINITY).time).toBe(0);
  });

  it("se met en pause et reprend avec toggle", () => {
    const transport = createTransport({ rangeEndSec: 10 });
    transport.play();
    transport.advance(1);

    transport.pause();
    expect(transport.playing).toBe(false);
    expect(transport.advance(1).time).toBeCloseTo(1, 10);
    expect(transport.frozen).toBe(false);

    transport.toggle();
    expect(transport.playing).toBe(true);
    expect(transport.advance(1).time).toBeCloseTo(2, 10);
  });

  it("borne les déplacements à la plage et annule l’état terminé", () => {
    const transport = createTransport({ rangeStartSec: 2, rangeEndSec: 6 });

    expect(transport.seek(-10)).toBe(2);
    expect(transport.seek(99)).toBe(6);
    expect(transport.seek(4)).toBe(4);
    expect(transport.seek(Number.NaN)).toBe(4);
  });

  it("revient au début avec reset", () => {
    const transport = createTransport({ rangeStartSec: 1, rangeEndSec: 6 });
    transport.play();
    transport.advance(2);
    transport.reset();

    expect(transport.time).toBe(1);
    expect(transport.playing).toBe(false);
    expect(transport.completed).toBe(false);
    expect(transport.frozen).toBe(false);
  });
});

describe("mode attente", () => {
  it("fige l’horloge pile sur l’attaque de la prochaine note", () => {
    const transport = createTransport({ rangeEndSec: 10, waitMode: true });
    transport.play();

    const step = transport.advance(0.1, pending(0.04, 1.5));

    expect(step).toEqual({ time: 0.04, frozen: true, completed: false });
    expect(transport.time).toBe(0.04);
    expect(transport.frozen).toBe(true);
  });

  it("reste figé tant que la note n’est pas jouée, sans jamais la dépasser", () => {
    const transport = createTransport({ rangeEndSec: 10, waitMode: true });
    transport.play();
    transport.advance(0.1, pending(0.04));
    transport.advance(0.5, pending(0.04));
    const step = transport.advance(3, pending(0.04));

    expect(step.time).toBeCloseTo(0.04, 10);
    expect(step.frozen).toBe(true);
    expect(step.completed).toBe(false);
  });

  it("repart quand la note est jouée et s’arrête sur la suivante", () => {
    const transport = createTransport({ rangeEndSec: 10, waitMode: true });
    transport.play();
    transport.advance(0.1, pending(0.04, 0.6));
    expect(transport.frozen).toBe(true);

    // L’élève joue la note : elle quitte la liste des notes en attente.
    const step = transport.advance(1, pending(0.6));

    expect(step).toEqual({ time: 0.6, frozen: true, completed: false });
  });

  it("ne fige pas quand la note est plus loin qu’un pas de temps", () => {
    const transport = createTransport({ rangeEndSec: 10, waitMode: true });
    transport.play();

    const step = transport.advance(0.016, pending(2));

    expect(step.frozen).toBe(false);
    expect(step.time).toBeCloseTo(0.016, 10);
  });

  it("ignore les notes dépassées et celles hors de la plage (sinon blocage garanti)", () => {
    const transport = createTransport({ rangeStartSec: 1, rangeEndSec: 4, waitMode: true });
    transport.play();
    transport.seek(2);

    // Attaque derrière l’horloge : dépassée, elle ne bloque pas la lecture.
    expect(transport.advance(1, pending(0.5)).time).toBeCloseTo(3, 10);
    // Note après la fin de plage : hors section, elle ne bloque pas non plus.
    expect(transport.advance(0.25, pending(9)).time).toBeCloseTo(3.25, 10);
  });

  it("laisse filer les notes quand le mode attente est éteint", () => {
    const transport = createTransport({ rangeEndSec: 10 });
    transport.play();

    const step = transport.advance(1, pending(0.04, 0.6));

    expect(step).toEqual({ time: 1, frozen: false, completed: false });
    transport.setWaitMode(true);
    expect(transport.waitMode).toBe(true);
    expect(transport.advance(0.5, pending(1.2))).toEqual({ time: 1.2, frozen: true, completed: false });
  });
});

describe("boucle A–B", () => {
  it("ramène au début de la boucle en gardant le reste du pas", () => {
    const transport = createTransport({ rangeEndSec: 8, loop: { startSec: 2, endSec: 4 } });
    transport.play();

    transport.seek(3.9);
    const step = transport.advance(0.3);

    expect(step.time).toBeCloseTo(2.2, 10);
    expect(step.completed).toBe(false);
  });

  it("enchaîne plusieurs tours quand le pas est plus long que la boucle", () => {
    const transport = createTransport({ rangeEndSec: 8, loop: { startSec: 1, endSec: 2 } });
    transport.play();
    transport.seek(1);

    // 5 s dans une boucle de 1 s : 5 tours complets, on retombe au point de départ.
    expect(transport.advance(5).time).toBeCloseTo(1, 10);
    expect(transport.advance(0.4).time).toBeCloseTo(1.4, 10);
  });

  it("ne termine jamais la plage tant que la boucle est active", () => {
    const transport = createTransport({ rangeEndSec: 4, loop: { startSec: 1, endSec: 3 } });
    transport.play();
    transport.seek(2.9);

    // 1,5 s après 2,9 s : la boucle est dépassée de 1,4 s, qui repart du début.
    const step = transport.advance(1.5);

    expect(step.completed).toBe(false);
    expect(step.time).toBeCloseTo(2.4, 10);
    expect(transport.playing).toBe(true);
  });

  it("ne se fige que sur une note située dans la boucle", () => {
    const transport = createTransport({ rangeEndSec: 9, loop: { startSec: 1, endSec: 3 }, waitMode: true });
    transport.play();
    transport.seek(1);

    // Une note après la fin de boucle ne doit pas retenir une boucle…
    expect(transport.advance(1.5, pending(5)).time).toBeCloseTo(2.5, 10);
    // …alors qu’une note de la boucle fige la lecture.
    expect(transport.advance(1.5, pending(2.8))).toEqual({ time: 2.8, frozen: true, completed: false });
  });

  it("oublie la boucle quand elle est vide ou libérée", () => {
    const transport = createTransport({ rangeEndSec: 4, loop: { startSec: 2, endSec: 1 } });
    expect(transport.loop).toBeNull();

    transport.setLoop({ startSec: 1, endSec: 2 });
    expect(transport.loop).toEqual({ startSec: 1, endSec: 2 });
    transport.setLoop(null);
    expect(transport.loop).toBeNull();
  });
});

describe("fin de plage", () => {
  it("s’arrête pile sur la fin et signale la complétion", () => {
    const transport = createTransport({ rangeStartSec: 1, rangeEndSec: 3 });
    transport.play();

    const step = transport.advance(5);

    expect(step).toEqual({ time: 3, frozen: false, completed: true });
    expect(transport.playing).toBe(false);
    // Une fois terminé, le transport ne bouge plus.
    expect(transport.advance(1)).toEqual({ time: 3, frozen: false, completed: true });
  });

  it("fait attendre la dernière note avant de terminer la plage", () => {
    const transport = createTransport({ rangeStartSec: 0, rangeEndSec: 4, waitMode: true });
    transport.play();

    // Le pas dépasse la fin de plage, mais la dernière note est encore à jouer :
    // le gel l’emporte sur la complétion.
    const frozen = transport.advance(5, pending(3.8));
    expect(frozen).toEqual({ time: 3.8, frozen: true, completed: false });

    const finished = transport.advance(0.5, pending());
    expect(finished).toEqual({ time: 4, frozen: false, completed: true });
  });

  it("repart du début quand on relance après la fin", () => {
    const transport = createTransport({ rangeStartSec: 1, rangeEndSec: 2 });
    transport.play();
    transport.advance(4);
    expect(transport.completed).toBe(true);

    transport.play();

    expect(transport.completed).toBe(false);
    expect(transport.time).toBe(1);
    expect(transport.playing).toBe(true);
  });

  it("efface l’état terminé dès qu’on se replace avant la fin", () => {
    const transport = createTransport({ rangeEndSec: 2 });
    transport.play();
    transport.advance(4);

    transport.seek(1);

    expect(transport.completed).toBe(false);
    expect(transport.snapshot()).toEqual({ time: 1, frozen: false, completed: false });
  });
});

describe("configuration à chaud", () => {
  it("applique tempo, plage, boucle et mode attente sans perdre la position", () => {
    const transport = createTransport({ bpm: 100, rangeStartSec: 0, rangeEndSec: 10 });
    transport.play();
    transport.advance(2);

    transport.configure({ tempoFactor: 0.5, waitMode: true, loop: { startSec: 1, endSec: 4 } });

    expect(transport.time).toBeCloseTo(2, 10);
    expect(transport.tempoFactor).toBe(0.5);
    expect(transport.waitMode).toBe(true);
    expect(transport.loop).toEqual({ startSec: 1, endSec: 4 });
  });

  it("ramène l’horloge dans la nouvelle plage et rouvre la lecture", () => {
    const transport = createTransport({ rangeStartSec: 0, rangeEndSec: 10 });
    transport.play();
    transport.advance(4);
    transport.setRange(5, 20);

    expect(transport.time).toBe(5);
    transport.advance(1);
    expect(transport.completed).toBe(false);

    transport.setRange(8, 9);
    transport.advance(0.5);
    transport.configure({ rangeStartSec: 0, rangeEndSec: 16 });
    expect(transport.time).toBeCloseTo(8.5, 10);
  });

  it("convertit les temps avec son propre tempo", () => {
    const transport = createTransport({ bpm: 120, tempoFactor: 0.5 });

    expect(transport.timeForBeats(2)).toBeCloseTo(2, 10);
    expect(transport.beatsAt(2)).toBeCloseTo(2, 10);

    transport.setTempoFactor(1);
    expect(transport.timeForBeats(2)).toBeCloseTo(1, 10);
    expect(transport.beatsAt(1)).toBeCloseTo(2, 10);
  });
});

describe("conversions mesures ↔ secondes", () => {
  it("traduit une section de mesures en plage de secondes", () => {
    // 4/4 à 120 BPM : une mesure = 4 temps = 2 s.
    expect(measureRangeToSec(SCORE, 1, 2)).toEqual({ startSec: 0, endSec: 4 });
    expect(measureRangeToSec(SCORE, 3, 3)).toEqual({ startSec: 4, endSec: 6 });
  });

  it("suit le facteur de tempo appliqué", () => {
    const slow = measureRangeToSec(SCORE, 1, 2, 0.5);
    const fast = measureRangeToSec(SCORE, 1, 2, 2);

    expect(slow).toEqual({ startSec: 0, endSec: 8 });
    expect(fast).toEqual({ startSec: 0, endSec: 2 });
  });

  it("compte en noires quel que soit le chiffrage", () => {
    const waltz = { bpm: 120, timeSignature: [3, 4] as [number, number], measureCount: 6 };
    const compound = { bpm: 120, timeSignature: [6, 8] as [number, number], measureCount: 6 };

    expect(beatsPerMeasureOf(waltz)).toBe(3);
    expect(beatsPerMeasureOf(compound)).toBe(3);
    expect(measureRangeToSec(waltz, 1, 1).endSec).toBeCloseTo(1.5, 10);
    expect(measureRangeToSec(compound, 2, 2).startSec).toBeCloseTo(1.5, 10);
  });

  it("borne les mesures à la partition et remet les bornes dans l’ordre", () => {
    expect(clampMeasure(SCORE, 0)).toBe(1);
    expect(clampMeasure(SCORE, 99)).toBe(8);
    expect(clampMeasure(SCORE, Number.NaN)).toBe(1);
    expect(measureRangeToSec(SCORE, 5, 2)).toEqual(measureRangeToSec(SCORE, 2, 5));
    expect(measureRangeToSec(SCORE, 0, 99)).toEqual(measureRangeToSec(SCORE, 1, 8));
    expect(measureRangeToSec(SCORE, 1, 1).startSec).toBe(0);
  });

  it("retrouve la mesure d’un instant donné", () => {
    expect(secToMeasure(SCORE, 0)).toBe(1);
    expect(secToMeasure(SCORE, 1.9)).toBe(1);
    expect(secToMeasure(SCORE, 2)).toBe(2);
    expect(secToMeasure(SCORE, 4.5)).toBe(3);
    expect(secToMeasure(SCORE, -3)).toBe(1);
    expect(secToMeasure(SCORE, 999)).toBe(8);
  });

  it("déduit la durée totale de la partition", () => {
    const shortScore = { ...SCORE, measureCount: 2 };
    expect(scoreDurationSec(shortScore)).toBeCloseTo(4, 10);

    const held = {
      ...SCORE,
      measureCount: 2,
      notes: [{ id: "a", midi: 60, name: "Do", onsetBeats: 8, durationBeats: 4, measure: 2, hand: "right" as const, velocity: 90 }],
    };
    // La dernière note tient 4 temps au-delà de la dernière barre.
    expect(scoreDurationSec(held)).toBeCloseTo(6, 10);
  });
});

describe("recalage du tempo", () => {
  it("conserve la position musicale quand le tempo change", () => {
    expect(rescaleTimeForTempo(2, 1, 0.5)).toBeCloseTo(4, 10);
    expect(rescaleTimeForTempo(4, 0.5, 1)).toBeCloseTo(2, 10);
    expect(rescaleTimeForTempo(3, 0.75, 0.75)).toBeCloseTo(3, 10);
  });

  it("se protège des facteurs et positions inexploitables", () => {
    expect(rescaleTimeForTempo(2, 0, 1)).toBeCloseTo(2, 10);
    expect(rescaleTimeForTempo(2, Number.NaN, 1)).toBeCloseTo(2, 10);
    expect(rescaleTimeForTempo(2, 1, 0)).toBeCloseTo(2, 10);
    expect(rescaleTimeForTempo(Number.NaN, 1, 1)).toBe(0);
    expect(rescaleTimeForTempo(-5, 1, 1)).toBe(0);
  });
});
