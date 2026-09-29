/**
 * File d'attente des imports de calque demandés par le menu « Importer » de la barre d'outils :
 * le fichier choisi (plan DXF ou image) est confié au composant d'import du plan « Site et
 * saisie » (`UnderlayImport`), qui le lit, demande l'échelle si besoin et l'enregistre dans le
 * projet. État d'interface seulement (jamais persisté).
 */
import { createStore } from "zustand/vanilla";

export type UnderlayImportKind = "dxf" | "image";

export interface PendingUnderlayImport {
  readonly kind: UnderlayImportKind;
  readonly file: File;
  /** Numéro de la demande (deux imports du même fichier restent distincts). */
  readonly seq: number;
}

export interface ImportQueueState {
  readonly pending: PendingUnderlayImport | null;
}

export const importQueue = createStore<ImportQueueState>()(() => ({ pending: null }));

let seq = 0;

/** Dépose un fichier à importer comme calque. */
export function requestUnderlayImport(kind: UnderlayImportKind, file: File): void {
  importQueue.setState({ pending: { kind, file, seq: ++seq } });
}

/** Retire la demande en attente si c'est encore `request` (déjà prise en charge). */
export function takeUnderlayImport(request: PendingUnderlayImport): void {
  if (importQueue.getState().pending === request) importQueue.setState({ pending: null });
}
