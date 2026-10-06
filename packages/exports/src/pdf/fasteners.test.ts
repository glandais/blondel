import { fastenerKindLabel, msg, type Fastener, type Model } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { residualFrench } from "../testing/french.js";
import { sampleParts, straightModel } from "../testing/fixtures.js";
import { RecordingCanvas, helveticaMeasure } from "./canvas.js";
import { renderPdf, type PdfPages } from "./document.js";

function fastener(i: number, o: Partial<Fastener> = {}): Fastener {
  return {
    id: `f${i}`,
    mark: `VS${i}`,
    kind: "bolt",
    grade: "8.8",
    diameter: 12,
    length: 100,
    quantity: 4,
    joint: "plateFloor",
    name: fastenerKindLabel("bolt"),
    origin: msg("fastener.joint.plateFloor"),
    partIds: ["stringer-inner-1", "tread-2"],
    deduced: ["diameter", "quantity"],
    ...o,
  };
}

function modelWith(fasteners?: readonly Fastener[]): Model {
  const m = straightModel({ parts: sampleParts() });
  return fasteners === undefined ? m : { ...m, fasteners };
}

/** Sommaire, nomenclature et visserie seulement. */
const PAGES: PdfPages = {
  toc: true,
  plan: false,
  elevation: false,
  installation: false,
  bom: true,
  fasteners: true,
  cutsheet: false,
  compliance: false,
  flats: false,
  templates: false,
};

function render(model: Model, locale: "fr" | "en" = "fr", pages: PdfPages = PAGES) {
  const c = new RecordingCanvas(297, 210, helveticaMeasure());
  const info = renderPdf(c, model, { pages, locale, title: "Test", date: "06/10/2026" });
  return { info, texts: c.pageTexts() };
}

describe("dossier PDF : section « Visserie »", () => {
  it("après la nomenclature, au sommaire, une ligne par repère et le total", () => {
    const { info, texts } = render(
      modelWith([fastener(1), fastener(2, { quantity: 2 }), fastener(1, { id: "f1b" })]),
    );
    expect(info.map((p) => p.kind)).toEqual(["toc", "bom", "fasteners"]);
    expect(info[2]!.title).toBe("Visserie");
    expect(texts[0]!.join("\n")).toContain("Visserie");
    const page = texts[2]!;
    for (const s of ["Repère", "Désignation", "Diamètre (mm)", "Assemblages", "Pièces"]) {
      expect(page).toContain(s);
    }
    expect(page).toContain("VS1");
    expect(page).toContain("VS2");
    expect(page).toContain("Platine sur sol");
    expect(page).toContain("LI1 ; M2");
    // VS1 : 4 + 4 ; total : 10.
    expect(page).toContain("8");
    expect(page).toContain("10");
  });

  it("absente sans visserie ou si la section est désactivée", () => {
    expect(render(modelWith()).info.map((p) => p.kind)).toEqual(["toc", "bom"]);
    expect(render(modelWith([])).info.map((p) => p.kind)).toEqual(["toc", "bom"]);
    expect(
      render(modelWith([fastener(1)]), "fr", { ...PAGES, fasteners: false }).info.map(
        (p) => p.kind,
      ),
    ).toEqual(["toc", "bom"]);
  });

  it("paginée au-delà d'une page, une seule entrée au sommaire", () => {
    const many = Array.from({ length: 80 }, (_, i) => fastener(i + 1));
    const { info, texts } = render(modelWith(many));
    const pages = info.filter((p) => p.kind === "fasteners");
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]!.title).toBe(`Visserie (1/${pages.length})`);
    const toc = texts[0]!.filter((s) => s.startsWith("Visserie"));
    expect(toc).toEqual(["Visserie"]);
  });

  it("anglais : « Fixings », aucun texte français", () => {
    const { info, texts } = render(modelWith([fastener(1)]), "en");
    expect(info[2]!.title).toBe("Fixings");
    const page = texts[2]!;
    expect(page).toContain("Plate to floor");
    expect(page).toContain("Bolt");
    expect(residualFrench(page, ["Test"])).toEqual([]);
  });
});
