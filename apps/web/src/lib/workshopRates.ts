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
import { msg, type Message, type MessageKey, type Translator } from "@blondel/i18n";

export type CostField = keyof CostRates;

export interface CostFieldInfo {
  readonly key: CostField;
  /** Clé du libellé, traduite à l'affichage (`t.t(f.labelKey)`). */
  readonly labelKey: MessageKey;
  /** Clé de l'unité (prix hors taxe), traduite à l'affichage. */
  readonly unitKey: MessageKey;
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
    {
      key: "hourlyRate",
      labelKey: "ui.lib.workshop.field.hourlyRate",
      unitKey: "ui.lib.workshop.unit.eurPerHour",
    },
    {
      key: "minutesPerCut",
      labelKey: "ui.lib.workshop.field.minutesPerCut",
      unitKey: "ui.lib.workshop.unit.min",
    },
    {
      key: "minutesPerWeldMeter",
      labelKey: "ui.lib.workshop.field.minutesPerWeldMeter",
      unitKey: "ui.lib.workshop.unit.minPerMetre",
    },
    {
      key: "minutesPerBend",
      labelKey: "ui.lib.workshop.field.minutesPerBend",
      unitKey: "ui.lib.workshop.unit.min",
    },
    {
      key: "minutesPerHole",
      labelKey: "ui.lib.workshop.field.minutesPerHole",
      unitKey: "ui.lib.workshop.unit.min",
    },
    {
      key: "minutesPerUniquePart",
      labelKey: "ui.lib.workshop.field.minutesPerUniquePart",
      unitKey: "ui.lib.workshop.unit.min",
    },
    {
      key: "steelPricePerKg",
      labelKey: "ui.lib.workshop.field.steelPricePerKg",
      unitKey: "ui.lib.workshop.unit.eurPerKg",
    },
    {
      key: "woodPricePerM3",
      labelKey: "ui.lib.workshop.field.woodPricePerM3",
      unitKey: "ui.lib.workshop.unit.eurPerM3",
    },
    {
      key: "finishPricePerM2",
      labelKey: "ui.lib.workshop.field.finishPricePerM2",
      unitKey: "ui.lib.workshop.unit.eurPerM2",
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

/** Nom du fichier d'export du barème, dans la langue d'affichage (« bareme-atelier.json »). */
export function ratesFileName(t: Translator): string {
  return `${t.t("ui.lib.workshop.fileName")}.json`;
}

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
  | { readonly ok: false; readonly error: Message } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: msg("ui.lib.workshop.error.unreadable") };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: msg("ui.lib.workshop.error.notObject") };
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
      error: issue
        ? msg("ui.lib.workshop.error.invalidField", { path: issue.path.join(".") })
        : msg("ui.lib.workshop.error.invalid"),
    };
  }
  const rates = compactRates(parsed.data);
  if (isEmptyRates(rates)) return { ok: false, error: msg("ui.lib.workshop.error.empty") };
  return { ok: true, rates };
}

const merged = new WeakMap<Project, { signature: string; project: Project }>();

/** Signature du contenu d'un barème compacté (un champ par champ, dans l'ordre du panneau). */
function ratesSignature(rates: CostRates): string {
  return COST_FIELDS.map((f) => rates[f.key] ?? "").join("|");
}

/**
 * Projet de la comparaison : le barème d'atelier fusionné dans une copie de son profil
 * d'atelier (champs renseignés prioritaires). Barème vide : le projet lui-même. Mémoïsé sur
 * l'identité du projet et le **contenu** du barème (les caches du comparateur servent).
 *
 * Le contenu, et non l'identité de l'objet `rates` : `effectiveRates` passe une copie compactée
 * du barème du store. Avec une mémoïsation par identité, cette copie remplaçait l'entrée du
 * cache, et `useComparison` (qui passe l'objet du store) obtenait à chaque appel une nouvelle
 * copie du projet : le résultat de la comparaison, rattaché à la copie précédente, n'était
 * jamais reconnu (« calcul… » sans fin dans le rendu serveur de la ligne « Coût estimé »).
 */
export function withWorkshopRates(project: Project, rates: CostRates): Project {
  const own = compactRates(rates);
  if (isEmptyRates(own)) return project;
  const signature = ratesSignature(own);
  const hit = merged.get(project);
  if (hit && hit.signature === signature) return hit.project;
  const next: Project = {
    ...project,
    workshop: { ...project.workshop, costs: { ...project.workshop?.costs, ...own } },
  };
  merged.set(project, { signature, project: next });
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
