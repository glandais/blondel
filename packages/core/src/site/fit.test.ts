/**
 * Adéquation au site (`site/fit.ts`, ADR-0010, sous-lot 3b) : un cas positif et un cas négatif
 * par type de conflit, sur un escalier droit (préréglage `straight` : emprise x ∈ [0 ; 900],
 * y ∈ [0 ; 3 780], montée vers +y, jour à gauche en x = 0, arrivée en y = 3 780 à 2 700 mm).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Model, SiteConflict } from "../model/derived.js";
import { ProjectSchema, type Project, type ProjectInput } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import { PROJECT_SCHEMA_VERSION } from "../model/project.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import {
  arrivalZone,
  computeSiteFit,
  doorSwingPolygon,
  doorSwingSector,
  projectLateralThickness,
  stairGrossPieces,
} from "./fit.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

/** Escalier droit sans trémie (aucun conflit de dalle ni d'échappée), site complété. */
function straight(site: Record<string, unknown> = {}, extra: Partial<ProjectInput> = {}): Project {
  const base = structuredClone(createProject("straight")) as unknown as Record<string, unknown>;
  const s = { ...(base.site as Record<string, unknown>) };
  delete s.opening;
  return ProjectSchema.parse({ ...base, ...extra, site: { ...s, ...site } });
}

const fitOf = (p: Project): readonly SiteConflict[] => buildModel(p, { memo: false }).siteFit ?? [];
const kinds = (p: Project): string[] => fitOf(p).map((c) => c.kind);
const wall = (id: string, a: [number, number], b: [number, number], thickness = 200) => ({
  id,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  thickness,
  loadBearing: true,
});

describe("adéquation au site : murs", () => {
  it("un mur qui traverse l'escalier est une erreur, zone dans le mur", () => {
    const p = straight({ walls: [wall("M1", [-500, 1500], [1400, 1500])] });
    const fit = fitOf(p);
    expect(fit.map((c) => [c.kind, c.severity, c.targetId])).toEqual([["wall", "erreur", "M1"]]);
    expect(fit[0]!.message).toEqual({ key: "site.fit.wall", params: { wall: "M1" } });
    for (const v of fit[0]!.zone) expect(Math.abs(v.y - 1500)).toBeLessThanOrEqual(100 + 1e-6);
  });

  it("escalier adossé au nu d'un mur : admis ; mur éloigné : rien", () => {
    // Nu du mur en x = 900 (axe en 1 000, épaisseur 200).
    expect(kinds(straight({ walls: [wall("M1", [1000, -500], [1000, 4500])] }))).toEqual([]);
    expect(kinds(straight({ walls: [wall("M1", [3000, -500], [3000, 4500])] }))).toEqual([]);
  });

  it("épaisseur latérale de la structure : le limon adossé entre dans le mur", () => {
    const p = straight({ walls: [wall("M1", [1000, -500], [1000, 3700])] });
    const model = buildModel(p, { memo: false });
    const fit = computeSiteFit(p, model.layout, model.stepping, {
      lateral: { inner: 0, outer: 40 },
    });
    expect(fit.map((c) => c.kind)).toEqual(["wall"]);
    expect(
      computeSiteFit(p, model.layout, model.stepping, { lateral: { inner: 40, outer: 0 } }),
    ).toEqual([]);
  });
});

describe("adéquation au site : contour de la pièce", () => {
  const room = (x0: number, y0: number, x1: number, y1: number) => ({
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  });

  it("escalier dans la pièce (au nu du contour) : rien", () => {
    expect(kinds(straight({ room: room(0, 0, 3000, 6000) }))).toEqual([]);
  });

  it("escalier qui dépasse du contour : erreur, zone hors de la pièce", () => {
    const fit = fitOf(straight({ room: room(0, 0, 3000, 3000) })).filter(
      (c) => c.kind === "outsideRoom",
    );
    expect(fit.map((c) => c.severity)).toEqual(["erreur"]);
    expect(Math.max(...fit[0]!.zone.map((v) => v.y))).toBeGreaterThan(3000);
  });

  it("contour rentrant qui entaille l'escalier sans qu'un sommet sorte : croisements détectés", () => {
    // Une avancée du contour entre dans l'escalier par le côté du jour (x = 0), strictement
    // entre deux lignes de nez (y = 2 160 et 2 430) : aucun sommet des pièces n'est hors du
    // contour, seuls les croisements d'arêtes révèlent le conflit.
    const notch = {
      points: [
        { x: -100, y: -100 },
        { x: 2000, y: -100 },
        { x: 2000, y: 6000 },
        { x: -100, y: 6000 },
        { x: -100, y: 2400 },
        { x: 500, y: 2400 },
        { x: 500, y: 2200 },
        { x: -100, y: 2200 },
      ],
    };
    const p = straight({ room: notch });
    const m = buildModel(p, { memo: false });
    const pieces = stairGrossPieces(m.layout, m.stepping, projectLateralThickness(p));
    for (const piece of pieces)
      for (const v of piece.polygon)
        expect(pointInPolygon(v, notch.points, 0.5)).not.toBe("outside");
    expect(kinds(p)).toEqual(["outsideRoom"]);
  });
});

describe("adéquation au site : obstacles", () => {
  it("poteau dans l'escalier : erreur ; poteau à côté : rien", () => {
    const post = (x: number) => ({
      kind: "post",
      id: "P1",
      center: { x, y: 1000 },
      sizeX: 200,
      sizeY: 200,
      rotation: 45,
    });
    const fit = fitOf(straight({ obstacles: [post(450)] }));
    expect(fit.map((c) => [c.kind, c.severity, c.targetId, c.message.key])).toEqual([
      ["obstacle", "erreur", "P1", "site.fit.post"],
    ]);
    // Diagonale du carré tourné de 45° : 141 mm ; centre à 1 100 mm, à 200 mm du bord.
    expect(kinds(straight({ obstacles: [post(1100)] }))).toEqual([]);
  });

  it("poteau rond : recouvrement au-delà du contact ; tangent au bord : rien", () => {
    const disc = (x: number) => ({
      kind: "circularPost",
      id: "C1",
      center: { x, y: 800 },
      radius: 100,
    });
    expect(kinds(straight({ obstacles: [disc(950)] }))).toEqual(["obstacle"]);
    expect(kinds(straight({ obstacles: [disc(1000)] }))).toEqual([]);
  });

  it("zone interdite non convexe : recouvrement détecté, creux qui contient l'escalier admis", () => {
    // Zone en U ouverte vers +y : bras x ∈ [−300 ; −100] et [1 000 ; 1 200], fond y ∈ [−400 ; −200].
    const u = (bottom: number) => ({
      kind: "zone",
      id: "Z1",
      points: [
        { x: -300, y: -400 },
        { x: 1200, y: -400 },
        { x: 1200, y: 2000 },
        { x: 1000, y: 2000 },
        { x: 1000, y: bottom },
        { x: -100, y: bottom },
        { x: -100, y: 2000 },
        { x: -300, y: 2000 },
      ],
    });
    // Son enveloppe convexe recouvre l'escalier, la zone elle-même non.
    expect(kinds(straight({ obstacles: [u(-200)] }))).toEqual([]);
    // Fond relevé à y = 300 : il entre dans les premières marches.
    const fit = fitOf(straight({ obstacles: [u(300)] }));
    expect(fit.map((c) => [c.kind, c.severity, c.targetId, c.message.key])).toEqual([
      ["obstacle", "erreur", "Z1", "site.fit.zone"],
    ]);
  });

  it("porte : le débattement côté escalier est un avertissement, l'autre côté rien", () => {
    // Baie dans un mur y = −100 (nu en y = 0) devant le départ, gonds en a.
    const door = (swing: "left" | "right") => ({
      kind: "door",
      id: "D1",
      a: { x: 100, y: -100 },
      b: { x: 800, y: -100 },
      hinge: "a",
      swing,
    });
    const fit = fitOf(straight({ obstacles: [door("left")] }));
    expect(fit.map((c) => [c.kind, c.severity, c.targetId])).toEqual([
      ["doorSwing", "avertissement", "D1"],
    ]);
    expect(fit[0]!.message.params?.radius).toMatchObject({ num: 700 });
    expect(kinds(straight({ obstacles: [door("right")] }))).toEqual([]);
  });

  it("porte : rayon du débattement réglé dans le profil d'atelier", () => {
    // Baie verticale x = 1 600, y ∈ [1 000 ; 1 600] (600 mm), gonds en a, ouverture vers −x :
    // le secteur s'étend jusqu'à x = 1 600 − rayon. Rayon par défaut (largeur, 600) : x ≥ 1 000,
    // à 100 mm de l'escalier ; rayon réglé à 1 200 : x ≥ 400, dans l'escalier.
    const door = {
      kind: "door",
      id: "D1",
      a: { x: 1600, y: 1000 },
      b: { x: 1600, y: 1600 },
      hinge: "a",
      swing: "left",
    };
    expect(kinds(straight({ obstacles: [door] }))).toEqual([]);
    const fit = fitOf(
      straight({ obstacles: [door] }, { workshop: { siteFit: { doorSwingRadius: 1200 } } }),
    );
    expect(fit.map((c) => [c.kind, c.targetId])).toEqual([["doorSwing", "D1"]]);
    expect(fit[0]!.message.params?.radius).toMatchObject({ num: 1200 });
  });

  it("porte : secteur de débattement (gonds en b, ouverture à droite)", () => {
    const sector = doorSwingPolygon(
      { kind: "door", id: "D", a: { x: 0, y: 0 }, b: { x: 800, y: 0 }, hinge: "b", swing: "right" },
      800,
    );
    // Gonds en b, ouverture à droite de a→b (vers −y) : secteur sous la baie.
    expect(Math.min(...sector.map((v) => v.y))).toBeCloseTo(-800, 6);
    expect(Math.max(...sector.map((v) => v.y))).toBeCloseTo(0, 6);
  });

  it("débattement dessiné (éditeur) : même rayon que le contrôle, réglage d'atelier compris", () => {
    const door = {
      kind: "door" as const,
      id: "D",
      a: { x: 0, y: 0 },
      b: { x: 800, y: 0 },
      hinge: "a" as const,
      swing: "left" as const,
    };
    expect(doorSwingSector(door)).toEqual(doorSwingPolygon(door, 800));
    expect(doorSwingSector(door, { doorSwingRadius: null })).toEqual(doorSwingPolygon(door, 800));
    expect(doorSwingSector(door, { doorSwingRadius: 1200 })).toEqual(doorSwingPolygon(door, 1200));
  });

  it("fenêtre : conseil seulement, marches devant la baie sous le linteau", () => {
    // Mur adossé côté extérieur (nu en x = 900), fenêtre dans le mur à mi-hauteur de la volée.
    const walls = [wall("M1", [1000, -500], [1000, 4500])];
    const win = (sill: number, head: number) => ({
      kind: "window",
      id: "F1",
      a: { x: 1000, y: 1500 },
      b: { x: 1000, y: 2300 },
      sill,
      head,
    });
    const fit = fitOf(straight({ walls, obstacles: [win(900, 2100)] }));
    expect(fit.map((c) => [c.kind, c.severity, c.targetId])).toEqual([["window", "conseil", "F1"]]);
    expect(fit[0]!.message.key).toBe("site.fit.window");
    // Linteau sous la première marche : rien.
    expect(kinds(straight({ walls, obstacles: [win(0, 100)] }))).toEqual([]);
    // Fenêtre dans un mur éloigné : rien.
    const far = { ...win(900, 2100), a: { x: 3000, y: 1500 }, b: { x: 3000, y: 2300 } };
    expect(kinds(straight({ obstacles: [far] }))).toEqual([]);
  });
});

describe("adéquation au site : dégagement d'arrivée", () => {
  // Arrivée en y = 3 780, emmarchement 900 : défaut 900 mm devant le nez d'arrivée.
  const across = (y: number) => [wall("M9", [-500, y + 100], [1400, y + 100])];

  it("mur à moins de l'emmarchement devant le nez d'arrivée : avertissement", () => {
    const fit = fitOf(straight({ walls: across(3780 + 600) }));
    expect(fit.map((c) => [c.kind, c.severity, c.targetId])).toEqual([
      ["arrivalClearance", "avertissement", "M9"],
    ]);
    expect(fit[0]!.message.params?.clearance).toMatchObject({ num: 900 });
  });

  it("mur au-delà du dégagement, ou dégagement réglé plus court : rien", () => {
    expect(kinds(straight({ walls: across(3780 + 900) }))).toEqual([]);
    expect(
      kinds(
        straight(
          { walls: across(3780 + 600) },
          { workshop: { siteFit: { arrivalClearance: 500 } } },
        ),
      ),
    ).toEqual([]);
  });

  it("poteaux devant l'arrivée ; zone interdite et contour de la pièce (niveau bas) ignorés", () => {
    const disc = { kind: "circularPost", id: "C9", center: { x: 450, y: 4300 }, radius: 100 };
    expect(fitOf(straight({ obstacles: [disc] })).map((c) => [c.kind, c.targetId])).toEqual([
      ["arrivalClearance", "C9"],
    ]);
    const post = {
      kind: "post",
      id: "P9",
      center: { x: 450, y: 4300 },
      sizeX: 200,
      sizeY: 200,
      rotation: 0,
    };
    expect(fitOf(straight({ obstacles: [post] })).map((c) => [c.kind, c.targetId])).toEqual([
      ["arrivalClearance", "P9"],
    ]);
    const zone = {
      kind: "zone",
      id: "Z9",
      points: [
        { x: 0, y: 4000 },
        { x: 900, y: 4000 },
        { x: 900, y: 4400 },
        { x: 0, y: 4400 },
      ],
    };
    expect(kinds(straight({ obstacles: [zone] }))).toEqual([]);
    const room = {
      points: [
        { x: -100, y: -100 },
        { x: 1000, y: -100 },
        { x: 1000, y: 4200 },
        { x: -100, y: 4200 },
      ],
    };
    expect(kinds(straight({ room }))).toEqual([]);
  });

  it("zone du dégagement : largeur hors tout, profondeur réglée, dans le sens de la montée", () => {
    const p = straight();
    const m = buildModel(p, { memo: false });
    const z = arrivalZone(m.layout, m.stepping, { inner: 10, outer: 20 }, 300)!;
    expect(z.clearance).toBe(300);
    const xs = z.zone.map((v) => v.x);
    const ys = z.zone.map((v) => v.y);
    expect(Math.min(...xs)).toBeCloseTo(-10, 6);
    expect(Math.max(...xs)).toBeCloseTo(920, 6);
    expect(Math.min(...ys)).toBeCloseTo(3780, 6);
    expect(Math.max(...ys)).toBeCloseTo(4080, 6);
  });
});

describe("adéquation au site : dalle haute", () => {
  const opening = (x: number, y: number, sizeX: number, sizeY: number) => ({
    kind: "rect",
    x,
    y,
    sizeX,
    sizeY,
  });

  it("trémie trop courte : la dernière marche traverse la dalle (erreur)", () => {
    const fit = fitOf(straight({ opening: opening(-100, 2500, 1100, 900) })).filter(
      (c) => c.kind === "slab",
    );
    expect(fit.map((c) => [c.severity, c.message.key])).toEqual([["erreur", "site.fit.slab"]]);
  });

  it("trémie qui dégage l'escalier : pas de conflit de dalle", () => {
    const fit = fitOf(straight({ opening: opening(-100, 630, 1100, 3150) }));
    expect(fit.filter((c) => c.kind === "slab")).toEqual([]);
  });

  it("dalle plus mince qu'une hauteur de marche : seule la ligne d'arrivée la traverse", () => {
    // Sous-face à 2 600 : seul le nez d'arrivée (y = 3 780, z = 2 700) est au-dessus ; la
    // trémie s'arrête en y = 3 630. Aucune marche 15 : message propre à la ligne d'arrivée.
    const thin = { upperSlabThickness: 100 };
    const fit = fitOf(straight({ ...thin, opening: opening(-100, 630, 1100, 3000) })).filter(
      (c) => c.kind === "slab",
    );
    expect(fit.map((c) => [c.severity, c.message])).toEqual([
      [
        "erreur",
        {
          key: "site.fit.slabArrival",
          params: { ceiling: expect.objectContaining({ num: 2600 }) },
        },
      ],
    ]);
    // Zone : emprise de la dernière marche (jusqu'au nez d'arrivée), pas toute la trémie.
    const ys = fit[0]!.zone.map((v) => v.y);
    expect(Math.max(...ys)).toBeCloseTo(3780, 6);
    expect(Math.min(...ys)).toBeGreaterThan(3000);
    // Trémie au ras de l'emmarchement, limons de 40 mm : avertissement sur la ligne d'arrivée.
    const p = straight({ ...thin, opening: opening(0, 630, 900, 3200) });
    const m = buildModel(p, { memo: false });
    const warn = computeSiteFit(p, m.layout, m.stepping, {
      lateral: { inner: 40, outer: 40 },
    }).filter((c) => c.kind === "slab");
    expect(warn.map((c) => [c.severity, c.message.key])).toEqual([
      ["avertissement", "site.fit.slabStructureArrival"],
    ]);
  });

  it("seule l'épaisseur latérale de la structure passe sous la dalle : avertissement", () => {
    const p = straight({ opening: opening(0, 630, 900, 3150) });
    const m = buildModel(p, { memo: false });
    expect(computeSiteFit(p, m.layout, m.stepping).filter((c) => c.kind === "slab")).toEqual([]);
    const fit = computeSiteFit(p, m.layout, m.stepping, {
      lateral: { inner: 40, outer: 40 },
    }).filter((c) => c.kind === "slab");
    expect(fit.map((c) => [c.severity, c.message.key])).toEqual([
      ["avertissement", "site.fit.slabStructure"],
    ]);
  });
});

describe("adéquation au site : échappée et recouvrement", () => {
  it("échappée : violations ECHAPPEE_* reprises telles quelles (message, sévérité, règle)", () => {
    const text = readFileSync(
      join(EXAMPLES_DIR, "acceptance-01-quart-tournant.blondel.json"),
      "utf8",
    );
    const m: Model = buildModel(parseProjectText(text), { memo: false });
    const violations = m.compliance.results.filter(
      (r) => r.status === "violation" && r.ruleId.startsWith("ECHAPPEE_"),
    );
    expect(violations.length).toBeGreaterThan(0);
    const headroom = (m.siteFit ?? []).filter((c) => c.kind === "headroom");
    expect(headroom.map((c) => c.ruleId).sort()).toEqual(violations.map((r) => r.ruleId).sort());
    for (const c of headroom) {
      const r = violations.find((v) => v.ruleId === c.ruleId)!;
      expect(c.message).toBe(r.message);
      expect(c.severity).toBe(r.severity === "bloquant" ? "erreur" : r.severity);
      expect(c.zone.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("échappée respectée (sans trémie ni plafond) : aucun conflit d'échappée", () => {
    expect(kinds(straight()).filter((k) => k === "headroom")).toEqual([]);
  });

  it("cage qui repasse sur elle-même : erreur localisée ; cage simple : rien", () => {
    const cage = (last: number) =>
      ProjectSchema.parse({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        site: { floorToFloor: 5400, upperSlabThickness: 200 },
        stair: {
          placement: { origin: { x: 0, y: 0 }, rotation: 0 },
          layout: {
            kind: "cage",
            sections: [3000, 600, 600, last].map((length) => ({
              axis: { kind: "straight", length },
              width: 900,
            })),
            junctions: [
              { angle: 90, mode: "landing" },
              { angle: 90, mode: "landing" },
              { angle: 90, mode: "landing" },
            ],
          },
        },
      });
    const fit = fitOf(cage(2400)).filter((c) => c.kind === "selfOverlap");
    expect(fit.map((c) => [c.severity, c.message])).toEqual([
      ["erreur", { key: "site.fit.selfOverlap", params: { sectionA: 1, sectionB: 4 } }],
    ]);
    expect(fit[0]!.zone.length).toBe(4);
    expect(kinds(cage(300)).filter((k) => k === "selfOverlap")).toEqual([]);
  });
});

describe("adéquation au site : emprise et pipeline", () => {
  it("emprise hors tout : une pièce par marche, élargie des épaisseurs latérales", () => {
    const p = straight();
    const m = buildModel(p, { memo: false });
    const pieces = stairGrossPieces(m.layout, m.stepping, { inner: 30, outer: 50 });
    expect(pieces.length).toBe(m.stepping.treads.length);
    const xs = pieces.flatMap((q) => q.polygon.map((v) => v.x));
    expect(Math.min(...xs)).toBeCloseTo(-30, 6);
    expect(Math.max(...xs)).toBeCloseTo(950, 6);
    expect(projectLateralThickness(p)).toEqual({ inner: 0, outer: 0 });
  });

  it("épaisseurs latérales de la structure du projet (limons)", () => {
    const text = readFileSync(join(EXAMPLES_DIR, "j3a-acceptance-01-bois.blondel.json"), "utf8");
    const t = projectLateralThickness(parseProjectText(text));
    expect(t.inner).toBeGreaterThan(0);
    expect(t.outer).toBeGreaterThan(0);
  });

  it("conflits triés par sévérité (erreurs d'abord)", () => {
    const fit = fitOf(
      straight({
        walls: [wall("M1", [-500, 1500], [1400, 1500]), wall("M9", [-500, 4480], [1400, 4480])],
        obstacles: [
          // Baie sans mur porteur : segment au nu de l'escalier.
          {
            kind: "window",
            id: "F1",
            a: { x: 900, y: 200 },
            b: { x: 900, y: 900 },
            sill: 0,
            head: 2000,
          },
        ],
      }),
    );
    const order = { erreur: 0, avertissement: 1, conseil: 2 } as const;
    const ranks = fit.map((c) => order[c.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(fit.map((c) => c.kind))).toEqual(
      new Set(["wall", "arrivalClearance", "window"]),
    );
  });

  it("Model.siteFit omis sans conflit ; régler le profil d'adéquation ne recalcule pas la structure", () => {
    const p = straight();
    expect(buildModel(p, { memo: false }).siteFit).toBeUndefined();
    const pa = straight({ walls: [wall("M9", [-500, 4380], [1400, 4380])] });
    // Même projet (sous-objets partagés), seul le réglage d'adéquation change.
    const pb: Project = { ...pa, workshop: { siteFit: { arrivalClearance: 300 } } };
    const a = buildModel(pa);
    const b = buildModel(pb);
    expect(a.siteFit?.map((c) => c.kind)).toEqual(["arrivalClearance"]);
    expect(b.siteFit).toBeUndefined();
    expect(b.parts).toBe(a.parts);
  });

  it("déplacer un obstacle ou le contour ne recalcule ni l'échappée ni le contrôle", () => {
    const text = readFileSync(join(EXAMPLES_DIR, "quarter-landing.blondel.json"), "utf8");
    const p1 = parseProjectText(text);
    const far = (x: number) => ({
      kind: "circularPost" as const,
      id: "C1",
      center: { x, y: -5000 },
      radius: 100,
    });
    const p2: Project = { ...p1, site: { ...p1.site, obstacles: [far(-5000)] } };
    const p3: Project = { ...p1, site: { ...p2.site, obstacles: [far(-6000)] } };
    const m1 = buildModel(p1);
    const m2 = buildModel(p2);
    const m3 = buildModel(p3);
    // `Model.headroom` et `Model.compliance` sont recomposés à chaque appel : on compare les
    // objets rendus par les étapes mémoïsées (point de l'échappée minimale, résultats de règle).
    expect(m1.headroom?.at).toBeDefined();
    expect(m1.compliance.results.length).toBeGreaterThan(0);
    for (const m of [m2, m3]) {
      expect(m.headroom?.at).toBe(m1.headroom?.at);
      m.compliance.results.forEach((r, i) => expect(r).toBe(m1.compliance.results[i]));
      expect(m.parts).toBe(m1.parts);
    }
  });
});

describe("adéquation au site : limon extérieur d'un hélicoïdal entre deux nez", () => {
  /** Mur court perpendiculaire au rayon du milieu de la marche 3, face à `face` du centre. */
  function midTreadWall(p: Project, model: Model, face: number) {
    const h = model.layout.helical!;
    const n0 = model.stepping.nosings[2]!;
    const n1 = model.stepping.nosings[3]!;
    const a0 = Math.atan2(n0.r.y - h.center.y, n0.r.x - h.center.x);
    const a1 = Math.atan2(n1.r.y - h.center.y, n1.r.x - h.center.x);
    let d = a1 - a0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const mid = a0 + d / 2;
    const u = { x: Math.cos(mid), y: Math.sin(mid) };
    const t = { x: -u.y, y: u.x };
    const c = { x: h.center.x + u.x * (face + 100), y: h.center.y + u.y * (face + 100) };
    return wall("H", [c.x - t.x * 100, c.y - t.y * 100], [c.x + t.x * 100, c.y + t.y * 100]);
  }

  for (const outer of [8, 60])
    it(`épaisseur extérieure ${outer} mm : un mur qui entre de 5 mm à mi-marche est un conflit`, () => {
      const base = createProject("helical");
      const model = buildModel(base, { memo: false });
      const R = model.layout.helical!.outerRadius;
      const lateral = { inner: 0, outer };
      const withWall = (face: number): Project =>
        ProjectSchema.parse({
          ...base,
          site: { ...base.site, walls: [midTreadWall(base, model, face)] },
        });
      const wallsOf = (face: number) => {
        const p = withWall(face);
        return computeSiteFit(p, model.layout, model.stepping, { lateral }).filter(
          (c) => c.kind === "wall",
        );
      };
      expect(wallsOf(R + outer - 5).map((c) => [c.kind, c.severity])).toEqual([["wall", "erreur"]]);
      // Au nu (1 mm de jeu) : rien.
      expect(wallsOf(R + outer + 1)).toEqual([]);
    });
});
