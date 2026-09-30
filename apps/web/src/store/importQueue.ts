/**
 * File d'attente des imports de calque demandés par le menu « Importer » de la barre d'outils :
 * le fichier choisi (plan DXF ou image) est confié au composant d'import du plan « Site et
 * saisie » (`UnderlayImport`), qui le lit, demande l'échelle si besoin et l'enregistre dans le
 * projet. État d'interface seulement (jamais persisté).
 *
 * Le composant d'import vit dans le plan « Site et saisie », qui n'est affiché qu'avec un
 * modèle : tant que le modèle est en cours de calcul ou en échec, la demande reste en file et
 * `queuedImportMessage` dit pourquoi (QUESTIONS D1) ; elle est prise en charge dès que le
 * modèle est rétabli, ou abandonnée par `cancelUnderlayImport`.
 */
import { msg, type Message } from "@blondel/i18n";
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

/** Abandonne la demande en attente (bouton « Abandonner l'import »). */
export function cancelUnderlayImport(): void {
  importQueue.setState({ pending: null });
}

/**
 * Message affiché quand une demande d'import attend alors que le plan « Site et saisie » ne
 * peut pas l'accueillir : modèle en cours de calcul, en échec, ou disponible mais plan « Site
 * et saisie » non affiché (autre onglet choisi entre-temps) ; message explicite au lieu d'une
 * attente silencieuse. `hostShown` (défaut : `available`) : le plan « Site et saisie », qui
 * prend la demande, est-il affiché ? `null` : rien à signaler.
 */
export function queuedImportMessage(
  pending: PendingUnderlayImport | null,
  model: {
    readonly available: boolean;
    readonly computing: boolean;
    readonly hostShown?: boolean;
  },
): { readonly kind: "info" | "error"; readonly text: Message; readonly openHost?: true } | null {
  if (!pending) return null;
  const hostShown = model.hostShown ?? model.available;
  if (model.available && hostShown) return null;
  const what = msg(pending.kind === "dxf" ? "ui.lib.import.what.dxf" : "ui.lib.import.what.image", {
    name: pending.file.name,
  });
  if (model.available) {
    return { kind: "info", text: msg("ui.lib.import.queued.onPlan", { what }), openHost: true };
  }
  if (model.computing) {
    return { kind: "info", text: msg("ui.lib.import.queued.computing", { what }) };
  }
  return { kind: "error", text: msg("ui.lib.import.queued.failed", { what }) };
}
