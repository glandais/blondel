/**
 * Mutateurs purs du placement et du tracé (ADR-0010, plan D, sous-lot 3a) : réglages d'un
 * tronçon ou d'une jonction, ajout, coupe et retrait de tronçons, et traduction d'un glisser de
 * l'éditeur 2D en paramètre (`dragSectionEnd`, `dragWidth`, `dragJunctionAngle`). L'interface
 * ne calcule rien : elle passe le point visé (repère du site) et le `Layout` calculé, qui donne
 * les repères (`Layout.sections`, `Layout.turns`).
 *
 * Contrat `EditResult` (`model/edit.ts`) : projet modifié, ou le même objet si l'opération est
 * sans effet, ou refus typé (`Message`) si elle sortirait du schéma (`LayoutSpecSchema` :
 * `CAGE_MAX_SECTIONS`, longueurs ≥ 0, |angle| < 180°, palier droit en mode palier et raccords
 * vifs…). Cotes arrondies au mm entier, angles au degré entier (ADR-0003). Sous-objets
 * inchangés partagés (`shareStructure`).
 *
 * **Tracé à volées** : chaque volée est un tronçon, chaque tournant une jonction de ±90°
 * (`flightsToCage`, convention F11 : longueur de tronçon = partie droite, volée L à k tournants
 * voisins = L − k·E). La modification se fait sur cette cage, puis le tracé est **réécrit en
 * volées** s'il s'y exprime encore (`cageToFlights` : longueur d'une volée, sens d'un tournant,
 * raccord du jour vif, en arc ou à poteau, mode) ; sinon il devient un tracé libre (cage),
 * modification annulable d'un seul pas. Exception : une largeur **uniforme** saisie ou tirée sur
 * un tracé à volées change sa largeur commune (`width`), longueurs de volées (au mur)
 * inchangées, comme le formulaire des volées. Une cage n'est jamais réécrite en volées ici
 * (`toFlightsLayout`, action explicite). Un tracé hélicoïdal est refusé
 * (`layout.edit.helical`).
 */
import { isMessage, msg, type Message } from "@blondel/i18n";
import * as V from "../geom2d/vec.js";
import { editError, roundMm, shareStructure, type EditResult } from "../model/edit.js";
import type { Layout, LayoutSection, LayoutSectionLine } from "../model/derived.js";
import type { Vec2 } from "../model/primitives.js";
import {
  CAGE_MAX_SECTIONS,
  LayoutSpecSchema,
  type CageAxis,
  type CageJunction,
  type CageLayoutSpec,
  type CageSection,
  type FlightsLayoutSpec,
  type LayoutSpec,
  type Project,
  type WallJoint,
  type WellJoint,
} from "../model/project.js";
import { toCageLayout } from "../project/layoutConversion.js";
import { issuesFromZod, projectIssueMessage } from "../project/errors.js";
import { cageToFlights, flightsToCage } from "./cage/fromFlights.js";
import { computeLayout } from "./layout.js";

type Anchor = NonNullable<CageSection["anchor"]>;

/** Tracé éditable : cage (saisie, ou issue des volées) et origine. */
interface Editable {
  readonly cage: CageLayoutSpec;
  readonly flights?: FlightsLayoutSpec;
}

/** Cage à modifier : celle du projet, ou celle d'un tracé à volées ; refus sinon. */
function editable(project: Project): Editable | { readonly error: Message } {
  const spec = project.stair.layout;
  if (spec.kind === "helical") return editError(msg("layout.edit.helical"));
  if (spec.kind === "cage") return { cage: spec };
  if (spec.turns.length !== spec.legs.length - 1) {
    return editError(msg("layout.edit.notConvertible"));
  }
  if (spec.legs.length === 1 && spec.legs[0]!.length === "auto") {
    const cage: CageLayoutSpec = {
      kind: "cage",
      sections: [{ axis: { kind: "straight", length: "auto" }, width: spec.width }],
      junctions: [],
      width: spec.width,
      legs: [],
      turns: [],
    };
    return { cage, flights: spec };
  }
  const lengths: number[] = [];
  for (const leg of spec.legs) {
    if (leg.length === "auto") return editError(msg("layout.edit.notConvertible"));
    lengths.push(leg.length);
  }
  let cage: CageLayoutSpec;
  try {
    cage = flightsToCage(spec, lengths);
  } catch {
    return editError(msg("layout.edit.notConvertible"));
  }
  // Volée plus courte que ses carrés d'angle (k·E) : sa partie droite serait négative, refus du
  // moteur à volées (`layout.legTooShort`) plutôt qu'une erreur de schéma sur un tronçon.
  const short = cage.sections.findIndex(
    (s) => s.axis.kind === "straight" && !(Number(s.axis.length) >= 0),
  );
  if (short >= 0) {
    const L = lengths[short]!;
    const straightPart = Number((cage.sections[short]!.axis as { length: number }).length);
    return editError(
      msg("layout.legTooShort", { flight: short + 1, length: L, required: L - straightPart }),
    );
  }
  return { cage, flights: spec };
}

const isError = (v: object): v is { readonly error: Message } => "error" in v;

/** Premier problème d'une analyse refusée, en `Message`. */
function schemaError(error: import("zod").ZodError): Message {
  const issue = error.issues[0]!;
  const own = (issue as { params?: { message?: unknown } }).params?.message;
  if (isMessage(own)) return own;
  return projectIssueMessage(issuesFromZod(error)[0]!);
}

/** Projet au tracé `layout` contrôlé par le schéma, partagé avec l'ancien. */
function commitLayout(project: Project, layout: LayoutSpec): EditResult {
  const checked = LayoutSpecSchema.safeParse(layout);
  if (!checked.success) return editError(schemaError(checked.error));
  const old = project.stair.layout;
  const shared = shareStructure(old, layout);
  if (shared === old) return { project };
  return { project: { ...project, stair: { ...project.stair, layout: shared } } };
}

/** Cage normalisée (champs dérivés recalculés) ; réécrite en volées si elle l'était et le peut. */
function commitCage(
  project: Project,
  from: Editable,
  sections: readonly CageSection[],
  junctions: readonly CageJunction[],
): EditResult {
  const { width: _w, legs: _l, turns: _t, ...rest } = from.cage;
  const cage: CageLayoutSpec = {
    ...rest,
    sections: [...sections],
    junctions: [...junctions],
    width: Math.min(...sections.flatMap((s) => [s.width, s.widthEnd ?? s.width])),
    legs: [],
    turns: [],
  };
  // Bornes de la cage d'abord (messages `layout.cage.*`), même pour un tracé à volées.
  const checked = LayoutSpecSchema.safeParse(cage);
  if (!checked.success) return editError(schemaError(checked.error));
  // Étendue non nulle de chaque tronçon droit (`checkSectionExtents`, `placeSections`) : une
  // partie droite nulle n'est admise qu'avec une jonction tournante d'entrée (carré d'angle) ou
  // une jonction de sortie.
  const empty = sections.findIndex(
    (s, k) =>
      s.axis.kind === "straight" &&
      s.axis.length === 0 &&
      !((k > 0 && junctions[k - 1]!.angle !== 0) || k < junctions.length),
  );
  if (empty >= 0) {
    return editError(
      msg("layout.cage.invalidSectionLength", { section: empty + 1, length: String(0) }),
    );
  }
  if (from.flights) {
    const flights = cageToFlights(cage);
    if (flights !== null) {
      const kind = from.flights.kind;
      return commitLayout(project, kind !== undefined ? { kind, ...flights } : flights);
    }
  }
  // Jour à poteau d'un tracé libre : refusé par le moteur (`computeLayout`) tant que le
  // développé du jour d'une cage n'existe pas ; refus ici plutôt qu'un projet sans modèle (un
  // tracé à volées à poteau reste modifiable tant qu'il s'écrit en volées).
  const newel = junctions.findIndex((jn) => jn.well.kind === "newel");
  if (newel >= 0)
    return editError(msg("layout.cage.newelNotYetSupported", { junction: newel + 1 }));
  return commitLayout(project, cage);
}

function sectionIndexError(i: number, count: number) {
  return editError(msg("layout.edit.sectionIndex", { section: i + 1, count }));
}

function junctionIndexError(j: number, count: number) {
  return editError(msg("layout.edit.junctionIndex", { junction: j + 1, count }));
}

const validIndex = (i: number, count: number): boolean =>
  Number.isInteger(i) && i >= 0 && i < count;

/** Applique `change` au tronçon `i` de la cage du projet. */
function editSection(
  project: Project,
  i: number,
  change: (s: CageSection, from: Editable) => CageSection | { readonly error: Message },
): EditResult {
  const from = editable(project);
  if (isError(from)) return from;
  const { sections, junctions } = from.cage;
  if (!validIndex(i, sections.length)) return sectionIndexError(i, sections.length);
  const next = change(sections[i]!, from);
  if (isError(next)) return next;
  return commitCage(
    project,
    from,
    sections.map((s, k) => (k === i ? next : s)),
    junctions,
  );
}

/** Applique `change` à la jonction `j` de la cage du projet. */
function editJunction(
  project: Project,
  j: number,
  change: (jn: CageJunction) => CageJunction | { readonly error: Message },
): EditResult {
  const from = editable(project);
  if (isError(from)) return from;
  const { sections, junctions } = from.cage;
  if (!validIndex(j, junctions.length)) return junctionIndexError(j, junctions.length);
  const next = change(junctions[j]!);
  if (isError(next)) return next;
  return commitCage(
    project,
    from,
    sections,
    junctions.map((x, k) => (k === j ? next : x)),
  );
}

// ------------------------------------------------------------------ Placement et conversion

/**
 * Placement de l'escalier : origine (arrondie au mm) et rotation (degrés, arrondie au degré
 * entier, sens trigonométrique) ; un champ absent est conservé.
 */
export function withPlacement(
  project: Project,
  placement: { readonly origin?: Vec2; readonly rotation?: number },
): EditResult {
  const old = project.stair.placement;
  const next = {
    ...old,
    ...(placement.origin
      ? { origin: { x: roundMm(placement.origin.x), y: roundMm(placement.origin.y) } }
      : {}),
    ...(placement.rotation !== undefined ? { rotation: roundMm(placement.rotation) } : {}),
  };
  if (!Number.isFinite(next.origin.x + next.origin.y + next.rotation)) return { project };
  const shared = shareStructure(old, next);
  if (shared === old) return { project };
  return { project: { ...project, stair: { ...project.stair, placement: shared } } };
}

/**
 * Conversion explicite en tracé libre (`toCageLayout` de `project/layoutConversion.ts`) : même
 * projet pour une cage, refus pour un hélicoïdal ou un tracé à volées qui ne se convertit pas.
 */
export function convertToCage(project: Project): EditResult {
  const spec = project.stair.layout;
  if (spec.kind === "cage") return { project };
  if (spec.kind === "helical") return editError(msg("layout.edit.helical"));
  const converted = toCageLayout(project);
  return converted ? { project: converted } : editError(msg("layout.edit.notConvertible"));
}

// ------------------------------------------------------------------ Tronçons

/**
 * Axe du tronçon `i` (droit : longueur de partie droite, F11 ; en arc : rayon au mm, balayage au
 * degré entier). Tracé à volées : longueur de la volée = partie droite + k·E.
 */
export function setSectionAxis(project: Project, i: number, axis: CageAxis): EditResult {
  const rounded: CageAxis =
    axis.kind === "straight"
      ? { kind: "straight", length: axis.length === "auto" ? "auto" : roundMm(axis.length) }
      : { kind: "arc", radius: roundMm(axis.radius), sweep: roundMm(axis.sweep) };
  return editSection(project, i, (s) => {
    if (rounded.kind === "arc" && s.widthEnd !== undefined) {
      const { widthEnd: _e, ...constant } = s;
      return { ...constant, axis: rounded };
    }
    return { ...s, axis: rounded };
  });
}

/**
 * Longueur de partie droite du tronçon droit `i` (mm, arrondie ; ≥ 0, `auto` pour un tronçon
 * unique). Refusé sur un axe en arc (`setSectionAxis`).
 */
export function setSectionLength(project: Project, i: number, length: number | "auto"): EditResult {
  if (length !== "auto" && !(Number.isFinite(length) && roundMm(length) >= 0)) {
    return editError(
      msg("layout.cage.invalidSectionLength", { section: i + 1, length: String(length) }),
    );
  }
  const spec = editable(project);
  if (!isError(spec) && spec.cage.sections[i]?.axis.kind === "arc") {
    return editError(msg("layout.edit.arcLength", { section: i + 1 }));
  }
  return setSectionAxis(project, i, { kind: "straight", length });
}

/** Changement de largeur : `null` retire `widthEnd` (largeur constante) ou `anchor` (milieu). */
export interface SectionWidthChange {
  readonly width?: number;
  readonly widthEnd?: number | null;
  readonly anchor?: Anchor | null;
}

function checkWidth(i: number, w: number): Message | null {
  return Number.isFinite(w) && roundMm(w) > 0
    ? null
    : msg("layout.edit.invalidWidth", { section: i + 1, width: String(w) });
}

/**
 * Largeurs du tronçon `i` (mm, arrondies) : `width` au départ, `widthEnd` à l'arrivée (égale à
 * `width` : retirée), `anchor` (bord d'ancrage, `null` : milieu). `i = "all"` : largeur uniforme
 * `width` de tous les tronçons (`widthEnd` retirées) et, s'il est donné, même ancrage pour tous.
 * Tracé à volées et largeur uniforme (`width` seule, ou `"all"`) : largeur commune des volées,
 * longueurs au mur inchangées. Une largeur d'arrivée différente convertit un tracé à volées en
 * tracé libre ; un ancrage seul, sans effet à largeur constante, n'y est pas écrit (le tracé
 * reste en volées, même projet).
 */
export function setSectionWidth(
  project: Project,
  i: number | "all",
  change: SectionWidthChange,
): EditResult {
  const idx = i === "all" ? 0 : i;
  for (const w of [change.width, change.widthEnd]) {
    if (typeof w === "number") {
      const e = checkWidth(idx, w);
      if (e) return editError(e);
    }
  }
  const width = change.width !== undefined ? roundMm(change.width) : undefined;
  const spec = project.stair.layout;
  if (i === "all") {
    if (width === undefined && change.anchor === undefined) return { project };
    return setAllWidths(project, width, change.anchor);
  }
  const widthEnd = typeof change.widthEnd === "number" ? roundMm(change.widthEnd) : change.widthEnd;
  const uniform =
    (widthEnd === undefined || widthEnd === null) &&
    (change.anchor === undefined || change.anchor === null);
  if (spec.kind !== "cage" && spec.kind !== "helical" && uniform && width !== undefined) {
    if (!validIndex(i, spec.legs.length)) return sectionIndexError(i, spec.legs.length);
    return commitLayout(project, { ...spec, width });
  }
  return editSection(project, i, (s) => withWidths(s, width, widthEnd, change.anchor));
}

/**
 * Tronçon aux largeurs et à l'ancrage donnés (`undefined` : inchangé, `null` : retiré) ; le même
 * objet si les largeurs et l'ancrage effectifs ne changent pas.
 */
function withWidths(
  s: CageSection,
  width: number | undefined,
  widthEnd: number | null | undefined,
  anchor: Anchor | null | undefined,
): CageSection {
  const { widthEnd: oldEnd, anchor: oldAnchor, ...base } = s;
  const w = width ?? s.width;
  const e = widthEnd === undefined ? oldEnd : (widthEnd ?? undefined);
  const a = anchor === undefined ? oldAnchor : (anchor ?? undefined);
  if (
    w === s.width &&
    (e ?? w) === (oldEnd ?? s.width) &&
    (a ?? "center") === (oldAnchor ?? "center")
  ) {
    return s;
  }
  return {
    ...base,
    width: w,
    ...(e !== undefined && e !== w ? { widthEnd: e } : {}),
    ...(a !== undefined ? { anchor: a } : {}),
  };
}

/** `setSectionWidth(project, "all", …)` : largeur uniforme et ancrage commun. */
function setAllWidths(
  project: Project,
  width: number | undefined,
  anchor: Anchor | null | undefined,
): EditResult {
  const spec = project.stair.layout;
  const anchorless = anchor === undefined || anchor === null;
  if (spec.kind !== "cage" && spec.kind !== "helical" && anchorless && width !== undefined) {
    return commitLayout(project, { ...spec, width });
  }
  const from = editable(project);
  if (isError(from)) return from;
  return commitCage(
    project,
    from,
    // Largeur uniforme : `widthEnd` retirée (`null`), comparée au tronçon d'origine.
    from.cage.sections.map((s) =>
      withWidths(s, width, width !== undefined ? null : undefined, anchor),
    ),
    from.cage.junctions,
  );
}

// ------------------------------------------------------------------ Jonctions

/** Jonction à l'angle `angle` (degrés entiers), champs liés ajustés pour rester au schéma. */
function withAngle(jn: CageJunction, angle: number): CageJunction {
  if (angle === jn.angle) return jn;
  const { depth: _d, ...rest } = jn;
  if (angle === 0) {
    // Palier droit : mode palier et raccords vifs imposés par le schéma.
    return {
      ...rest,
      angle: 0,
      mode: "landing",
      well: { kind: "sharp" },
      wall: { kind: "sharp" },
    };
  }
  return { ...rest, angle };
}

/**
 * Angle de la jonction `j` (degrés signés, arrondi au degré, |angle| < 180°). À 0° (palier
 * droit), mode palier et raccords vifs imposés ; une profondeur `depth` n'est gardée qu'à 0°.
 * Tracé à volées : ±90° change le sens du tournant, un autre angle convertit en tracé libre.
 */
export function setJunctionAngle(project: Project, j: number, angle: number): EditResult {
  const a = roundMm(angle);
  if (!(Math.abs(a) < 180)) {
    return editError(msg("layout.cage.angleOutOfRange", { junction: j + 1, angle: String(angle) }));
  }
  return editJunction(project, j, (jn) => withAngle(jn, a));
}

/** Mode de la jonction `j` (marches balancées, palier, marches rayonnantes). */
export function setJunctionMode(
  project: Project,
  j: number,
  mode: CageJunction["mode"],
): EditResult {
  return editJunction(project, j, (jn) => ({ ...jn, mode }));
}

/** Raccord côté jour de la jonction `j` (cotes arrondies au mm). */
export function setWellJoint(project: Project, j: number, well: WellJoint): EditResult {
  const r: WellJoint =
    well.kind === "arc"
      ? { kind: "arc", radius: roundMm(well.radius) }
      : well.kind === "newel"
        ? {
            kind: "newel",
            size: roundMm(well.size),
            ...(well.offset !== undefined ? { offset: roundMm(well.offset) } : {}),
          }
        : well.kind === "chamfer"
          ? {
              kind: "chamfer",
              setbackIn: roundMm(well.setbackIn),
              setbackOut: roundMm(well.setbackOut),
            }
          : { kind: "sharp" };
  return editJunction(project, j, (jn) => ({ ...jn, well: r }));
}

/** Raccord côté mur de la jonction `j` (rayon arrondi au mm). */
export function setWallJoint(project: Project, j: number, wall: WallJoint): EditResult {
  const r: WallJoint =
    wall.kind === "arc" ? { kind: "arc", radius: roundMm(wall.radius) } : { kind: "sharp" };
  return editJunction(project, j, (jn) => ({ ...jn, wall: r }));
}

// ------------------------------------------------------------------ Ajout, coupe, retrait

const STRAIGHT_LANDING: CageJunction = {
  angle: 0,
  mode: "landing",
  well: { kind: "sharp" },
  wall: { kind: "sharp" },
};

/** Nouveau tronçon pour `insertSection`. */
export interface NewSection {
  /** Partie droite (mm, ≥ 0). */
  readonly length: number;
  /** Largeur ; absente : largeur du tronçon voisin à cet endroit. */
  readonly width?: number;
  /** Jonction qui relie le nouveau tronçon ; absente : palier droit (angle 0). */
  readonly angle?: number;
  readonly mode?: CageJunction["mode"];
}

/**
 * Insère un tronçon droit à la position `index` (0 à n) : avant le premier (jonction ajoutée
 * après lui), après le dernier (jonction ajoutée avant lui), ou entre les tronçons `index − 1`
 * et `index` (la jonction existante reste avant lui, la nouvelle après). La jonction ajoutée est
 * un palier droit par défaut ; `removeSection(index)` rend alors le projet de départ.
 */
export function insertSection(project: Project, index: number, section: NewSection): EditResult {
  const from = editable(project);
  if (isError(from)) return from;
  const { sections, junctions } = from.cage;
  const n = sections.length;
  if (!(Number.isInteger(index) && index >= 0 && index <= n)) return sectionIndexError(index, n);
  const length = roundMm(section.length);
  if (!(length >= 0)) {
    return editError(
      msg("layout.cage.invalidSectionLength", {
        section: index + 1,
        length: String(section.length),
      }),
    );
  }
  const neighbourWidth =
    index > 0 ? (sections[index - 1]!.widthEnd ?? sections[index - 1]!.width) : sections[0]!.width;
  if (section.width !== undefined) {
    const e = checkWidth(index, section.width);
    if (e) return editError(e);
  }
  const added: CageSection = {
    axis: { kind: "straight", length },
    width: section.width !== undefined ? roundMm(section.width) : neighbourWidth,
  };
  const angle = section.angle !== undefined ? roundMm(section.angle) : 0;
  const junction: CageJunction =
    angle === 0
      ? STRAIGHT_LANDING
      : withAngle({ ...STRAIGHT_LANDING, mode: section.mode ?? "winders" }, angle);
  const nextSections = [...sections.slice(0, index), added, ...sections.slice(index)];
  // Jonction du nouveau tronçon : après lui, sauf en fin de cage (avant lui).
  const at = index === n ? n - 1 : index;
  const nextJunctions = [...junctions.slice(0, at), junction, ...junctions.slice(at)];
  return commitCage(project, from, nextSections, nextJunctions);
}

/**
 * Retire le tronçon `i`. Premier ou dernier : sa jonction disparaît. Intermédiaire : ses deux
 * jonctions fusionnent en une, d'angle la somme des deux (refus hors de ]−180°, 180°[), qui
 * garde les autres réglages de la jonction de plus grand angle (la première à égalité) ; à 0°,
 * palier droit (mode palier, raccords vifs). Refusé pour le dernier tronçon restant.
 */
export function removeSection(project: Project, i: number): EditResult {
  const from = editable(project);
  if (isError(from)) return from;
  const { sections, junctions } = from.cage;
  const n = sections.length;
  if (!validIndex(i, n)) return sectionIndexError(i, n);
  if (n === 1) {
    return editError(msg("layout.cage.sectionCount", { count: 0, max: CAGE_MAX_SECTIONS }));
  }
  const nextSections = sections.filter((_, k) => k !== i);
  if (i === 0) return commitCage(project, from, nextSections, junctions.slice(1));
  if (i === n - 1) return commitCage(project, from, nextSections, junctions.slice(0, -1));
  const a = junctions[i - 1]!;
  const b = junctions[i]!;
  const keep = Math.abs(b.angle) > Math.abs(a.angle) ? b : a;
  const sum = roundMm(a.angle + b.angle);
  if (!(Math.abs(sum) < 180)) {
    return editError(msg("layout.cage.angleOutOfRange", { junction: i, angle: String(sum) }));
  }
  const merged = sum === keep.angle ? keep : withAngle(keep, sum);
  return commitCage(project, from, nextSections, [
    ...junctions.slice(0, i - 1),
    merged,
    ...junctions.slice(i + 1),
  ]);
}

/** Largeur d'un tronçon droit à l'abscisse `x` de sa partie droite (interpolation linéaire). */
function widthAt(s: CageSection, length: number, x: number): number {
  const end = s.widthEnd ?? s.width;
  return length > 0 ? s.width + ((end - s.width) * x) / length : s.width;
}

/** Deux tronçons de part et d'autre d'un palier droit, largeurs interpolées et arrondies. */
function cutSection(
  s: CageSection,
  length: number,
  at: number,
  depth: number,
  secondLength: number,
): [CageSection, CageSection] {
  const { widthEnd: _e, axis: _a, ...base } = s;
  const w1 = roundMm(widthAt(s, length, at));
  const w2 = roundMm(widthAt(s, length, Math.min(length, at + depth)));
  const end = s.widthEnd ?? s.width;
  const first: CageSection = {
    axis: { kind: "straight", length: at },
    ...base,
    ...(w1 !== s.width ? { widthEnd: w1 } : {}),
  };
  const second: CageSection = {
    axis: { kind: "straight", length: secondLength },
    ...base,
    width: w2,
    ...(end !== w2 ? { widthEnd: end } : {}),
  };
  return [first, second];
}

/**
 * Coupe commune de `splitSection` et `insertLanding` : tronçon droit `i` de partie droite L
 * coupé à `at` du départ par un palier droit de profondeur `depth` (absente : largeur à la coupe,
 * F9, non écrite) ; `consume` : le palier est pris sur la partie droite (tracé conservé) ou
 * ajouté (montée allongée).
 */
function landingCut(
  project: Project,
  i: number,
  at: number | undefined,
  depth: number | undefined,
  consume: boolean,
): EditResult {
  const from = editable(project);
  if (isError(from)) return from;
  const { sections, junctions } = from.cage;
  if (!validIndex(i, sections.length)) return sectionIndexError(i, sections.length);
  const s = sections[i]!;
  if (s.axis.kind === "arc") return editError(msg("layout.edit.splitArc", { section: i + 1 }));
  const L = s.axis.length;
  if (L === "auto") return editError(msg("layout.edit.autoLength", { section: i + 1 }));
  const given = depth !== undefined ? roundMm(depth) : undefined;
  if (given !== undefined && !(given > 0)) {
    return editError(
      msg("layout.cage.invalidSectionLength", { section: i + 1, length: String(depth) }),
    );
  }
  const guess = given ?? roundMm(widthAt(s, L, L / 2));
  const x = at !== undefined ? roundMm(at) : roundMm(consume ? (L - guess) / 2 : L / 2);
  const outside = (depthText: number) =>
    editError(
      msg("layout.edit.splitOutside", { section: i + 1, length: L, depth: depthText, at: x }),
    );
  // Coupe hors de la partie droite : refus avant d'interpoler la largeur (pas d'extrapolation).
  if (!(x >= 0 && x <= L)) return outside(guess);
  const d = given ?? roundMm(widthAt(s, L, x));
  const rest = consume ? L - x - d : L - x;
  // Dernier tronçon : sa partie droite est toute son étendue (pas de jonction après lui), elle
  // doit rester non nulle (`checkSectionExtents`).
  const last = i === sections.length - 1;
  if (!(d > 0) || !(rest >= 0) || (last && rest === 0)) return outside(d);
  const [first, second] = cutSection(s, L, x, consume ? d : 0, rest);
  const landing: CageJunction =
    given !== undefined ? { ...STRAIGHT_LANDING, depth: given } : STRAIGHT_LANDING;
  return commitCage(
    project,
    from,
    [...sections.slice(0, i), first, second, ...sections.slice(i + 1)],
    [...junctions.slice(0, i), landing, ...junctions.slice(i)],
  );
}

/**
 * Coupe le tronçon droit `i` en deux par un palier droit pris **sur sa partie droite** : même
 * emprise, même ligne de foulée, même longueur totale (parties droites + profondeur du palier) ;
 * `at` : début du palier depuis le départ du tronçon (défaut : palier centré), `depth` :
 * profondeur (défaut : largeur à la coupe, F9). Largeur variable : largeurs interpolées.
 */
export function splitSection(project: Project, i: number, at?: number, depth?: number): EditResult {
  return landingCut(project, i, at, depth, true);
}

/**
 * Insère un palier droit (jonction d'angle 0) dans le tronçon droit `i`, à `at` de son départ
 * (défaut : au milieu) : la partie droite est conservée de part et d'autre, la montée s'allonge
 * de la profondeur du palier (`depth`, défaut : largeur à cet endroit, F9).
 */
export function insertLanding(
  project: Project,
  i: number,
  at?: number,
  depth?: number,
): EditResult {
  return landingCut(project, i, at, depth, false);
}

// ------------------------------------------------------------------ Glisser

/** Direction de montée d'une ligne transversale (normale gauche de gauche → droite). */
function lineDirection(line: LayoutSectionLine): Vec2 {
  return V.perpLeft(V.normalize(V.sub(line.right, line.left)));
}

function anchorPoint(line: LayoutSectionLine, anchor: Anchor): Vec2 {
  return anchor === "left"
    ? line.left
    : anchor === "right"
      ? line.right
      : V.lerp(line.left, line.right, 0.5);
}

function layoutSection(
  project: Project,
  layout: Layout,
  i: number,
):
  | { section: LayoutSection; spec: CageSection; cage: CageLayoutSpec }
  | { readonly error: Message } {
  const from = editable(project);
  if (isError(from)) return from;
  const n = from.cage.sections.length;
  if (!validIndex(i, n)) return sectionIndexError(i, n);
  const section = layout.sections?.[i];
  if (!section || layout.sections!.length !== n) return editError(msg("layout.edit.notComputed"));
  return { section, spec: from.cage.sections[i]!, cage: from.cage };
}

const DEG = 180 / Math.PI;

/**
 * Glisser de la fin du tronçon `i` jusqu'au point `point` (repère du site). Tronçon droit :
 * nouvelle partie droite = projection de `point` sur la direction u du tronçon depuis le point
 * d'ancrage de sa ligne de départ (F11 : bord d'ancrage, milieu par défaut), arrondie, ≥ 0
 * (≥ 1 mm quand une partie droite nulle laisserait le tronçon sans étendue : dernier tronçon
 * après un palier droit, tronçon unique). Tronçon en arc : balayage = angle, autour du centre et
 * dans le sens de la courbe, du point d'ancrage de départ à `point` (degré entier, de 1° à
 * 359°). Le départ du tronçon ne dépend pas de sa longueur : idempotent (même point sur le
 * projet obtenu : même projet), monotone, et la fin suit le pointeur (au mm près).
 */
export function dragSectionEnd(
  project: Project,
  layout: Layout,
  i: number,
  point: Vec2,
): EditResult {
  const found = layoutSection(project, layout, i);
  if (isError(found)) return found;
  const { section, spec, cage } = found;
  const start = anchorPoint(section.start, spec.anchor ?? "center");
  if (spec.axis.kind === "arc" && section.arc) {
    const sign = spec.axis.sweep < 0 ? -1 : 1;
    const c = section.arc.center;
    let s = sign * V.signedAngle(V.sub(start, c), V.sub(point, c));
    if (s <= 0) s += 2 * Math.PI;
    const sweep = sign * Math.min(359, Math.max(1, roundMm(s * DEG)));
    return setSectionAxis(project, i, { ...spec.axis, sweep });
  }
  const u = lineDirection(section.start);
  const zeroOk = (i > 0 && cage.junctions[i - 1]!.angle !== 0) || i < cage.junctions.length;
  const length = Math.max(zeroOk ? 0 : 1, roundMm(V.dot(V.sub(point, start), u)));
  return setSectionLength(project, i, length);
}

/** Pas de la sonde de `dragWidth` (mm de largeur), réglage numérique sans valeur métier. */
const WIDTH_PROBE = 100;
/** Pente sous laquelle le bord tiré est tenu pour fixe (mm de bord par mm de largeur). */
const FIXED_EDGE_SLOPE = 0.25;

/**
 * Glisser d'un bord (`edge`) du tronçon `i` à son départ ou à son arrivée (`end`) jusqu'au point
 * `point`. Arrivée d'un tronçon droit d'une cage : `widthEnd` ; départ, ou axe en arc : `width` ;
 * tracé à volées : largeur commune. Le bord qui reste en place quand la largeur change dépend
 * du tracé (bord gauche au départ de l'escalier, bord du jour après un tournant, bord ou milieu
 * d'ancrage ailleurs, mur extérieur d'une volée suivante…) : plutôt que de le déduire, le
 * mutateur **sonde le moteur** (`computeLayout` sur la largeur ± `WIDTH_PROBE`), lit la pente k
 * de la position du bord tiré, mesurée le long de la ligne, et résout la largeur qui amène ce
 * bord au droit de `point` (position affine en largeur). Le bord suit donc le pointeur au mm
 * près, et réappliquer le même point au projet obtenu le rend inchangé. Refus
 * `layout.edit.fixedEdge` si le bord tiré ne bouge pas avec la largeur (|k| < 1/4) ; point au
 * droit du bord actuel : même projet. Largeur arrondie, au moins 1 mm.
 */
export function dragWidth(
  project: Project,
  layout: Layout,
  i: number,
  end: "start" | "end",
  edge: "left" | "right",
  point: Vec2,
): EditResult {
  const found = layoutSection(project, layout, i);
  if (isError(found)) return found;
  const { section, spec } = found;
  const line = section[end];
  const span = V.sub(line.right, line.left);
  const w = V.norm(span);
  if (!(w > 0)) return editError(msg("layout.edit.notComputed"));
  const dir = V.scale(span, 1 / w);
  const along = (q: Vec2) => V.dot(V.sub(q, line.left), dir);
  const target = along(point);
  const current = edge === "left" ? 0 : w;
  if (Math.abs(target - current) < 0.5) return { project };
  const spec0 = project.stair.layout;
  const setsEnd = spec0.kind === "cage" && end === "end" && spec.axis.kind === "straight";
  const value =
    spec0.kind !== "cage" && spec0.kind !== "helical"
      ? spec0.width
      : setsEnd
        ? (spec.widthEnd ?? spec.width)
        : spec.width;
  const withValue = (v: number) =>
    setSectionWidth(project, i, setsEnd ? { widthEnd: v } : { width: v });
  // Pente du bord tiré, lue sur le tracé recalculé à largeur ± WIDTH_PROBE.
  let slope: number | undefined;
  let refusal: Message | undefined;
  for (const delta of [WIDTH_PROBE, -WIDTH_PROBE]) {
    if (value + delta < 1) continue;
    const trial = withValue(value + delta);
    if (trial.error) {
      refusal ??= trial.error;
      continue;
    }
    let moved: Vec2 | undefined;
    try {
      moved = computeLayout(trial.project).sections?.[i]?.[end][edge];
    } catch {
      moved = undefined;
    }
    if (!moved) continue;
    slope = (along(moved) - current) / delta;
    break;
  }
  if (slope === undefined) return editError(refusal ?? msg("layout.edit.notComputed"));
  if (!(Math.abs(slope) >= FIXED_EDGE_SLOPE)) {
    return editError(msg("layout.edit.fixedEdge", { section: i + 1 }));
  }
  // Largeur exacte qui amène le bord au point ; la largeur actuelle en est déjà l'arrondi :
  // sans effet (réappliquer le même point au résultat le rend inchangé, même si |k| > 1).
  const exact = value + (target - current) / slope;
  if (Math.abs(exact - value) <= 0.5 + 1e-6) return { project };
  return withValue(Math.max(1, roundMm(exact)));
}

/**
 * Repère d'une jonction pour l'éditeur : pivot (milieu de la ligne d'arrivée du tronçon
 * entrant), directions entrante et sortante.
 */
export interface JunctionFrame {
  readonly pivot: Vec2;
  readonly incoming: Vec2;
  readonly outgoing: Vec2;
}

/**
 * Repère de la jonction `j` lu dans le `Layout` : pivot = milieu de la ligne d'arrivée du
 * tronçon entrant, qui ne dépend pas de l'angle de la jonction (le coin du jour K, lui, change
 * de bord avec le signe de l'angle) ; directions de montée à l'arrivée du tronçon entrant et au
 * départ du sortant. La poignée d'angle se place sur `pivot + r·outgoing` ; `null` si le tracé
 * ne porte pas ces tronçons.
 */
export function junctionFrame(layout: Layout, j: number): JunctionFrame | null {
  const a = layout.sections?.[j];
  const b = layout.sections?.[j + 1];
  if (!a || !b) return null;
  return {
    pivot: V.lerp(a.end.left, a.end.right, 0.5),
    incoming: lineDirection(a.end),
    outgoing: lineDirection(b.start),
  };
}

/**
 * Glisser de la poignée d'angle de la jonction `j` jusqu'au point `point` : angle signé, au
 * degré entier, de la direction entrante à la direction pivot → `point` (`junctionFrame`), borné
 * à [−179°, 179°] (domaine du schéma). Point confondu avec le pivot : sans effet. Le pivot et la
 * direction entrante ne dépendent pas de l'angle : réappliquer le même point au projet obtenu le
 * rend inchangé, y compris en traversant 0°.
 *
 * Passer par 0° impose un palier droit (mode palier, raccords vifs : `setJunctionAngle`), sans
 * mémoire du mode et des raccords d'avant : l'interface applique chaque pas du glisser au projet
 * **du début du geste**, pas au résultat du pas précédent, pour qu'un passage par 0° ne perde
 * pas le balancement ni le raccord du jour.
 */
export function dragJunctionAngle(
  project: Project,
  layout: Layout,
  j: number,
  point: Vec2,
): EditResult {
  const from = editable(project);
  if (isError(from)) return from;
  const count = from.cage.junctions.length;
  if (!validIndex(j, count)) return junctionIndexError(j, count);
  const frame = layout.sections?.length === count + 1 ? junctionFrame(layout, j) : null;
  if (!frame) return editError(msg("layout.edit.notComputed"));
  const d = V.sub(point, frame.pivot);
  if (!(V.norm(d) > 0)) return { project };
  const angle = Math.min(179, Math.max(-179, roundMm(V.signedAngle(frame.incoming, d) * DEG)));
  return setJunctionAngle(project, j, angle);
}
