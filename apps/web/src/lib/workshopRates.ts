/**
 * Barème d'atelier saisi dans l'interface (QUESTIONS A14, décision du 2026-09-29 ; CHALLENGE
 * A8 : barèmes séparés du projet) : taux horaire, temps unitaires, prix matière et finition
 * (`CostRates` du cœur, `workshop/costs.ts`). **Aucune valeur par défaut** ; tant que le barème
 * est incomplet, le comparateur n'affiche pas d'euros (règle du cœur, `variantCost`).
 *
 * Le barème vit hors du projet (stockage du navigateur, fichier JSON d'import / export) : il
 * n'entre ni dans l'autosauvegarde, ni dans le `.blondel.json`, ni dans l'historique. Il est
 * seulement fusionné, pour la comparaison des variantes, dans une **copie** du projet
 * (`withWorkshopRates`) : ses champs renseignés complètent ou remplacent ceux d'un profil
 * d'atelier porté par le projet (`Project.workshop.costs`, fichier importé).
 */
import { COST_TIME_FIELDS, CostRatesSchema, type CostRates, type Project } from "@blondel/core";

export type CostField = keyof CostRates;

export interface CostFieldInfo {
  readonly key: CostField;
  readonly label: string;
  readonly unit: string;
  /**
   * Champ exigé pour tout chiffrage (taux horaire et `COST_TIME_FIELDS` du cœur) ; sinon
   * selon les matériaux de la variante.
   */
  readonly always: boolean;
}

const always = (key: CostField): boolean =>
  key === "hourlyRate" || (COST_TIME_FIELDS as readonly string[]).includes(key);

/** Champs du barème, dans l'ordre du panneau. */
export const COST_FIELDS: readonly CostFieldInfo[] = (
  [
    { key: "hourlyRate", label: "Taux horaire", unit: "€ HT/h" },
    { key: "minutesPerCut", label: "Temps par coupe", unit: "min" },
    { key: "minutesPerWeldMeter", label: "Temps par mètre de cordon", unit: "min/m" },
    { key: "minutesPerBend", label: "Temps par pli", unit: "min" },
    { key: "minutesPerHole", label: "Temps par perçage", unit: "min" },
    { key: "minutesPerUniquePart", label: "Temps par pièce unique", unit: "min" },
    { key: "steelPricePerKg", label: "Prix de l'acier", unit: "€ HT/kg" },
    { key: "woodPricePerM3", label: "Prix du bois (débit)", unit: "€ HT/m³" },
    {
      key: "finishPricePerM2",
      label: "Finition (acier peint ou galvanisé)",
      unit: "€ HT/m²",
    },
  ] as const satisfies readonly Omit<CostFieldInfo, "always">[]
).map((f) => ({ ...f, always: always(f.key) }));

/** Barème sans champ vide (clés absentes plutôt que `undefined`). */
export function compactRates(rates: CostRates): CostRates {
  const out: Record<string, number> = {};
  for (const f of COST_FIELDS) {
    const v = rates[f.key];
    if (v !== undefined && Number.isFinite(v) && v >= 0) out[f.key] = v;
  }
  return out as CostRates;
}

/** Aucun champ renseigné ? */
export function isEmptyRates(rates: CostRates): boolean {
  return Object.keys(compactRates(rates)).length === 0;
}

/**
 * Champs exigés pour tout chiffrage encore vides (taux horaire et temps). Les prix matière et
 * la finition ne sont exigés que pour les variantes qui en ont (acier, bois, surfaces finies) :
 * le comparateur les signale variante par variante.
 */
export function missingRequiredRates(rates: CostRates): readonly CostFieldInfo[] {
  return COST_FIELDS.filter((f) => f.always && rates[f.key] === undefined);
}

/** Saisie d'un champ : nombre décimal ≥ 0 (virgule acceptée) ; vide = non renseigné. */
export function parseRateInput(
  text: string,
): { readonly ok: true; readonly value: number | undefined } | { readonly ok: false } {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return { ok: true, value: undefined };
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return { ok: false };
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? { ok: true, value: v } : { ok: false };
}

/** Barème avec un champ modifié (`undefined` : champ vidé). */
export function withRate(rates: CostRates, key: CostField, value: number | undefined): CostRates {
  const next: Record<string, number | undefined> = { ...rates, [key]: value };
  if (value === undefined) delete next[key];
  return compactRates(next as CostRates);
}

/** Format du fichier d'export du barème. */
export const RATES_FILE_FORMAT = "blondel-bareme-atelier";
export const RATES_FILE_NAME = "bareme-atelier.json";

/**
 * Fichier JSON du barème : un profil d'atelier partiel (`{ costs }`, forme de
 * `Project.workshop`), repérable par `format`, qu'on peut aussi coller dans un projet.
 */
export function ratesToJson(rates: CostRates): string {
  return `${JSON.stringify({ format: RATES_FILE_FORMAT, version: 1, costs: compactRates(rates) }, null, 2)}\n`;
}

/**
 * Lit un barème : fichier exporté par `ratesToJson`, profil d'atelier (`{ costs: … }`, ex.
 * section `workshop` d'un projet) ou barème nu. Valeurs validées par le schéma du cœur ;
 * clés inconnues ignorées ; aucune clé connue : erreur.
 */
export function parseRatesJson(
  text: string,
):
  | { readonly ok: true; readonly rates: CostRates }
  | { readonly ok: false; readonly error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Fichier JSON illisible." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "Objet JSON attendu." };
  }
  const obj = data as Record<string, unknown>;
  const workshop =
    typeof obj["workshop"] === "object" && obj["workshop"] !== null
      ? (obj["workshop"] as Record<string, unknown>)
      : undefined;
  const source = obj["costs"] ?? workshop?.["costs"] ?? obj;
  const parsed = CostRatesSchema.safeParse(source);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `Barème invalide${issue ? ` (${issue.path.join(".")} : nombre positif ou nul attendu)` : ""}.`,
    };
  }
  const rates = compactRates(parsed.data);
  if (isEmptyRates(rates)) return { ok: false, error: "Aucun champ de barème reconnu." };
  return { ok: true, rates };
}

const merged = new WeakMap<Project, { rates: CostRates; project: Project }>();

/**
 * Projet de la comparaison : le barème d'atelier fusionné dans une copie de son profil
 * d'atelier (champs renseignés prioritaires). Barème vide : le projet lui-même. Mémoïsé sur
 * l'identité du projet et du barème (les caches du comparateur servent).
 */
export function withWorkshopRates(project: Project, rates: CostRates): Project {
  const own = compactRates(rates);
  if (isEmptyRates(own)) return project;
  const hit = merged.get(project);
  if (hit && hit.rates === rates) return hit.project;
  const next: Project = {
    ...project,
    workshop: { ...project.workshop, costs: { ...project.workshop?.costs, ...own } },
  };
  merged.set(project, { rates, project: next });
  return next;
}

/**
 * Barème réellement appliqué au comparateur pour `project` (celui de `withWorkshopRates`) et
 * champs repris du profil d'atelier porté par le projet ouvert (fichier importé), faute de
 * valeur dans le panneau. L'état « complet / incomplet » du panneau se lit sur ce barème : un
 * projet qui porte déjà un barème affiche des euros même si le panneau est vide.
 */
export function effectiveRates(
  project: Project,
  rates: CostRates,
): { readonly rates: CostRates; readonly fromProject: readonly CostFieldInfo[] } {
  const own = compactRates(rates);
  const effective = compactRates(withWorkshopRates(project, own).workshop?.costs ?? {});
  return {
    rates: effective,
    fromProject: COST_FIELDS.filter(
      (f) => own[f.key] === undefined && effective[f.key] !== undefined,
    ),
  };
}
