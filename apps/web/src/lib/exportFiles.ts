/**
 * Fichiers proposés par le menu « Exporter » (plans, liste de débit, dossiers PDF complet ou sans
 * gabarits, fiche de pose, DXF des pièces, modèle 3D glTF) : chaque export est une fonction pure
 * `(projet, modèle) → fichier(s)` qui appelle `@blondel/exports` (aucune cotation ni règle ici).
 * Le téléchargement lui-même (Blob + lien) est dans `download.ts`.
 *
 * Versions DXF (décision utilisateur du 2026-09-28, CHALLENGE P6) : plans cotés en AC1021
 * (2007) par défaut, R12 proposé ; pièces en R12.
 *
 * Dossier PDF (QUESTIONS A20, décision du 2026-09-29) : « complet » garde tous les gabarits
 * 1:1 ; trois dossiers filtrés ne tuilent que les gabarits d'une famille (limons et structure,
 * marches, garde-corps : `templateFamily` de `@blondel/exports`) ; recouvrement des cases fixe
 * (10 mm, `DEFAULT_TILE_OVERLAP`), sans réglage.
 */
import type { Model, Part, Project } from "@blondel/core";
import {
  DEFAULT_PART_DXF_VERSION,
  DEFAULT_PLAN_DXF_VERSION,
  GLB_MIME,
  createZip,
  exportGlb,
  exportCutListCsv,
  massNoteFor,
  exportPartDxf,
  exportPartsDxf,
  exportPlanDxf,
  exportProjectJson,
  renderElevationSvg,
  renderPlanSvg,
  safeFileStem,
  templateFamily,
  type TemplateFamily,
} from "@blondel/exports";
import { PROJECT_FILE_SUFFIX, projectFileName } from "../store/persistence.js";
import {
  loadExportPdf,
  type ExportPdfFn,
  type FileContent,
  type PdfJobOptions,
} from "./optionalApi.js";

/** Dépendances injectables : chargement du module PDF, mise en page déléguée (worker). */
export interface ExportDeps {
  readonly loadPdf: () => Promise<ExportPdfFn>;
  /**
   * Mise en page du dossier PDF hors du fil principal (worker de calcul) : fournie par
   * l'interface, elle remplace `loadPdf` (plusieurs centaines de millisecondes de calcul
   * synchrone sinon, qui figeaient la page).
   */
  readonly renderPdf?: (
    project: Project,
    model: Model,
    options?: PdfJobOptions,
  ) => Promise<FileContent>;
  /**
   * Modèle glTF hors du fil principal (worker de calcul) ; absent : `exportGlb` sur le fil
   * principal.
   */
  readonly renderGlb?: (project: Project, model: Model) => Promise<FileContent>;
}

export const DEFAULT_EXPORT_DEPS: ExportDeps = { loadPdf: loadExportPdf };

export interface ExportFile {
  readonly filename: string;
  readonly mime: string;
  readonly content: FileContent;
}

export type ExportId =
  | "project-json"
  | "plan-svg"
  | "plan-dxf"
  | "plan-dxf-r12"
  | "elevation-svg"
  | "cutlist-csv"
  | "pdf"
  | "pdf-a3"
  | "pdf-light"
  | "pdf-stringers"
  | "pdf-treads"
  | "pdf-guards"
  | "installation-pdf"
  | "glb"
  | "parts-dxf";

export interface ExportEntry {
  readonly id: ExportId;
  readonly label: string;
  /** Le modèle est-il nécessaire (tous sauf le projet JSON) ? */
  readonly needsModel: boolean;
}

export const EXPORT_ENTRIES: readonly ExportEntry[] = [
  { id: "project-json", label: "Projet (.blondel.json)", needsModel: false },
  { id: "plan-svg", label: "Plan coté (SVG)", needsModel: true },
  { id: "plan-dxf", label: "Plan coté (DXF 2007 / AC1021)", needsModel: true },
  { id: "plan-dxf-r12", label: "Plan coté (DXF R12)", needsModel: true },
  { id: "elevation-svg", label: "Élévation (SVG)", needsModel: true },
  { id: "cutlist-csv", label: "Liste de débit (CSV)", needsModel: true },
  { id: "pdf", label: "Dossier PDF complet (gabarits 1:1 en A4)", needsModel: true },
  { id: "pdf-a3", label: "Dossier PDF complet (gabarits 1:1 en A3)", needsModel: true },
  {
    id: "pdf-stringers",
    label: "Dossier PDF, gabarits 1:1 des limons et de la structure (A4)",
    needsModel: true,
  },
  { id: "pdf-treads", label: "Dossier PDF, gabarits 1:1 des marches (A4)", needsModel: true },
  {
    id: "pdf-guards",
    label: "Dossier PDF, gabarits 1:1 des garde-corps (A4)",
    needsModel: true,
  },
  { id: "pdf-light", label: "Dossier PDF sans gabarits", needsModel: true },
  { id: "installation-pdf", label: "Fiche de pose (PDF)", needsModel: true },
  { id: "parts-dxf", label: "DXF des pièces (R12)", needsModel: true },
  { id: "glb", label: "Modèle 3D glTF (.glb)", needsModel: true },
];

/** Dossiers PDF filtrés par famille de gabarits (QUESTIONS A20). */
export const PDF_FAMILY_JOBS: Readonly<
  Record<"pdf-stringers" | "pdf-treads" | "pdf-guards", TemplateFamily>
> = {
  "pdf-stringers": "stringers",
  "pdf-treads": "treads",
  "pdf-guards": "guards",
};

type PdfJobId = "pdf" | "pdf-a3" | "pdf-light" | "installation-pdf" | keyof typeof PDF_FAMILY_JOBS;

/**
 * Pages et format de chaque dossier PDF (`@blondel/exports/pdf`) : complet = toutes les pages,
 * gabarits 1:1 tuilés en A4 ou A3 ; gabarits d'une seule famille (A4) ; sans gabarits ; fiche
 * de pose seule.
 */
export const PDF_JOBS: Readonly<Record<PdfJobId, { suffix: string; options: PdfJobOptions }>> = {
  pdf: { suffix: "", options: {} },
  "pdf-a3": { suffix: "-a3", options: { format: "a3" } },
  "pdf-stringers": {
    suffix: "-gabarits-limons",
    options: { templateFamilies: [PDF_FAMILY_JOBS["pdf-stringers"]] },
  },
  "pdf-treads": {
    suffix: "-gabarits-marches",
    options: { templateFamilies: [PDF_FAMILY_JOBS["pdf-treads"]] },
  },
  "pdf-guards": {
    suffix: "-gabarits-garde-corps",
    options: { templateFamilies: [PDF_FAMILY_JOBS["pdf-guards"]] },
  },
  "pdf-light": { suffix: "-sans-gabarits", options: { pages: { templates: false } } },
  "installation-pdf": {
    suffix: "-fiche-de-pose",
    options: {
      pages: {
        toc: false,
        plan: false,
        elevation: false,
        installation: true,
        bom: false,
        cutsheet: false,
        compliance: false,
        flats: false,
        templates: false,
      },
    },
  },
};

export const MIME = {
  json: "application/json",
  svg: "image/svg+xml",
  dxf: "application/dxf",
  csv: "text/csv;charset=utf-8",
  pdf: "application/pdf",
  zip: "application/zip",
  glb: GLB_MIME,
} as const;

/** Radical de nom de fichier dérivé du nom du projet (sans accents ni espaces). */
export function fileStem(projectName: string): string {
  return projectFileName(projectName).slice(0, -PROJECT_FILE_SUFFIX.length);
}

/** Pièces qui ont un développé à plat (seules exportables en DXF de pièce). */
export function partsWithFlat(model: Pick<Model, "parts">): readonly Part[] {
  return model.parts.filter((p) => p.flat !== undefined);
}

/** Nom de fichier portable d'une pièce (repère, sinon identifiant), règle de `@blondel/exports`. */
export function partFileStem(part: Part): string {
  return safeFileStem(part.mark || part.id);
}

/** DXF R12 d'une seule pièce (lève `RangeError` si elle n'a pas de développé). */
export function partDxfFile(part: Part, stem: string): ExportFile {
  return {
    filename: `${stem}-${partFileStem(part)}.dxf`,
    mime: MIME.dxf,
    content: exportPartDxf(part, { version: DEFAULT_PART_DXF_VERSION }),
  };
}

/**
 * DXF R12 de toutes les pièces à développé (`exportPartsDxf` : un fichier par repère, quantité
 * dans le fichier), regroupés dans une archive ZIP (`createZip`) ; un seul fichier : téléchargé
 * tel quel. Liste vide : aucune pièce n'a de développé.
 */
export function partsDxfFiles(model: Pick<Model, "parts">, stem: string): ExportFile[] {
  const files = exportPartsDxf(model, { version: DEFAULT_PART_DXF_VERSION });
  if (files.length === 0) return [];
  if (files.length === 1) {
    const f = files[0]!;
    return [{ filename: `${stem}-${f.filename}`, mime: MIME.dxf, content: f.content }];
  }
  const zip = createZip(files.map((f) => ({ name: f.filename, data: f.content })));
  return [{ filename: `${stem}-pieces-dxf.zip`, mime: MIME.zip, content: zip }];
}

/** Un export est-il disponible (modèle calculé, pièces à développé) ? Motif sinon. */
export function exportAvailability(
  id: ExportId,
  model: Model | null,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (id === "project-json") return { ok: true };
  if (!model) return { ok: false, reason: "Aucun modèle calculé." };
  if (id === "pdf-stringers" || id === "pdf-treads" || id === "pdf-guards") {
    const family = PDF_FAMILY_JOBS[id];
    if (!partsWithFlat(model).some((p) => templateFamily(p) === family)) {
      return { ok: false, reason: "Aucune pièce de cette famille n'a de développé (gabarit 1:1)." };
    }
  }
  if (id === "parts-dxf" && partsWithFlat(model).length === 0) {
    return {
      ok: false,
      reason: "Aucune pièce n'a de développé à plat (choisir une structure qui en produit).",
    };
  }
  return { ok: true };
}

/**
 * Produit le ou les fichiers d'un export. Lève si le rendu échoue (l'appelant affiche le
 * message) ; `pdf` peut être asynchrone.
 */
export async function buildExport(
  id: ExportId,
  project: Project,
  model: Model | null,
  deps: ExportDeps = DEFAULT_EXPORT_DEPS,
): Promise<ExportFile[]> {
  const stem = fileStem(project.name);
  if (id === "project-json") {
    return [
      {
        filename: projectFileName(project.name),
        mime: MIME.json,
        content: exportProjectJson(project),
      },
    ];
  }
  const avail = exportAvailability(id, model);
  if (!avail.ok) throw new Error(avail.reason);
  const m = model as Model;
  const svgOptions = { project, theme: "light" as const, background: true, title: project.name };
  switch (id) {
    case "plan-svg":
      return [
        { filename: `${stem}-plan.svg`, mime: MIME.svg, content: renderPlanSvg(m, svgOptions) },
      ];
    case "elevation-svg":
      return [
        {
          filename: `${stem}-elevation.svg`,
          mime: MIME.svg,
          content: renderElevationSvg(m, svgOptions),
        },
      ];
    case "plan-dxf":
      return [
        {
          filename: `${stem}-plan.dxf`,
          mime: MIME.dxf,
          content: exportPlanDxf(m, { project, version: DEFAULT_PLAN_DXF_VERSION }),
        },
      ];
    case "plan-dxf-r12":
      return [
        {
          filename: `${stem}-plan-r12.dxf`,
          mime: MIME.dxf,
          content: exportPlanDxf(m, { project, version: "R12" }),
        },
      ];
    case "cutlist-csv":
      return [
        {
          filename: `${stem}-debit.csv`,
          mime: MIME.csv,
          content: exportCutListCsv(m, { massNote: massNoteFor(project.workshop) }),
        },
      ];
    case "pdf":
    case "pdf-a3":
    case "pdf-light":
    case "pdf-stringers":
    case "pdf-treads":
    case "pdf-guards":
    case "installation-pdf": {
      const { suffix, options } = PDF_JOBS[id];
      const filename = `${stem}${suffix}.pdf`;
      if (deps.renderPdf) {
        return [{ filename, mime: MIME.pdf, content: await deps.renderPdf(project, m, options) }];
      }
      const exportPdf = await deps.loadPdf();
      const content = await exportPdf(m, { project, title: project.name, ...options });
      return [{ filename, mime: MIME.pdf, content }];
    }
    case "glb": {
      const content = deps.renderGlb
        ? await deps.renderGlb(project, m)
        : exportGlb(m, { project, title: project.name });
      return [{ filename: `${stem}.glb`, mime: MIME.glb, content }];
    }
    case "parts-dxf":
      return partsDxfFiles(m, stem);
  }
}
