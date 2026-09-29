/**
 * Téléchargement d'un fichier produit dans le navigateur : `Blob` + lien `<a download>` cliqué
 * par programme (aucun dialogue modal). Plusieurs fichiers sont espacés pour que le navigateur
 * ne les regroupe ni ne les bloque.
 */
import type { FileContent } from "./optionalApi.js";

export interface DownloadableFile {
  readonly filename: string;
  readonly mime: string;
  readonly content: FileContent;
}

/** Contenu converti en `Blob` (les octets sont copiés : le tableau d'origine reste intact). */
export function toBlob(file: DownloadableFile): Blob {
  const c = file.content;
  if (c instanceof Blob) return c;
  if (typeof c === "string") return new Blob([c], { type: file.mime });
  const bytes = c instanceof Uint8Array ? new Uint8Array(c) : new Uint8Array(c.slice(0));
  return new Blob([bytes], { type: file.mime });
}

export function downloadFile(file: DownloadableFile): void {
  const url = URL.createObjectURL(toBlob(file));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Révocation différée : certains navigateurs lisent l'URL après le clic.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Délai entre deux téléchargements successifs (ms, présentation). */
export const DOWNLOAD_SPACING_MS = 300;

export function downloadFiles(files: readonly DownloadableFile[]): void {
  files.forEach((f, i) => {
    if (i === 0) downloadFile(f);
    else setTimeout(() => downloadFile(f), i * DOWNLOAD_SPACING_MS);
  });
}
