/**
 * Étape « Visserie » du pipeline (QUESTIONS A27, décision du 2026-10-06) : éléments de visserie
 * (`Model.fasteners`) déduits des assemblages boulonnés ou vissés que le modèle connaît déjà, et
 * nulle part ailleurs (aucune visserie inventée).
 *
 * Sources, dans l'ordre des pièces du modèle :
 *
 * 1. **Fixations déclarées** par la pièce (`Part.fixings`) : supports de marche vissés
 *    (`supportBolted`, un boulon par perçage, lumière comprise ; `treadScrewed`, vis de la
 *    marche dans l'aile horizontale), contremarche d'arrivée pliée fixée au chevêtre
 *    (`riserTrimmer`). Un plugin déclare ainsi tout nouvel assemblage (point d'extension).
 * 2. **Platines percées** (catégorie `fixing`, perçages de `flat.outline.holes`) sans fixation
 *    déclarée : pied et tête de limon, about limon ↔ poteau, pied de poteau, de `steel-flat` et
 *    `steel-curved`. Assemblée à deux pièces ou plus (`assembledWith`) : `plateBolted` ; sinon
 *    selon l'orientation du solide : normale verticale → `plateFloor` (sol), sinon
 *    `plateTrimmer` (platine de tête contre le chevêtre). Diamètre de perçage : largeur du trou
 *    perpendiculaire à sa plus grande étendue (cercle : diamètre ; lumière : largeur).
 * 3. **Garde-corps** (`GuardsAnalysis`) : poteaux de la trémie (`guardPostFloor`) ou d'un
 *    rampant, `perPoint` éléments par poteau. Un poteau de rampant est fixé sur l'escalier, dont
 *    le support se lit sur le matériau des pièces porteuses (« type de fixation selon le
 *    support », A27) : limons et crémaillères, à défaut (limon central, noyau) les marches ;
 *    l'une au moins en bois → `guardPostStair` (bois), sinon `guardPostStairMetal`. Le modèle ne
 *    situe pas la fixation du poteau sur une pièce précise : l'élément ne porte que le poteau.
 *    Mains courantes murales (`onGuard` faux) : supports au plus à `bracketSpacing` d'entraxe
 *    sur la longueur de la main courante (nombre = ⌈L / entraxe⌉ + 1, hypothèse « à valider »
 *    documentée dans `FASTENER_PROVENANCE`), `perPoint` éléments par support, `handrailWall` sur
 *    un mur porteur (`Wall.loadBearing`), `handrailPartition` sur une cloison ; mur non décrit
 *    par le site (mur imposé par le projet, sans `wallId`) : selon `unknownWallLoadBearing` du
 *    profil (« à valider »), élément marqué `unknownWall`. Le support de main courante lui-même
 *    (quincaillerie) n'est pas un élément de visserie : son nombre figure dans
 *    `Fastener.origin`.
 *
 * Vis de marche (`treadScrewed`) : seulement sous une marche **bois** portée par le support
 * (assemblage support ↔ marche) ; une marche en tôle pliée n'a pas de perçage correspondant
 * dans son développé (assemblage non décrit) : aucun élément.
 *
 * Diamètre nominal déduit (`nominalDiameterFor`) = plus grand diamètre de la série du profil
 * (`nominalDiameters`) qui passe dans le perçage avec le jeu minimal `holeClearance` (M12 dans
 * 13 ou 14 mm, M16 dans 18 mm) ; sans perçage dimensionné (ou perçage trop petit pour la
 * série), diamètre du profil d'atelier. Quantité = points × `perPoint`. Nature, classe,
 * longueur, `perPoint`, série et jeu viennent du profil d'atelier (« à valider »).
 *
 * Repères : `VS1`, `VS2`… un par désignation identique (nature, classe, diamètre, longueur),
 * dans l'ordre d'apparition.
 */
import { dec, msg, type Message } from "@blondel/i18n";
import type { Part, PartFixing } from "../model/derived.js";
import {
  fastenerGradeLabel,
  fastenerKindLabel,
  type Fastener,
  type FastenerDeducedField,
  type FastenerKind,
} from "../model/fasteners.js";
import type { Wall } from "../model/project.js";
import type { Mm, Vec2, Vec3 } from "../model/primitives.js";
import type { GuardsAnalysis, HandrailRun } from "../guards/types.js";
import type { FastenerProfile } from "../workshop/fasteners.js";

/** Préfixe des repères de visserie (non traduit). */
export const FASTENER_MARK_PREFIX = "VS";

export interface FastenerInput {
  /** Pièces finales du modèle (`assembledWith` normalisé). */
  readonly parts: readonly Part[];
  /** Analyse des garde-corps (absente ou `null` : aucun garde-corps). */
  readonly guards?: GuardsAnalysis | null;
  /** Murs du site (`Wall.loadBearing` des mains courantes murales). */
  readonly walls: readonly Wall[];
  /** Visserie du profil d'atelier (`resolveWorkshopProfile(...).fasteners`). */
  readonly profile: FastenerProfile;
}

/** Fixation interne : celle d'une pièce, avec son origine et ce qui est déduit. */
interface Fixing extends PartFixing {
  /** Quantité déduite du modèle (perçages comptés). */
  readonly drilled: boolean;
  /** Main courante murale sur un mur que le site ne décrit pas. */
  readonly unknownWall?: boolean;
}

/** Natures désignées par un filetage métrique (« M12 ») ; les autres par un diamètre (« Ø6 »). */
const METRIC_KINDS: ReadonlySet<FastenerKind> = new Set([
  "bolt",
  "machine-screw",
  "anchor",
  "chemical-anchor",
]);

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Tolérance (mm) de la comparaison diamètre + jeu ≤ perçage. */
const HOLE_EPS: Mm = 1e-6;

/**
 * Diamètre nominal d'un élément logé dans un perçage : plus grand diamètre de la série qui y
 * passe avec le jeu minimal (`d + jeu ≤ perçage`) ; `NaN` si aucun (perçage trop petit, série
 * vide, perçage non fini).
 */
export function nominalDiameterFor(hole: Mm, series: readonly Mm[], clearance: Mm): Mm {
  let best = Number.NaN;
  if (!Number.isFinite(hole)) return best;
  for (const d of series) if (d > 0 && d + clearance <= hole + HOLE_EPS && !(d <= best)) best = d;
  return best;
}

/**
 * Diamètre d'un perçage décrit par son contour : largeur perpendiculaire à sa plus grande
 * étendue (cercle : diamètre ; lumière oblongue : largeur).
 */
export function holeDiameterOf(hole: readonly Vec2[]): Mm {
  if (hole.length < 3) return Number.NaN;
  let best = -1;
  let dir: Vec2 = { x: 1, y: 0 };
  for (let i = 0; i < hole.length; i++)
    for (let j = i + 1; j < hole.length; j++) {
      const dx = hole[j]!.x - hole[i]!.x;
      const dy = hole[j]!.y - hole[i]!.y;
      const d = Math.hypot(dx, dy);
      if (d > best) {
        best = d;
        dir = { x: dx / d, y: dy / d };
      }
    }
  const proj = hole.map((p) => -dir.y * p.x + dir.x * p.y);
  return Math.max(...proj) - Math.min(...proj);
}

/** Fixations d'une platine percée (catégorie `fixing`), lues sur son développé. */
function plateFixings(part: Part): Fixing[] {
  const holes = part.flat?.outline.holes ?? [];
  if (holes.length === 0) return [];
  const partners = part.assembledWith ?? [];
  let joint: PartFixing["joint"];
  if (partners.length >= 2) joint = "plateBolted";
  else {
    const z = part.solid.kind === "extrusion" ? part.solid.frame.zAxis.z : 1;
    joint = Math.abs(z) > 0.9 ? "plateFloor" : "plateTrimmer";
  }
  // Un élément par diamètre de perçage (toutes les platines du cœur n'en ont qu'un).
  const byDiameter = new Map<number, number>();
  for (const h of holes) {
    const d = round1(holeDiameterOf(h));
    if (!Number.isFinite(d) || d <= 0) continue;
    byDiameter.set(d, (byDiameter.get(d) ?? 0) + 1);
  }
  return [...byDiameter].map(([holeDiameter, points]) => ({
    joint,
    points,
    holeDiameter,
    ...(joint === "plateBolted" ? { with: partners } : {}),
    drilled: true,
  }));
}

/** Longueur développée d'une main courante (balayage), sinon longueur de débit. */
function handrailLength(part: Part | undefined, run: HandrailRun): Mm {
  if (part?.solid.kind === "sweep") {
    const path: readonly Vec3[] = part.solid.path;
    let L = 0;
    for (let i = 1; i < path.length; i++)
      L += Math.hypot(
        path[i]!.x - path[i - 1]!.x,
        path[i]!.y - path[i - 1]!.y,
        path[i]!.z - path[i - 1]!.z,
      );
    if (L > 0) return L;
  }
  return part?.stock?.length ?? run.to - run.from;
}

/**
 * Mur porteur ou cloison le long d'une main courante murale ; `undefined` si le site ne décrit
 * pas ce mur (le profil d'atelier tranche).
 */
function loadBearingOf(
  run: HandrailRun,
  guards: GuardsAnalysis,
  walls: readonly Wall[],
): boolean | undefined {
  const side = guards.sides.find((s) => s.side === run.side);
  const ivs = (side?.intervals ?? []).filter((iv) => iv.kind === "wall");
  const exact = ivs.find(
    (iv) => Math.abs(iv.from - run.from) < 1e-6 && Math.abs(iv.to - run.to) < 1e-6,
  );
  const overlap = (iv: (typeof ivs)[number]): number =>
    Math.min(iv.to, run.to) - Math.max(iv.from, run.from);
  const iv = exact ?? [...ivs].sort((a, b) => overlap(b) - overlap(a))[0];
  const wall = iv?.wallId !== undefined ? walls.find((w) => w.id === iv.wallId) : undefined;
  return wall?.loadBearing;
}

/** Matériau bois (`wood-…`). */
const isWood = (p: Part): boolean => p.material.startsWith("wood-");

/**
 * Support des poteaux de rampant : bois si une pièce porteuse au moins est en bois — limons et
 * crémaillères, à défaut (limon central, noyau, aucune pièce de structure latérale) marches et
 * paliers.
 */
function stairSupportIsWood(parts: readonly Part[]): boolean {
  const sides = parts.filter((p) => p.category === "stringer" || p.category === "carriage");
  const carriers =
    sides.length > 0
      ? sides
      : parts.filter((p) => p.category === "tread" || p.category === "landing");
  return carriers.some(isWood);
}

/** Fixations des pièces de garde-corps (poteaux, mains courantes murales), par pièce. */
function guardFixings(
  guards: GuardsAnalysis,
  byId: ReadonlyMap<string, Part>,
  walls: readonly Wall[],
  profile: FastenerProfile,
): Map<string, Fixing[]> {
  const out = new Map<string, Fixing[]>();
  const add = (id: string, f: Fixing): void => {
    if (!byId.has(id)) return;
    const list = out.get(id) ?? [];
    list.push(f);
    out.set(id, list);
  };
  const seen = new Set<string>();
  const stairJoint = stairSupportIsWood([...byId.values()])
    ? "guardPostStair"
    : "guardPostStairMetal";
  for (const run of guards.runs) {
    for (const id of run.postPartIds) {
      // Poteau partagé par deux lignes (angle de trémie) : compté une fois.
      if (seen.has(id)) continue;
      seen.add(id);
      add(id, {
        joint: run.kind === "rake" ? stairJoint : "guardPostFloor",
        points: 1,
        drilled: false,
      });
    }
  }
  for (const hr of guards.handrails) {
    if (hr.onGuard) continue;
    const L = handrailLength(byId.get(hr.partId), hr);
    if (!(L > 0) || !(profile.bracketSpacing > 0)) continue;
    const brackets = Math.ceil(L / profile.bracketSpacing - 1e-9) + 1;
    const known = loadBearingOf(hr, guards, walls);
    const joint = (known ?? profile.unknownWallLoadBearing) ? "handrailWall" : "handrailPartition";
    add(hr.partId, {
      joint,
      points: brackets,
      drilled: false,
      ...(known === undefined ? { unknownWall: true } : {}),
    });
  }
  return out;
}

/** Origine d'un élément (assemblage décrit avec les repères des pièces). */
function originOf(f: PartFixing, mark: string, withMarks: string): Message {
  switch (f.joint) {
    case "plateFloor":
      return msg("fastener.origin.plateFloor", { mark });
    case "plateTrimmer":
      return msg("fastener.origin.plateTrimmer", { mark });
    case "plateBolted":
      return msg("fastener.origin.plateBolted", { mark, with: withMarks });
    case "supportBolted":
      return msg("fastener.origin.supportBolted", { mark, with: withMarks });
    case "treadScrewed":
      return msg("fastener.origin.treadScrewed", { mark, with: withMarks });
    case "riserTrimmer":
      return msg("fastener.origin.riserTrimmer", { mark });
    case "guardPostFloor":
      return msg("fastener.origin.guardPostFloor", { mark });
    case "guardPostStair":
    case "guardPostStairMetal":
      return msg("fastener.origin.guardPostStair", { mark });
    case "handrailWall":
      return msg("fastener.origin.handrailWall", { mark, count: f.points });
    case "handrailPartition":
      return msg("fastener.origin.handrailPartition", { mark, count: f.points });
  }
}

/** Désignation complète (« Boulon M12 × 100, classe 8.8 »). */
export function fastenerName(
  kind: FastenerKind,
  grade: Fastener["grade"],
  diameter: Mm,
  length: Mm,
): Message {
  return msg(METRIC_KINDS.has(kind) ? "fastener.name.metric" : "fastener.name.plain", {
    kind: fastenerKindLabel(kind),
    diameter: dec(diameter, 1),
    length: dec(length, 0),
    grade: fastenerGradeLabel(grade),
  });
}

/**
 * Visserie du modèle (voir l'en-tête du module) : une entrée par assemblage d'origine, dans
 * l'ordre des pièces ; liste vide sans assemblage connu. Fonction pure.
 */
export function computeFasteners(input: FastenerInput): Fastener[] {
  const { parts, guards, walls, profile } = input;
  const byId = new Map<string, Part>();
  const rank = new Map<string, number>();
  parts.forEach((p, i) => {
    if (!byId.has(p.id)) {
      byId.set(p.id, p);
      rank.set(p.id, i);
    }
  });
  const fromGuards = guards
    ? guardFixings(guards, byId, walls, profile)
    : new Map<string, Fixing[]>();
  const marks = new Map<string, string>();
  const ids = new Set<string>();
  const out: Fastener[] = [];
  for (const part of parts) {
    const declared: Fixing[] = part.fixings
      ? part.fixings.map((f) => ({ ...f, drilled: true }))
      : part.category === "fixing"
        ? plateFixings(part)
        : [];
    for (const f of [...declared, ...(fromGuards.get(part.id) ?? [])]) {
      const points = Math.floor(f.points);
      if (!(points > 0)) continue;
      let partners = (f.with ?? []).filter((id) => byId.has(id) && id !== part.id);
      if (f.joint === "treadScrewed") {
        // Marche bois portée par le support (assemblage support ↔ marche).
        const treads = (part.assembledWith ?? [])
          .map((id) => byId.get(id))
          .filter(
            (p): p is Part =>
              p !== undefined && (p.category === "tread" || p.category === "landing"),
          );
        if (!treads.some(isWood)) continue;
        partners = treads.filter(isWood).map((t) => t.id);
      }
      const setting = profile.joints[f.joint];
      const nominal =
        f.holeDiameter !== undefined
          ? nominalDiameterFor(f.holeDiameter, profile.nominalDiameters, profile.holeClearance)
          : NaN;
      const deducedDiameter = Number.isFinite(nominal) && nominal > 0;
      const diameter = deducedDiameter ? nominal : setting.diameter;
      const deduced: FastenerDeducedField[] = [];
      if (deducedDiameter) deduced.push("diameter");
      if (f.drilled) deduced.push("quantity");
      const key = `${setting.kind}|${setting.grade}|${diameter}|${setting.length}`;
      let mark = marks.get(key);
      if (mark === undefined) {
        mark = `${FASTENER_MARK_PREFIX}${marks.size + 1}`;
        marks.set(key, mark);
      }
      let id = `fastener-${f.joint}-${part.id}`;
      for (let k = 2; ids.has(id); k++) id = `fastener-${f.joint}-${part.id}-${k}`;
      ids.add(id);
      const partIds = [...new Set([part.id, ...partners])].sort(
        (a, b) => rank.get(a)! - rank.get(b)!,
      );
      const withMarks = partners.map((pid) => byId.get(pid)!.mark).join(", ");
      out.push({
        id,
        mark,
        kind: setting.kind,
        grade: setting.grade,
        diameter,
        length: setting.length,
        quantity: points * setting.perPoint,
        joint: f.joint,
        name: fastenerName(setting.kind, setting.grade, diameter, setting.length),
        origin: originOf({ ...f, points }, part.mark, withMarks),
        partIds,
        deduced,
        ...(f.unknownWall ? { unknownWall: true as const } : {}),
      });
    }
  }
  return out;
}
