/**
 * Préréglages de démonstration (`presetDemo.ts`) et exemples `examples/demo-*.blondel.json`.
 * Régénération : `UPDATE_EXAMPLES=1 pnpm vitest run packages/core/src/project/presetDemo.test.ts`.
 * Les exports de bout en bout (SVG, DXF, PDF, glTF) de ces exemples sont vérifiés par
 * `packages/exports/src/examples.test.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { translatorFor } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../structures/index.js";
import { cageFeatures, type CageFeature } from "../model/cageFeatures.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { segmentIntersect } from "../geom2d/intersect.js";
import { pointInPolygon } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { computeGuards } from "../guards/compute.js";
import { computeLayout } from "../layout/layout.js";
import { OPENING_POINT_PRECISION } from "../site/opening.js";
import { computeStepping } from "../stepping/stepping.js";
import { assemblyQuantity } from "../parts/components.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "./parse.js";
import {
  createDemoProject,
  DEMO_PRESET_DESCRIPTIONS,
  DEMO_PRESET_IDS,
  DEMO_PRESET_LABELS,
  isDemoPresetId,
  type DemoPresetId,
} from "./presetDemo.js";
import { ALL_PRESET_IDS, createProject, PRESET_LABELS } from "./presets.js";
import { serializeProject } from "./serialize.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const exampleFile = (id: string): string => `${id}.blondel.json`;

if (process.env["UPDATE_EXAMPLES"] === "1") {
  for (const id of DEMO_PRESET_IDS) {
    writeFileSync(join(EXAMPLES_DIR, exampleFile(id)), serializeProject(createDemoProject(id)));
  }
}

const FR = translatorFor("fr");
const EN = translatorFor("en");

describe("préréglages de démonstration", () => {
  it("identifiants distincts des préréglages de base, libellés et descriptions renseignés", () => {
    expect(DEMO_PRESET_IDS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(DEMO_PRESET_IDS).size).toBe(DEMO_PRESET_IDS.length);
    for (const id of DEMO_PRESET_IDS) {
      expect(id.startsWith("demo-")).toBe(true);
      expect(isDemoPresetId(id)).toBe(true);
      expect((ALL_PRESET_IDS as readonly string[]).includes(id)).toBe(false);
      expect(FR.t(DEMO_PRESET_LABELS[id]).length).toBeGreaterThan(0);
      expect(FR.t(DEMO_PRESET_DESCRIPTIONS[id])).toMatch(/^[A-ZÉ].+\.$/);
      expect(FR.t(DEMO_PRESET_DESCRIPTIONS[id])).not.toContain("\n");
      expect(EN.t(DEMO_PRESET_DESCRIPTIONS[id])).toMatch(/^[A-Z0-9].+\.$/);
    }
    for (const id of ALL_PRESET_IDS) expect(isDemoPresetId(id)).toBe(false);
    expect(new Set(Object.values(DEMO_PRESET_LABELS)).size).toBe(DEMO_PRESET_IDS.length);
  });

  it("préréglages de base inchangés : aucune apparence enregistrée", () => {
    for (const id of ALL_PRESET_IDS) {
      const p = createProject(id);
      expect(p.appearance).toBeUndefined();
      expect(p.name).toBe(FR.t(PRESET_LABELS[id]));
      expect(serializeProject(p)).not.toContain('"appearance"');
    }
  });

  it.each(DEMO_PRESET_IDS)("%s : modèle complet, aucune erreur ni violation bloquante", (id) => {
    const p = createDemoProject(id);
    expect(p.name).toBe(FR.t(DEMO_PRESET_LABELS[id]));
    expect(p.stair.structure.kind).not.toBe("none");
    expect(p.guards).toBeDefined();
    expect(p.appearance).toBeDefined();
    const m = buildModel(p, { memo: false });
    expect(m.errors).toEqual([]);
    const blocking = m.compliance.results.filter(
      (r) => r.status === "violation" && r.severity === "bloquant",
    );
    expect(blocking.map((r) => r.ruleId)).toEqual([]);
    expect(m.compliance.summary.bloquant).toBe(0);
    // Adéquation au site (ADR-0010) : aucun conflit de sévérité « erreur ».
    expect((m.siteFit ?? []).filter((c) => c.severity === "erreur")).toEqual([]);
    for (const part of m.parts) {
      // Pièce finie faite de composantes (poutre en couches empilées, QUESTIONS A33 (e)) : sa
      // matière est portée par ses composantes, imbriquées (planche → couche → poutre, A36 (9)).
      const mass = assemblyQuantity(m.parts, part.id, "mass_kg");
      expect(mass !== undefined && Number.isFinite(mass) && mass > 0, part.id).toBe(true);
    }
  });

  it.each(["demo-helical-glass", "demo-helical-well"] as const)(
    "%s : sortie du palier d'arrivée vers la dalle au moins aussi large que l'emmarchement",
    (id) => {
      const h = buildModel(createDemoProject(id), { memo: false }).layout!.helical!;
      const exit = 2 * h.outerRadius * Math.sin(h.landingAngle / 2);
      expect(exit).toBeGreaterThanOrEqual(h.outerRadius - h.innerRadius);
    },
  );

  it("les matériaux sont ceux du modèle (masses cohérentes), l'apparence ne règle que les teintes", () => {
    const materials = (id: (typeof DEMO_PRESET_IDS)[number]): Set<string> =>
      new Set(buildModel(createDemoProject(id), { memo: false }).parts.map((p) => p.material));
    expect(materials("demo-helical-glass")).toEqual(
      new Set(["steel-painted", "wood-oak", "glass", "stainless-brushed"]),
    );
    expect(materials("demo-u-oak")).toEqual(new Set(["wood-oak"]));
    expect(materials("demo-quarter-landing-ash")).toContain("wood-ash");
    expect(materials("demo-quarter-landing-ash")).not.toContain("wood-oak");
    expect(materials("demo-quarter-landing-ash")).toContain("glass");
    // Tôle pliée : marches en acier (seule la contremarche d'arrivée, contre la dalle, reste
    // en bois : comportement du plugin `steel-flat`).
    const industrial = buildModel(createDemoProject("demo-half-turn-industrial"), { memo: false });
    const treads = industrial.parts.filter((p) => p.category === "tread");
    expect(treads.length).toBeGreaterThan(0);
    expect(new Set(treads.map((p) => p.material))).toEqual(new Set(["steel-painted"]));
    expect(materials("demo-helical-well")).toContain("wood-beech");
    // Acier peint en trois tons distincts : ossature, marches, garde-corps.
    const tones = createDemoProject("demo-half-turn-industrial").appearance!;
    expect(new Set([tones.paintColor, tones.treadPaintColor, tones.guardPaintColor]).size).toBe(3);
  });

  it("chaque démo est un projet canonique : relu et resérialisé à l'identique", () => {
    for (const id of DEMO_PRESET_IDS) {
      const text = serializeProject(createDemoProject(id));
      expect(serializeProject(parseProjectText(text))).toBe(text);
    }
  });

  it("particularités : ERP large à deux mains courantes, loft sans contremarche, jour en arc", () => {
    const erp = createDemoProject("demo-erp-grand");
    expect(erp.stair.layout.width).toBe(1400);
    expect(erp.compliance.contexts).toContain("erp_neuf");
    const m = buildModel(erp, { memo: false });
    // Mains courantes des deux côtés de la volée (pas seulement celle de la trémie).
    const handrails = new Set(m.parts.filter((p) => p.category === "handrail").map((p) => p.id));
    expect(handrails).toContain("guard-inner-1-handrail");
    expect(handrails).toContain("guard-outer-1-handrail");
    // Hélicoïdaux : marches de 80 mm, vide entre marches (sans contremarche) sous la sphère de
    // 100 mm de `VIDE_ENTRE_MARCHES`.
    for (const id of ["demo-helical-glass", "demo-helical-well"] as const) {
      const results = buildModel(createDemoProject(id), { memo: false }).compliance.results;
      const gaps = results.filter((r) => r.ruleId === "VIDE_ENTRE_MARCHES");
      expect(gaps.length, id).toBeGreaterThan(0);
      expect(
        gaps.filter((r) => r.status === "violation"),
        id,
      ).toEqual([]);
    }
    const loft = createDemoProject("demo-straight-loft");
    expect(loft.stair.treads.risers).toBe("none");
    expect(loft.stair.treads.thickness).toBe(80);
    const curved = createDemoProject("demo-quarter-curved");
    expect(curved.stair.layout.turns[0]!.inner.kind).toBe("arc");
    const well = createDemoProject("demo-helical-well");
    expect(well.stair.layout.kind === "helical" && well.stair.layout.core.kind).toBe("well");
    // Limon central débillardé (QUESTIONS A29) : caisson à flasques roulées, consoles soudées.
    const central = createDemoProject("demo-central-wreathed");
    expect(central.stair.structure.kind).toBe("steel-central");
    const cm = buildModel(central, { memo: false });
    expect(cm.parts.some((p) => p.id.startsWith("central-web-left-"))).toBe(true);
    expect(cm.parts.some((p) => p.id.endsWith("-central-bearing"))).toBe(true);
    expect(cm.executionClass).toBe("EXC2");
    // Limon central bois (QUESTIONS A29 ; A33 (e) (f), A34 (c) ; A39 du 2026-10-13) : hélicoïdal
    // à grand rayon, lamellé-collé cintré sur moule (imposé : les couches empilées restent
    // montrées par `j5c-limon-central-bois-helicoidal`), platines à âme noyée sur la poutre
    // cintrée, reste sous entaille saisi (au repli de 180 mm, deux bloquants `PRECHECK_*`).
    const glulam = createDemoProject("demo-central-glulam");
    expect(glulam.name).toBe("Hélicoïdal sur limon central bois lamellé-collé");
    expect(glulam.stair.layout.kind).toBe("helical");
    expect(glulam.stair.layout.kind === "helical" && glulam.stair.layout.core.kind).toBe("well");
    expect(glulam.stair.treads.risers).toBe("none");
    const glulamStructure = glulam.stair.structure;
    expect(glulamStructure.kind).toBe("wood-central");
    expect(glulamStructure.kind === "wood-central" && glulamStructure.params.section).toMatchObject(
      { kind: "glulam", curvedMethod: "mould", residual: 250 },
    );
    const gm = buildModel(glulam, { memo: false });
    expect(gm.parts.some((p) => p.id === "wood-central-beam" && p.mark === "LC1")).toBe(true);
    expect(gm.parts.some((p) => p.componentOf === "wood-central-beam")).toBe(false);
    expect(gm.parts.some((p) => p.id === "wood-central-plate-foot")).toBe(true);
    expect(gm.parts.some((p) => p.id === "wood-central-plate-head")).toBe(true);
    expect(gm.parts.some((p) => p.id.startsWith("wood-central-shoe-"))).toBe(false);
    const kr = gm.compliance.results.filter((r) => r.ruleId === "LAMELLE_CINTRE_KR");
    expect(kr.map((r) => r.status)).toEqual(["ok"]);
    // Lamelles `auto` t = ⌊r_in / 240⌋ = 4 mm (r_in = 1 106 mm), 22 lamelles de 4 mm pour
    // b = 88 mm, au lieu de 1 mm sur l'ancien quart tournant (r_in = 406 mm).
    expect(
      gm.autoValues?.["stair.structure.params.section.lamellaThickness"],
    ).toBeGreaterThanOrEqual(4);
    // Escalier droit sur limon central bois : poutre droite, sabots en U (ancrage `auto`).
    const straightCentral = createDemoProject("demo-straight-central-glulam");
    expect(straightCentral.stair.layout.turns).toEqual([]);
    const sm = buildModel(straightCentral, { memo: false });
    expect(sm.parts.some((p) => p.id === "wood-central-beam")).toBe(true);
    expect(sm.parts.some((p) => p.id.startsWith("wood-central-shoe-"))).toBe(true);
    // Crémaillères chêne (`wood-cut`) : deux crémaillères, marches sans contremarche.
    const cut = createDemoProject("demo-straight-cut-oak");
    expect(cut.stair.structure.kind).toBe("wood-cut");
    expect(cut.stair.treads.risers).toBe("none");
    const cutParts = buildModel(cut, { memo: false }).parts;
    expect(cutParts.filter((p) => p.id.startsWith("carriage-")).map((p) => p.mark)).toEqual([
      "CI1",
      "CE1",
    ]);
  });
});

describe("démos du tracé libre (ADR-0010, sous-lot 7a)", () => {
  /** Fonctions de cage et structure attendues de chaque démo à cage saisie. */
  const CAGE_DEMOS: Readonly<
    Partial<Record<DemoPresetId, { features: readonly CageFeature[]; structure: string }>>
  > = {
    "demo-cage-oak-60": {
      features: ["anyAngle", "straightLanding", "chamfer"],
      structure: "wood-housed",
    },
    "demo-cage-flared-steel": { features: ["variableWidth", "chamfer"], structure: "steel-flat" },
    "demo-cage-central-steel": { features: ["anyAngle", "chamfer"], structure: "steel-central" },
    "demo-cage-arc-glass": { features: ["arcAxis", "straightLanding"], structure: "steel-curved" },
    "demo-cage-room": { features: ["anyAngle", "chamfer"], structure: "wood-housed" },
  };

  it("les démos à cage saisie sont celles listées ici", () => {
    const cages = DEMO_PRESET_IDS.filter(
      (id) => createDemoProject(id).stair.layout.kind === "cage",
    );
    expect(cages).toEqual(Object.keys(CAGE_DEMOS));
  });

  it.each(Object.entries(CAGE_DEMOS))(
    "%s : fonctions de cage, structure générée, aucun constat évitable",
    (id, { features, structure }) => {
      const p = createDemoProject(id as DemoPresetId);
      const layout = p.stair.layout;
      expect(layout.kind).toBe("cage");
      if (layout.kind !== "cage") return;
      expect(cageFeatures(layout)).toEqual(features);
      expect(p.stair.structure.kind).toBe(structure);
      const m = buildModel(p, { memo: false });
      expect(m.errors.map((e) => e.key)).not.toContain("structure.cageUnsupported");
      expect(m.parts.some((x) => x.category === "stringer")).toBe(true);
      // Garde-corps rampants dans la trémie (arrivée le long d'un axe du site).
      const violations = m.compliance.results.filter((r) => r.status === "violation");
      expect(violations.map((r) => r.ruleId)).not.toContain("GC_CONFLIT_DALLE");
      expect(m.stepping.going).toBeGreaterThan(255);
      expect(m.stepping.going).toBeLessThan(285);
    },
  );

  it("départ évasé : la première volée passe de 1 200 à 900 mm", () => {
    const layout = createDemoProject("demo-cage-flared-steel").stair.layout;
    expect(
      layout.kind === "cage" && [layout.sections[0]!.width, layout.sections[0]!.widthEnd],
    ).toEqual([1200, 900]);
  });

  describe("demo-cage-room : escalier dans sa pièce", () => {
    const project = createDemoProject("demo-cage-room");
    const model = buildModel(project, { memo: false });

    it("contour, murs, poteau, porte et fenêtre ; aucun conflit hors échappée", () => {
      expect(project.site.room?.points.length).toBeGreaterThanOrEqual(4);
      expect(new Set((project.site.obstacles ?? []).map((o) => o.kind))).toEqual(
        new Set(["post", "door", "window"]),
      );
      expect(project.site.walls.length).toBe(2);
      // Ni hors pièce, ni mur, ni obstacle, ni débattement de porte, ni fenêtre, ni dégagement
      // d'arrivée, ni structure sous la dalle (trémie arrêtée au nez d'arrivée et menée jusqu'aux
      // murs) : seule reste l'échappée recommandée (conseil).
      const kinds = new Set((model.siteFit ?? []).map((c) => c.kind));
      expect([...kinds].sort()).toEqual(["headroom"]);
      expect((model.siteFit ?? []).every((c) => c.severity !== "erreur")).toBe(true);
      // Côtés le long des murs : pas de garde-corps de volée extérieur (mur à moins de
      // `wallTolerance`), garde-corps du jour présent.
      const guards = model.parts.filter((x) => x.id.startsWith("guard-")).map((x) => x.id);
      expect(guards.some((id) => id.startsWith("guard-inner-"))).toBe(true);
      expect(guards.some((id) => id.startsWith("guard-outer-"))).toBe(false);
    });

    it("trémie dans la pièce : aucun sommet hors du contour, aucun mur traversé", () => {
      const opening = project.site.opening;
      expect(opening?.kind).toBe("polygon");
      if (opening?.kind !== "polygon") return;
      const room = project.site.room!.points;
      // Sommets arrondis au dixième de mm (`polygonOpening`) : tolérance d'autant.
      for (const q of opening.points)
        expect(pointInPolygon(q, room, OPENING_POINT_PRECISION)).not.toBe("outside");
      // Aucun côté de la trémie ne coupe l'axe d'un mur (contour convexe, murs au-delà du nu).
      for (const w of project.site.walls)
        for (let i = 0; i < opening.points.length; i++) {
          const a = opening.points[i]!;
          const b = opening.points[(i + 1) % opening.points.length]!;
          expect(segmentIntersect(a, b, w.a, w.b)).toBeNull();
        }
    });

    it("arrivée dégagée : aucun garde-corps de trémie ne barre la sortie sur la dalle", () => {
      const layout = computeLayout(project);
      const stepping = computeStepping(project, layout);
      const runs = computeGuards(project, layout, stepping).runs.filter(
        (r) => r.kind === "opening",
      );
      expect(runs.length).toBeGreaterThan(0);
      const last = stepping.nosings[stepping.nosings.length - 1]!;
      const climb = V.normalize(V.perpLeft(V.sub(last.r, last.q)));
      // Lignes de marche de l'arrivée : du nez vers la dalle, sur toute la largeur du nez.
      for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const from = V.lerp(last.q, last.r, t);
        const to = V.addScaled(from, climb, 1000);
        for (const run of runs)
          for (let i = 0; i + 1 < run.path.length; i++)
            expect(segmentIntersect(from, to, run.path[i]!, run.path[i + 1]!)).toBeNull();
      }
    });

    /** Projet de la démo avec le poteau déplacé en `center`. */
    const withPost = (center: { x: number; y: number }): Project => ({
      ...project,
      site: {
        ...project.site,
        obstacles: (project.site.obstacles ?? []).map((o) =>
          o.kind === "post" ? { ...o, center } : o,
        ),
      },
    });

    it("propriété : un poteau posé sur une marche est un conflit « erreur »", () => {
      const treads = model.stepping.treads;
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: treads.length - 1 }),
          fc.double({ min: 0.2, max: 0.8, noNaN: true }),
          fc.double({ min: 0.2, max: 0.8, noNaN: true }),
          (i, u, v) => {
            // Point intérieur de la marche : barycentre pondéré de trois sommets.
            const o = treads[i]!.walkingSurface;
            const [a, b, c] = [o[0]!, o[1]!, o[2]!];
            const w = [u * v, u * (1 - v), 1 - u];
            const center = {
              x: Math.round(w[0]! * a.x + w[1]! * b.x + w[2]! * c.x),
              y: Math.round(w[0]! * a.y + w[1]! * b.y + w[2]! * c.y),
            };
            if (pointInPolygon(center, o) !== "inside") return;
            const m = buildModel(withPost(center), { memo: false });
            expect(
              (m.siteFit ?? []).some((x) => x.kind === "obstacle" && x.severity === "erreur"),
            ).toBe(true);
          },
        ),
        { numRuns: 12, seed: 7 },
      );
    });

    it("un contour de pièce rétréci sous l'escalier est un conflit « erreur »", () => {
      const room = project.site.room!;
      const shrunk: Project = {
        ...project,
        site: {
          ...project.site,
          room: { points: room.points.map((q) => (q.x > 0 ? { ...q, x: q.x - 300 } : q)) },
        },
      };
      const m = buildModel(shrunk, { memo: false });
      expect(
        (m.siteFit ?? []).some((c) => c.kind === "outsideRoom" && c.severity === "erreur"),
      ).toBe(true);
    });
  });
});

describe("essence des marches `stair.treads.material` (rétrocompatible)", () => {
  it("absente : chêne, projet sérialisé sans le champ ; présente : marches et contremarches", () => {
    const base = createProject("quarter-left");
    expect(base.stair.treads.material).toBeUndefined();
    expect(serializeProject(base)).not.toMatch(/"treads": \{[^}]*"material"/);
    const oak = buildModel(base, { memo: false }).parts.filter(
      (p) => p.category === "tread" || p.category === "riser",
    );
    expect(new Set(oak.map((p) => p.material))).toEqual(new Set(["wood-oak"]));
    const pine = ProjectSchema.parse({
      ...base,
      stair: { ...base.stair, treads: { ...base.stair.treads, material: "wood-pine" } },
    });
    const parts = buildModel(pine, { memo: false }).parts.filter(
      (p) => p.category === "tread" || p.category === "riser",
    );
    expect(new Set(parts.map((p) => p.material))).toEqual(new Set(["wood-pine"]));
    // Masse cohérente avec l'essence (pin plus léger que le chêne, profil d'atelier).
    const mass = (ps: typeof parts): number =>
      ps.reduce((s, p) => s + (p.quantities["mass_kg"] ?? 0), 0);
    expect(mass(parts)).toBeLessThan(mass(oak));
    expect(
      ProjectSchema.safeParse({
        ...base,
        stair: { ...base.stair, treads: { ...base.stair.treads, material: "steel-raw" } },
      }).success,
    ).toBe(false);
  });
});

describe("champ `appearance` (rétrocompatible)", () => {
  const base = createProject("straight");

  it("absent : projet inchangé ; présent : relu à l'identique", () => {
    expect(ProjectSchema.parse(base).appearance).toBeUndefined();
    const withTint = ProjectSchema.parse({
      ...base,
      appearance: {
        paintColor: "#1F2328",
        treadPaintColor: "#a3a8ab",
        guardPaintColor: "#2e3338",
        woodTone: "dark",
        glassTint: "smoked",
      },
    });
    const text = serializeProject(withTint);
    expect(serializeProject(parseProjectText(text))).toBe(text);
  });

  it("n'agit pas sur le modèle (pièces et matériaux identiques)", () => {
    const tinted = { ...base, appearance: { paintColor: "#ffffff", woodTone: "dark" as const } };
    const a = buildModel(base, { memo: false });
    const b = buildModel(tinted, { memo: false });
    expect(b.parts.map((p) => [p.id, p.material, p.quantities["mass_kg"]])).toEqual(
      a.parts.map((p) => [p.id, p.material, p.quantities["mass_kg"]]),
    );
  });

  it("refuse une couleur mal formée ou une valeur inconnue", () => {
    for (const appearance of [
      { paintColor: "noir" },
      { paintColor: "#12345" },
      { treadPaintColor: "gris" },
      { guardPaintColor: "#1234567" },
      { woodTone: "rouge" },
      { glassTint: "opaque" },
    ]) {
      expect(ProjectSchema.safeParse({ ...base, appearance }).success).toBe(false);
    }
  });
});

describe("examples/demo-*.blondel.json", () => {
  it.each(DEMO_PRESET_IDS)("%s est à jour avec son générateur", (id) => {
    const text = readFileSync(join(EXAMPLES_DIR, exampleFile(id)), "utf8");
    expect(text).toBe(serializeProject(createDemoProject(id)));
  });
});
