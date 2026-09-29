/**
 * Bout en bout du jalon 3a : cas d'acceptation n° 1 (quart tournant bas, poteau d'angle) avec
 * la structure bois `wood-housed` (limons à la française), exemple
 * `examples/j3a-acceptance-01-bois.blondel.json`. Pipeline réel du cœur (plugin enregistré par
 * `@blondel/core`) → dossier PDF et DXF R12 de chaque limon, relus par le lecteur de test.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModel,
  listStructures,
  parseProjectText,
  vec2,
  type FlatPattern,
  type Part,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { exportPartsDxf } from "./dxf/parts.js";
import { RecordingCanvas, STANDARD_SCALES, exportPdf, renderPdf } from "./pdf/index.js";
import { renderFlatPatternSvg } from "./svg/flat.js";
import { entitiesOn, polylines, readDxf, type DxfFile } from "./testing/dxf-reader.js";
import { parseXml } from "./testing/xml.js";

const TOL = 0.01;
const FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/j3a-acceptance-01-bois.blondel.json",
);

const project = parseProjectText(readFileSync(FILE, "utf8"));
const model = buildModel(project);
const stringers = model.parts.filter((p) => p.category === "stringer");

/** Sommets du contour sans doublons consécutifs (même fusion que l'écrivain, 1e-6 mm). */
function distinctVertices(poly: readonly { x: number; y: number }[]) {
  const out: { x: number; y: number }[] = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (prev === undefined || vec2.distance(prev, p) > 1e-6) out.push(p);
  }
  if (out.length > 1 && vec2.distance(out[0]!, out[out.length - 1]!) <= 1e-6) out.pop();
  return out;
}

/** Relit le DXF d'une pièce et le compare à son développé à ±0,01 mm. */
function expectFaithful(f: DxfFile, part: Part): void {
  const flat = part.flat as FlatPattern;
  const [contour] = polylines(f, "CONTOUR");
  expect(contour, part.mark).toBeDefined();
  expect(contour!.closed).toBe(true);
  const expected = distinctVertices(flat.outline.outer);
  expect(contour!.vertices).toHaveLength(expected.length);
  contour!.vertices.forEach((v, i) => {
    expect(vec2.distance(v, expected[i]!), `${part.mark} sommet ${i}`).toBeLessThanOrEqual(TOL);
    expect(v.bulge).toBe(0);
  });
  // Chaque trait (mortaise, tenon, traçage, joint) relu à ±0,01 mm sur son calque.
  const lines = entitiesOn(f, "LINE");
  const drawn = flat.lines.filter((l) => l.kind !== "text");
  expect(lines).toHaveLength(drawn.length);
  drawn.forEach((l, i) => {
    expect(vec2.distance(lines[i]!.a, l.a), `${part.mark} trait ${i}`).toBeLessThanOrEqual(TOL);
    expect(vec2.distance(lines[i]!.b, l.b), `${part.mark} trait ${i}`).toBeLessThanOrEqual(TOL);
  });
  const mortises = flat.lines.filter((l) => l.feature === "mortise").length;
  expect(mortises, part.mark).toBeGreaterThan(0);
  expect(entitiesOn(f, "LINE", "MORTAISE")).toHaveLength(mortises);
  expect(entitiesOn(f, "TEXT", "TEXTE").map((t) => t.value)).toContain(part.mark);
}

describe("jalon 3a : cas d'acceptation n° 1 en limons à la française", () => {
  it("plugin wood-housed enregistré et appliqué, modèle sans erreur", () => {
    expect(listStructures().map((s) => s.kind)).toEqual(
      expect.arrayContaining(["wood-housed", "wood-cut"]),
    );
    expect(project.stair.structure.kind).toBe("wood-housed");
    expect(model.errors).toEqual([]);
    // Deux volées : limon intérieur (jour) et extérieur (mur) par volée, un poteau d'angle.
    expect(stringers.map((p) => p.mark).sort()).toEqual(["LE1", "LE2", "LI1", "LI2"]);
    expect(model.parts.filter((p) => p.category === "post")).toHaveLength(1);
    for (const p of stringers) expect(p.flat, p.mark).toBeDefined();
  });

  it("DXF R12 de chaque limon relu à ±0,01 mm (contour, mortaises, repère)", () => {
    const files = exportPartsDxf(model, { version: "R12" });
    for (const part of stringers) {
      const file = files.find((f) => f.partIds.includes(part.id));
      expect(file, part.mark).toBeDefined();
      expect(file!.content).toContain("AC1009");
      expectFaithful(readDxf(file!.content), part);
      parseXml(renderFlatPatternSvg(part));
    }
  });

  it("dossier PDF non vide, chaque développé à une échelle normalisée", () => {
    // Régression : la ligne d'information d'un limon (fibre de référence), de largeur
    // physique fixe, ne tenait dans le cadre à aucune échelle ; ~60 rendus par planche (56 s).
    const pages = renderPdf(new RecordingCanvas(), model, { project });
    const flats = pages.filter((p) => p.kind === "flat");
    for (const p of stringers) {
      const page = flats.find((f) => f.partIds?.includes(p.id));
      expect(page, p.mark).toBeDefined();
      expect(page!.scaleNote, p.mark).toBeUndefined();
      expect(STANDARD_SCALES).toContain(page!.scale);
    }
    const bytes = exportPdf(model, { project, date: "29/09/2026", compress: false });
    expect(bytes.length).toBeGreaterThan(10_000);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).not.toMatch(/NaN|Infinity/);
    for (const p of stringers) expect(text, p.mark).toContain(p.mark);
  });
});
