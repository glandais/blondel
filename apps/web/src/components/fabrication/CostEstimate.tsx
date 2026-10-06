/**
 * Ligne « Coût estimé » du mode Fabrication (étape 7 de la spécification de contenu : « Coût
 * estimé, ou “Compléter le profil d'atelier” »).
 *
 * - Barème incomplet : lien « Compléter le profil d'atelier ({applied} / {total}) » qui ouvre le
 *   profil d'atelier (même remplissage que la ligne de l'inspecteur sans sélection) ; aucune
 *   comparaison n'est lancée.
 * - Barème complet : coût de la variante courante (ligne `current`) lu dans la comparaison des
 *   variantes (`useComparison`, calculée dans le worker), au format du comparateur ; « calcul… »
 *   pendant le calcul ; sans variante courante (projet sans structure), lien « Voir le coût dans
 *   le comparateur » (onglet Comparer). Aucun coût n'est calculé ici.
 */
import type { CostRates, Project } from "@blondel/core";
import type { Translator } from "@blondel/i18n";
import { useMemo } from "react";
import { useT } from "../../i18n/useT.js";
import { compareLines, type CompareOutcome } from "../../lib/variants.js";
import { COST_FIELDS, effectiveRates, missingRequiredRates } from "../../lib/workshopRates.js";
import { appStore, useApp, useComparison, useWorkshop } from "../../store/appStore.js";
import { openWorkshopDialog } from "../../store/uiStore.js";

/** Remplissage du barème réellement appliqué (projet + panneau du profil d'atelier). */
export interface CostProfileFill {
  /** Un champ obligatoire du barème manque : pas d'euros. */
  readonly incomplete: boolean;
  /** Champs renseignés. */
  readonly applied: number;
  /** Champs du barème. */
  readonly total: number;
}

/** Remplissage du barème : même lecture que la ligne « Coût estimé » de l'inspecteur 2d. */
export function costProfileFill(project: Project, rates: CostRates): CostProfileFill {
  const applied = effectiveRates(project, rates).rates;
  return {
    incomplete: missingRequiredRates(applied).length > 0,
    applied: COST_FIELDS.filter((f) => applied[f.key] !== undefined).length,
    total: COST_FIELDS.length,
  };
}

/**
 * Texte du coût de la variante courante, au format du comparateur (ligne « cost » de
 * `compareLines`) ; `null` si la comparaison n'a pas de ligne courante (« – » à l'affichage).
 */
export function currentCostText(outcome: CompareOutcome | null, t: Translator): string | null {
  const row = outcome?.rows.find((r) => r.current);
  if (!row) return null;
  return compareLines([row], t).find((l) => l.key === "cost")?.cells[0]?.text ?? null;
}

/** Coût de la variante courante (monté seulement si le barème est complet). */
function CostValue() {
  const t = useT();
  const { outcome, pending, project: computedFor, requested } = useComparison();
  const computing = pending || !outcome || computedFor !== requested;
  if (computing) {
    return (
      <span className="fab-cost__value muted" role="status">
        {t.t("ui.fabAside.cost.pending")}
      </span>
    );
  }
  const text = currentCostText(outcome, t);
  if (text === null) {
    // Aucune variante courante (projet sans structure…) : le comparateur chiffre chaque variante.
    return (
      <button type="button" className="link" onClick={() => appStore.getState().setView("compare")}>
        {t.t("ui.inspector.cost.openComparator")}
      </button>
    );
  }
  return <span className="fab-cost__value num">{text}</span>;
}

export function CostEstimate() {
  const t = useT();
  const project = useApp((s) => s.project);
  const rates = useWorkshop((s) => s.rates);
  const fill = useMemo(() => costProfileFill(project, rates), [project, rates]);
  return (
    <div className="fab-cost">
      <span className="fab-cost__label">{t.t("ui.inspector.cost.label")}</span>
      {fill.incomplete ? (
        <button type="button" className="link" onClick={openWorkshopDialog}>
          {t.t("ui.inspector.cost.completeProfile", {
            applied: String(fill.applied),
            total: String(fill.total),
          })}
        </button>
      ) : (
        <CostValue />
      )}
    </div>
  );
}
