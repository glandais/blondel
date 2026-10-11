import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import { PROJECT_SCHEMA_VERSION, ProjectSchema, type Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/index.js";
import { goingsOnMeasurementLine } from "./measurementLine.js";

const EXAMPLES = fileURLToPath(new URL("../../../../examples/", import.meta.url));
const load = (f: string): Project =>
  parseProjectText(readFileSync(`${EXAMPLES}${f}.blondel.json`, "utf8"));

/** Projet dont la ligne de foulée de conception est à `distance` du jour. */
function withDesignLine(p: Project, distance: number): Project {
  return { ...p, stair: { ...p.stair, walkline: { mode: "fromInner", distance } } };
}

describe("girons sur la ligne de mesure (SPEC X9)", () => {
  it.each([
    "quarter-left",
    "quarter-right",
    "two-quarters-s",
    "two-quarters-u",
    "half-turn",
    "demo-quarter-curved",
    "j3c-acceptance-01-upn",
    "j5a-helicoidal",
  ])("%s : ligne de mesure confondue avec Γ → girons de conception", (f) => {
    const m = buildModel(load(f));
    const r = goingsOnMeasurementLine(m.layout, m.stepping, m.layout.walklineOffset);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.goings.length).toBeGreaterThan(0);
    for (const g of r.goings) expect(g.going).toBeCloseTo(g.tread.going, 6);
  });

  it("quart tournant : les girons balancés croissent avec la distance au jour", () => {
    const m = buildModel(load("quarter-left"));
    const d = m.layout.walklineOffset;
    const near = goingsOnMeasurementLine(m.layout, m.stepping, d - 100);
    const far = goingsOnMeasurementLine(m.layout, m.stepping, d + 100);
    expect(near.ok && far.ok).toBe(true);
    if (!near.ok || !far.ok) return;
    const total = (xs: readonly { going: number }[]) => xs.reduce((a, b) => a + b.going, 0);
    expect(total(far.goings)).toBeGreaterThan(total(near.goings) + 1);
    // Chaque marche balancée du tournant est plus profonde loin du jour.
    far.goings.forEach((g, i) => expect(g.going).toBeGreaterThan(near.goings[i]!.going - 1e-6));
  });

  it("hélicoïdal : cercle concentrique, giron = (r_Γ + d − d_f) · Δθ", () => {
    const m = buildModel(load("j5a-helicoidal"));
    const h = m.layout.helical!;
    const r = goingsOnMeasurementLine(m.layout, m.stepping, 600);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expected = (h.walklineRadius + 600 - m.layout.walklineOffset) * h.stepAngle;
    for (const g of r.goings) expect(g.going).toBeCloseTo(expected, 9);
  });

  it("ligne de conception à 300 mm d'un jour de 900 : contrôles DTU sur la ligne à 450 mm", () => {
    const p = withDesignLine(load("quarter-left"), 300);
    const m = buildModel(p);
    const lf = m.compliance.results.filter((r) => r.ruleId === "LF_POSITION_DTU_ETROIT");
    // Avant : une seule ligne « non évaluée (non implémenté) ».
    expect(lf.every((r) => r.status !== "non-evaluee")).toBe(true);
    const measured = goingsOnMeasurementLine(m.layout, m.stepping, 450);
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    const bad = measured.goings.filter((g) => Math.abs(g.going - m.stepping.going) > 10);
    // Balancement réglé sur la ligne à 300 mm : à 450 mm, des girons sortent de ± 10 mm.
    expect(bad.length).toBeGreaterThan(0);
    const violations = lf.filter((r) => r.status === "violation");
    expect(violations.length).toBe(bad.length);
    for (const v of violations) {
      expect(v.location.kind).toBe("tread");
      expect(fr(v.message)).toMatch(/G_TOL_BALANCEE/);
    }
  });

  it("surcharges utilisateur des règles de giron appliquées aux constats de la ligne de mesure", () => {
    // Relecture adverse (vague J) : une règle de giron ignorée ou assouplie par l'utilisateur ne
    // doit pas ressortir, à sa sévérité déclarée, sous LF_POSITION_*.
    const base = withDesignLine(load("quarter-left"), 300);
    const lf = (p: Project) =>
      buildModel(p).compliance.results.filter(
        (r) => r.ruleId === "LF_POSITION_DTU_ETROIT" && r.status === "violation",
      );
    expect(lf(base).length).toBeGreaterThan(0);
    const withOverride = (severity: "ignore" | "conseil"): Project => ({
      ...base,
      compliance: {
        ...base.compliance,
        overrides: [{ ruleId: "G_TOL_BALANCEE", severity, justification: "Relevé contradictoire" }],
      },
    });
    // Ignorée : plus aucun constat de G_TOL_BALANCEE sur la ligne de mesure.
    const ignored = buildModel(withOverride("ignore")).compliance.results.filter(
      (r) => r.ruleId === "LF_POSITION_DTU_ETROIT",
    );
    expect(ignored.filter((r) => r.status === "violation")).toEqual([]);
    expect(
      ignored.some((r) => /G_TOL_BALANCEE/.test(fr(r.message)) && /ignorée/.test(fr(r.message))),
    ).toBe(true);
    // Assouplie en conseil : les constats suivent la sévérité effective de G_TOL_BALANCEE.
    const soft = lf(withOverride("conseil"));
    expect(soft.length).toBe(lf(base).length);
    for (const v of soft) expect(v.severity).toBe("conseil");
  });

  it("hélicoïdal : ligne de mesure hors de l'emmarchement → non mesurée", () => {
    // Relecture adverse (vague J) : un cercle de mesure au-delà du bord extérieur donnait des
    // girons sur une ligne qui ne coupe aucune marche.
    const m = buildModel(load("j5a-helicoidal"));
    const h = m.layout.helical!;
    const width = h.outerRadius - h.innerRadius;
    const out = goingsOnMeasurementLine(m.layout, m.stepping, width + 50);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(fr(out.reason)).toMatch(/hors de l'emmarchement/);
    expect(goingsOnMeasurementLine(m.layout, m.stepping, width - 1).ok).toBe(true);
  });
});

describe("ligne de mesure d'une cage : distances par jonction (sous-lot 2d, F2)", () => {
  const straight = (length: number, width = 900) => ({
    axis: { kind: "straight" as const, length },
    width,
  });
  /** Cage à deux jonctions (60° et 120°) de largeurs différentes : d_f 450 puis 600 mm. */
  const cage = (): Project =>
    ProjectSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      site: { floorToFloor: 2700, upperSlabThickness: 200 },
      stair: {
        placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        layout: {
          kind: "cage",
          sections: [
            straight(1500, 900),
            { ...straight(600, 900), widthEnd: 1300 },
            straight(1500, 1300),
          ],
          junctions: [
            { angle: 60, mode: "winders" },
            { angle: 120, mode: "winders" },
          ],
        },
      },
    });

  it("cible égale à d_f de chaque jonction : girons de conception ; `include` filtre les marches", () => {
    const m = buildModel(cage());
    const [t1, t2] = m.layout.turns;
    expect([t1!.walklineOffset, t2!.walklineOffset]).toEqual([450, 600]);
    const nearest = (s: number) =>
      Math.max(0, t1!.sStart - s, s - t1!.sEnd) <= Math.max(0, t2!.sStart - s, s - t2!.sEnd)
        ? t1!
        : t2!;
    const r = goingsOnMeasurementLine(m.layout, m.stepping, 0, {
      target: (s) => ({ d: nearest(s).walklineOffset!, offset: nearest(s).walklineOffset! }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.goings.length).toBe(m.stepping.treads.filter((t) => t.kind === "winder").length);
    for (const g of r.goings) expect(g.going).toBeCloseTo(g.tread.going, 6);
    const only = goingsOnMeasurementLine(m.layout, m.stepping, 0, {
      include: (t) => t.number === r.goings[0]!.tread.number,
      target: () => ({ d: 450, offset: 450 }),
    });
    expect(only.ok && only.goings.map((g) => g.tread.number)).toEqual([r.goings[0]!.tread.number]);
  });

  it("ligne à 600 mm du jour de la première jonction (d_f 450) : girons plus longs que sur Γ", () => {
    const m = buildModel(cage());
    const t1 = m.layout.turns[0]!;
    const inFirst = (t: { number: number }) => {
      const a = m.stepping.nosings[t.number - 1]!;
      const b = m.stepping.nosings[t.number]!;
      const s = (a.s + b.s) / 2;
      return s < (t1.sEnd + m.layout.turns[1]!.sStart) / 2;
    };
    const r = goingsOnMeasurementLine(m.layout, m.stepping, 0, {
      include: inFirst,
      target: () => ({ d: 600, offset: 450 }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.goings.length).toBeGreaterThan(0);
    const total = (xs: readonly { going: number }[]) => xs.reduce((a, b) => a + b.going, 0);
    const design = r.goings.reduce((a, g) => a + g.tread.going, 0);
    expect(total(r.goings)).toBeGreaterThan(design + 1);
  });
});
