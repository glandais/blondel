import type { Model, Part } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { report, straightModel, woodStringerPart } from "../testing/fixtures.js";
import { JsPdfCanvas, RecordingCanvas, helveticaMeasure, type RecordedOp } from "./canvas.js";
import { exportPdfDocument, renderPdf, type PdfPages } from "./document.js";
import { CONTROL_RULER_MM, HEADER, MARGIN, contentFrame } from "./layout.js";
import {
  DEFAULT_TILE_OVERLAP,
  registrationPoints,
  templatePages,
  templateSheet,
  templateTiles,
  tileGrid,
  tileHasContent,
  tileLabel,
  tileRect,
} from "./tiles.js";

const FRAME3 = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
};

/** Flan rectangulaire de `w × h` mm (tôle de 5 mm). */
function plate(w: number, h: number, mark = "PL1"): Part {
  const outer = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return {
    id: `plate-${mark}`,
    mark,
    category: "support",
    name: "Platine",
    material: "steel-painted",
    solid: { kind: "extrusion", frame: FRAME3, profile: { outer, holes: [] }, depth: 5 },
    flat: { outline: { outer, holes: [] }, lines: [], thickness: 5 },
    quantities: {},
  };
}

const TEMPLATES_ONLY: PdfPages = {
  toc: false,
  plan: false,
  elevation: false,
  installation: false,
  bom: false,
  cutsheet: false,
  compliance: false,
  flats: false,
  templates: true,
};

/** Nombre de cases attendu sur une longueur (formule indépendante de l'implémentation). */
function expectedCount(sheet: number, tile: number, overlap: number): number {
  // Tolérance de 1e-6 mm, comme l'implémentation (arrondis des additions successives).
  if (sheet <= tile + 1e-6) return 1;
  let n = 1;
  let covered = tile;
  while (covered < sheet - 1e-6) {
    covered += tile - overlap;
    n++;
  }
  return n;
}

const model = (parts: Part[]): Model => ({ ...straightModel(), parts, compliance: report([]) });

describe("grille des gabarits 1:1", () => {
  it("propriété : la grille couvre la planche avec le nombre minimal de cases", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 6000, noNaN: true }),
        fc.double({ min: 1, max: 3000, noNaN: true }),
        fc.constantFrom([277, 158], [400, 245]),
        // Recouvrement ≥ 1 mm : à 0, les mires tombent sur la frontière (arrondis flottants).
        fc.double({ min: 1, max: 30, noNaN: true }),
        (W, H, [fw, fh], o) => {
          const g = tileGrid(W, H, fw!, fh!, o);
          expect(g.cols).toBe(expectedCount(W, fw!, o));
          expect(g.rows).toBe(expectedCount(H, fh!, o));
          // Couverture : la dernière case atteint le bord ; l'avant-dernière ne suffisait pas.
          expect((g.cols - 1) * g.stepX + fw!).toBeGreaterThanOrEqual(W - 1e-6);
          if (g.cols > 1) expect((g.cols - 2) * g.stepX + fw!).toBeLessThan(W);
          // Mires : chacune sur au moins deux cases (bande de recouvrement commune).
          for (const m of registrationPoints(g)) {
            let n = 0;
            for (let r = 0; r < g.rows; r++) {
              for (let c = 0; c < g.cols; c++) {
                const t = tileRect(g, r, c);
                if (m.x >= t.x && m.x <= t.x + t.w && m.y >= t.y && m.y <= t.y + t.h) n++;
              }
            }
            expect(n).toBeGreaterThanOrEqual(2);
          }
        },
      ),
    );
  });

  it("repères de case : lignes en lettres, colonnes en chiffres", () => {
    expect(tileLabel(0, 0)).toBe("A1");
    expect(tileLabel(1, 11)).toBe("B12");
    expect(tileLabel(25, 0)).toBe("Z1");
    expect(tileLabel(26, 2)).toBe("AA3");
    expect(() => tileGrid(100, 100, 50, 50, 30)).toThrow(RangeError);
  });
});

describe("gabarits 1:1 dans le dossier PDF", () => {
  const helvetica = helveticaMeasure();
  const measure = {
    textWidth: (v: string, size: number, bold = false) => helvetica(v, size, bold),
  };
  const fontPx = (2.4 * 96) / 25.4;

  it("nombre de pages selon la taille du développé, en A4 et en A3", () => {
    for (const [w, h] of [
      [200, 100],
      [900, 280],
      [2000, 600],
      [3250, 260],
    ] as const) {
      const part = plate(w, h);
      const sheet = templateSheet(measure, part, { fontPx });
      // La planche 1:1 contient la pièce, ses cotes et ses marges.
      expect(sheet.width).toBeGreaterThan(w);
      expect(sheet.height).toBeGreaterThan(h);
      for (const format of ["a4", "a3"] as const) {
        const frame = contentFrame(new JsPdfCanvas({ format }));
        const cols = expectedCount(sheet.width, frame.w, DEFAULT_TILE_OVERLAP);
        const rows = expectedCount(sheet.height, frame.h, DEFAULT_TILE_OVERLAP);
        const { bytes, pages } = exportPdfDocument(model([part]), {
          format,
          pages: TEMPLATES_ONLY,
          compress: false,
        });
        // Flan rectangulaire : toutes les cases ont un tracé (matière, contour ou cotes).
        expect(pages, `${w}×${h} ${format}`).toHaveLength(rows * cols);
        for (const p of pages) {
          expect(p.kind).toBe("template");
          expect(p.scale).toBe(1);
          expect(p.tile).toMatchObject({ rows, cols, count: rows * cols });
        }
        const text = new TextDecoder("latin1").decode(bytes);
        expect(text.match(/\/Type \/Page\b/g)).toHaveLength(rows * cols);
      }
    }
    // Une petite pièce tient sur une page : pas de case.
    const one = renderPdf(new RecordingCanvas(), model([plate(200, 100)]), {
      pages: TEMPLATES_ONLY,
    });
    expect(one).toHaveLength(1);
    expect(one[0]!.title).toBe("Gabarit 1:1 PL1 — Platine");
    // A3 : moins de pages qu'en A4.
    const a4 = exportPdfDocument(model([plate(2000, 600)]), { pages: TEMPLATES_ONLY }).pages.length;
    const a3 = exportPdfDocument(model([plate(2000, 600)]), { format: "a3", pages: TEMPLATES_ONLY })
      .pages.length;
    expect(a3).toBeLessThan(a4);
  });

  it("limon en biais : cases vides omises, cases imprimées non vides", () => {
    const part = woodStringerPart({ riserCount: 14 });
    const sheet = templateSheet(measure, part, { fontPx });
    const frame = contentFrame(new RecordingCanvas());
    const grid = tileGrid(sheet.width, sheet.height, frame.w, frame.h);
    const tiles = templateTiles(sheet, grid);
    expect(tiles.length).toBeLessThan(grid.rows * grid.cols);
    const kept = new Set(tiles.map((t) => t.label));
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        expect(tileHasContent(sheet, tileRect(grid, r, c))).toBe(kept.has(tileLabel(r, c)));
      }
    }
    const pages = renderPdf(new RecordingCanvas(297, 210, helvetica), model([part]), {
      pages: TEMPLATES_ONLY,
    });
    expect(pages.map((p) => p.tile!.label)).toEqual(tiles.map((t) => t.label));
  });

  it("chaque case : tracés dans la page, règle de 100 mm, mires et repères de recouvrement", () => {
    const part = plate(2000, 600);
    const cv = new RecordingCanvas(297, 210, helvetica);
    const pages = renderPdf(cv, model([part]), { pages: TEMPLATES_ONLY });
    const perPage: RecordedOp[][] = [[]];
    for (const op of cv.ops) {
      if (op.type === "page") perPage.push([]);
      else perPage[perPage.length - 1]!.push(op);
    }
    expect(perPage).toHaveLength(pages.length);
    perPage.forEach((ops, i) => {
      const tile = pages[i]!.tile!;
      for (const op of ops) {
        if (op.type !== "path") continue;
        for (const p of op.ops) {
          if (p.op === "Z") continue;
          expect(p.x).toBeGreaterThanOrEqual(-1e-6);
          expect(p.x).toBeLessThanOrEqual(297 + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(-1e-6);
          expect(p.y).toBeLessThanOrEqual(210 + 1e-6);
        }
      }
      // Règle de contrôle : un trait horizontal de 100 mm exactement.
      const ruler = ops.some(
        (op) =>
          op.type === "path" &&
          op.ops.length === 2 &&
          op.ops[0]!.op === "M" &&
          op.ops[1]!.op === "L" &&
          Math.abs(op.ops[1]!.y - op.ops[0]!.y) < 1e-9 &&
          Math.abs(op.ops[1]!.x - op.ops[0]!.x - CONTROL_RULER_MM) < 1e-9,
      );
      expect(ruler, tile.label).toBe(true);
      const texts = ops.filter((o) => o.type === "text").map((o) => (o as { value: string }).value);
      expect(texts.join("\n")).toMatch(/Imprimer à 100 %/);
      expect(texts).toContain(`Page ${i + 1} / ${pages.length}`);
      // Recouvrement annoncé vers chaque voisine imprimée.
      if (tile.col + 1 < tile.cols)
        expect(texts).toContain(`recouvrement ${tileLabel(tile.row, tile.col + 1)}`);
      if (tile.row > 0)
        expect(texts).toContain(`recouvrement ${tileLabel(tile.row - 1, tile.col)}`);
      // Détourage au cadre utile.
      expect(ops.some((o) => o.type === "clip")).toBe(true);
    });
  });

  it("grande grille (14 lignes) : le plan d'assemblage reste dans l'en-tête, au-dessus du cadre", () => {
    const cv = new RecordingCanvas(297, 210, helvetica);
    const frame = contentFrame(cv);
    const drafts = templatePages(cv, plate(300, 2000), ["plate-PL1"], frame, { fontPx: 9 });
    expect(drafts[0]!.info.tile.rows).toBeGreaterThanOrEqual(12);
    for (const d of drafts) {
      const rec = new RecordingCanvas(297, 210, helvetica);
      const w = d.headerRight!(rec);
      expect(w).toBeGreaterThan(0);
      for (const op of rec.ops) {
        if (op.type !== "path") continue;
        for (const p of op.ops) {
          if (p.op === "Z") continue;
          expect(p.y).toBeGreaterThanOrEqual(MARGIN);
          // Filet de l'en-tête à MARGIN + HEADER − 2, cadre du gabarit en dessous.
          expect(p.y).toBeLessThanOrEqual(MARGIN + HEADER - 2);
          expect(p.y).toBeLessThan(frame.y);
        }
      }
    }
  });

  it("à 1:1, 1 mm de pièce = 1 mm de papier, raccord exact entre cases voisines", () => {
    const part = plate(600, 100);
    const cv = new RecordingCanvas(297, 210, helvetica);
    const pages = renderPdf(cv, model([part]), { pages: TEMPLATES_ONLY });
    expect(pages.length).toBeGreaterThanOrEqual(3);
    const frame = contentFrame(cv);
    // Trait du contour (bord bas y = 0 de la pièce) : abscisses sur la planche.
    const perPage: RecordedOp[][] = [[]];
    for (const op of cv.ops) {
      if (op.type === "page") perPage.push([]);
      else perPage[perPage.length - 1]!.push(op);
    }
    const sheetXs = perPage.map((ops, i) => {
      const t = pages[i]!.tile!;
      const g = tileGrid(1e9, 1, frame.w, frame.h); // pas identique à celui du dossier
      const originX = t.col * g.stepX;
      const xs: number[] = [];
      for (const op of ops) {
        if (op.type !== "path" || op.style.fill === undefined) continue;
        // Matière du flan seulement (le plan d'assemblage de l'en-tête est aussi rempli).
        if (op.ops.some((p) => p.op !== "Z" && p.y < frame.y)) continue;
        for (const p of op.ops) if (p.op !== "Z") xs.push(p.x - frame.x + originX);
      }
      return [Math.min(...xs), Math.max(...xs)];
    });
    const lo = Math.min(...sheetXs.map((r) => r[0]!));
    const hi = Math.max(...sheetXs.map((r) => r[1]!));
    // Arrondi des coordonnées SVG (0,01 px) : moins de 0,01 mm.
    expect(Math.abs(hi - lo - 600)).toBeLessThan(0.01);
  });
});
