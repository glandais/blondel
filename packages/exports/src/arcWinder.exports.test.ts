/**
 * Marches dansantes sur un tronçon à axe en arc (décision F10 (1), sous-lot P2) : effets sur les
 * **exports** des cages saisies en arc, que `packages/core/src/pipeline/arcWinder.test.ts` (qui
 * borne l'effet sur le `Model`) ne voit pas. Mesurés contre le commit 67672d2 :
 * - plan et élévation SVG : les marches de l'arc sont peintes en dansantes
 *   (`data-kind="winder"` au lieu de `straight`) ;
 * - la cote de giron du plan (`data-dimension="going"`) porte sur la première marche droite
 *   quand il y en a une (`cage-arc-palier-cintre`, `demo-cage-arc-glass`) ; sans aucune marche
 *   droite (`cage-arc`, hélicoïdaux), décision F10 (9), appliquée en P3 : elle se pose sur la
 *   première marche dansante, mesurée sur la ligne de foulée (plan DXF R12 de `cage-arc` :
 *   couche COTES de 11 à 17 entités, comme avant P2) ;
 * - liste de débit, visserie et développés inchangés (mêmes pièces).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModel,
  createProject,
  parseProjectText,
  pointInPolygon,
  ProjectSchema,
  vec2,
  type Model,
  type Project,
  type Vec2,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildPlanDrawing, type Dimension } from "./plan/drawing.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderPlanSvg } from "./svg/plan.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

const example = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

describe("marches dansantes sur axe en arc (décision F10 (1)) — exports", () => {
  it.each([
    // Exemple, marches dansantes, marches droites, cote de giron au plan.
    ["cage-arc", 14, 0, 1],
    ["cage-arc-palier-cintre", 7, 6, 1],
    ["demo-cage-arc-glass", 7, 6, 1],
  ])("%s : %i dansantes, %i droites, %i cote de giron", (name, winders, straights, going) => {
    const project = example(name);
    const model = buildModel(project);
    const opts = { project, theme: "light" as const, title: project.name, locale: "fr" as const };
    const plan = renderPlanSvg(model, opts);
    expect(count(plan, /data-kind="winder"/g)).toBe(winders);
    expect(count(plan, /data-kind="straight"/g)).toBe(straights);
    expect(count(plan, /data-dimension="going"/g)).toBe(going);
    const elevation = renderElevationSvg(model, opts);
    expect(count(elevation, /data-kind="winder"/g)).toBe(winders);
    expect(count(elevation, /data-kind="straight"/g)).toBe(straights);
  });
});

// ------------------------------------------------------------------ décision F10 (9)

/** Milieu de la ligne de cote (décalée de la ligne mesurée). */
const lineMid = (d: Dimension): Vec2 =>
  vec2.addScaled(vec2.lerp(d.a, d.b, 0.5), d.normal, d.offset);

/**
 * Cote de giron du plan d'un modèle complet, contrôlée selon la décision F10 (9) : une seule
 * cote « going » ; sans marche droite, posée sur la première marche dansante (corde de ses deux
 * nez), valeur = giron sur la ligne de foulée ; avec une marche droite, posée sur la première
 * droite entre deux nez non balancés, valeur = distance de ses extrémités (règle d'avant P3).
 */
function checkGoingDimension(model: Model): void {
  const { stepping, layout } = model;
  const dims = buildPlanDrawing(model).dimensions.filter((d) => d.role === "going");
  const anyStraight = stepping.treads.some((t) => t.kind === "straight");
  if (anyStraight) {
    const k = stepping.nosings.findIndex((n0, i) => {
      const n1 = stepping.nosings[i + 1];
      const t = n1 && stepping.treads.find((x) => x.number === n1.index);
      return !!n1 && !n0.balanced && !n1.balanced && t?.kind === "straight";
    });
    if (k < 0) {
      expect(dims).toHaveLength(0);
      return;
    }
    expect(dims).toHaveLength(1);
    const d = dims[0]!;
    expect(d.a).toEqual(stepping.nosings[k]!.p);
    expect(d.b).toEqual(stepping.nosings[k + 1]!.p);
    expect(Math.abs(d.value - vec2.distance(d.a, d.b))).toBeLessThan(1e-9);
    return;
  }
  const k = stepping.nosings.findIndex((_, i) => {
    const n1 = stepping.nosings[i + 1];
    return !!n1 && stepping.treads.find((x) => x.number === n1.index)?.kind === "winder";
  });
  expect(k).toBeGreaterThanOrEqual(0);
  const n0 = stepping.nosings[k]!;
  const n1 = stepping.nosings[k + 1]!;
  const tread = stepping.treads.find((x) => x.number === n1.index)!;
  // Première dansante : aucune dansante de plus petit numéro.
  expect(stepping.treads.every((t) => t.kind !== "winder" || t.number >= tread.number)).toBe(true);
  expect(dims).toHaveLength(1);
  const d = dims[0]!;
  expect(d.a).toEqual(n0.p);
  expect(d.b).toEqual(n1.p);
  // Valeur mesurée sur la ligne de foulée (longueur d'arc), pas la corde.
  expect(Math.abs(d.value - tread.going)).toBeLessThan(1e-9);
  expect(d.value).toBeGreaterThanOrEqual(vec2.distance(d.a, d.b) - 1e-9);
  // Texte « g (foulée) = … » : la valeur n'est pas la longueur dessinée (F10 (14)).
  expect(d.text).toMatch(/^g \(foulée\) = \d+,\d$/);
  expect(Math.abs(Number(d.text.slice(13).replace(",", ".")) - tread.going)).toBeLessThanOrEqual(
    0.05 + 1e-9,
  );
  // Ligne de cote dans l'emprise, entre le jour et la ligne de foulée.
  const mid = lineMid(d);
  expect(pointInPolygon(mid, layout.footprint)).toBe("inside");
  const h = layout.helical;
  if (h) {
    const r = vec2.distance(mid, h.center);
    expect(r).toBeGreaterThan(h.innerRadius);
    expect(r).toBeLessThan(h.walklineRadius);
  }
}

describe("cote de giron sans marche droite : première dansante, sur la ligne de foulée (décision F10 (9))", () => {
  it.each([
    "cage-arc",
    "j5a-helicoidal",
    "j5c-limon-central-helicoidal",
    "j5c-limon-central-bois-helicoidal",
    "demo-helical-glass",
    "demo-helical-well",
    "demo-central-glulam",
    // Avec au moins une marche droite : cote inchangée, sur une marche droite.
    "cage-arc-palier-cintre",
    "demo-cage-arc-glass",
  ])("exemple %s", (name) => {
    const model = buildModel(example(name));
    expect(model.errors).toEqual([]);
    checkGoingDimension(model);
  });

  it("préréglage helical : la cote porte « g = » le giron de la ligne de foulée", () => {
    const model = buildModel(createProject("helical"));
    expect(model.stepping.treads.some((t) => t.kind === "straight")).toBe(false);
    checkGoingDimension(model);
  });

  /** Préréglage helical, forme tirée (sens, rayons, noyau, balayage, départ, palier, débord). */
  const helicalArb: fc.Arbitrary<Project> = fc
    .record({
      direction: fc.constantFrom("left" as const, "right" as const),
      coreRadius: fc.integer({ min: 60, max: 400 }),
      width: fc.integer({ min: 600, max: 1200 }),
      core: fc.constantFrom("column" as const, "well" as const),
      sweep: fc.oneof(
        fc.record({
          mode: fc.constant("angle" as const),
          degrees: fc.integer({ min: 180, max: 720 }),
        }),
        fc.record({
          mode: fc.constant("treadsPerTurn" as const),
          count: fc.integer({ min: 10, max: 24 }),
        }),
      ),
      startAngle: fc.integer({ min: -180, max: 180 }),
      landing: fc.option(fc.integer({ min: 30, max: 180 }), { nil: undefined }),
      nosing: fc.integer({ min: 0, max: 30 }),
    })
    .map((r) => {
      const base = createProject("helical");
      return ProjectSchema.parse({
        ...base,
        stair: {
          ...base.stair,
          layout: {
            kind: "helical",
            direction: r.direction,
            outerRadius: r.coreRadius + r.width,
            core: { kind: r.core, radius: r.coreRadius },
            sweep: r.sweep,
            startAngle: r.startAngle,
            ...(r.landing !== undefined ? { landing: { angle: r.landing } } : {}),
          },
          treads: { ...base.stair.treads, nosing: r.nosing },
        },
      });
    });

  it("propriété : hélicoïdaux tirés du préréglage", () => {
    fc.assert(
      fc.property(helicalArb, (project) => {
        const model = buildModel(project, { memo: false });
        fc.pre(model.stepping.treads.length > 1);
        expect(model.stepping.treads.some((t) => t.kind === "straight")).toBe(false);
        checkGoingDimension(model);
      }),
      { numRuns: 25 },
    );
  });

  /** Cage d'un seul tronçon à axe en arc (sans marche droite) ou suivi d'un tronçon droit. */
  const arcCageArb: fc.Arbitrary<Project> = fc
    .record({
      radius: fc.integer({ min: 1200, max: 4000 }),
      sweep: fc.integer({ min: 40, max: 160 }),
      sign: fc.constantFrom(1, -1),
      width: fc.integer({ min: 700, max: 1100 }),
      floorToFloor: fc.integer({ min: 2300, max: 3000 }),
    })
    .map((r) => {
      const base = example("cage-arc");
      return ProjectSchema.parse({
        ...base,
        site: { ...base.site, floorToFloor: r.floorToFloor },
        stair: {
          ...base.stair,
          layout: {
            kind: "cage",
            junctions: [],
            sections: [
              { axis: { kind: "arc", radius: r.radius, sweep: r.sign * r.sweep }, width: r.width },
            ],
          },
        },
      });
    });

  it("propriété : cages en arc seul", () => {
    fc.assert(
      fc.property(arcCageArb, (project) => {
        const model = buildModel(project, { memo: false });
        fc.pre(model.stepping.treads.length > 1);
        expect(model.stepping.treads.some((t) => t.kind === "straight")).toBe(false);
        checkGoingDimension(model);
      }),
      { numRuns: 25 },
    );
  });
});
