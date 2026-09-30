/**
 * Règles de rules.yaml **non évaluables** sur le modèle, avec leur motif (ADR-0004) : la donnée
 * manque (finitions, sol du palier haut, relevé du gros œuvre) ou la vérification sort du
 * contrôle de conception (résistance, tolérance d'exécution). Le moteur les rend
 * `non-evaluee` avec ce motif (et une information utile quand la table la donne : charge à
 * reprendre, tolérance admissible) au lieu du message générique « sans évaluateur ».
 *
 * Ce ne sont pas des évaluateurs : elles restent comptées dans `ruleCoverage().notImplemented`.
 */
import { stairLoads, resolveCategory } from "../../precheck/loads.js";
import { PrecheckSettingsSchema, type PrecheckSettings } from "../../precheck/settings.js";
import { fmt } from "../check.js";
import { ruleParam } from "../table.js";
import type { EvaluatorContext } from "../types.js";

/** Motif de non-évaluation (peut dépendre du projet). */
export type UnevaluatedReason = (ctx: EvaluatorContext) => string;

/** Réglages du prédimensionnement de la structure (`params.precheck`), défauts sinon. */
function precheckSettings(ctx: EvaluatorContext): Partial<PrecheckSettings> {
  const params = ctx.project.stair.structure.params as
    Readonly<Record<string, unknown>> | undefined;
  const parsed = PrecheckSettingsSchema.safeParse(params?.["precheck"] ?? {});
  return parsed.success ? parsed.data : {};
}

const loadsInfo: UnevaluatedReason = (ctx) => {
  // Annexe nationale (SPEC X16) : valeurs de la règle, quel que soit le jeu du prédimensionnement.
  const settings: PrecheckSettings = {
    ...PrecheckSettingsSchema.parse({}),
    ...precheckSettings(ctx),
    loadSet: "AN",
  };
  const contexts = [...ctx.contexts];
  const category = resolveCategory(settings, contexts);
  const l = stairLoads(settings, contexts);
  return `Information : charges d'exploitation q_k = ${fmt(l.qk, 1)} kN/m², Q_k = ${fmt(l.Qk, 1)} kN (catégorie ${category}${settings.category === "auto" ? ", déduite des contextes" : ""}), données d'entrée du prédimensionnement indicatif des limons (Model.precheck) ; la résistance de l'escalier n'est pas vérifiée par le contrôle de conception.`;
};

export const UNEVALUATED_REASONS: Readonly<Record<string, UnevaluatedReason>> = {
  NEZ_CONTRASTE: (ctx) =>
    `Non évaluée : le contraste visuel (au moins ${fmt(ctx.rule.min ?? Number.NaN, 0)} mm à l'horizontale) et le caractère non glissant des nez dépendent de la finition (revêtement, bande de nez), absente du modèle ; à vérifier au choix des finitions.`,
  BANDE_EVEIL: (ctx) =>
    `Non évaluée : le revêtement d'éveil de vigilance se pose sur le sol du palier haut, hors du modèle de l'escalier ; à prévoir à ${fmt(ctx.rule.max ?? Number.NaN, 0)} mm de la première marche descendante (réductible à un giron si la configuration l'impose).`,
  CHARGE_ESCALIER_A: loadsInfo,
  CHARGE_ESCALIER_AUTRES: loadsInfo,
  CHARGE_MARCHE_INDUSTRIEL: (ctx) =>
    `Non évaluée : flèche des marches sous la charge de ${fmt(ruleParam(ctx.rule, "charge_nez"), 1)} kN au nez non calculée (le prédimensionnement ne porte que sur les limons) ; exigence : flèche ≤ min(portée / ${fmt(ruleParam(ctx.rule, "portee_sur_fleche"), 0)} ; ${fmt(ctx.rule.max ?? Number.NaN, 0)} mm).`,
  DEFORMATION_CINTRAGE: (ctx) =>
    `Non évaluée : tolérance d'exécution sur les pièces livrées (cintrage ≤ ${fmt(ctx.rule.max ?? Number.NaN, 0)} mm/m, balustres ${fmt(ruleParam(ctx.rule, "max_balustres"), 0)} mm/m), qui se mesure à la réception ; sans objet pour la conception.`,
  TREMIE_TOLERANCE: (ctx) =>
    `Non évaluée : l'écart d'implantation et de dimensions de la trémie finie (${fmt(ctx.rule.min ?? Number.NaN, 0)} à +${fmt(ctx.rule.max ?? Number.NaN, 0)} mm) se constate sur le gros œuvre ; le modèle ne porte que la trémie saisie, et la façon de l'intégrer comme jeu de conception n'est pas décrite par la recherche (A-regles §1.7).`,
  HAUTEUR_ETAGE_TOLERANCE: (ctx) => {
    const H = ctx.project.site.floorToFloor;
    const threshold = ruleParam(ctx.rule, "H_seuil");
    const tol =
      H <= threshold
        ? (ctx.rule.max ?? Number.NaN)
        : ruleParam(ctx.rule, "coefficient_au_dela") * Math.cbrt(H / 1000);
    return `Information : tolérance admissible sur la hauteur à monter H = ${fmt(H, 0)} mm : ± ${fmt(tol, 1)} mm${H > threshold ? ` (au-delà de ${fmt(threshold, 0)} mm : ± ${fmt(ruleParam(ctx.rule, "coefficient_au_dela"), 0)} · H^(1/3), H en m, interprétation A-regles §1.7)` : ""}. Non évaluée : l'écart réel se constate au relevé du gros œuvre, absent du modèle (une seule hauteur à monter saisie).`;
  },
};
