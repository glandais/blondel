/**
 * API du cœur et des exports branchées par l'interface :
 *
 * - `listStructures` (plugins de structure de `@blondel/core`, `wood-housed` et `wood-cut`
 *   enregistrés au chargement du cœur depuis le jalon 3a) : importée directement ; la liste est
 *   encapsulée pour que l'interface reste utilisable (structure « aucune » seule) si un plugin
 *   lève à l'énumération ;
 * - `exportPdf` (`@blondel/exports/pdf`, point d'entrée séparé à cause de jsPDF) : importée
 *   dynamiquement au premier export PDF, dans son propre morceau de code.
 */
import { listStructures } from "@blondel/core";
import type { Model, Project, StructureKind } from "@blondel/core";

/** Octets, texte ou `Blob` : toutes les formes de contenu de fichier acceptées. */
export type FileContent = string | Uint8Array | ArrayBuffer | Blob;

/**
 * Pages et format d'un dossier PDF (`PdfPages` et `format` de `@blondel/exports/pdf`) : clé
 * absente = page produite ; format absent = A4. Clonable (requête du worker).
 */
export interface PdfJobOptions {
  readonly pages?: Readonly<
    Partial<
      Record<
        | "toc"
        | "plan"
        | "elevation"
        | "installation"
        | "bom"
        | "cutsheet"
        | "compliance"
        | "flats"
        | "templates",
        boolean
      >
    >
  >;
  readonly format?: "a4" | "a3";
}

/** Signature attendue de `exportPdf` (synchrone ou asynchrone). */
export type ExportPdfFn = (
  model: Model,
  options?: { readonly project?: Project; readonly title?: string } & PdfJobOptions,
) => FileContent | Promise<FileContent>;

export interface OptionalApi {
  /** Plugins de structure enregistrés (`@blondel/core`). */
  readonly listStructures?: () => readonly StructureKind[];
}

type Namespace = Readonly<Record<string, unknown>>;

/** Fonction `name` de l'espace de noms, ou `undefined` si elle n'est pas exportée. */
export function pick<F>(ns: Namespace, name: string): F | undefined {
  const f = ns[name];
  return typeof f === "function" ? (f as F) : undefined;
}

/** Résout les fonctions facultatives dans un espace de noms donné (tests). */
export function resolveOptionalApi(coreNs: Namespace): OptionalApi {
  const listStructures = pick<OptionalApi["listStructures"]>(coreNs, "listStructures");
  return listStructures ? { listStructures } : {};
}

/** API effectivement liée : registre de structures du cœur. */
export const optionalApi: OptionalApi = { listStructures };

/**
 * Plugins de structure disponibles ; liste vide si `listStructures` n'est pas exporté ou lève
 * (seule la structure `none` est alors proposée).
 */
export function availableStructures(api: OptionalApi = optionalApi): readonly StructureKind[] {
  try {
    return api.listStructures?.() ?? [];
  } catch {
    return [];
  }
}

/** Charge `exportPdf` à la demande (jsPDF dans un morceau séparé). */
export async function loadExportPdf(): Promise<ExportPdfFn> {
  const { exportPdf } = await import("@blondel/exports/pdf");
  return exportPdf;
}
