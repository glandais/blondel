/**
 * Corrections proposées (`suggestFixes`) : actions que l'interface peut offrir à l'utilisateur
 * face à une erreur ou un avertissement du modèle, chacune avec un libellé et un **patch** de
 * projet (fusion profonde, tableaux remplacés en bloc, voir `deepMerge`). Fonction pure : aucune
 * action n'est appliquée ; l'appelant applique `deepMerge(project, fix.patch)` puis revalide.
 *
 * Corrections actuelles :
 * - **jour à angle vif avec une structure à poteau** (`wood-housed`, `steel-flat`,
 *   `steel-profile` : les limons de jour se rencontreraient en un point et ne sont pas
 *   générés) → passer les jours vifs en poteau d'angle de `DEFAULT_NEWEL_SIZE` ;
 * - **garde-corps en conflit avec la dalle haute** (`GC_CONFLIT_DALLE`, trémie rectangulaire au
 *   nu de l'escalier) → élargir la trémie le long des bords de l'escalier ;
 * - **jour trop étroit pour un garde-corps de jour** (erreur des garde-corps) → régler le côté
 *   jour des garde-corps sur « mur ».
 */
import type { Model } from "../model/derived.js";
import { ProjectSchema, type Project, type ProjectInput } from "../model/project.js";
import { LayoutError } from "../layout/errors.js";
import { computeLayout } from "../layout/layout.js";
import { GuardsSpecSchema } from "../guards/spec.js";
import { NARROW_JOUR_ERROR_PREFIX } from "../guards/jour.js";
import { sectionWidth } from "../guards/parts.js";
import {
  deepMerge,
  growAlongStairEdges,
  PRESET_OPENING_CLEARANCE,
  type DeepPartial,
} from "./presets.js";

/** Action proposée : libellé affichable, raison, patch à fusionner dans le projet. */
export interface FixSuggestion {
  /** Identifiant stable de la correction (pour l'UI et les tests). */
  readonly id: "jour-newel" | "opening-clearance" | "jour-wall";
  /** Libellé d'action, à l'infinitif (ex. « Passer le jour en poteau de 100 mm »). */
  readonly label: string;
  /** Pourquoi cette correction est proposée. */
  readonly reason: string;
  /** Patch de projet (fusion profonde, tableaux remplacés en bloc). */
  readonly patch: DeepPartial<ProjectInput>;
}

/**
 * Structures dont les limons de jour s'assemblent sur un **poteau d'angle** : un jour à angle
 * vif les empêche de se rencontrer (erreur « jour à angle vif » des plugins). Liste tenue ici
 * tant que les plugins ne le déclarent pas eux-mêmes (voir LEDGER §3).
 */
export const NEWEL_REQUIRED_STRUCTURES: readonly string[] = [
  "wood-housed",
  "steel-flat",
  "steel-profile",
];

/**
 * Côté du poteau d'angle proposé (mm). **[Valeur d'usage, confiance faible, à valider]** :
 * C §1.9 cite un poteau de 90 à 100 mm sur un escalier à deux quarts tournants [11] ; même
 * valeur que le cas d'acceptation n° 1 (CHALLENGE P1).
 */
export const DEFAULT_NEWEL_SIZE = 100;

/**
 * Le tracé du projet corrigé est-il constructible ? Un poteau centré sur l'angle doit tenir dans
 * la volée centrale d'un demi-tournant (volée ≥ 2E + côté du poteau) : un jour plus étroit que
 * le poteau rendrait le tracé impossible, la correction n'est alors pas proposée.
 */
function layoutAccepts(project: Project, patch: DeepPartial<ProjectInput>): boolean {
  const parsed = ProjectSchema.safeParse(deepMerge(project, patch));
  if (!parsed.success) return false;
  try {
    computeLayout(parsed.data);
    return true;
  } catch (e) {
    if (e instanceof LayoutError) return false;
    throw e;
  }
}

/** Pas d'arrondi (mm) du jeu de trémie proposé. */
const CLEARANCE_GRID = 10;

/**
 * Corrections applicables au projet d'après son modèle (`buildModel(project)`) : liste vide si
 * rien n'est à proposer. Chaque patch est autonome (les corrections se combinent en les
 * appliquant l'une après l'autre, modèle recalculé entre deux).
 */
export function suggestFixes(
  project: Project,
  model?: Pick<Model, "layout" | "compliance" | "errors">,
): FixSuggestion[] {
  const out: FixSuggestion[] = [];

  // 1. Jour à angle vif avec une structure à poteau d'angle.
  const turns = project.stair.layout.turns;
  const sharp = turns.filter((t) => t.inner.kind === "sharp").length;
  const newelPatch: DeepPartial<ProjectInput> = {
    stair: {
      layout: {
        turns: turns.map((t) =>
          t.inner.kind === "sharp"
            ? { ...t, inner: { kind: "newel" as const, size: DEFAULT_NEWEL_SIZE } }
            : t,
        ),
      },
    },
  };
  if (
    sharp > 0 &&
    NEWEL_REQUIRED_STRUCTURES.includes(project.stair.structure.kind) &&
    layoutAccepts(project, newelPatch)
  ) {
    out.push({
      id: "jour-newel",
      label: `Passer le jour en poteau de ${DEFAULT_NEWEL_SIZE} mm${sharp > 1 ? ` (${sharp} tournants)` : ""}`,
      reason: `La structure « ${project.stair.structure.kind} » assemble ses limons de jour sur un poteau d'angle : avec un jour à angle vif, ils se rencontreraient en un point et ne sont pas générés.`,
      patch: newelPatch,
    });
  }
  if (!model) return out;

  // 2. Garde-corps rampant sous la dalle haute : trémie élargie le long de l'escalier.
  const opening = project.site.opening;
  const clash = model.compliance.results.some(
    (r) => r.ruleId === "GC_CONFLIT_DALLE" && r.status === "violation",
  );
  if (clash && opening?.kind === "rect" && model.layout.inner.segments.length > 0) {
    const spec = project.guards ?? GuardsSpecSchema.parse({});
    // Axe du garde-corps décalé vers le vide + demi-section la plus large (poteau ou main
    // courante), arrondi au pas supérieur ; au moins le jeu des préréglages.
    const need =
      spec.flight.edgeOffset + Math.max(spec.posts.size, sectionWidth(spec.handrail.section)) / 2;
    const clearance = Math.max(
      PRESET_OPENING_CLEARANCE,
      Math.ceil(need / CLEARANCE_GRID) * CLEARANCE_GRID,
    );
    const grown = growAlongStairEdges(opening, model.layout, clearance, true);
    if (grown.sizeX !== opening.sizeX || grown.sizeY !== opening.sizeY) {
      out.push({
        id: "opening-clearance",
        label: `Élargir la trémie de ${clearance} mm le long de l'escalier`,
        reason:
          "Un garde-corps rampant passe sous la dalle haute (trémie au nu de l'escalier) : sa main courante traverserait le plancher.",
        patch: { site: { opening: { kind: "rect", ...grown } } },
      });
    }
  }

  // 3. Jour trop étroit pour un garde-corps de jour.
  const narrow = model.errors.some((e) => e.startsWith(NARROW_JOUR_ERROR_PREFIX));
  if (narrow && project.guards && project.guards.flight.inner !== "wall") {
    out.push({
      id: "jour-wall",
      label: "Régler le côté jour des garde-corps sur « mur »",
      reason:
        "Le jour est plus étroit que la sphère T1 : aucun garde-corps de jour n'est construit. À retenir seulement si le jour est fermé (sinon, élargir le jour).",
      patch: { guards: { flight: { inner: "wall" } } },
    });
  }
  return out;
}
