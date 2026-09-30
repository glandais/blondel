import { dec, msg, translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import { isNarrowJourNote } from "./jour.js";
import {
  flightRunLabel,
  lengthList,
  openingRunLabel,
  runTitle,
  sideLabel,
  uniqueMessages,
} from "./labels.js";

const en = translatorFor("en");

describe("libellés des garde-corps (ADR-0007)", () => {
  it("français identique aux anciens libellés, forme de début de phrase", () => {
    expect(fr(flightRunLabel("inner"))).toBe("garde-corps de volée côté jour");
    expect(fr(flightRunLabel("outer", 2))).toBe("garde-corps de volée côté extérieur n° 2");
    expect(fr(openingRunLabel())).toBe("garde-corps de trémie");
    expect(fr(runTitle(flightRunLabel("inner")))).toBe("Garde-corps de volée côté jour");
    expect(fr(runTitle(openingRunLabel(3)))).toBe("Garde-corps de trémie n° 3");
    expect(
      fr(
        msg("guard.gap.betweenBalusters", {
          bay: msg("guard.bay", { run: openingRunLabel(), n: 2 }),
        }),
      ),
    ).toBe("entre balustres, garde-corps de trémie, travée 2");
  });

  it("anglais sans reste de français", () => {
    expect(en.t(runTitle(flightRunLabel("inner", 1)))).toBe("Flight guard (well side) no. 1");
    expect(
      en.t(
        msg("guard.gap.lastCableToHandrail", {
          bay: msg("guard.bay", { run: openingRunLabel(), n: 1 }),
        }),
      ),
    ).toBe("between the last cable and the handrail, stairwell opening guard, bay 1");
    expect(en.t(msg("guard.note.autoBothMissingOne", { side: sideLabel("inner") }))).toBe(
      "“Auto” handrail: MC_DEUX_COTES requires a handrail on both sides, but the well side has neither a wall nor a guard to carry it.",
    );
    expect(en.t(msg("part.guardPost.name"))).toBe("Guard post");
  });

  it("remarque du jour étroit : pluriel, liste des longueurs, reconnue par sa clé", () => {
    const note = msg("guard.narrowJour.note", { width: dec(60, 0), threshold: dec(110, 0) });
    const partial = (lengths: number[]) =>
      msg("guard.narrowJour.partial", {
        note,
        count: lengths.length,
        lengths: lengthList(lengths),
      });
    const head =
      "Garde-corps de volée côté jour non généré : jour de 60 mm, plus étroit que la sphère T1 (110 mm) : pas de garde-corps de jour (décision A10), protection contre les chutes côté jour signalée en conseil. Si le jour est fermé, régler le côté jour des garde-corps sur « mur ».";
    expect(fr(partial([850.4]))).toBe(
      `${head} Garde-corps de jour partiel sur la portion de la volée qui borde un vide hors du jour (850 mm).`,
    );
    expect(fr(partial([850, 1200.6, 30]))).toBe(
      `${head} Garde-corps de jour partiel sur 3 portions de la volée qui borde un vide hors du jour (850 mm, 1201 mm, 30 mm).`,
    );
    expect(en.t(partial([850, 1200]))).toMatch(
      /on 2 portions of the flight .* \(850 mm, 1200 mm\)\.$/,
    );
    expect(isNarrowJourNote(note)).toBe(true);
    expect(isNarrowJourNote(partial([1]))).toBe(true);
    expect(isNarrowJourNote(msg("guard.note.glass"))).toBe(false);
  });

  it("remarque de synthèse : « (s) » en français, vrai pluriel en anglais", () => {
    const summary = (runs: number, posts: number, infill: number, handrails: number) =>
      msg("guard.note.summary", {
        runs: msg("guard.count.lines", { count: dec(runs, 0) }),
        posts: msg("guard.count.posts", { count: dec(posts, 0) }),
        infill: msg("guard.count.infill", { count: dec(infill, 0) }),
        handrails: msg("guard.count.handrails", { count: dec(handrails, 0) }),
      });
    expect(fr(summary(1, 2, 1200, 0))).toBe(
      "Garde-corps : 1 ligne(s), 2 poteau(x), 1200 élément(s) de remplissage, 0 main(s) courante(s) ; sections, entraxes, jeux et reculs par défaut à valider (voir LEDGER).",
    );
    expect(en.t(summary(1, 2, 1, 0))).toBe(
      "Guarding: 1 line, 2 posts, 1 infill member, 0 handrails; default sections, spacings, clearances and setbacks to be validated (see LEDGER).",
    );
  });

  it("dédoublonnage structurel des messages", () => {
    const a = msg("guard.note.newelAsPost", { side: sideLabel("inner") });
    const b = msg("guard.note.newelAsPost", { side: sideLabel("inner") });
    const c = msg("guard.note.newelAsPost", { side: sideLabel("outer") });
    expect(uniqueMessages([a, b, c, a])).toEqual([a, c]);
  });
});
