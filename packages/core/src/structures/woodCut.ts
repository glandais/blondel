/**
 * Plugin `wood-cut` : limons bois à l'anglaise (crémaillères), C §1.4.
 *
 * - **Escalier droit seulement au J3a** (le tableau FCBA ne couvre que l'escalier droit) : un
 *   tracé tournant rend une erreur explicite et aucune crémaillère.
 * - **Deux crémaillères** (par paire, domaine du tableau FCBA), sous les extrémités des
 *   marches : face extérieure de chaque crémaillère à `inset` du bord de l'emmarchement
 *   (C_i, C_e), épaisseur prise vers l'intérieur ; les marches reposent à plat sur les dents
 *   [choix Blondel à valider : position des crémaillères sous les marches].
 * - **Entailles** : pour chaque marche, assise horizontale au niveau du dessous de la marche,
 *   de la face verticale de la dent précédente à la suivante ; face verticale d'une dent =
 *   ligne de nez décalée du débord et, s'il y a des contremarches pleines, de leur épaisseur
 *   (la contremarche s'appuie devant la dent).
 * - **Reste sous entaille** h_res : distance perpendiculaire entre les fonds d'entaille et la
 *   sous-face rampante (rive basse droite). `auto` : valeur exigée par le tableau FCBA quand il
 *   est exploitable, sinon `residualFallback` (à valider).
 * - Contrôles : CREMAILLERE_REGLE_MOYENS (tableau FCBA lu dans rules.yaml, `non-evaluee` hors
 *   de son domaine), LIMON_EPAISSEUR_MIN_DTU, longueur de plateau et débit (profil d'atelier).
 *
 * Domaine d'exploitation du tableau [hypothèse Blondel, à valider] : escalier droit, classe de
 * résistance connue (C30 résineux, D40 feuillus), épaisseur ≥ la plus petite épaisseur
 * tabulée, hauteur à monter ≤ celle de l'exemple (2,70 m) et projection horizontale de la
 * crémaillère ≤ celle de l'exemple (2,70 m / tan 38°) : moment de flexion d'une poutre
 * rampante ∝ portée horizontale², donc exemple du côté de la sécurité.
 */
import { z } from "zod";
import { intersectLines } from "../geom2d/intersect.js";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import type { FlatPattern, NosingLine, Part } from "../model/derived.js";
import type { Mm, Polygon2, Vec2 } from "../model/primitives.js";
import type { StructureContext, StructureKind, StructureOutput } from "../model/plugins.js";
import { fmt } from "../rules/check.js";
import {
  WOOD_MATERIALS,
  resolveWorkshopProfile,
  type WoodMaterialId,
} from "../workshop/profile.js";
import { CheckCollector, FAB_RULES, pluginRuleDef } from "./checks.js";
import { CREMAILLERE_RULE_ID, fcbaTable, requiredResidual, type StrengthClass } from "./fcba.js";
import { area, clipHalfPlane, minAreaRect, pointSegmentDistance, removeCollinear } from "./geom.js";
import { stairGeometry } from "./legs.js";
import { woodQuantities } from "./quantities.js";
import { stockOf } from "./woodHoused.js";

const mmInt = z.number().int();
const mmPos = mmInt.positive();
const mmNonNeg = mmInt.nonnegative();

export const WoodCutParamsSchema = z.object({
  material: z.enum(WOOD_MATERIALS).default("wood-oak"),
  /** Épaisseur finie des crémaillères. */
  thickness: mmPos.default(45),
  /** Reste sous entaille (perpendiculaire à la sous-face) ; `auto` : tableau FCBA ou repli. */
  residual: z.union([mmPos, z.literal("auto")]).default("auto"),
  /** Reste sous entaille retenu quand le tableau FCBA n'est pas exploitable (à valider). */
  residualFallback: mmPos.default(180),
  /**
   * Classe de résistance ; `auto` : C30 pour le pin, D40 pour chêne, hêtre, frêne
   * [hypothèse à valider : classe réelle selon le classement du bois], inconnue pour le
   * lamellé-collé.
   */
  strengthClass: z.enum(["C30", "D40", "unknown", "auto"]).default("auto"),
  /** Retrait de la face extérieure des crémaillères sous le bout des marches (à valider). */
  inset: mmNonNeg.default(0),
});
export type WoodCutParams = z.output<typeof WoodCutParamsSchema>;

const AUTO_CLASS: Readonly<Record<WoodMaterialId, StrengthClass | "unknown">> = {
  "wood-pine": "C30",
  "wood-oak": "D40",
  "wood-beech": "D40",
  "wood-ash": "D40",
  "wood-glulam": "unknown",
};

export interface CarriageDetail {
  readonly part: Part;
  readonly outline: Polygon2;
  /** Fonds d'entaille (u, z). */
  readonly notches: readonly Vec2[];
  /** Rive basse : point et direction. */
  readonly lowerRive: { readonly point: Vec2; readonly dir: Vec2 };
  /** Reste sous entaille mesuré (min perpendiculaire). */
  readonly residual: Mm;
  readonly mirrored: boolean;
}

export interface CutResult {
  readonly output: StructureOutput;
  readonly carriages: readonly CarriageDetail[];
  readonly residual: Mm;
  /** Raison pour laquelle le tableau FCBA n'est pas exploitable (absent : exploitable). */
  readonly fcbaUnusable?: string;
}

/** Point de la ligne de nez décalée de d vers le haut qui coupe la droite (a, dir). */
function crossing(nosing: NosingLine, climb: Vec2, d: Mm, a: Vec2, dir: Vec2): Mm | null {
  let up = V.perpLeft(nosing.dir);
  if (V.dot(up, climb) < 0) up = V.scale(up, -1);
  const hit = intersectLines(
    { origin: V.addScaled(nosing.p, up, d), dir: nosing.dir },
    { origin: a, dir },
  );
  return hit ? V.dot(V.sub(hit.point, a), dir) : null;
}

export function buildWoodCut(ctx: StructureContext, params: WoodCutParams): CutResult {
  const { project, layout, stepping } = ctx;
  const profile = resolveWorkshopProfile(project.workshop);
  const notes: string[] = [];
  const nosings = stepping.nosings;
  const n = nosings.length;
  const e = params.thickness;
  const spec = project.stair.treads;
  const table = fcbaTable();
  const cls = params.strengthClass === "auto" ? AUTO_CLASS[params.material] : params.strengthClass;

  if (project.stair.layout.turns.length > 0) {
    return {
      output: {
        parts: [],
        checks: [],
        notes,
        errors: [
          "Crémaillères (limon à l'anglaise) : escalier tournant non supporté au jalon 3a (escalier droit seulement).",
        ],
      },
      carriages: [],
      residual: Number.NaN,
      fcbaUnusable: "escalier tournant",
    };
  }
  if (n < 2) {
    return {
      output: { parts: [], checks: [], notes, errors: ["Crémaillères : découpage vide."] },
      carriages: [],
      residual: Number.NaN,
    };
  }

  const geo = stairGeometry(project, layout);
  const leg = geo.legs[0]!;
  const H = project.site.floorToFloor;
  const run = Math.abs(nosings[n - 1]!.s - nosings[0]!.s);
  const maxRun = table.floorToFloor / Math.tan((table.pitchDeg * Math.PI) / 180);
  let fcbaUnusable: string | undefined;
  let required: number | null = null;
  if (cls === "unknown")
    fcbaUnusable = "classe de résistance inconnue (lamellé-collé ou non précisée)";
  else {
    required = requiredResidual(table, cls, e);
    if (required === null)
      fcbaUnusable = `épaisseur ${fmt(e, 0)} mm inférieure à la plus petite épaisseur du tableau (${cls})`;
    else if (H > table.floorToFloor)
      fcbaUnusable = `hauteur à monter ${fmt(H, 0)} mm > ${fmt(table.floorToFloor, 0)} mm (exemple FCBA)`;
    else if (run > maxRun + 1e-6)
      fcbaUnusable = `projection horizontale ${fmt(run, 0)} mm > ${fmt(maxRun, 0)} mm (exemple FCBA : ${fmt(table.floorToFloor, 0)} mm à ${fmt(table.pitchDeg, 0)}°)`;
  }
  const residual =
    params.residual !== "auto"
      ? params.residual
      : fcbaUnusable === undefined && required !== null
        ? required
        : params.residualFallback;

  const tm = spec.thickness;
  const toothOffset = spec.nosing + (spec.risers === "full" ? spec.riserThickness : 0);
  const carriages: CarriageDetail[] = [];
  const stocks = new Map<string, ReturnType<typeof stockOf>>();
  for (const side of ["inner", "outer"] as const) {
    const edgeStart = side === "inner" ? leg.innerOrigin : leg.outerStart;
    const inward = side === "inner" ? leg.n : V.scale(leg.n, -1);
    const a = V.addScaled(edgeStart, inward, params.inset + e);
    const dir = leg.u;
    const into = V.scale(inward, -1);
    const us: Mm[] = [];
    for (const k of nosings) {
      const u = crossing(k, dir, toothOffset, a, dir);
      if (u === null) break;
      us.push(u);
    }
    if (us.length !== n) {
      notes.push(
        `Crémaillère ${side === "inner" ? "côté jour" : "côté mur"} : lignes de nez parallèles à la crémaillère, non générée.`,
      );
      continue;
    }
    const z = nosings.map((k) => k.z);
    const top: Vec2[] = [V.vec(us[0]!, 0)];
    for (let k = 0; k + 1 < n; k++) {
      top.push(V.vec(us[k]!, z[k]! - tm), V.vec(us[k + 1]!, z[k]! - tm));
    }
    const notches = us.slice(1).map((u, i) => V.vec(u, z[i]! - tm));
    // Rive basse : direction des fonds d'entaille, décalée du reste sous entaille.
    const w =
      notches.length >= 2
        ? V.normalize(V.sub(notches[notches.length - 1]!, notches[0]!))
        : V.normalize(V.vec(us[n - 1]! - us[0]!, z[n - 1]! - z[0]!));
    const down = V.perpRight(w);
    const ref = notches[0] ?? V.vec(us[0]!, z[0]! - tm);
    const worst = Math.max(
      ...(notches.length > 0 ? notches : [ref]).map((p) => V.dot(V.sub(p, ref), down)),
    );
    const rivePoint = V.addScaled(ref, down, residual + worst);
    const riveAt = (u: Mm): Mm => rivePoint.y + ((u - rivePoint.x) * w.y) / w.x;
    const raw = [...top, V.vec(us[n - 1]!, riveAt(us[n - 1]!)), V.vec(us[0]!, riveAt(us[0]!))];
    let outline = ensureCCW(
      removeCollinear(clipHalfPlane(ensureCCW(raw), V.vec(0, 0), V.vec(0, 1))),
    );
    if (outline.length < 3 || area(outline) <= 0) {
      notes.push(
        `Crémaillère ${side === "inner" ? "côté jour" : "côté mur"} : contour dégénéré, non générée.`,
      );
      continue;
    }
    const measured = Math.min(
      ...(notches.length > 0 ? notches : [ref]).map((p) =>
        pointSegmentDistance(p, V.addScaled(rivePoint, w, -1e5), V.addScaled(rivePoint, w, 1e5)),
      ),
    );
    const mirrored = V.dot(V.perpRight(into), dir) < 0;
    let uMin = Infinity;
    let uMax = -Infinity;
    for (const p of outline) {
      uMin = Math.min(uMin, p.x);
      uMax = Math.max(uMax, p.x);
    }
    const T = (p: Vec2): Vec2 => (mirrored ? V.vec(uMax - p.x, p.y) : V.vec(p.x - uMin, p.y));
    const flatOuter = mirrored ? outline.map(T).reverse() : outline.map(T);
    const id = side === "inner" ? "carriage-inner-1" : "carriage-outer-1";
    const mark = side === "inner" ? "CI1" : "CE1";
    const sideName = side === "inner" ? "côté jour" : "côté mur";
    const lines: FlatPattern["lines"][number][] = [];
    if (notches.length >= 2) {
      lines.push({
        kind: "mark",
        a: T(notches[0]!),
        b: T(notches[notches.length - 1]!),
        label: "Fond des entailles",
      });
    }
    const mid = (uMin + uMax) / 2;
    const yMid = Math.max(riveAt(mid), 0) + residual / 2;
    const la = T(V.vec(mid - 20, yMid));
    const lb = T(V.vec(mid + 20, yMid));
    lines.push({ kind: "text", a: mirrored ? lb : la, b: mirrored ? la : lb, label: mark });
    const flat: FlatPattern = {
      outline: { outer: flatOuter, holes: [] },
      lines,
      thickness: e,
      reference: {
        kind: "face",
        description: `Face intérieure de la crémaillère ${sideName} (côté milieu de l'escalier), vue depuis le milieu de l'escalier ; x horizontal le long de la crémaillère, y = altitude (sol fini bas = 0), mm, 1:1.`,
      },
    };
    const box = minAreaRect(outline);
    const st = stockOf(box.length, box.width, e, profile);
    stocks.set(id, st);
    const devArea = area(outline);
    const xDir = mirrored ? V.scale(dir, -1) : dir;
    const origin = V.addScaled(a, dir, mirrored ? uMax : uMin);
    const slope = Math.atan2(w.y, w.x);
    const part: Part = {
      id,
      mark,
      category: "carriage",
      name: `Crémaillère ${sideName}`,
      material: params.material,
      solid: {
        kind: "extrusion",
        frame: {
          origin: { x: origin.x, y: origin.y, z: 0 },
          xAxis: { x: xDir.x, y: xDir.y, z: 0 },
          yAxis: { x: 0, y: 0, z: 1 },
          zAxis: { x: into.x, y: into.y, z: 0 },
        },
        profile: flat.outline,
        depth: e,
      },
      flat,
      section: `${fmt(e, 0)} × ${fmt(Math.ceil(box.width), 0)}`,
      stock: st.stock,
      quantities: woodQuantities(
        { volumeMm3: devArea * e, surfaceMm2: devArea, length: box.length },
        params.material,
        profile,
        st.stock,
      ),
      grain: { x: dir.x * Math.cos(slope), y: dir.y * Math.cos(slope), z: Math.sin(slope) },
    };
    outline = removeCollinear(outline);
    carriages.push({
      part,
      outline,
      notches,
      lowerRive: { point: rivePoint, dir: w },
      residual: measured,
      mirrored,
    });
  }

  // Contrôles.
  const checks = new CheckCollector(project, stepping);
  const loc = (p: Part) => ({ partId: p.id });
  const cremaillere = checks.yamlRule(CREMAILLERE_RULE_ID);
  if (cremaillere && carriages.length > 0) {
    if (fcbaUnusable !== undefined || required === null) {
      checks.add(cremaillere, [
        {
          status: "non-evaluee",
          message: `Tableau FCBA non exploitable : ${fcbaUnusable ?? "valeur absente"} ; justification par le calcul.`,
        },
      ]);
    } else {
      checks.addItems(
        cremaillere,
        carriages.map((c) => ({ value: c.residual, label: c.part.mark, ...loc(c.part) })),
        `Reste sous entaille (${cls}, épaisseur ${fmt(e, 0)} mm)`,
        { min: required, max: null },
      );
    }
  }
  const thicknessRule = checks.yamlRule("LIMON_EPAISSEUR_MIN_DTU");
  if (thicknessRule && carriages.length > 0) {
    const E = project.stair.layout.width;
    if (E > 1200) {
      checks.add(thicknessRule, [
        {
          status: "non-evaluee",
          message: `Hors domaine des règles de moyens (emmarchement ${fmt(E, 0)} mm > 1 200 mm).`,
        },
      ]);
    } else {
      checks.addItems(
        thicknessRule,
        carriages.map((c) => ({ value: e, label: c.part.mark, ...loc(c.part) })),
        "Épaisseur de crémaillère",
        { min: thicknessRule.min, max: thicknessRule.max },
      );
    }
  }
  if (carriages.length > 0) {
    checks.addItems(
      pluginRuleDef(FAB_RULES.boardLength),
      carriages.map((c) => ({ value: c.part.stock!.length, label: c.part.mark, ...loc(c.part) })),
      "Longueur de débit",
      { min: null, max: profile.wood.maxBoardLength },
    );
    checks.add(
      pluginRuleDef(FAB_RULES.stockAvailable),
      carriages.map((c) => {
        const st = stocks.get(c.part.id)!;
        const ok = st.widthOk && st.thicknessOk;
        return {
          status: ok ? ("ok" as const) : ("violation" as const),
          measured: st.need.w,
          location: { kind: "part" as const, partId: c.part.id },
          message: ok
            ? `${c.part.mark} : débit brut ${fmt(st.stock.width, 0)} × ${fmt(st.stock.thickness, 0)} mm disponible.`
            : `${c.part.mark} : débit brut nécessaire ${fmt(st.need.w, 0)} × ${fmt(st.need.t, 0)} mm indisponible dans le profil d'atelier.`,
        };
      }),
    );
  }
  notes.push(
    `Crémaillères : reste sous entaille ${fmt(residual, 0)} mm (${
      params.residual !== "auto"
        ? "saisi"
        : fcbaUnusable === undefined
          ? `tableau FCBA, ${cls}`
          : `valeur de repli à valider — tableau FCBA non exploitable : ${fcbaUnusable}`
    }).`,
  );

  return {
    output: { parts: carriages.map((c) => c.part), checks: checks.results, notes },
    carriages,
    residual,
    ...(fcbaUnusable !== undefined ? { fcbaUnusable } : {}),
  };
}

export const WOOD_CUT: StructureKind<WoodCutParams> = {
  kind: "wood-cut",
  label: "Limons bois à l'anglaise (crémaillères)",
  family: "bois",
  paramsSchema: WoodCutParamsSchema,
  defaults: (_ctx: StructureContext) => WoodCutParamsSchema.parse({}),
  build: (ctx, params) => buildWoodCut(ctx, params).output,
};
