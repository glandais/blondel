import { isMessageError, translatorFor, type MessageError } from "@blondel/i18n";
import { buildModel, createDemoProject, createProject, type Model, type Part } from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  EXPORT_ENTRIES,
  MIME,
  PDF_JOBS,
  buildDossierPdf,
  buildExport,
  dossierPdfJob,
  fileSuffix,
  exportAvailability,
  fileStem,
  partDxfFile,
  partsDxfFiles,
  partsWithFlat,
} from "./exportFiles.js";
import type { ExportDeps } from "./exportFiles.js";
import type { PdfJobOptions } from "./optionalApi.js";
import { toValidateDocRows } from "./toValidate.js";

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

const FR = translatorFor("fr");

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

  it("export indisponible : `MessageError` (motif traduit à l'affichage, pas figé)", async () => {
    const error = await buildExport("plan-svg", project, null, undefined, "en").catch(
      (e: unknown) => e,
    );
    expect(isMessageError(error)).toBe(true);
    expect((error as MessageError).msg.key).toBe("ui.label.export.noModel");
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
    // Dossiers : leurs options et les valeurs ◆ du projet ; fiche de pose : ni page ni lignes.
    const rows = toValidateDocRows(project, model, FR);
    expect(seen[0]).toEqual({ toValidate: rows });
    expect(seen[1]).toEqual({ format: "a3", toValidate: rows });
    expect(seen[2]).toEqual({ pages: { templates: false }, toValidate: rows });
    const pose = seen[3] as { pages: Record<string, boolean>; toValidate?: unknown };
    expect(pose.toValidate).toBeUndefined();
    expect(pose.pages["toValidate"]).toBe(false);
    expect(pose.pages["installation"]).toBe(true);
    expect(
      Object.entries(pose.pages)
        .filter(([, v]) => v)
        .map(([k]) => k),
    ).toEqual(["installation"]);
  });

  it("dossiers filtrés par famille de gabarits (QUESTIONS A20) : A4, une famille chacun", async () => {
    const seen: unknown[] = [];
    const deps: ExportDeps = {
      loadPdf: async () => () => new Uint8Array(),
      renderPdf: async (_p, _m, options) => {
        seen.push(options);
        return new Uint8Array([1]);
      },
    };
    // Démo industrielle (plat découpé, marches en tôle) : limons et marches à développé.
    const industrial = createDemoProject("demo-half-turn-industrial");
    const m = buildModel(industrial);
    const names: string[] = [];
    for (const id of ["pdf-stringers", "pdf-treads"] as const) {
      expect(exportAvailability(id, m).ok, id).toBe(true);
      const [f] = await buildExport(id, industrial, m, deps);
      names.push(f!.filename);
    }
    expect(seen).toMatchObject([
      { templateFamilies: ["stringers"] },
      { templateFamilies: ["treads"] },
    ]);
    expect(names[0]).toMatch(/-gabarits-limons\.pdf$/);
    expect(names[1]).toMatch(/-gabarits-marches\.pdf$/);
    // Le dossier complet garde tous les gabarits (aucun filtre transmis).
    expect(PDF_JOBS.pdf.options.templateFamilies).toBeUndefined();
    expect(PDF_JOBS["pdf-a3"].options.templateFamilies).toBeUndefined();
    // Famille sans développé (garde-corps : aucun développé à ce jour) : entrée indisponible.
    const none = exportAvailability("pdf-guards", m);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(FR.t(none.reason)).toMatch(/famille/);
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
    const labels = EXPORT_ENTRIES.map((e) => FR.t(e.label));
    expect(labels).toContain("Modèle 3D glTF (.glb)");
    expect(labels).toContain("Fiche de pose (PDF)");
    expect(labels.some((l) => l.startsWith("Dossier PDF complet"))).toBe(true);
  });
});

describe("dossier PDF du mode Fabrication : format × gabarits, valeurs ◆", () => {
  /** Options reçues par la mise en page (worker simulé). */
  function recorder(): { deps: ExportDeps; seen: PdfJobOptions[] } {
    const seen: PdfJobOptions[] = [];
    return {
      seen,
      deps: {
        loadPdf: async () => () => new Uint8Array(),
        renderPdf: async (_p, _m, options) => {
          seen.push(options ?? {});
          return new Uint8Array([1]);
        },
      },
    };
  }

  it("A4 / A3 × tous, une famille, aucun : options et suffixes", () => {
    const formats = ["a4", "a3"] as const;
    const templates = ["all", "stringers", "treads", "guards", "none"] as const;
    const names = new Set<string>();
    for (const f of formats) {
      for (const tpl of templates) {
        const job = dossierPdfJob(f, tpl);
        expect(job.options.format, `${f} ${tpl}`).toBe(f === "a3" ? "a3" : undefined);
        if (tpl === "all") {
          expect(job.options.templateFamilies).toBeUndefined();
          expect(job.options.pages).toBeUndefined();
        } else if (tpl === "none") {
          expect(job.options.pages).toEqual({ templates: false });
        } else {
          expect(job.options.templateFamilies).toEqual([tpl]);
        }
        names.add(fileSuffix(job.suffix, FR));
      }
    }
    // Dix combinaisons, dix noms de fichiers distincts.
    expect(names.size).toBe(10);
    expect(fileSuffix(dossierPdfJob("a4", "all").suffix, FR)).toBe("");
    expect(fileSuffix(dossierPdfJob("a3", "all").suffix, FR)).toBe("-a3");
    expect(fileSuffix(dossierPdfJob("a3", "stringers").suffix, FR)).toBe("-gabarits-limons-a3");
    expect(fileSuffix(dossierPdfJob("a4", "none").suffix, FR)).toBe(
      fileSuffix(PDF_JOBS["pdf-light"].suffix, FR),
    );
  });

  it("dossiers du menu = combinaisons du formulaire (même suffixe, mêmes options)", () => {
    expect(PDF_JOBS.pdf).toEqual(dossierPdfJob("a4", "all"));
    expect(PDF_JOBS["pdf-a3"]).toEqual(dossierPdfJob("a3", "all"));
    expect(PDF_JOBS["pdf-light"]).toEqual(dossierPdfJob("a4", "none"));
    expect(PDF_JOBS["pdf-stringers"]).toEqual(dossierPdfJob("a4", "stringers"));
    expect(PDF_JOBS["pdf-treads"]).toEqual(dossierPdfJob("a4", "treads"));
    expect(PDF_JOBS["pdf-guards"]).toEqual(dossierPdfJob("a4", "guards"));
  });

  it("valeurs ◆ transmises (validées et restantes), dans la langue du dossier", async () => {
    const industrial = createDemoProject("demo-half-turn-industrial");
    const m = buildModel(industrial);
    const fr = toValidateDocRows(industrial, m, FR);
    expect(fr.length).toBeGreaterThan(0);
    const { deps, seen } = recorder();
    const [file] = await buildDossierPdf(industrial, m, dossierPdfJob("a3", "treads"), deps, "fr");
    expect(file!.filename).toMatch(/-gabarits-marches-a3\.pdf$/);
    expect(seen[0]).toEqual({ format: "a3", templateFamilies: ["treads"], toValidate: fr });
    const [en] = await buildDossierPdf(industrial, m, dossierPdfJob("a4", "all"), deps, "en");
    expect(en!.filename).toMatch(/\.pdf$/);
    expect(seen[1]!.toValidate).toEqual(toValidateDocRows(industrial, m, translatorFor("en")));
  });

  it("module PDF chargé sur le fil principal : mêmes options, lignes ◆ comprises", async () => {
    const seen: unknown[] = [];
    const deps: ExportDeps = {
      loadPdf: async () => (_m, o) => {
        seen.push(o);
        return new Uint8Array([1]);
      },
    };
    await buildDossierPdf(project, model, dossierPdfJob("a4", "none"), deps);
    expect(seen[0]).toMatchObject({
      project,
      title: project.name,
      locale: "fr",
      pages: { templates: false },
      toValidate: toValidateDocRows(project, model, FR),
    });
    await buildExport("installation-pdf", project, model, deps);
    expect(seen[1]).not.toHaveProperty("toValidate");
  });

  it("sans modèle, ou famille de gabarits sans développé : `MessageError`", async () => {
    const { deps, seen } = recorder();
    const noModel = await buildDossierPdf(project, null, dossierPdfJob("a4", "all"), deps).catch(
      (e: unknown) => e,
    );
    expect((noModel as MessageError).msg.key).toBe("ui.label.export.noModel");
    const noFlat = await buildDossierPdf(
      project,
      model,
      dossierPdfJob("a4", "stringers"),
      deps,
    ).catch((e: unknown) => e);
    expect(isMessageError(noFlat)).toBe(true);
    expect((noFlat as MessageError).msg.key).toBe("ui.label.export.noFamilyFlat");
    expect(seen).toHaveLength(0);
  });
});
