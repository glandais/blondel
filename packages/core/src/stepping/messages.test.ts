/**
 * Messages du tracé, du découpage et du balancement (ADR-0007) : le français redonne les textes
 * d'avant la migration, l'anglais ne garde aucun reste de français.
 */
import { dec, isMessageError, msg, translatorFor, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { BALANCING_STRATEGIES } from "../balancing/registry.js";
import { computeLayout } from "../layout/layout.js";
import { computeStepping } from "./stepping.js";
import { makeSteppingProject } from "./test-helpers.js";

const FR = translatorFor("fr");
const EN = translatorFor("en");

/** Mots français qui ne doivent pas subsister dans une traduction anglaise. */
const FRENCH =
  /\b(nez|volée|volées|tournant|tournants|giron|girons|collet|jour|marche|palier|de|du|la|le|les|et|mm en)\b/;

function thrown(f: () => unknown): Message {
  try {
    f();
  } catch (e) {
    if (isMessageError(e)) return e.msg;
    throw e;
  }
  throw new Error("aucune exception");
}

describe("messages du tracé et du découpage", () => {
  it("volée trop courte : erreur du tracé, français inchangé, anglais sans reste", () => {
    const p = makeSteppingProject({ width: 800, legs: [700, 2000] });
    const m = thrown(() => computeLayout(p));
    expect(m.key).toBe("layout.legTooShort");
    expect(FR.t(m)).toBe(
      "La volée 1 est trop courte : 700 mm mesurés au mur, il faut au moins 800 mm (emmarchement et raccords de jour).",
    );
    expect(EN.t(m)).toBe(
      "Flight 1 is too short: 700 mm measured at the wall, at least 800 mm is required (stair width and well easings).",
    );
  });

  it("note de zone balancée d'un quart tournant : clé, nom du tournant imbriqué, anglais", () => {
    const p = makeSteppingProject({ width: 800, legs: [2000, 2000] });
    const st = computeStepping(p, computeLayout(p));
    const note = st.notes.find((n) => n.key === "stepping.zoneSummary");
    expect(note).toBeDefined();
    expect(FR.t(note!)).toMatch(
      /^Tournant 1 : \d+ \+ \d+ nez balancés \(nez fixes \d+ et \d+, extrémités (tangente|libre)\/(tangente|libre)\), M3 · courbe continue \(cubique\), collet minimal [\d,]+ mm en corde \([\d,]+ mm en arc\)\.$/,
    );
    const en = EN.t(note!);
    expect(en).toMatch(
      /^Turn 1: \d+ \+ \d+ balanced nosings .*M3 · smooth curve \(cubic\), minimum narrow end/,
    );
    expect(en).not.toMatch(FRENCH);
  });

  it("pluriel de l'étendue (fr : moins de 2 → singulier, comme l'ancien texte) et listes", () => {
    const turn = msg("stepping.turnName.atPost", {
      turn: msg("stepping.turnName.single", { turn: 1 }),
      nosings: msg("stepping.list.and", {
        a: msg("stepping.nosingRef", { nosing: 3 }),
        b: msg("stepping.nosingRef", { nosing: 4 }),
      }),
    });
    const at = (extent: number): Message =>
      msg("stepping.extentExceeded", { turn, count: dec(extent), from: 2, to: 9 });
    expect(FR.t(at(1.5))).toBe(
      "Tournant 1 (nez 3 et nez 4 au poteau) : aucune zone admissible dans l'étendue de balancement de 1,5 giron depuis l'angle ; étendue dépassée (nez fixes 2 et 9).",
    );
    expect(FR.t(at(3))).toContain("de 3 girons depuis l'angle");
    expect(EN.t(at(1.5))).toBe(
      "Turn 1 (nosing 3 and nosing 4 at the newel post): no admissible zone within the balancing extent of 1.5 goings from the corner; extent exceeded (fixed nosings 2 and 9).",
    );
    expect(EN.t(at(1))).toContain("extent of 1 going from");
  });

  it("comptes variables : français « (s) » inchangé, vrai pluriel en anglais", () => {
    const turn = msg("stepping.turnName.single", { turn: 1 });
    const winders = (count: number): Message =>
      msg("stepping.windersPerSideLimited", { turn, count, before: 1, after: 2 });
    expect(FR.t(winders(1))).toBe(
      "Tournant 1 : 1 marches balancées demandées de chaque côté, 1 avant et 2 après possibles (nez fixes).",
    );
    expect(EN.t(winders(1))).toContain(": 1 winder requested");
    expect(EN.t(winders(5))).toContain(": 5 winders requested");

    const landings = (count: number): Message =>
      msg("stepping.tooFewRisersForLandings", { risers: 3, count });
    expect(FR.t(landings(1))).toBe(
      "Pas assez de hauteurs (3) pour 1 palier(s) : aucun giron droit possible.",
    );
    expect(EN.t(landings(1))).toContain("for 1 landing:");
    expect(EN.t(landings(2))).toContain("for 2 landings:");

    const perAngle = msg("stepping.perAngleZonesWithBreaks", {
      breaks: msg("stepping.breakCount", { count: 2 }),
      remaining: msg("stepping.remainingBreakCount", { count: 1 }),
    });
    expect(FR.t(perAngle)).toBe(
      "Poteau(x) d'angle : collets irréguliers (K3) avec le balancement d'un seul tenant (2 rupture(s)) ; zones par angle retenues (nez du poteau fixe, une zone de chaque côté du poteau, B §3.1, 1 rupture(s) restante(s)).",
    );
    expect(EN.t(perAngle)).toContain("(2 breaks)");
    expect(EN.t(perAngle)).toContain("B §3.1, 1 remaining break).");

    const rotation = (reach: number): Message =>
      msg("stepping.rotationNoteDefaults", { turn, count: dec(reach), steepness: dec(2) });
    expect(FR.t(rotation(1))).toBe(
      "Tournant 1 : rotation paramétrée (M6), portée λ = 1 giron(s), raideur p = 2 (réglages par défaut à valider).",
    );
    expect(EN.t(rotation(1))).toContain("reach λ = 1 going,");
    expect(EN.t(rotation(1.5))).toContain("reach λ = 1.5 goings,");
  });

  it("libellés des stratégies de balancement traduits", () => {
    for (const s of Object.values(BALANCING_STRATEGIES)) {
      expect(FR.t(s.labelKey)).toMatch(new RegExp(`\\(${s.id}\\)$`));
      expect(EN.t(s.labelKey)).not.toBe(s.labelKey);
      expect(EN.t(s.labelKey)).not.toMatch(FRENCH);
    }
  });
});
