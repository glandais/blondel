/**
 * Valeurs ◆ « à valider » du projet courant (ADR-0009 point 9), pour la liste à cocher, les
 * replis des sections et les compteurs. Lecture du projet (`useApp`) et du dernier modèle
 * calculé (`useModel`) ; les lignes viennent de `lib/toValidate.ts`.
 *
 * Mémoïsation au niveau du module, par identité du couple (projet, modèle) : tous les
 * composants qui lisent les lignes (replis de chaque section, réglages d'atelier, bande,
 * sorties, liste) partagent un seul calcul par modification, au lieu d'un `useMemo` chacun
 * (le calcul évalue les défauts du plugin de structure).
 */
import type { Model, Project } from "@blondel/core";
import { useMemo } from "react";
import { toValidateRows, type ToValidateRow } from "../../lib/toValidate.js";
import { useApp, useModel } from "../../store/appStore.js";

/** Clé du modèle absent (pas encore calculé). */
const NO_MODEL: object = {};

const cache = new WeakMap<Project, WeakMap<object, readonly ToValidateRow[]>>();

/** Lignes du couple (projet, modèle), calculées une fois par couple. */
export function cachedToValidateRows(
  project: Project,
  model: Model | null | undefined,
): readonly ToValidateRow[] {
  let byModel = cache.get(project);
  if (byModel === undefined) {
    byModel = new WeakMap();
    cache.set(project, byModel);
  }
  const key: object = model ?? NO_MODEL;
  let rows = byModel.get(key);
  if (rows === undefined) {
    rows = toValidateRows(project, model);
    byModel.set(key, rows);
  }
  return rows;
}

/** Lignes des valeurs ◆ du projet courant (validées comprises). */
export function useToValidateRows(): readonly ToValidateRow[] {
  const project = useApp((s) => s.project);
  const { model } = useModel();
  return cachedToValidateRows(project, model);
}

/** Clés (`paramKey`) des valeurs ◆ validées du projet courant. */
export function useValidatedKeys(): ReadonlySet<string> {
  const rows = useToValidateRows();
  return useMemo(() => new Set(rows.filter((r) => r.validated).map((r) => r.key)), [rows]);
}

/** Nombre de valeurs ◆ restantes (non validées). */
export function useRemainingCount(): number {
  const rows = useToValidateRows();
  return useMemo(() => rows.filter((r) => !r.validated).length, [rows]);
}
