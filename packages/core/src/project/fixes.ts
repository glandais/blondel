/**
 * Corrections proposées (`suggestFixes`) : actions que l'interface peut offrir à l'utilisateur
 * face à une erreur ou un avertissement du modèle, chacune avec un libellé et un **patch** de
 * projet (fusion profonde, tableaux remplacés en bloc, voir `deepMerge`). Fonction pure : aucune
 * action n'est appliquée ; l'appelant applique `deepMerge(project, fix.patch)` puis revalide.
 *
 * Corrections actuelles :
 * - **jour à angle vif avec une structure à poteau** (`wood-housed`, `steel-flat`,
 *   `steel-profile` : les limons de jour se rencontreraient en un point et ne sont pas
 *   générés) → passer les jours vifs en poteau d'angle de `DEFAULT_NEWEL_SIZE` (poteau élargi
 *   des profilés pour `steel-profile`, section lue sur le modèle) ;
 * - **poteau trop étroit pour les profilés** (`steel-profile`, poteau différent du poteau
 *   élargi attendu, décision A13) → poser le poteau des profilés ;
 * - **garde-corps en conflit avec la dalle haute** (`GC_CONFLIT_DALLE`, trémie rectangulaire au
 *   nu de l'escalier) → élargir la trémie le long des bords de l'escalier ;
 * - **jour plus étroit que la sphère T1** (pas de garde-corps de jour, remarque des garde-corps,
 *   décision A10) → régler le côté jour des garde-corps sur « mur », **seulement si le jour est
 *   fermé** : l'escalier ne le sait pas, la correction est libellée comme telle et n'est pas
 *   proposée quand l'utilisateur a déclaré le côté jour « vide » (`guards.flight.inner`) ;
 * - **cage qui s'écrit en volées et dont la structure n'est pas générée**
 *   (`structure.cageUnsupported` dans le modèle, tracé libre sans aucune fonction de cage,
 *   `cageFeatures` vide, ADR-0010, sous-lot 2e) → reconvertir en volées (`toFlightsLayout`, conversion exacte :
 *   même tracé, aller-retour à l'identique) : le tracé à volées retrouve les structures, les
 *   préréglages et les formulaires de volées. Sans cette erreur (structure « aucune »), la
 *   cage saisie est gardée telle quelle, sans bandeau de correction permanent. Un S / Z saisi en cage (`oppositeTurns`) s'écrit
 *   aussi en volées mais n'est pas proposé : les structures à limons le refusent en volées
 *   comme en cage. Le patch porte `kind: "flights"` (une fusion profonde ne peut pas retirer le
 *   `kind` de la cage) ; les champs propres à la cage sont écartés par le schéma.
 *
 * Cage saisie : les corrections de jour (poteau d'angle) ne s'appliquent pas, le poteau d'une
 * cage étant refusé en amont (`layout.cage.newelNotYetSupported`) et la structure non générée
 * (`structure.cageUnsupported`) ; `turns` d'une cage est vide.
 */
import { msg, type Message } from "@blondel/i18n";
import { cageFeatures } from "../model/cageFeatures.js";
import type { Model } from "../model/derived.js";
import { ProjectSchema, type Project, type ProjectInput } from "../model/project.js";
import { GuardsSpecSchema } from "../guards/spec.js";
import { isNarrowJourNote } from "../guards/jour.js";
import { sectionWidth } from "../guards/parts.js";
import {
  deepMerge,
  growAlongStairEdges,
  PRESET_OPENING_CLEARANCE,
  type DeepPartial,
} from "./presets.js";
import { profileFlangeWidth } from "../structures/steelProfile.js";
import {
  DEFAULT_NEWEL,
  DEFAULT_NEWEL_SIZE,
  expectedNewel,
  layoutAccepts as layoutOk,
  structureRequiresNewel,
  newelLabel,
  newelMatches,
  newelSatisfies,
} from "./newel.js";
import { toFlightsLayout } from "./layoutConversion.js";

export { DEFAULT_NEWEL_SIZE };

/** Action proposée : libellé affichable, raison, patch à fusionner dans le projet. */
export interface FixSuggestion {
  /** Identifiant stable de la correction (pour l'UI et les tests). */
  readonly id:
    "jour-newel" | "newel-profile" | "opening-clearance" | "jour-wall" | "cage-to-flights";
  /** Libellé d'action, à l'infinitif (ex. « Passer le jour en poteau de 100 mm »). */
  readonly label: Message;
  /** Pourquoi cette correction est proposée. */
  readonly reason: Message;
  /** Patch de projet (fusion profonde, tableaux remplacés en bloc). */
  readonly patch: DeepPartial<ProjectInput>;
  /**
   * Règles du contrôle de conception que la correction vise (inspecteur Règle, « Pour
   * corriger ») ; absent : correction d'une erreur ou d'une remarque, sans règle associée.
   */
  readonly ruleIds?: readonly string[];
}

/** Le tracé du projet corrigé par `patch` est-il constructible (`newel.ts`) ? */
function layoutAccepts(project: Project, patch: DeepPartial<ProjectInput>): boolean {
  const parsed = ProjectSchema.safeParse(deepMerge(project, patch));
  return parsed.success && layoutOk(parsed.data);
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
  model?: Pick<Model, "layout" | "compliance" | "errors"> & Partial<Pick<Model, "parts" | "notes">>,
): FixSuggestion[] {
  const out: FixSuggestion[] = [];

  // 0. Cage qui s'écrit en volées : reconvertir (conversion exacte, voir l'en-tête).
  const spec = project.stair.layout;
  const cageRefused = model?.errors.some((e) => e.key === "structure.cageUnsupported") ?? false;
  if (spec.kind === "cage" && cageRefused && cageFeatures(spec).length === 0) {
    const flights = toFlightsLayout(project);
    if (flights !== null) {
      const layout = flights.stair.layout;
      out.push({
        id: "cage-to-flights",
        label: msg("project.fix.cageToFlights.label", { count: layout.legs.length }),
        reason: msg("project.fix.cageToFlights.reason"),
        patch: {
          stair: {
            layout: {
              kind: "flights",
              width: layout.width,
              legs: layout.legs.map((l) => ({ ...l })),
              turns: layout.turns.map((t) => ({ ...t, inner: { ...t.inner } })),
            },
          },
        },
      });
    }
  }

  // 1. Jour à angle vif avec une structure à poteau d'angle ; poteau des profilés (A13).
  const turns = project.stair.layout.turns;
  const { kind, params } = project.stair.structure;
  const flange = model?.parts ? profileFlangeWidth(model.parts) : null;
  const expected = expectedNewel(kind, params, flange);
  const target = expected ?? DEFAULT_NEWEL;
  const patchFor = (
    which: (inner: (typeof turns)[number]["inner"]) => boolean,
    to: typeof target = target,
  ) => ({
    stair: {
      layout: {
        turns: turns.map((t) => (which(t.inner) ? { ...t, inner: { ...to } } : t)),
      },
    },
  });
  const sharp = turns.filter((t) => t.inner.kind === "sharp").length;
  let newelPatch: DeepPartial<ProjectInput> = patchFor((i) => i.kind === "sharp");
  let sharpTarget = target;
  // Poteau élargi des profilés refusé par le tracé : poteau par défaut (décision A4), le plugin
  // signalant la réception (`FAB_POTEAU_RECEPTION`).
  if (sharp > 0 && !newelMatches(target, DEFAULT_NEWEL) && !layoutAccepts(project, newelPatch)) {
    sharpTarget = DEFAULT_NEWEL;
    newelPatch = patchFor((i) => i.kind === "sharp", DEFAULT_NEWEL);
  }
  if (sharp > 0 && structureRequiresNewel(kind) && layoutAccepts(project, newelPatch)) {
    out.push({
      id: "jour-newel",
      label:
        sharp > 1
          ? msg("project.fix.jourNewel.labelMany", {
              newel: newelLabel(sharpTarget),
              count: String(sharp),
            })
          : msg("project.fix.jourNewel.label", { newel: newelLabel(sharpTarget) }),
      reason: msg("project.fix.jourNewel.reason", { kind }),
      patch: newelPatch,
    });
  }
  // Poteau existant différent du poteau élargi des profilés (section connue seulement).
  const unfit = (i: (typeof turns)[number]["inner"]): boolean =>
    i.kind === "newel" && !newelSatisfies(i, kind, params, flange);
  const mismatched =
    kind === "steel-profile" && expected ? turns.filter((t) => unfit(t.inner)).length : 0;
  if (mismatched > 0 && expected) {
    const patch = patchFor(unfit);
    if (layoutAccepts(project, patch)) {
      out.push({
        id: "newel-profile",
        label:
          mismatched > 1
            ? msg("project.fix.newelProfile.labelMany", {
                newel: newelLabel(expected),
                count: String(mismatched),
              })
            : msg("project.fix.newelProfile.label", { newel: newelLabel(expected) }),
        reason: msg("project.fix.newelProfile.reason"),
        patch,
      });
    }
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
        label: msg("project.fix.openingClearance.label", { clearance: String(clearance) }),
        reason: msg("project.fix.openingClearance.reason"),
        patch: { site: { opening: { kind: "rect", ...grown } } },
        // Seule correction attachée à une règle du contrôle : les autres corrigent une erreur
        // de génération (jour vif), une remarque (poteau des profilés, jour étroit).
        ruleIds: ["GC_CONFLIT_DALLE"],
      });
    }
  }

  // 3. Jour plus étroit que la sphère T1 (pas de garde-corps de jour, décision A10) : côté jour
  // « mur » seulement si le jour est fermé. Côté jour déclaré « vide » : jour ouvert, rien à proposer.
  // Garde-corps partiel côté jour (vide ouvert hors du jour, décision A10 du 2026-09-30) : un
  // jour fermé ne ferme pas ce vide, « mur » supprimerait ce garde-corps : pas de proposition.
  const narrow = (model.notes ?? []).some(isNarrowJourNote);
  const partialGuard = (model.parts ?? []).some((p) => p.id.startsWith("guard-inner-"));
  if (narrow && !partialGuard && project.guards && project.guards.flight.inner === "auto") {
    out.push({
      id: "jour-wall",
      label: msg("project.fix.jourWall.label"),
      reason: msg("project.fix.jourWall.reason"),
      patch: { guards: { flight: { inner: "wall" } } },
    });
  }
  return out;
}
