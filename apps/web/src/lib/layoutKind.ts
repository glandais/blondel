/**
 * Type de tracé (jalon 5a) : escalier « à volées » (volées droites et tournants à 90°) ou
 * hélicoïdal. Transformations pures du `Project` pour passer de l'un à l'autre, préréglages de
 * l'interface, formes des cartes du parcours guidé (`SHAPE_IDS`, `pressedShapes`, `applyShape`)
 * et compatibilité des structures avec le type de tracé. Aucune valeur métier ici :
 * le nouveau tracé vient des préréglages du cœur (`createProject`).
 */
import {
  HELICAL_MAX_LANDING_ANGLE,
  createHelicalProjectWithFallback,
  createProject,
  getStructure,
  structureAcceptsLayout,
  withHelicalCore,
  type PresetId,
  type PresetOptions,
  type Project,
  type Turn,
} from "@blondel/core";
import { msg, type Message, type MessageKey } from "@blondel/i18n";
import { chooseStructure } from "./structureChoice.js";

export type LayoutKind = "flights" | "helical";

export const LAYOUT_KIND_LABELS: Readonly<Record<LayoutKind, MessageKey>> = {
  flights: "ui.label.layoutKind.flights",
  helical: "ui.label.layoutKind.helical",
};

/** Contexte de forme de rules.yaml activé pour un hélicoïdal (non déduit par le moteur). */
export const HELICAL_CONTEXT = "helicoidal";

/** Plugin de structure propre aux hélicoïdaux (fût, marches rayonnantes, main courante). */
export const HELICAL_STRUCTURE = "helical-core";

export function layoutKindOf(project: Project): LayoutKind {
  return project.stair.layout.kind === "helical" ? "helical" : "flights";
}

/**
 * La structure `kind` sait-elle construire un tracé de ce type ? Déclaré par le plugin
 * (`StructureKind.capabilities.layouts`, dette D4) ; « none » convient aux deux.
 */
export function structureFitsLayout(kind: string, layout: LayoutKind): boolean {
  return structureAcceptsLayout(kind, layout);
}

/**
 * Projet d'un préréglage pour l'interface : celui du cœur, avec la structure `helical-core` pour
 * l'hélicoïdal (fût, main courante hélicoïdale) quand le plugin est enregistré — sans structure,
 * un hélicoïdal ne montre que des marches flottantes.
 * @throws RangeError (message pour l'utilisateur) si les options sont incohérentes.
 */
export function presetProject(id: PresetId, options?: PresetOptions): Project {
  const p = createProject(id, options);
  if (id === "helical" && p.stair.structure.kind === "none" && getStructure(HELICAL_STRUCTURE)) {
    return withHelicalCore(p);
  }
  return p;
}

function withContext(contexts: readonly string[], kind: LayoutKind): string[] {
  const rest = contexts.filter((c) => c !== HELICAL_CONTEXT);
  return kind === "helical" ? [...rest, HELICAL_CONTEXT] : rest;
}

/**
 * Marches par tour proposées quand on passe la rotation d'un hélicoïdal en « nombre de marches
 * par tour » sans modèle calculé (`HelicalEditor`) : **valeur de présentation**, sans source
 * métier, à ajuster. Le passage volées → hélicoïdal utilise le repli du cœur
 * (`createHelicalProjectWithFallback`, dette D4).
 */
export const FALLBACK_TREADS_PER_TURN = 12;

export interface LayoutSwitch {
  readonly project: Project;
  /** Remarque à afficher (valeur provisoire retenue), absente sinon. */
  readonly note?: Message;
}

/**
 * Préréglage du nouveau type pour les H et dalle du projet (repli du cœur quand aucune rotation
 * ne satisfait tous ses critères, `createHelicalProjectWithFallback`). Pour
 * l'hélicoïdal, le découpage, les marches et la ligne de foulée **conservés** du projet sont
 * transmis au préréglage : sa recherche du nombre de marches par tour et du palier (module,
 * giron, échappée sous le tour supérieur) porte ainsi sur l'escalier qui sera réellement calculé.
 */
function basePreset(project: Project, kind: LayoutKind): LayoutSwitch {
  const options: PresetOptions = {
    floorToFloor: project.site.floorToFloor,
    upperSlabThickness: project.site.upperSlabThickness,
  };
  if (kind === "flights") return { project: presetProject("straight", options) };
  const { stepping, treads, walkline } = project.stair;
  const kept = { stepping, treads, walkline };
  const helical = createHelicalProjectWithFallback({ ...options, patch: { stair: kept } });
  return helical.note === undefined
    ? { project: helical.project }
    : { project: helical.project, note: helical.note };
}

/**
 * Change le type de tracé en gardant le site (hauteur, dalle), le découpage, les marches, les
 * garde-corps et le contrôle : le tracé, son placement, les murs et la trémie (si le projet en a
 * une) sont ceux du préréglage du cœur du nouveau type (droit, ou hélicoïdal à fût) pour les
 * mêmes H et dalle. Une structure incompatible avec le nouveau tracé, ou l'absence de structure,
 * devient celle du préréglage (`helical-core` pour un hélicoïdal si le plugin existe, « none »
 * pour les volées) ; les surcharges de nez, sans objet, sont retirées ; le contexte de forme
 * `helicoidal` suit le type de tracé.
 * @throws RangeError si le préréglage du cœur est impossible même avec la rotation provisoire.
 */
export function switchLayoutKind(project: Project, kind: LayoutKind): LayoutSwitch {
  if (layoutKindOf(project) === kind) return { project };
  const { project: base, note } = basePreset(project, kind);
  const next = adoptPreset(project, base, kind);
  return note === undefined ? { project: next } : { project: next, note };
}

/**
 * Reprend du préréglage `base` (de type `kind`) le tracé, le placement, les murs et la trémie
 * (seulement si `project` en a une) et garde le reste de `project`. Structure gardée si elle
 * convient au nouveau tracé (et n'est pas « aucune »), sinon celle du préréglage ; surcharges de
 * nez retirées ; contexte de forme `helicoidal` synchronisé. Partie commune de
 * `switchLayoutKind` et `applyShape`.
 */
function adoptPreset(project: Project, base: Project, kind: LayoutKind): Project {
  const { opening: _opening, ...site } = project.site;
  const opening = project.site.opening !== undefined ? base.site.opening : undefined;
  const cur = project.stair.structure;
  const structure =
    cur.kind !== "none" && structureFitsLayout(cur.kind, kind) ? cur : base.stair.structure;
  return {
    ...project,
    site: { ...site, walls: base.site.walls, ...(opening ? { opening } : {}) },
    stair: {
      ...project.stair,
      placement: base.stair.placement,
      layout: base.stair.layout,
      structure,
      nosingOverrides: [],
    },
    compliance: {
      ...project.compliance,
      contexts: withContext(project.compliance.contexts, kind),
    },
  };
}

// ------------------------------------------------------------------ Formes du parcours guidé

/** Formes proposées en cartes à l'étape « Forme » du parcours guidé (ordre de la maquette). */
export const SHAPE_IDS = [
  "straight",
  "quarter-left",
  "quarter-right",
  "u",
  "s",
  "half-turn",
  "helical",
] as const;
export type ShapeId = (typeof SHAPE_IDS)[number];

/** Préréglage du cœur de chaque forme (libellé complet : `PRESET_LABELS` du cœur). */
export const SHAPE_PRESETS: Readonly<Record<ShapeId, PresetId>> = {
  straight: "straight",
  "quarter-left": "quarter-left",
  "quarter-right": "quarter-right",
  u: "two-quarters-u",
  s: "two-quarters-s",
  "half-turn": "half-turn",
  helical: "helical",
};

/**
 * Formes qui correspondent au projet, déduites des tournants saisis (présentation seulement) :
 * hélicoïdal ; aucun tournant → droit ; un tournant → ¼ selon son sens (palier compris) ; deux
 * tournants de même sens → U **et** ½ tournant (les deux préréglages ne diffèrent que par les
 * longueurs de volées et le jour : on ne peut pas les distinguer) ; deux tournants de sens
 * opposés → S ; trois tournants ou plus → aucune.
 */
export function pressedShapes(project: Project): ReadonlySet<ShapeId> {
  const layout = project.stair.layout;
  if (layout.kind === "helical") return new Set<ShapeId>(["helical"]);
  const turns = layout.turns;
  if (turns.length === 0) return new Set<ShapeId>(["straight"]);
  if (turns.length === 1) {
    return new Set<ShapeId>([turns[0]!.direction === "left" ? "quarter-left" : "quarter-right"]);
  }
  if (turns.length === 2) {
    return new Set<ShapeId>(hasOppositeTurns(turns) ? ["s"] : ["u", "half-turn"]);
  }
  return new Set<ShapeId>();
}

/** Préréglage à volées pour H, dalle et découpage du projet, et E s'il est donné. */
function flightsPreset(project: Project, id: PresetId, width: number | undefined): Project {
  return presetProject(id, {
    floorToFloor: project.site.floorToFloor,
    upperSlabThickness: project.site.upperSlabThickness,
    ...(width === undefined ? {} : { width }),
    // Découpage conservé transmis au préréglage : ses longueurs de volées portent sur le nombre
    // de marches et le giron qui seront réellement calculés.
    patch: { stair: { stepping: project.stair.stepping } },
  });
}

/**
 * Applique une forme (carte de l'étape « Forme » du guidé) : transformation pure, dont
 * l'appelant fait une seule entrée d'historique. Hélicoïdal : `switchLayoutKind`. Sinon,
 * préréglage à volées du cœur pour la hauteur à monter, la dalle, le découpage et l'emmarchement
 * E du projet (sans E si le cœur le refuse pour cette forme) : on en prend le tracé, le
 * placement, les murs et la trémie (si le projet en a une) ; on garde le reste (nom, site hors
 * murs et trémie, découpage, marches, ligne de foulée, balancement, garde-corps, contrôle,
 * valeurs validées). Une structure gardée qui demande un poteau d'angle reçoit le jour adapté
 * par le cœur (`chooseStructure`), dont la remarque devient la note.
 * @throws RangeError (message pour l'utilisateur) si le préréglage est impossible même sans E.
 */
export function applyShape(project: Project, shape: ShapeId): LayoutSwitch {
  if (shape === "helical") return switchLayoutKind(project, "helical");
  const id = SHAPE_PRESETS[shape];
  const layout = project.stair.layout;
  const width = layout.kind === "helical" ? undefined : layout.width;
  let base: Project;
  try {
    base = flightsPreset(project, id, width);
  } catch (e) {
    if (!(e instanceof RangeError) || width === undefined) throw e;
    base = flightsPreset(project, id, undefined);
  }
  const next = adoptPreset(project, base, "flights");
  const kept = next.stair.structure;
  if (kept.kind === "none" || kept !== project.stair.structure) return { project: next };
  const c = chooseStructure(next, kept.kind, kept.params);
  return c.notice === null ? { project: c.project } : { project: c.project, note: c.notice };
}

/** Angle proposé quand on ajoute un palier d'arrivée à un hélicoïdal (degrés, repris du cœur). */
export const DEFAULT_LANDING_ANGLE = HELICAL_MAX_LANDING_ANGLE;

// ------------------------------------------------------------------ Typologie des volées

/** Enchaînement de deux tournants : même sens (U, demi-tournant) ou sens opposés (S / Z). */
export type TurnSequence = "same" | "opposite";

/** Tracé à volées dont deux tournants consécutifs sont de sens opposés (S / Z). */
export function hasOppositeTurns(turns: readonly Pick<Turn, "direction">[]): boolean {
  return turns.some((t, i) => i > 0 && t.direction !== turns[i - 1]!.direction);
}

const dirLabel = (d: Turn["direction"]): Message =>
  msg(d === "left" ? "ui.lib.typology.left" : "ui.lib.typology.right");

/**
 * Typologie lisible d'un tracé à volées, déduite des tournants saisis (présentation seulement :
 * le cœur construit le tracé à partir des volées et des tournants, quel que soit ce libellé).
 * Traduite à l'affichage.
 */
export function flightsTypologyLabel(turns: readonly Pick<Turn, "direction" | "mode">[]): Message {
  if (turns.length === 0) return msg("assistant.typology.straight");
  const landing = turns.some((t) => t.mode === "landing");
  const withLanding: Message | string = landing
    ? msg(
        turns.every((t) => t.mode === "landing")
          ? "ui.lib.typology.suffix.landings"
          : "ui.lib.typology.suffix.landing",
      )
    : "";
  if (turns.length === 1) {
    const direction = dirLabel(turns[0]!.direction);
    return landing
      ? msg("ui.lib.typology.quarterLanding", { direction })
      : msg("ui.lib.typology.quarter", { direction });
  }
  if (turns.length === 2) {
    const [a, b] = turns as [Pick<Turn, "direction">, Pick<Turn, "direction">];
    return a.direction === b.direction
      ? msg("ui.lib.typology.twoSame", { direction: dirLabel(a.direction), landing: withLanding })
      : msg("ui.lib.typology.twoOpposite", {
          first: dirLabel(a.direction),
          second: dirLabel(b.direction),
          landing: withLanding,
        });
  }
  return msg("ui.lib.typology.several", {
    n: String(turns.length),
    alternate: hasOppositeTurns(turns) ? msg("ui.lib.typology.suffix.alternate") : "",
    landing: withLanding,
  });
}

/**
 * Change l'enchaînement de deux tournants en gardant le sens du premier : `opposite` → le
 * second tournant prend le sens contraire (S / Z), `same` → le même (U). Sans effet hors
 * tracé à volées de deux tournants au moins.
 */
export function withTurnSequence(project: Project, sequence: TurnSequence): Project {
  const layout = project.stair.layout;
  if (layout.kind === "helical" || layout.turns.length < 2) return project;
  const first = layout.turns[0]!.direction;
  const other: Turn["direction"] = first === "left" ? "right" : "left";
  const turns = layout.turns.map((t, i) =>
    i === 1 ? { ...t, direction: sequence === "same" ? first : other } : t,
  );
  return { ...project, stair: { ...project.stair, layout: { ...layout, turns } } };
}
