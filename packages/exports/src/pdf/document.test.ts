import { bbox, type Model } from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quarterArb, straightArb } from "../testing/arbitraries.js";
import {
  report,
  ruleResult,
  sampleParts,
  sampleProject,
  straightModel,
  woodStringerPart,
} from "../testing/fixtures.js";
import { JsPdfCanvas, RecordingCanvas, helveticaMeasure, type RecordedOp } from "./canvas.js";
import {
  COMPLIANCE_DISCLAIMER,
  exportPdf,
  exportPdfDocument,
  renderPdf,
  wrapText,
  type PdfPageKind,
  type PdfPages,
} from "./document.js";

/** Pages limitées aux sections nommées. */
function only(...keys: (keyof PdfPages)[]): PdfPages {
  const all: (keyof PdfPages)[] = [
    "toc",
    "plan",
    "elevation",
    "installation",
    "bom",
    "cutsheet",
    "compliance",
    "flats",
    "templates",
  ];
  return Object.fromEntries(all.map((k) => [k, keys.includes(k)])) as PdfPages;
}

const ORDER: readonly PdfPageKind[] = [
  "toc",
  "plan",
  "elevation",
  "installation",
  "bom",
  "cutsheet",
  "compliance",
  "flat",
  "template",
];

function fullModel(): Model {
  const m = straightModel();
  return {
    ...m,
    parts: [...sampleParts(), woodStringerPart(), woodStringerPart({ mark: "LE1" })],
    compliance: report([
      ruleResult("GIRON_MIN", { kind: "tread", number: 2 }, "bloquant", {
        measured: 200,
        min: 210,
        unit: "mm",
        nature: "reglementaire",
        confidence: "eleve",
        source: "Arrêté 2015",
      }),
      ruleResult("BLONDEL", { kind: "stair" }, "avertissement", {
        secondarySource: true,
        nature: "normatif",
        confidence: "moyen",
        source: "NF DTU 36.3",
        downgradeReason: "profil souple",
        declaredSeverity: "bloquant",
      }),
      ruleResult("CONSEIL_X", { kind: "stair" }, "conseil"),
      { ...ruleResult("NON_EVAL", { kind: "stair" }), status: "non-evaluee" },
      { ...ruleResult("OK_1", { kind: "stair" }), status: "ok", measured: 620, unit: "mm" },
    ]),
  };
}

/** Toutes les coordonnées dessinées sont finies et dans la page. */
function checkInPage(c: RecordingCanvas): void {
  for (const op of c.ops as RecordedOp[]) {
    if (op.type === "path") {
      for (const p of op.ops) {
        if (p.op === "Z") continue;
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(-0.01);
        expect(p.x).toBeLessThanOrEqual(c.pageWidth + 0.01);
        expect(p.y).toBeGreaterThanOrEqual(-0.01);
        expect(p.y).toBeLessThanOrEqual(c.pageHeight + 0.01);
      }
    } else if (op.type === "text") {
      expect(Number.isFinite(op.x) && Number.isFinite(op.y)).toBe(true);
      expect(op.value).not.toMatch(/NaN|Infinity/);
    }
  }
}

describe("renderPdf (mise en page sur surface enregistrée)", () => {
  const project = sampleProject();
  const model = fullModel();
  const c = new RecordingCanvas();
  const pages = renderPdf(c, model, { project, date: "29/09/2026" });
  const texts = c.pageTexts();

  it("ordre des pages : sommaire, plans, pose, nomenclature, débit, contrôle, développés, gabarits", () => {
    const kinds = pages.map((p) => p.kind);
    // Sections dans l'ordre, chacune présente.
    const ranks = kinds.map((k) => ORDER.indexOf(k));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (const k of ORDER) expect(kinds, k).toContain(k);
    expect(kinds.slice(0, 3)).toEqual(["toc", "plan", "elevation"]);
    // LI1 tôle, M2 (× 2), M1, M10, LI1 bois (même repère, autre développé), LE1.
    expect(kinds.filter((k) => k === "flat")).toHaveLength(6);
    expect(c.pageCount).toBe(pages.length);
    expect(texts).toHaveLength(pages.length);
    // Pièces identiques (M2 × 2) : un seul développé et un seul gabarit.
    const flats = pages.filter((p) => p.kind === "flat");
    expect(flats.map((p) => p.partIds)).toContainEqual(["tread-2", "tread-3"]);
    const templates = pages.filter((p) => p.kind === "template");
    expect(new Set(templates.map((p) => p.partIds!.join(","))).size).toBe(6);
  });

  it("sommaire : chaque section avec ses pages", () => {
    const toc = texts[0]!.join("\n");
    expect(toc).toContain("Sommaire");
    for (const s of [
      "Plan coté",
      "Élévation développée",
      "Fiche de pose",
      "Nomenclature",
      "Fiche de débit",
      "Contrôle de conception",
    ]) {
      expect(toc).toContain(s);
    }
    const first = (k: PdfPageKind): number => pages.findIndex((p) => p.kind === k) + 1;
    expect(toc).toContain(String(first("plan")));
    const lastTemplate = pages.length;
    expect(toc).toMatch(new RegExp(`à ${lastTemplate}\\b`));
    expect(toc).toMatch(/Gabarit 1:1 LI1/);
    expect(toc).toMatch(/imprimer à 100 %/);
  });

  it("cartouche : projet, date, échelle, repère, matériau, épaisseur et pagination", () => {
    texts.forEach((t, i) => {
      expect(t).toContain(project.name);
      expect(t).toContain("29/09/2026");
      expect(t).toContain(`Page ${i + 1} / ${pages.length}`);
      const p = pages[i]!;
      expect(t).toContain(p.scale !== undefined ? `1:${p.scale}` : "—");
      for (const label of [
        "Projet",
        "Document",
        "Échelle",
        "Date",
        "Repère",
        "Matériau",
        "Épaisseur",
      ]) {
        expect(t).toContain(label);
      }
      if (p.kind === "flat" || p.kind === "template") {
        const part = model.parts.find((q) => q.id === p.partIds![0])!;
        expect(t).toContain(part.mark);
        expect(t).toContain(`${part.flat!.thickness} mm`);
        expect(t.some((s) => ["Chêne", "Acier peint"].includes(s))).toBe(true);
      }
    });
    for (const p of pages) {
      if (["toc", "bom", "cutsheet", "compliance"].includes(p.kind))
        expect(p.scale).toBeUndefined();
      else if (p.kind !== "installation") expect(p.scale).toBeGreaterThan(0);
      if (p.kind === "template") expect(p.scale).toBe(1);
    }
  });

  it("nomenclature : repère, désignation, matériau, section, débit, quantité", () => {
    const bom = texts[pages.findIndex((p) => p.kind === "bom")]!;
    for (const h of ["Repère", "Désignation", "Matériau", "Section", "Qté"]) {
      expect(bom).toContain(h);
    }
    expect(bom).toContain("M2");
    expect(bom).toContain("950 × 300 × 45");
    expect(bom).toContain("Total");
    expect(bom).toContain(String(model.parts.length));
  });

  it("contrôle de conception : avertissement, groupes, provenance", () => {
    const text = texts[pages.findIndex((p) => p.kind === "compliance")]!.join("\n");
    expect(text).toContain(COMPLIANCE_DISCLAIMER);
    expect(text).toContain("Violations bloquantes (1)");
    expect(text).toContain("Avertissements (1)");
    expect(text).toContain("Conseils (1)");
    expect(text).toContain("Règles non évaluées (1)");
    expect(text).toContain("Règles respectées (1)");
    expect(text).toContain("mesuré 200 mm — min 210 mm");
    expect(text).toMatch(/Nature : réglementaire — confiance : élevée — source : Arrêté 2015/);
    expect(text).toMatch(/source : NF DTU 36\.3 \(source secondaire/);
    expect(text).toContain("rétrogradée : profil souple");
    // Ordre des groupes : bloquant avant avertissement avant conseil.
    expect(text.indexOf("Violations bloquantes")).toBeLessThan(text.indexOf("Avertissements"));
    expect(text.indexOf("Avertissements")).toBeLessThan(text.indexOf("Conseils"));
  });

  it("dessins dans la page, échelles normalisées", () => {
    checkInPage(c);
    for (const p of pages) {
      if (p.scale !== undefined && p.scaleNote === undefined) {
        expect([1, 2, 5, 10, 20, 25, 50, 75, 100, 200, 500]).toContain(p.scale);
      }
    }
  });

  it("échelle imposée tenue si possible, sinon signalée", () => {
    const c2 = new RecordingCanvas();
    const ok = renderPdf(c2, model, {
      project,
      planScale: 50,
      pages: only("plan"),
    });
    expect(ok).toEqual([{ kind: "plan", title: "Plan coté", scale: 50 }]);
    const c3 = new RecordingCanvas();
    const tooBig = renderPdf(c3, model, {
      project,
      planScale: 1,
      pages: only("plan"),
    });
    expect(tooBig[0]!.scale).toBeGreaterThan(1);
    expect(tooBig[0]!.scaleNote).toMatch(/trop grande/);
    expect(c3.pageTexts()[0]!.join(" ")).toMatch(/Remarque : échelle 1:1 demandée/);
    checkInPage(c3);
  });

  it("contrôle de conception long : réparti sur plusieurs pages, avertissement répété", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      ruleResult(`R${i}`, { kind: "stair" }, "avertissement", {
        message: "Un message assez long ".repeat(8),
      }),
    );
    const m = { ...model, compliance: report(many) };
    const c4 = new RecordingCanvas();
    const ps = renderPdf(c4, m, {
      pages: only("compliance"),
    });
    expect(ps.length).toBeGreaterThan(1);
    const t = c4.pageTexts();
    t.forEach((page) => expect(page.some((s) => s.includes(COMPLIANCE_DISCLAIMER))).toBe(true));
    checkInPage(c4);
    // Chaque règle apparaît une fois.
    const all = t.flat().join("\n");
    for (let i = 0; i < 80; i++) expect(all).toContain(`R${i} — `);
  });

  it("contrôle de conception long : texte jamais sous le cadre (cartouche), pages de suite comprises", () => {
    // Le rappel de l'avertissement en tête des pages de suite doit être compté dans la
    // pagination, sinon la dernière ligne déborde sur le cartouche.
    const bottom = c.pageHeight - 10 - 20 - 3; // bas du cadre utile (MARGIN, cartouche, blanc)
    for (const count of [60, 120, 200]) {
      const many = Array.from({ length: count }, (_, i) =>
        ruleResult(`R${i}`, { kind: "stair" }, "avertissement", {
          message: "Un message ".repeat((i % 7) + 1),
        }),
      );
      const cv = new RecordingCanvas();
      renderPdf(cv, { ...model, compliance: report(many) }, { pages: only("compliance") });
      // Corps de page : textes entre le filet d'en-tête et le cadre du cartouche.
      let paths = 0;
      for (const op of cv.ops) {
        if (op.type === "page") paths = 0;
        else if (op.type === "path") paths += 1;
        else if (op.type === "text" && paths === 1)
          expect(op.y, op.value).toBeLessThanOrEqual(bottom + 1e-9);
      }
    }
  });

  it("développé posé à l'échelle imprimée : 1 mm de pièce = 1/n mm de papier", () => {
    for (const flatScale of [undefined, 10, 20]) {
      const part = woodStringerPart({ riserCount: 5 });
      const cv = new RecordingCanvas();
      const [page] = renderPdf(
        cv,
        { ...model, parts: [part] },
        {
          ...(flatScale !== undefined ? { flatScale } : {}),
          pages: only("flats"),
        },
      );
      const n = page!.scale!;
      if (flatScale !== undefined) expect(n).toBe(flatScale);
      // Contour : le chemin rempli à trait épais (1,5 px) qui a autant de sommets que le contour.
      const outline = cv.ops.find(
        (o): o is Extract<RecordedOp, { type: "path" }> =>
          o.type === "path" &&
          o.style.fill !== undefined &&
          o.ops.filter((q) => q.op === "L").length === part.flat!.outline.outer.length - 1,
      )!;
      const xs = outline.ops.flatMap((q) => (q.op === "Z" || q.op === "C" ? [] : [q.x]));
      const ys = outline.ops.flatMap((q) => (q.op === "Z" || q.op === "C" ? [] : [q.y]));
      const b = bbox(part.flat!.outline.outer);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo((b.max.x - b.min.x) / n, 2);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo((b.max.y - b.min.y) / n, 2);
    }
  });

  it("date invalide : « — », pas de NaN", () => {
    const cv = new RecordingCanvas();
    renderPdf(cv, model, {
      date: new Date(Number.NaN),
      pages: only("bom"),
    });
    expect(cv.pageTexts()[0]).toContain("—");
    expect(cv.pageTexts()[0]!.join(" ")).not.toMatch(/NaN/);
    expect(() => exportPdf(model, { date: new Date(Number.NaN) })).not.toThrow();
  });

  it("modèle vide : pages de texte explicites", () => {
    const c5 = new RecordingCanvas();
    const ps = renderPdf(c5, { ...model, parts: [], compliance: report([]) }, {});
    expect(ps.map((p) => p.kind)).toEqual([
      "toc",
      "plan",
      "elevation",
      "installation",
      "installation",
      "bom",
      "cutsheet",
      "compliance",
    ]);
    const t = c5.pageTexts().flat();
    expect(t).toContain("Aucune pièce générée.");
    expect(t).toContain("Aucune règle évaluée.");
    expect(t).toContain("Escalier");
    expect(t).toContain("—");
  });

  it("wrapText : lignes dans la largeur, mots conservés", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-zé]{1,30}$/), { maxLength: 40 }),
        fc.double({ min: 10, max: 200, noNaN: true }),
        (words, width) => {
          const lines = wrapText(c, words.join(" "), 3, width);
          for (const l of lines) expect(c.textWidth(l, 3)).toBeLessThanOrEqual(width + 1e-9);
          expect(lines.join("").replace(/\s/g, "")).toBe(words.join(""));
        },
      ),
    );
  });

  it("propriété : escaliers droits et quarts tournants, tout dans la page", () => {
    fc.assert(
      fc.property(fc.oneof(straightArb, quarterArb), (m) => {
        const cv = new RecordingCanvas();
        const ps = renderPdf(
          cv,
          { ...m, parts: [woodStringerPart()] },
          { pages: { templates: false } },
        );
        expect(ps.length).toBeGreaterThanOrEqual(8);
        checkInPage(cv);
      }),
      { numRuns: 15 },
    );
  });
});

describe("exportPdf (jsPDF)", () => {
  const project = sampleProject();
  const model = fullModel();

  it("fichier PDF valide, une page par page prévue, textes présents", () => {
    const bytes = exportPdf(model, { project, date: "29/09/2026", compress: false });
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const pages = renderPdf(new RecordingCanvas(297, 210, helveticaMeasure()), model, { project });
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(pages.length);
    expect(exportPdfDocument(model, { project }).pages).toEqual(pages);
    // Textes en WinAnsi (é = 0xE9), lisibles dans les flux non compressés.
    expect(text).toContain(
      "(Contrôle de conception indicatif, ne vaut pas attestation de conformité.) Tj",
    );
    expect(text).toContain("(29/09/2026) Tj");
    expect(text).toContain("(Plan coté) Tj");
  });

  it("déterministe ; compression par défaut plus compacte", () => {
    const a = exportPdf(model, { project });
    const b = exportPdf(model, { project });
    expect(a).toEqual(b);
    expect(a.length).toBeLessThan(exportPdf(model, { project, compress: false }).length);
  });

  it("date passée en objet : cartouche JJ/MM/AAAA", () => {
    const bytes = exportPdf(model, {
      project,
      date: new Date(2026, 8, 29),
      compress: false,
      pages: only("bom"),
    });
    expect(new TextDecoder("latin1").decode(bytes)).toContain("(29/09/2026) Tj");
  });

  it("A3 : page plus grande", () => {
    const c = new JsPdfCanvas({ format: "a3" });
    expect(c.pageWidth).toBeCloseTo(420, 0);
    expect(c.pageHeight).toBeCloseTo(297, 0);
  });
});
