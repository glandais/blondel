import { buildModel, createProject, type Model, type Part } from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  EXPORT_ENTRIES,
  MIME,
  buildExport,
  exportAvailability,
  fileStem,
  partDxfFile,
  partsDxfFiles,
  partsWithFlat,
} from "./exportFiles.js";
import type { ExportDeps } from "./exportFiles.js";

const project = createProject("quarter-left");
const model = buildModel(project);

/** Modèle dont les deux premières pièces reçoivent un développé rectangulaire (test). */
function withFlats(m: Model): Model {
  const flat = (w: number): NonNullable<Part["flat"]> => ({
    outline: {
      outer: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: 300 },
        { x: 0, y: 300 },
      ],
      holes: [],
    },
    lines: [],
    thickness: 40,
  });
  return { ...m, parts: m.parts.map((p, i) => (i < 2 ? { ...p, flat: flat(800 + i) } : p)) };
}

const text = (c: unknown): string => {
  if (typeof c !== "string") throw new Error("texte attendu");
  return c;
};

describe("exports du menu", () => {
  it("nom de fichier dérivé du projet", () => {
    expect(fileStem("Quart tournant à gauche")).toBe("quart-tournant-a-gauche");
    expect(fileStem("")).toBe("projet");
  });

  it.each([
    "plan-svg",
    "elevation-svg",
    "plan-dxf",
    "plan-dxf-r12",
    "cutlist-csv",
    "project-json",
  ] as const)("%s : un fichier non vide", async (id) => {
    const files = await buildExport(id, project, model);
    expect(files).toHaveLength(1);
    const f = files[0]!;
    expect(f.filename.startsWith("quart-tournant-a-gauche")).toBe(true);
    expect(text(f.content).length).toBeGreaterThan(100);
  });

  it("versions DXF : plan AC1021 par défaut, R12 sur demande", async () => {
    const [ac] = await buildExport("plan-dxf", project, model);
    const [r12] = await buildExport("plan-dxf-r12", project, model);
    expect(text(ac!.content)).toContain("AC1021");
    expect(text(r12!.content)).toContain("AC1009");
    expect(ac!.mime).toBe(MIME.dxf);
  });

  it("SVG et CSV : types et contenu attendus", async () => {
    const [plan] = await buildExport("plan-svg", project, model);
    expect(text(plan!.content)).toMatch(/^<svg/);
    const [csv] = await buildExport("cutlist-csv", project, model);
    expect(text(csv!.content)).toContain("Repère");
    expect(csv!.filename.endsWith(".csv")).toBe(true);
  });

  it("PDF : module chargé à la demande, contenu (même asynchrone) transmis", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    let loads = 0;
    const deps: ExportDeps = {
      loadPdf: async () => {
        loads++;
        return async () => bytes;
      },
    };
    const [pdf] = await buildExport("pdf", project, model, deps);
    expect(loads).toBe(1);
    expect(pdf).toMatchObject({ filename: "quart-tournant-a-gauche.pdf", mime: MIME.pdf });
    expect(pdf!.content).toBe(bytes);
    // Le projet JSON ne charge pas le module PDF.
    await buildExport("project-json", project, null, deps);
    expect(loads).toBe(1);
  });

  it("PDF délégué (worker) : `renderPdf` remplace le chargement du module", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    let loads = 0;
    const seen: unknown[] = [];
    const deps: ExportDeps = {
      loadPdf: async () => {
        loads++;
        return () => new Uint8Array();
      },
      renderPdf: async (p) => {
        seen.push(p);
        return bytes;
      },
    };
    const [pdf] = await buildExport("pdf", project, model, deps);
    expect(loads).toBe(0);
    expect(seen).toEqual([project]);
    expect(pdf).toMatchObject({ filename: "quart-tournant-a-gauche.pdf", mime: MIME.pdf });
    expect(pdf!.content).toBe(bytes);
  });

  it("PDF réel : @blondel/exports/pdf produit un fichier %PDF", async () => {
    const [pdf] = await buildExport("pdf", project, model);
    const c = pdf!.content;
    expect(c).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode((c as Uint8Array).slice(0, 5))).toBe("%PDF-");
  }, 30_000);

  it("sans modèle : seul le projet JSON est disponible", () => {
    for (const e of EXPORT_ENTRIES) {
      expect(exportAvailability(e.id, null).ok).toBe(!e.needsModel);
    }
  });

  it("DXF des pièces : indisponible sans développé (structure « aucune »)", () => {
    expect(partsWithFlat(model)).toHaveLength(0);
    expect(exportAvailability("parts-dxf", model).ok).toBe(false);
  });

  it("DXF des pièces : archive ZIP des fichiers R12 (un par repère)", () => {
    const m = withFlats(model);
    const files = partsDxfFiles(m, "x");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ filename: "x-pieces-dxf.zip", mime: MIME.zip });
    const zip = files[0]!.content as Uint8Array;
    // Signature d'en-tête local ZIP « PK\x03\x04 » et deux entrées .dxf.
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const names = new TextDecoder().decode(zip).match(/[A-Za-z0-9_-]+\.dxf/g) ?? [];
    expect(new Set(names).size).toBe(2);
  });

  it("DXF des pièces : une seule pièce à développé → le DXF tel quel", () => {
    const m = withFlats(model);
    const one = { parts: m.parts.filter((p) => p.flat !== undefined).slice(0, 1) };
    const files = partsDxfFiles(one, "x");
    expect(files).toHaveLength(1);
    expect(files[0]!.filename).toMatch(/^x-.+\.dxf$/);
    expect(text(files[0]!.content)).toContain("AC1009");
    expect(partDxfFile(one.parts[0]!, "x").filename).toBe(files[0]!.filename);
  });

  it("DXF d'une pièce sans développé : erreur explicite", () => {
    expect(() => partDxfFile(model.parts[0]!, "x")).toThrow(RangeError);
  });
});

describe("dossiers PDF, fiche de pose et modèle glTF", () => {
  it("chaque dossier PDF transmet ses pages et son format, nom de fichier distinct", async () => {
    const seen: unknown[] = [];
    const deps: ExportDeps = {
      loadPdf: async () => () => new Uint8Array(),
      renderPdf: async (_p, _m, options) => {
        seen.push(options);
        return new Uint8Array([1]);
      },
    };
    const names: string[] = [];
    for (const id of ["pdf", "pdf-a3", "pdf-light", "installation-pdf"] as const) {
      const [f] = await buildExport(id, project, model, deps);
      names.push(f!.filename);
      expect(f!.mime).toBe(MIME.pdf);
    }
    expect(new Set(names).size).toBe(4);
    expect(names).toContain("quart-tournant-a-gauche-fiche-de-pose.pdf");
    expect(seen[0]).toEqual({});
    expect(seen[1]).toEqual({ format: "a3" });
    expect(seen[2]).toEqual({ pages: { templates: false } });
    const pose = seen[3] as { pages: Record<string, boolean> };
    expect(pose.pages["installation"]).toBe(true);
    expect(
      Object.entries(pose.pages)
        .filter(([, v]) => v)
        .map(([k]) => k),
    ).toEqual(["installation"]);
  });

  it("fiche de pose réelle : PDF d'une seule section, plus court que le dossier complet", async () => {
    const [pose] = await buildExport("installation-pdf", project, model);
    const [full] = await buildExport("pdf-light", project, model);
    const pages = (c: unknown) =>
      (new TextDecoder("latin1").decode(c as Uint8Array).match(/\/Type\s*\/Page[^s]/g) ?? [])
        .length;
    expect(pages(pose!.content)).toBeGreaterThanOrEqual(1);
    expect(pages(pose!.content)).toBeLessThan(pages(full!.content));
  }, 60_000);

  it("glTF : délégué au worker si fourni, sinon calculé sur place (en-tête glTF)", async () => {
    const [local] = await buildExport("glb", project, model);
    expect(local).toMatchObject({ filename: "quart-tournant-a-gauche.glb", mime: MIME.glb });
    expect(new TextDecoder().decode((local!.content as Uint8Array).slice(0, 4))).toBe("glTF");
    const bytes = new Uint8Array([7]);
    const [delegated] = await buildExport("glb", project, model, {
      loadPdf: async () => () => new Uint8Array(),
      renderGlb: async () => bytes,
    });
    expect(delegated!.content).toBe(bytes);
  });

  it("le menu propose glTF, fiche de pose et PDF complet", () => {
    const labels = EXPORT_ENTRIES.map((e) => e.label);
    expect(labels).toContain("Modèle 3D glTF (.glb)");
    expect(labels).toContain("Fiche de pose (PDF)");
    expect(labels.some((l) => l.startsWith("Dossier PDF complet"))).toBe(true);
  });
});
