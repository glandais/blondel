/**
 * Valeurs retenues par le calcul pour les paramètres en « auto » (`Model.autoValues`, exposé par
 * le cœur) : lecture seule, aucune grandeur calculée ici. Clé : chemin du projet joint par des
 * points, indices en clair (`stair.layout.legs.0.length`, `stair.structure.params.lowerOffset`).
 * Absente (modèle d'avant l'exposition, paramètre non automatique) : `undefined`, et le contrôle
 * « Auto | valeur » garde son libellé neutre.
 */
import type { Model } from "@blondel/core";

/** Clé de `Model.autoValues` d'un chemin du projet. */
export function autoValueKey(path: readonly (string | number)[]): string {
  return path.join(".");
}

/** Valeur retenue en mode Auto pour le paramètre `path`, si le modèle l'expose. */
export function autoValueOf(
  model: Pick<Model, "autoValues"> | null | undefined,
  path: readonly (string | number)[],
): number | undefined {
  const v = model?.autoValues?.[autoValueKey(path)];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
