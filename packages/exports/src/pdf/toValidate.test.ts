/**
 * Page « Valeurs à valider » du dossier PDF (ADR-0009 point 9) : absente sans l'option (rendu
 * inchangé), placée après le contrôle de conception et reprise au sommaire, restantes d'abord,
 * décompte au pluriel, pagination, français et anglais, textes en WinAnsi.
 */
import { msg, textMessage } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { translatorOf } from "../i18n.js";
import { sampleParts, sampleProject, straightModel } from "../testing/fixtures.js";
import { RecordingCanvas, helveticaMeasure, toWinAnsi } from "./canvas.js";
import { renderPdf, type PdfLayoutOptions, type PdfPageInfo } from "./document.js";
import { toValidateOrder, toValidateSummary, type PdfToValidateRow } from "./toValidate.js";

const ROWS: readonly PdfToValidateRow[] = [
  {
    label: textMessage("Pince du support"),
    value: "30 mm",
    section: msg("pipeline.stage.structure"),
    validated: true,
  },
  {
    label: textMessage("Section des poteaux"),
    value: "40 mm",
    section: msg("pipeline.stage.guards"),
    validated: false,
  },
  {
    label: textMessage("Essence"),
    value: "Chêne",
    section: msg("pipeline.stage.structure"),
    validated: false,
  },
];

/** Dossier rendu sur une surface enregistrée (métrique Helvetica réelle). */
function render(options: PdfLayoutOptions): { pages: PdfPageInfo[]; texts: string[][] } {
  const c = new RecordingCanvas(297, 210, helveticaMeasure());
  // Pièces avec développés : les planches suivent la page « Valeurs à valider ».
  const model = { ...straightModel(), parts: sampleParts() };
  const pages = renderPdf(c, model, { project: sampleProject(), ...options });
  return { pages, texts: c.pageTexts() };
}

/** Textes de la première page « Valeurs à valider ». */
function pageText(r: { pages: PdfPageInfo[]; texts: string[][] }): string[] {
  return r.texts[r.pages.findIndex((p) => p.kind === "toValidate")] ?? [];
}

describe("dossier PDF : valeurs à valider", () => {
  it("sans l'option : aucune page, rendu identique", () => {
    const without = render({});
    expect(without.pages.some((p) => p.kind === "toValidate")).toBe(false);
    // `pages.toValidate` seul ne produit rien non plus.
    const flag = render({ pages: { toValidate: true } });
    expect(flag.texts).toEqual(without.texts);
  });

  it("avec l'option : après le contrôle, avant les développés, au sommaire", () => {
    const r = render({ toValidate: ROWS });
    const kinds = r.pages.map((p) => p.kind);
    const at = kinds.indexOf("toValidate");
    expect(at).toBeGreaterThan(kinds.lastIndexOf("compliance"));
    expect(at).toBeLessThan(kinds.indexOf("flat"));
    expect(kinds.filter((k) => k === "toValidate")).toHaveLength(1);
    expect(r.pages[at]!.title).toBe("Valeurs à valider");
    // Sommaire : entrée avec le numéro de page (rang + 1).
    const toc = r.texts[0]!;
    const entry = toc.indexOf("Valeurs à valider");
    expect(entry).toBeGreaterThanOrEqual(0);
    expect(toc[entry + 1]).toBe(String(at + 1));
    // Une page de plus que sans l'option, le reste inchangé.
    const base = render({});
    expect(r.pages.length).toBe(base.pages.length + 1);
  });

  it("français : chapeau, décompte, restantes d'abord, état", () => {
    const text = pageText(render({ toValidate: ROWS }));
    const joined = text.join("\n");
    expect(joined).toContain("Valeurs par défaut non sourcées");
    expect(joined).toContain("vérifiées par l'atelier");
    expect(text).toContain("1 validée · 2 restantes");
    for (const col of ["Paramètre", "Valeur", "Section", "État"]) expect(text).toContain(col);
    const order = ["Section des poteaux", "Essence", "Pince du support"].map((s) =>
      text.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text.filter((s) => s === "à valider")).toHaveLength(2);
    expect(text.filter((s) => s === "validée")).toHaveLength(1);
    expect(text).toContain("Chêne");
    expect(text).toContain("Garde-corps");
  });

  it("anglais : titre, état et décompte traduits", () => {
    const r = render({ toValidate: ROWS, locale: "en" });
    const at = r.pages.findIndex((p) => p.kind === "toValidate");
    expect(r.pages[at]!.title).toBe("Values to validate");
    const text = pageText(r);
    expect(text).toContain("1 validated · 2 remaining");
    expect(text.filter((s) => s === "to be validated")).toHaveLength(2);
    expect(text.filter((s) => s === "validated")).toHaveLength(1);
    expect(text.join("\n")).not.toMatch(/validée|à valider|restante/);
  });

  it("décompte au pluriel et au singulier", () => {
    const t = translatorOf();
    const v = (validated: boolean): PdfToValidateRow => ({ ...ROWS[0]!, validated });
    expect(toValidateSummary(t, [])).toBe("0 validée · 0 restante");
    expect(toValidateSummary(t, [v(true), v(true), v(false)])).toBe("2 validées · 1 restante");
    const en = translatorOf({ locale: "en" });
    expect(toValidateSummary(en, [v(true), v(false), v(false)])).toBe("1 validated · 2 remaining");
  });

  it("ordre : restantes puis validées, ordre d'entrée conservé dans chaque groupe", () => {
    const rows = ROWS.map((r, i) => ({ ...r, value: String(i), validated: i % 2 === 0 }));
    expect(toValidateOrder(rows).map((r) => r.value)).toEqual(["1", "0", "2"]);
  });

  it("liste vide : une ligne « Aucune valeur à valider »", () => {
    const text = pageText(render({ toValidate: [] }));
    expect(text).toContain("Aucune valeur à valider");
    expect(text).toContain("0 validée · 0 restante");
  });

  it("longue liste : pagination, titres numérotés, une seule entrée au sommaire", () => {
    const many: PdfToValidateRow[] = Array.from({ length: 90 }, (_, i) => ({
      label: textMessage(`Paramètre ${i + 1}`),
      value: `${i + 1} mm`,
      section: msg("pipeline.stage.structure"),
      validated: i % 3 === 0,
    }));
    const r = render({ toValidate: many });
    const idx = r.pages.flatMap((p, i) => (p.kind === "toValidate" ? [i] : []));
    expect(idx.length).toBeGreaterThan(1);
    // Pages consécutives.
    expect(idx).toEqual(idx.map((_, k) => idx[0]! + k));
    expect(r.pages[idx[0]!]!.title).toBe(`Valeurs à valider (1/${idx.length})`);
    // Toutes les lignes imprimées, une fois chacune.
    const all = idx.flatMap((i) => r.texts[i]!);
    for (let i = 1; i <= 90; i++) {
      expect(all.filter((s) => s === `Paramètre ${i}`)).toHaveLength(1);
    }
    // Chapeau sur la première page seulement.
    expect(r.texts[idx[1]!]!.join("\n")).not.toContain("non sourcées");
    const toc = r.texts[0]!;
    expect(toc.filter((s) => s === "Valeurs à valider")).toHaveLength(1);
    expect(toc).toContain(`${idx[0]! + 1} à ${idx[idx.length - 1]! + 1}`);
  });

  it("pages.toValidate = false : aucune page malgré l'option", () => {
    const off = render({ toValidate: ROWS, pages: { toValidate: false } });
    expect(off.pages.some((p) => p.kind === "toValidate")).toBe(false);
    expect(off.texts).toEqual(render({}).texts);
  });

  it("aucun caractère hors WinAnsi (pas de glyphe ◆), en français et en anglais", () => {
    for (const locale of ["fr", "en"] as const) {
      for (const s of pageText(render({ toValidate: ROWS, locale }))) {
        expect(toWinAnsi(s), s).toBe(s);
        expect(s).not.toContain("◆");
      }
    }
  });
});
