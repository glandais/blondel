/**
 * Dessins en anglais (ADR-0007) : plan et élévation SVG, développés SVG, plan et développés DXF
 * sur des exemples réels de `examples/`. Aucun texte français ne doit rester (heuristique :
 * lettres accentuées, mots courants), aucune clé brute ; calques DXF traduits et assainis.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText, type Model } from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { partLayers, PART_LAYERS, partLineLayer, exportPartDxf } from "../dxf/part.js";
import { exportPartsDxf } from "../dxf/parts.js";
import { exportPlanDxf, planLayers, PLAN_LAYERS } from "../dxf/plan.js";
import { sanitizeLayerName } from "../dxf/r12.js";
import { FRENCH_ACCENTS, residualFrench } from "../testing/french.js";
import { findAll, parseXml } from "../testing/xml.js";
import { renderElevationSvg } from "./elevation.js";
import { renderFlatPatternSvg } from "./flat.js";
import { renderPlanSvg } from "./plan.js";
import { readDxf, type DxfFile } from "../testing/dxf-reader.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");

/** Exemples couvrant droit à balancement, hélicoïdal, tôle pliée, limon bois (mortaises). */
const EXAMPLES = [
  "demo-quarter-landing-ash.blondel.json",
  "j5a-helicoidal.blondel.json",
  "j3b-acceptance-01-tole-pliee.blondel.json",
  "j3a-acceptance-01-bois.blondel.json",
] as const;

const models = new Map<string, Model>();
function model(file: string): Model {
  let m = models.get(file);
  if (m === undefined) {
    m = buildModel(parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8")));
    models.set(file, m);
  }
  return m;
}

function expectEnglish(texts: readonly string[], where: string): void {
  expect(texts.length, where).toBeGreaterThan(0);
  for (const s of texts) {
    expect(residualFrench([s]), where).toEqual([]);
  }
}

/** Textes d'un SVG : `<title>` et contenus des `<text>`. */
function svgTexts(svg: string): string[] {
  const root = parseXml(svg);
  return [...findAll(root, "title"), ...findAll(root, "text")].map((e) => e.text);
}

/** Textes (séquences `\U+XXXX` décodées) et noms de calques d'un DXF. */
function dxfTexts(f: DxfFile): string[] {
  const decode = (s: string): string =>
    s.replace(/\\U\+([0-9A-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const texts = f.entities.flatMap((e) => (e.type === "TEXT" ? [decode(e.value)] : []));
  return [...texts, ...f.layers.keys()];
}

describe("dessins en anglais (locale « en »)", () => {
  for (const file of EXAMPLES) {
    describe(file, () => {
      it("plan SVG : cartouche et titre en anglais", () => {
        const svg = renderPlanSvg(model(file), { locale: "en" });
        const texts = svgTexts(svg);
        expectEnglish(texts, "plan");
        expect(texts.some((t) => /^Plan — \d+ rises$/.test(t))).toBe(true);
        expect(texts.some((t) => /^Total rise H = [\d,]+ mm$/.test(t))).toBe(true);
        expect(texts.some((t) => /^2R \+ G = \d+\.\d mm$/.test(t))).toBe(true);
        expect(texts.some((t) => t.startsWith("Design check: "))).toBe(true);
      });

      it("élévation SVG en anglais", () => {
        const texts = svgTexts(renderElevationSvg(model(file), { locale: "en" }));
        expectEnglish(texts, "élévation");
        expect(texts).toContain("Developed elevation");
        expect(texts).toContain("Elevation developed along the walking line");
      });

      it("plan DXF : textes et calques en anglais", () => {
        for (const version of ["R12", "AC1021"] as const) {
          const f = readDxf(exportPlanDxf(model(file), { locale: "en", version }));
          expectEnglish(dxfTexts(f), `plan DXF ${version}`);
          for (const l of Object.values(planLayers(translatorFor("en")))) {
            expect(f.layers.has(l.name), l.name).toBe(true);
          }
        }
      });

      it("développés SVG et DXF en anglais", () => {
        const parts = model(file).parts.filter((p) => p.flat !== undefined);
        expect(parts.length).toBeGreaterThan(0);
        for (const part of parts) {
          expectEnglish(
            svgTexts(renderFlatPatternSvg(part, { locale: "en" })),
            `développé ${part.mark}`,
          );
          const f = readDxf(exportPartDxf(part, { locale: "en", quantity: 2 }));
          const texts = dxfTexts(f);
          expectEnglish(texts, `DXF ${part.mark}`);
          expect(texts.some((t) => t.startsWith("Material: "))).toBe(true);
          expect(texts).toContain("Quantity: 2");
        }
        for (const d of exportPartsDxf(model(file), { locale: "en" })) {
          expectEnglish(dxfTexts(readDxf(d.content)), d.filename);
        }
      });
    });
  }

  it("hélicoïdal : cartouche propre à l'hélicoïdal traduit", () => {
    const texts = svgTexts(renderPlanSvg(model("j5a-helicoidal.blondel.json"), { locale: "en" }));
    expect(texts.some((t) => t.startsWith("Spiral stair ("))).toBe(true);
    expect(texts.some((t) => t.startsWith("Angle per step "))).toBe(true);
  });

  it("tôle pliée : sens de pli traduit (up / down)", () => {
    const m = model("j3b-acceptance-01-tole-pliee.blondel.json");
    const all = m.parts
      .filter((p) => p.flat?.lines.some((l) => l.kind === "bend" && l.bendUp !== undefined))
      .flatMap((p) => svgTexts(renderFlatPatternSvg(p, { locale: "en" })));
    expect(all.some((t) => /° (up|down)\b/.test(t))).toBe(true);
  });

  it("erreurs dans la langue de l'export", () => {
    const part = { ...model(EXAMPLES[2]).parts[0]!, flat: undefined };
    expect(() => renderFlatPatternSvg(part, { locale: "en" })).toThrow(/has no flat pattern/);
    expect(() => exportPartDxf(part)).toThrow(/n'a pas de développé à plat/);
    expect(() => renderPlanSvg(model(EXAMPLES[0]), { locale: "en", scale: 0 })).toThrow(
      /^Invalid scale: 1:0$/,
    );
  });
});

describe("calques DXF traduits", () => {
  it("français : noms historiques inchangés", () => {
    expect(Object.values(PLAN_LAYERS).map((l) => l.name)).toEqual([
      "CONTOUR",
      "MARCHES",
      "NEZ",
      "FOULEE",
      "TREMIE",
      "COTES",
      "TEXTE",
    ]);
    expect(Object.values(PART_LAYERS).map((l) => l.name)).toEqual([
      "CONTOUR",
      "PLI",
      "TRACAGE",
      "MORTAISE",
      "TENON",
      "ROULAGE",
      "JOINT",
      "TEXTE",
      "INFO",
    ]);
    expect(planLayers()).toBe(PLAN_LAYERS);
  });

  it("anglais : noms traduits, assainis, uniques, couleurs et types de ligne conservés", () => {
    const en = translatorFor("en");
    for (const [fr, tr] of [
      [PLAN_LAYERS, planLayers(en)],
      [PART_LAYERS, partLayers(en)],
    ] as const) {
      const names = Object.values(tr).map((l) => l.name);
      expect(new Set(names).size).toBe(names.length);
      for (const [id, l] of Object.entries(tr)) {
        expect(sanitizeLayerName(l.name)).toBe(l.name);
        expect(l.name).not.toMatch(FRENCH_ACCENTS);
        const ref = (fr as Record<string, typeof l>)[id]!;
        expect(l.color).toBe(ref.color);
        expect(l.lineType).toBe(ref.lineType);
      }
    }
    expect(planLayers(en).walkline.name).toBe("WALKLINE");
    const a = { x: 0, y: 0 };
    expect(partLineLayer({ kind: "mark", a, b: a, feature: "mortise" }, en)).toBe("MORTISE");
    expect(partLineLayer({ kind: "bend", a, b: a }, en)).toBe("BEND");
  });
});
