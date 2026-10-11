/**
 * Exports d'une cage saisie (tracé libre, ADR-0010, sous-lot 2e) : chaque export est produit
 * sans exception et sans grandeur non finie sur un jeu de cages (60°, 120°, palier droit,
 * trapèze, axe en arc, marches rayonnantes, pan coupé, cage qui se recouvre), en français et en
 * anglais ; plan coté par tronçon (instantanés ciblés) ; fiche de pose par tronçon ; élévation
 * des sous-faces d'une cage qui se recouvre.
 */
import {
  buildModel,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpecInput,
  type Model,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { exportCutListCsv } from "./csv/cutlist.js";
import { exportFastenersCsv } from "./csv/fasteners.js";
import { cutSheet } from "./cutsheet.js";
import { exportPartDxf } from "./dxf/part.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { exportPlanDxf } from "./dxf/plan.js";
import { exportGlb } from "./gltf/glb.js";
import { translatorOf } from "./i18n.js";
import { installationSheet } from "./installation.js";
import { exportProjectJson } from "./json.js";
import { installationLines } from "./pdf/installation.js";
import { exportPdfDocument } from "./pdf/document.js";
import { buildPlanDrawing } from "./plan/drawing.js";
import { renderElevationSvg, soffitIntervals } from "./svg/elevation.js";
import { renderFlatPatternSvg } from "./svg/flat.js";
import { renderPlanSvg } from "./svg/plan.js";
import { readDxf } from "./testing/dxf-reader.js";
import { readGlb } from "./testing/glb-reader.js";
import { parseXml } from "./testing/xml.js";
import { createZip } from "./zip.js";

const NON_FINITE = /NaN|Infinity|undefined/;

const straight = (length: number, width = 900, widthEnd?: number) => ({
  axis: { kind: "straight" as const, length },
  width,
  ...(widthEnd !== undefined ? { widthEnd } : {}),
});

function cageProject(layout: CageLayoutSpecInput, floorToFloor = 2700): Project {
  const base = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: "Cage",
    site: {
      floorToFloor,
      upperSlabThickness: 200,
      walls: [
        {
          id: "M1",
          a: { x: -6000, y: -200 },
          b: { x: -6000, y: 3000 },
          thickness: 200,
          loadBearing: true,
        },
      ],
    },
    stair: { placement: { origin: { x: 0, y: 0 }, rotation: 0 }, layout },
    guards: {},
  };
  const first = buildModel(ProjectSchema.parse(base), { memo: false });
  const xs = first.layout.footprint.map((p) => p.x);
  const ys = first.layout.footprint.map((p) => p.y);
  // Trémie sur toute l'emprise sauf une bande de 600 mm au départ (échappée calculée).
  const x = Math.round(Math.min(...xs)) - 300;
  const y = Math.round(Math.min(...ys)) + 600;
  const opening = {
    kind: "rect",
    x,
    y,
    sizeX: Math.round(Math.max(...xs)) + 300 - x,
    sizeY: Math.round(Math.max(...ys)) + 300 - y,
  };
  return ProjectSchema.parse({ ...base, site: { ...base.site, opening } });
}

/** Croisement : le quatrième tronçon repasse au-dessus du premier (constat du tracé). */
const CROSSOVER: CageLayoutSpecInput = {
  kind: "cage",
  sections: [straight(3000), straight(600), straight(600), straight(2400)],
  junctions: [
    { angle: 90, mode: "landing" },
    { angle: 90, mode: "landing" },
    { angle: 90, mode: "landing" },
  ],
};

const CAGES: Record<string, { layout: CageLayoutSpecInput; floorToFloor?: number }> = {
  "60° balancé": {
    layout: {
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: 60, mode: "winders" }],
    },
  },
  "120° balancé, congé côté mur": {
    layout: {
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: -120, mode: "winders", wall: { kind: "arc", radius: 300 } }],
    },
  },
  "palier droit": {
    layout: {
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: 0, mode: "landing", depth: 900 }],
    },
  },
  "trapèze et quart tournant": {
    layout: {
      kind: "cage",
      sections: [straight(1500, 900, 1300), straight(1500, 1300)],
      junctions: [{ angle: 90, mode: "winders" }],
    },
  },
  "arc de 90°": {
    layout: {
      kind: "cage",
      sections: [{ axis: { kind: "arc", radius: 1500, sweep: 90 }, width: 900 }],
      junctions: [],
    },
  },
  "marches rayonnantes à 75°": {
    layout: {
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: 75, mode: "radiating", well: { kind: "arc", radius: 150 } }],
    },
  },
  "pan coupé à 120°": {
    layout: {
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [
        { angle: 120, mode: "winders", well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 } },
      ],
    },
  },
  "cage qui se recouvre": { layout: CROSSOVER, floorToFloor: 5400 },
  "arc élargi entre deux paliers droits": {
    layout: {
      kind: "cage",
      sections: [
        straight(1500),
        { axis: { kind: "arc", radius: 1500, sweep: 60 }, width: 1100 },
        straight(800, 1100),
      ],
      junctions: [
        { angle: 0, mode: "landing", depth: 900 },
        { angle: 0, mode: "landing", depth: 600 },
      ],
    },
    floorToFloor: 3000,
  },
  "arc seul de 120°": {
    layout: {
      kind: "cage",
      sections: [{ axis: { kind: "arc", radius: 1500, sweep: 120 }, width: 900 }],
      junctions: [],
    },
    floorToFloor: 2400,
  },
  "150° balancé, congé côté mur de 400": {
    layout: {
      kind: "cage",
      sections: [straight(1500), straight(1500)],
      junctions: [{ angle: 150, mode: "winders", wall: { kind: "arc", radius: 400 } }],
    },
  },
};

const built = Object.entries(CAGES).map(([name, c]) => {
  const project = cageProject(c.layout, c.floorToFloor);
  return { name, project, model: buildModel(project, { memo: false }) };
});

describe("tous les exports sur une cage saisie", () => {
  it.each(built)(
    "$name : sans exception ni grandeur non finie (fr et en)",
    ({ project, model }) => {
      expect(model.layout.cage).toBe(true);
      // Seul le constat de recouvrement du tracé est admis (cage qui se recouvre).
      expect(
        model.errors.map((e) => e.key).filter((k) => k !== "layout.cage.sectionsOverlap"),
      ).toEqual([]);
      expect(model.stepping.treads.length).toBeGreaterThan(0);
      for (const locale of ["fr", "en"] as const) {
        for (const theme of ["light", "dark"] as const) {
          const plan = renderPlanSvg(model, { project, theme, locale, title: project.name });
          const elev = renderElevationSvg(model, { project, theme, locale, title: project.name });
          parseXml(plan);
          parseXml(elev);
          expect(plan).not.toMatch(NON_FINITE);
          expect(elev).not.toMatch(NON_FINITE);
          for (const t of model.stepping.treads) expect(plan).toContain(`data-tread="${t.number}"`);
        }
        for (const version of ["AC1021", "R12"] as const) {
          const dxf = exportPlanDxf(model, { project, version, locale });
          expect(dxf).not.toMatch(NON_FINITE);
          expect(readDxf(dxf).entities.length).toBeGreaterThan(0);
        }
        const files = exportPartsDxf(model, { locale });
        for (const f of files) expect(readDxf(f.content).entities.length).toBeGreaterThan(0);
        for (const part of model.parts.filter((p) => p.flat !== undefined)) {
          parseXml(renderFlatPatternSvg(part, { locale }));
          expect(exportPartDxf(part, { locale })).not.toMatch(NON_FINITE);
        }
        const { bytes, pages } = exportPdfDocument(model, {
          project,
          date: "11/10/2026",
          compress: false,
          locale,
        });
        expect(pages.map((p) => p.kind)).toContain("installation");
        expect(new TextDecoder("latin1").decode(bytes)).not.toMatch(/NaN|Infinity/);
        const glb = readGlb(exportGlb(model, { project, locale }));
        expect(glb.doc.nodes.length).toBeGreaterThan(0);
        expect(exportCutListCsv(model, { locale })).not.toMatch(NON_FINITE);
        expect(exportFastenersCsv(model, { locale })).not.toMatch(NON_FINITE);
        expect(cutSheet(model.parts, { locale }).length).toBeGreaterThan(0);
        const sheet = installationSheet(model, project, { locale });
        const lines = installationLines(sheet, translatorOf({ locale })).map((l) => l.text);
        expect(lines.join("\n")).not.toMatch(NON_FINITE);
      }
      const json = exportProjectJson(project);
      const zip = createZip([
        { name: "projet.blondel.json", data: new TextEncoder().encode(json) },
        { name: "plan.svg", data: new TextEncoder().encode(renderPlanSvg(model, { project })) },
      ]);
      expect(zip.length).toBeGreaterThan(0);
    },
  );
});

/** Cotes et annotations du plan, arrondies (instantanés ciblés, insensibles au flottant). */
function planSummary(model: Model, locale: "fr" | "en" = "fr") {
  const d = buildPlanDrawing(model, { locale });
  return {
    dimensions: d.dimensions.map((x) => `${x.role} ${Math.round(x.value)} « ${x.text} »`),
    labels: (d.labels ?? []).map((l) => `${l.kind} « ${l.text} »`),
    width: d.cartouche.find((l) => l.startsWith("Emmarchement") || l.startsWith("Stair width")),
  };
}

const model = (name: string): Model => built.find((b) => b.name === name)!.model;

describe("plan coté d'une cage : par tronçon", () => {
  it("60° : parties droites (F11), largeur de départ, angle de la jonction", () => {
    expect(planSummary(model("60° balancé"))).toMatchSnapshot();
  });

  it("120° à congé côté mur : angle et rayon du congé", () => {
    expect(planSummary(model("120° balancé, congé côté mur"))).toMatchSnapshot();
  });

  it("palier droit : profondeur du palier, pas d'angle", () => {
    const s = planSummary(model("palier droit"));
    expect(s.dimensions).toContain("landing 900 « 900 »");
    expect(s.labels).toEqual([]);
    expect(s).toMatchSnapshot();
  });

  it("trapèze : largeurs de départ et de fin, emmarchement de 900 à 1 300 mm", () => {
    const s = planSummary(model("trapèze et quart tournant"));
    expect(s.dimensions.filter((d) => d.startsWith("width ")).map((d) => d.split(" ")[1])).toEqual([
      "900",
      "1300",
    ]);
    expect(s.width).toBe("Emmarchement E = 900 à 1 300 mm");
    expect(s).toMatchSnapshot();
  });

  it("axe en arc : rayon et balayage", () => {
    const s = planSummary(model("arc de 90°"));
    expect(s.dimensions).toContain("radius 1500 « R 1 500 »");
    expect(s.labels).toEqual(["sweep « balayage 90° »"]);
    expect(planSummary(model("arc de 90°"), "en").labels).toEqual(["sweep « sweep 90° »"]);
  });

  it("arc élargi entre deux paliers droits : largeur de l'arc et profondeur des deux paliers", () => {
    const s = planSummary(model("arc élargi entre deux paliers droits"));
    // Largeur de départ (900), puis la largeur introduite par l'arc (1 100), cotée une fois.
    expect(s.dimensions.filter((d) => d.startsWith("width ")).map((d) => d.split(" ")[1])).toEqual([
      "900",
      "1100",
    ]);
    // Palier derrière un tronçon droit et palier derrière l'arc (même valeur que la fiche).
    const sheet = installationSheet(model("arc élargi entre deux paliers droits"));
    const depths = sheet.junctions!.map((j) => Math.round(j.depth ?? -1));
    expect(depths).toEqual([900, 600]);
    expect(
      s.dimensions.filter((d) => d.startsWith("landing ")).map((d) => d.split(" ")[1]),
    ).toEqual(depths.map(String));
    expect(s).toMatchSnapshot();
  });

  it("arc seul : pas de cote de reculement en corde (cartouche seul)", () => {
    const s = planSummary(model("arc seul de 120°"));
    expect(s.dimensions.some((d) => d.startsWith("run "))).toBe(false);
    expect(s.dimensions).toContain("radius 1500 « R 1 500 »");
  });

  it("congé côté mur : étiquette au milieu de l'arc du congé, pas au coin virtuel", () => {
    const m = model("150° balancé, congé côté mur de 400");
    const d = buildPlanDrawing(m);
    const label = d.labels!.find((l) => l.kind === "wallJoint")!;
    expect(label.text).toBe("R 400");
    const z = m.layout.turns[0]!;
    const w = z.outerCorner;
    // Milieu de l'arc : à R / cos(75°) − R ≈ 1 145 mm de W ; étiquette à moins d'une hauteur de
    // texte et demie de ce point (et non au-delà de W).
    const toArc = 400 / Math.cos((75 * Math.PI) / 180) - 400;
    const dist = Math.hypot(label.at.x - w.x, label.at.y - w.y);
    expect(dist).toBeGreaterThan(toArc - 200);
    expect(dist).toBeLessThan(toArc + 1);
  });

  it("pan coupé et marches rayonnantes : raccords du jour annotés", () => {
    expect(planSummary(model("pan coupé à 120°"))).toMatchSnapshot();
    expect(planSummary(model("marches rayonnantes à 75°")).labels).toEqual([
      "junctionAngle « 75° »",
      "wellJoint « R 150 »",
    ]);
  });

  it("longueur cotée = partie droite saisie (F11), quel que soit l'angle", () => {
    for (const name of ["60° balancé", "120° balancé, congé côté mur", "pan coupé à 120°"]) {
      const lengths = buildPlanDrawing(model(name))
        .dimensions.filter((d) => d.role === "section")
        .map((d) => d.value);
      expect(lengths).toHaveLength(2);
      for (const l of lengths) expect(l).toBeCloseTo(1500, 6);
    }
  });

  it("tracé à volées : aucune cote de tronçon ni annotation (plan inchangé)", () => {
    const flights = buildModel(
      ProjectSchema.parse({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        site: { floorToFloor: 2700, upperSlabThickness: 200 },
        stair: {
          placement: { origin: { x: 0, y: 0 } },
          layout: {
            width: 900,
            legs: [{ length: 2400 }, { length: 1500 }],
            turns: [{ direction: "left", mode: "winders" }],
          },
        },
      }),
      { memo: false },
    );
    const d = buildPlanDrawing(flights);
    expect(d.labels).toBeUndefined();
    expect(d.dimensions.some((x) => x.role === "section" || x.role === "landing")).toBe(false);
    expect(renderPlanSvg(flights)).not.toContain('class="labels"');
  });

  it("SVG et DXF portent les annotations", () => {
    const m = model("60° balancé");
    expect(renderPlanSvg(m)).toContain('data-label="junctionAngle"');
    for (const version of ["AC1021", "R12"] as const) {
      const texts = readDxf(exportPlanDxf(m, { version }))
        .entities.filter((e) => e.type === "TEXT")
        .map((e) => (e as { value: string }).value);
      expect(texts.some((t) => t.startsWith("60"))).toBe(true);
    }
  });
});

describe("fiche de pose d'une cage : cotes d'implantation par tronçon", () => {
  it("tronçons, jonctions, palier droit", () => {
    const sheet = installationSheet(model("palier droit"));
    expect(sheet.sections?.map((s) => [s.number, s.kind, Math.round(s.length ?? -1)])).toEqual([
      [1, "straight", 1500],
      [2, "straight", 1500],
    ]);
    expect(sheet.junctions?.map((j) => [j.number, j.angle, Math.round(j.depth ?? -1)])).toEqual([
      [1, 0, 900],
    ]);
    const lines = installationLines(sheet).map((l) => l.text);
    expect(lines).toContain("Jonction 1 : palier droit de 900 mm");
    expect(lines.some((l) => l.startsWith("Tronçon 2, arrivée : G X "))).toBe(true);
  });

  it("arc et angle quelconque", () => {
    const arc = installationSheet(model("arc de 90°"));
    expect(arc.sections?.[0]?.arc?.sweep).toBeCloseTo(90, 9);
    expect(arc.sections?.[0]?.arc?.radius).toBeCloseTo(1500, 9);
    const sixty = installationSheet(model("60° balancé"), undefined, { locale: "en" });
    expect(sixty.junctions?.[0]?.angle).toBeCloseTo(60, 9);
    expect(installationLines(sixty, translatorOf({ locale: "en" })).map((l) => l.text)).toContain(
      "Sections: start and end lines (site coordinates, mm; L left, R right going up)",
    );
  });

  it("tracé à volées : pas de section par tronçon", () => {
    const m = buildModel(
      ProjectSchema.parse({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        site: { floorToFloor: 2700, upperSlabThickness: 200 },
        stair: {
          placement: { origin: { x: 0, y: 0 } },
          layout: { width: 900, legs: [{ length: 3500 }], turns: [] },
        },
      }),
      { memo: false },
    );
    const sheet = installationSheet(m);
    expect(sheet.sections).toBeUndefined();
    expect(sheet.junctions).toBeUndefined();
  });
});

describe("élévation d'une cage qui se recouvre", () => {
  it("sous-faces de l'échappée dessinées (Model.soffits)", () => {
    const m = model("cage qui se recouvre");
    expect(m.stepping.soffits).toBeUndefined();
    expect(m.soffits?.length).toBe(m.stepping.treads.length);
    const L = m.stepping.nosings[m.stepping.nosings.length - 1]!.s;
    expect(soffitIntervals(m, 0, L).length).toBeGreaterThan(0);
    const svg = renderElevationSvg(m);
    expect(svg).toContain('class="soffit"');
    expect(svg).toContain("(auto-recouvrement)");
  });

  it("cage sans recouvrement : aucune sous-face", () => {
    expect(model("60° balancé").soffits).toBeUndefined();
  });
});
