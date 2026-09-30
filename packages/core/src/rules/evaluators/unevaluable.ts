/**
 * Règles de rules.yaml **non évaluables** sur le modèle, avec leur motif (ADR-0004) : la donnée
 * manque (finitions, sol du palier haut, relevé du gros œuvre) ou la vérification sort du
 * contrôle de conception (résistance, tolérance d'exécution). Le moteur les rend
 * `non-evaluee` avec ce motif (et une information utile quand la table la donne : charge à
 * reprendre, tolérance admissible) au lieu du message générique « sans évaluateur ».
 *
 * Ce ne sont pas des évaluateurs : elles restent comptées dans `ruleCoverage().notImplemented`.
 */
import { dec, msg, type Message } from "@blondel/i18n";
import { stairLoads, resolveCategory } from "../../precheck/loads.js";
import { PrecheckSettingsSchema, type PrecheckSettings } from "../../precheck/settings.js";
import { ruleParam } from "../table.js";
import type { EvaluatorContext } from "../types.js";

/** Motif de non-évaluation (peut dépendre du projet). */
export type UnevaluatedReason = (ctx: EvaluatorContext) => Message;

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
  return msg(
    settings.category === "auto"
      ? "compliance.unevaluable.loadsDeduced"
      : "compliance.unevaluable.loads",
    { qk: dec(l.qk, 1), Qk: dec(l.Qk, 1), category },
  );
};

/** Borne de la règle, arrondie au mm (absente de la table : « — »). */
const bound = (v: number | null, digits = 0) => dec(v ?? Number.NaN, digits);

export const UNEVALUATED_REASONS: Readonly<Record<string, UnevaluatedReason>> = {
  NEZ_CONTRASTE: (ctx) => msg("rules.NEZ_CONTRASTE.notEvaluated", { min: bound(ctx.rule.min) }),
  BANDE_EVEIL: (ctx) => msg("rules.BANDE_EVEIL.notEvaluated", { max: bound(ctx.rule.max) }),
  CHARGE_ESCALIER_A: loadsInfo,
  CHARGE_ESCALIER_AUTRES: loadsInfo,
  CHARGE_MARCHE_INDUSTRIEL: (ctx) =>
    msg("rules.CHARGE_MARCHE_INDUSTRIEL.notEvaluated", {
      load: dec(ruleParam(ctx.rule, "charge_nez"), 1),
      ratio: dec(ruleParam(ctx.rule, "portee_sur_fleche"), 0),
      max: bound(ctx.rule.max),
    }),
  DEFORMATION_CINTRAGE: (ctx) =>
    msg("rules.DEFORMATION_CINTRAGE.notEvaluated", {
      max: bound(ctx.rule.max),
      balusters: dec(ruleParam(ctx.rule, "max_balustres"), 0),
    }),
  TREMIE_TOLERANCE: (ctx) =>
    msg("rules.TREMIE_TOLERANCE.notEvaluated", {
      min: bound(ctx.rule.min),
      max: bound(ctx.rule.max),
    }),
  HAUTEUR_ETAGE_TOLERANCE: (ctx) => {
    const H = ctx.project.site.floorToFloor;
    const threshold = ruleParam(ctx.rule, "H_seuil");
    const tol =
      H <= threshold
        ? (ctx.rule.max ?? Number.NaN)
        : ruleParam(ctx.rule, "coefficient_au_dela") * Math.cbrt(H / 1000);
    if (H <= threshold)
      return msg("rules.HAUTEUR_ETAGE_TOLERANCE.info", { H: dec(H, 0), tolerance: dec(tol, 1) });
    return msg("rules.HAUTEUR_ETAGE_TOLERANCE.infoAbove", {
      H: dec(H, 0),
      tolerance: dec(tol, 1),
      threshold: dec(threshold, 0),
      coefficient: dec(ruleParam(ctx.rule, "coefficient_au_dela"), 0),
    });
  },
};
