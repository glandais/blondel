/**
 * Critères d'acceptation globaux (docs/prompts/02-conception-dev.md §6, SPEC §MVP) de bout en
 * bout, sur les exemples du dépôt : projet lu → `buildModel` (pipeline réel du cœur, plugins
 * enregistrés par `@blondel/core`) → exports, relus par les lecteurs de test.
 *
 * - Critère n° 1 complet (`j4-acceptance-01-garde-corps`) : quart tournant bas bois, limons à la
 *   française, poteau d'angle, garde-corps barreaudé côté vide et de trémie ; conforme (aucune
 *   violation bloquante), dossier PDF et DXF de chaque pièce à plat.
 * - Critère n° 3 (`j3b-acceptance-01-tole-pliee`) : DXF R12 des limons en plat acier et des
 *   marches en tôle pliée relus à ±0,01 mm (contour, perçages, traits), lignes de pli repérées
 *   sur leur calque avec angle et sens, repère de pièce gravé.
 *
 * (« Conçu en moins de 2 minutes » relève de l'interface et n'est pas vérifié ici.)
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModel,
  parseProjectText,
  vec2,
  type FlatPattern,
  type Model,
  type Part,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { exportPartsDxf } from "./dxf/parts.js";
import { PART_LAYERS } from "./dxf/part.js";
import { exportPlanDxf } from "./dxf/plan.js";
import { RecordingCanvas, exportPdf, renderPdf } from "./pdf/index.js";
import { renderFlatPatternSvg } from "./svg/flat.js";
import { entitiesOn, polylines, readDxf, type DxfFile } from "./testing/dxf-reader.js";
import { parseXml } from "./testing/xml.js";

const TOL = 0.01;
const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");

function load(file: string): { project: Project; model: Model } {
  const project = parseProjectText(readFileSync(resolve(EXAMPLES, file), "utf8"));
  return { project, model: buildModel(project) };
}

const blocking = (m: Model) =>
  m.compliance.results.filter((r) => r.status === "violation" && r.severity === "bloquant");

/** Sommets sans doublons consécutifs (même fusion que l'écrivain, 1e-6 mm). */
function distinctVertices(poly: readonly { x: number; y: number }[]) {
  const out: { x: number; y: number }[] = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (prev === undefined || vec2.distance(prev, p) > 1e-6) out.push(p);
  }
  if (out.length > 1 && vec2.distance(out[0]!, out[out.length - 1]!) <= 1e-6) out.pop();
  return out;
}

function expectRing(
  actual: readonly { x: number; y: number; bulge: number }[],
  expected: readonly { x: number; y: number }[],
  what: string,
): void {
  const ring = distinctVertices(expected);
  expect(actual, what).toHaveLength(ring.length);
  actual.forEach((v, i) => {
    expect(vec2.distance(v, ring[i]!), `${what} sommet ${i}`).toBeLessThanOrEqual(TOL);
    expect(v.bulge, `${what} sommet ${i}`).toBe(0);
  });
}

/**
 * Relit le DXF d'une pièce et le compare à son développé à ±0,01 mm : contour extérieur,
 * perçages (contours intérieurs), chaque trait sur son calque, repère gravé sur TEXTE.
 */
function expectFaithful(f: DxfFile, part: Part): void {
  const flat = part.flat as FlatPattern;
  const contours = polylines(f, PART_LAYERS.contour.name);
  const holes = flat.outline.holes.filter((h) => h.length >= 3);
  expect(contours, part.mark).toHaveLength(1 + holes.length);
  for (const c of contours) expect(c.closed, part.mark).toBe(true);
  expectRing(contours[0]!.vertices, flat.outline.outer, `${part.mark} contour`);
  holes.forEach((h, i) => expectRing(contours[1 + i]!.vertices, h, `${part.mark} perçage ${i}`));
  const lines = entitiesOn(f, "LINE");
  const drawn = flat.lines.filter((l) => l.kind !== "text");
  expect(lines, part.mark).toHaveLength(drawn.length);
  drawn.forEach((l, i) => {
    expect(vec2.distance(lines[i]!.a, l.a), `${part.mark} trait ${i}`).toBeLessThanOrEqual(TOL);
    expect(vec2.distance(lines[i]!.b, l.b), `${part.mark} trait ${i}`).toBeLessThanOrEqual(TOL);
  });
  expect(entitiesOn(f, "TEXT", PART_LAYERS.text.name).map((t) => t.value)).toContain(part.mark);
}

/** Décode les séquences `\\U+XXXX` des textes DXF R12 (caractères non ASCII). */
const decodeDxfText = (v: string): string =>
  v.replace(/\\U\+([0-9A-F]{4})/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));

/** Textes d'un calque, décodés. */
const textsOn = (f: DxfFile, layer: string): string[] =>
  entitiesOn(f, "TEXT", layer).map((t) => decodeDxfText(t.value));

/** Fichier DXF (R12) contenant la pièce, relu. */
function partDxf(model: Model, part: Part): DxfFile {
  const file = exportPartsDxf(model, { version: "R12" }).find((f) => f.partIds.includes(part.id));
  expect(file, part.mark).toBeDefined();
  expect(file!.content).toContain("AC1009");
  expect(file!.content).not.toMatch(/NaN|Infinity/);
  return readDxf(file!.content);
}

function pdfText(model: Model, project: Project): string {
  const bytes = exportPdf(model, { project, date: "29/09/2026", compress: false });
  const text = new TextDecoder("latin1").decode(bytes);
  expect(text.startsWith("%PDF-")).toBe(true);
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  expect(text).not.toMatch(/NaN|Infinity/);
  return text;
}

describe("critère d'acceptation n° 1 complet : quart tournant bois, poteau, garde-corps", () => {
  const { project, model } = load("j4-acceptance-01-garde-corps.blondel.json");
  const stringers = model.parts.filter((p) => p.category === "stringer");
  const guards = model.parts.filter((p) => p.id.startsWith("guard-"));

  it("cas conforme au cahier des charges : H 2 700, trémie 2 800 × 900, bois, poteau", () => {
    expect(project.site.floorToFloor).toBe(2700);
    expect(project.site.opening).toMatchObject({ kind: "rect", sizeX: 2800, sizeY: 900 });
    expect(project.stair.layout.turns).toHaveLength(1);
    expect(project.stair.layout.turns[0]!.inner.kind).toBe("newel");
    expect(project.stair.structure.kind).toBe("wood-housed");
    expect(model.errors).toEqual([]);
    expect(blocking(model)).toEqual([]);
    // Structure bois complète : 4 limons, 1 poteau d'angle, marches et contremarches bois.
    expect(stringers.map((p) => p.mark).sort()).toEqual(["LE1", "LE2", "LI1", "LI2"]);
    expect(
      model.parts.filter((p) => p.category === "post" && !p.id.startsWith("guard-")),
    ).toHaveLength(1);
    for (const p of [...stringers, ...model.parts.filter((x) => x.category === "tread")]) {
      expect(p.material, p.id).toMatch(/^wood-/);
    }
    // Garde-corps barreaudé côté vide et de trémie : poteaux, balustres, mains courantes.
    const cats = new Set(guards.map((p) => p.category));
    expect([...cats].sort()).toEqual(["baluster", "handrail", "post"]);
    // Pas de classe d'exécution pour une structure bois.
    expect(model.executionClass).toBeUndefined();
  });

  it("DXF R12 de chaque pièce à plat relu à ±0,01 mm (limons : mortaises sur leur calque)", () => {
    const flats = model.parts.filter((p) => p.flat !== undefined);
    for (const s of stringers) expect(flats, s.mark).toContain(s);
    for (const part of flats) {
      const f = partDxf(model, part);
      expectFaithful(f, part);
      parseXml(renderFlatPatternSvg(part));
    }
    for (const s of stringers) {
      const f = partDxf(model, s);
      const mortises = s.flat!.lines.filter((l) => l.feature === "mortise").length;
      expect(mortises, s.mark).toBeGreaterThan(0);
      expect(entitiesOn(f, "LINE", PART_LAYERS.mortise.name)).toHaveLength(mortises);
    }
  });

  it("plan DXF (AC1021) relu, garde-corps compris", () => {
    const plain = buildModel({ ...project, guards: undefined } as Project);
    const count = (m: Model) =>
      readDxf(exportPlanDxf(m, { project, version: "AC1021" })).entities.length;
    expect(count(model)).toBeGreaterThan(0);
    // Les garde-corps ajoutent des entités au plan (pièces dessinées en plan).
    expect(count(model)).toBeGreaterThanOrEqual(count(plain));
  });

  it("dossier PDF : plan, élévation, nomenclature avec les repères, développés des limons", () => {
    const pages = renderPdf(new RecordingCanvas(), model, { project });
    const kinds = new Set(pages.map((p) => p.kind));
    for (const k of ["plan", "elevation", "bom", "compliance", "flat"] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
    const text = pdfText(model, project);
    for (const mark of [...stringers.map((p) => p.mark), "PT1", "PG1", "BA1", "MC1"]) {
      expect(text, mark).toContain(mark);
    }
  });
});

describe("critère d'acceptation n° 3 : DXF de limon acier et de marche en tôle pliée", () => {
  const { project, model } = load("j3b-acceptance-01-tole-pliee.blondel.json");
  const stringers = model.parts.filter((p) => p.category === "stringer");
  const treads = model.parts.filter((p) => p.category === "tread");
  const params = project.stair.structure.params as { folded?: { clearance?: number } };

  it("structure steel-flat en tôle pliée : modèle sans erreur, contremarches bois supprimées", () => {
    expect(project.stair.structure.kind).toBe("steel-flat");
    expect(model.errors).toEqual([]);
    expect(blocking(model)).toEqual([]);
    expect(model.executionClass).toBe("EXC1");
    expect(model.parts.filter((p) => p.category === "riser")).toEqual([]);
    expect(stringers.map((p) => p.mark).sort()).toEqual(["LE1", "LE2", "LI1", "LI2"]);
    expect(treads).toHaveLength(model.stepping.treads.length);
    for (const p of [...stringers, ...treads]) {
      expect(p.material, p.id).toMatch(/^steel-/);
      expect(p.flat, p.id).toBeDefined();
    }
  });

  it("limons en plat : DXF R12 relu à ±0,01 mm, fibre de référence déclarée", () => {
    for (const s of stringers) {
      const f = partDxf(model, s);
      expectFaithful(f, s);
      expect(s.flat!.reference?.kind, s.mark).toBe("face");
      const info = textsOn(f, PART_LAYERS.info.name);
      expect(
        info.some((t) => t.startsWith("Référence : face tracée")),
        s.mark,
      ).toBe(true);
      expect(
        info.some((t) => /épaisseur 8 mm/.test(t)),
        s.mark,
      ).toBe(true);
    }
  });

  it("marches en tôle pliée : contour relu à ±0,01 mm, lignes de pli repérées", () => {
    const clearance = params.folded?.clearance ?? 10;
    for (const t of treads) {
      const flat = t.flat!;
      const f = partDxf(model, t);
      expectFaithful(f, t);
      expect(flat.reference?.kind, t.mark).toBe("neutral-fiber");
      // Z : deux plis de 90°, l'un vers le bas (nez), l'autre vers le haut (contremarche).
      const bends = flat.lines.filter((l) => l.kind === "bend");
      expect(bends, t.mark).toHaveLength(2);
      expect(bends.map((b) => b.bendAngle)).toEqual([90, 90]);
      expect(bends.map((b) => b.bendUp).sort()).toEqual([false, true]);
      // Calque PLI (tirets), un trait et une annotation (angle, sens) par pli.
      expect(f.layers.get(PART_LAYERS.bend.name)?.lineType).toBe("DASHED");
      const bendLines = entitiesOn(f, "LINE", PART_LAYERS.bend.name);
      expect(bendLines, t.mark).toHaveLength(2);
      bends.forEach((b, i) => {
        expect(vec2.distance(bendLines[i]!.a, b.a)).toBeLessThanOrEqual(TOL);
        expect(vec2.distance(bendLines[i]!.b, b.b)).toBeLessThanOrEqual(TOL);
      });
      const notes = textsOn(f, PART_LAYERS.bend.name);
      expect(
        notes.some((n) => /90°.* bas$/.test(n)),
        t.mark,
      ).toBe(true);
      expect(
        notes.some((n) => /90°.* haut$/.test(n)),
        t.mark,
      ).toBe(true);
      // Plis parallèles, d'un bord à l'autre du contour (x le long du pli).
      const box = {
        min: Math.min(...flat.outline.outer.map((p) => p.x)),
        max: Math.max(...flat.outline.outer.map((p) => p.x)),
      };
      for (const b of bends) {
        expect(Math.abs(b.a.y - b.b.y), t.mark).toBeLessThanOrEqual(1e-6);
        expect(Math.min(b.a.x, b.b.x)).toBeGreaterThanOrEqual(box.min - TOL);
        expect(Math.max(b.a.x, b.b.x)).toBeLessThanOrEqual(box.max + TOL);
      }
      // Cote réelle : marche droite (contour rectangulaire) = emmarchement − 2 jeux latéraux.
      if (distinctVertices(flat.outline.outer).length === 4) {
        const len = vec2.distance(bends[0]!.a, bends[0]!.b);
        expect(
          Math.abs(len - (project.stair.layout.width - 2 * clearance)),
          t.mark,
        ).toBeLessThanOrEqual(TOL);
      }
      // Nombre de plis et longueur pliée reportés dans la nomenclature.
      expect(t.quantities["bends"]).toBe(2);
    }
  });

  it("dossier PDF : développés des limons et des marches pliées", () => {
    const pages = renderPdf(new RecordingCanvas(), model, { project });
    const flatIds = new Set(pages.filter((p) => p.kind === "flat").flatMap((p) => p.partIds ?? []));
    for (const p of [...stringers, ...treads]) expect(flatIds.has(p.id), p.mark).toBe(true);
    const text = pdfText(model, project);
    for (const p of [...stringers, ...treads]) expect(text, p.mark).toContain(p.mark);
  });
});
