/**
 * Bascule de l'hélicoïdal sur le moteur de cage (F10, sous-lot P2, ADR-0010) : parité au niveau
 * du **`Model` entier**. Pour chaque projet hélicoïdal, `buildModel` est calculé deux fois, par
 * l'ancien chemin (copie figée `layout/legacyHelical.ts` : tracé et découpage d'avant la
 * bascule) puis par le pipeline basculé (`computeLayout` → `helicalToCage` + moteur de cage
 * d'origine `helical`, `Layout.helical` de compatibilité ; découpage de cage), et les deux
 * modèles sont comparés champ à champ : tracé, découpage, pièces (solides, quantités, débit),
 * contrôle de conception (RuleResult par RuleResult, messages compris), erreurs, remarques,
 * garde-corps, prédimensionnement, échappée, chiffres clés, contrôle sur le site.
 *
 * Commutation sans crochet de production : `vi.mock` de `layout/layout.js` et de
 * `stepping/stepping.js` (même procédé que `arcWinder.test.ts`) ; drapeau levé, un projet
 * hélicoïdal passe par `legacyComputeHelicalLayout`, puis tout tracé portant `helical` sans
 * `helicalOrigin` par `legacyComputeHelicalStepping`. Les deux calculs se font avec
 * `memo: false` : aucun cache ne mélange les chemins. Le reste du pipeline (structure,
 * garde-corps, échappée, règles) est le code de production, commun aux deux calculs.
 *
 * Portée : ce test isole l'effet du **tracé et du découpage** ; il ne voit pas une retouche de
 * l'aval (structures, échappée, site, exports), présente des deux côtés. La comparaison au
 * vrai `buildModel` d'avant P2 (commit 67672d2), exemples par exemples et exports compris, a
 * été faite à part (vidage des 48 exemples dans les deux arbres, ledger du chantier) : les
 * escaliers non hélicoïdaux y sont identiques, hors décision (1) sur les cages en arc.
 *
 * Comparateur : `compareValues` de `helical-parity-helpers.ts` (1e-6 mm, 1e-9 rad, entiers,
 * chaînes, clés et ordre exacts ; NaN des deux côtés tenu pour égal : modèle partiel).
 * `Layout.helical` est comparé au bit près. Ajouts du tracé de cage (`sections`,
 * `walklineSide`, `helicalOrigin`) vérifiés à part. Les pièces de marche (`tread-*`) sont
 * rangées sous `treadParts` pour distinguer l'écart CUT des autres pièces, strictes.
 *
 * Écarts admis (tout autre chemin échoue ; un écart attendu d'un cas du catalogue qui
 * disparaît aussi) :
 * - `CUT` (décision F10 (2)) : contours des marches et des sous-faces coupés sur la ligne du
 *   nez k + 2, donc solide, quantités (longueur, surface, volume, masse, débit) des pièces de
 *   marche et emprise des chiffres clés (`figures.footprint`, lue sur les contours) ;
 * - `CUT × TIE` (question F10 (5), sous CUT seulement) : emplacement du minimum d'échappée
 *   (point, abscisse, nez) quand le point de la cage est un minimum ex æquo de la référence
 *   (`tieOnReference`) ; valeurs strictes ; ses conséquences (localisation et marche citée,
 *   zone et message du conflit sur le site) admises pour les seules règles d'échappée
 *   (`ECHAPPEE_*`, chemins préfixés `[echappee]`), jamais pour une autre règle ;
 * - `ROT180` (question F10 (6), pièces hors marches) : développé d'une pièce retourné d'un
 *   demi-tour dans sa boîte (`flatRotated180`, 1e-6 mm, mêmes sommets dans le même ordre) ;
 *   `minAreaRect` (`structures/geom.ts`) départage par le bruit deux côtés de même largeur
 *   d'un gabarit de couche de poutre en couches ; observé sur
 *   `j5c-limon-central-bois-helicoidal` seulement (gabarits `wood-central-layer-*`) ;
 * - `HALF` : paramètre d'un message arrondi par `dec` dont la valeur brute est à mi-pas (à
 *   1e-6 près, vérifiée sur `Layout.helical` / `Stepping`) ;
 * - `ROT` / `ALIGN` (contrôle sur le site, `siteFit[*].zone`) : même polygone de collision,
 *   sommet de départ différent (deux sommets de même abscisse au bruit près départagés par le
 *   tri de l'enveloppe convexe) ou sommet aligné gardé d'un seul côté (alignement décidé par le
 *   signe d'un produit vectoriel de l'ordre de 1e-12) ; vérifié par comparaison cyclique à
 *   1e-6 mm, après retrait des sommets alignés pour `ALIGN`. Zone d'affichage seulement ; une
 *   tolérance dans `convexHull` a été essayée et écartée (elle change des zones de collision
 *   d'escaliers non hélicoïdaux, `site/fit.property.test.ts`).
 *
 * Constats de la bascule, corrigés dans le code (bruit d'arrondi qui départageait des ex
 * æquo), sans effet sur les escaliers non hélicoïdaux des exemples (vérifié contre 67672d2) :
 * marche citée par les contrôles « la plus défavorable » (grandeurs par marche de
 * l'hélicoïdal égales par construction, `stepping.ts`) ; échantillon dédoublé d'une poutre
 * cintrée (`samples`, `woodCentralBeam.ts`) ; nombre de sous-arcs de l'emprise hors tout
 * (`site/fit.ts`) ; nez le plus proche du minimum d'échappée (`nearestNosing`, `build.ts`).
 * Les départages de `minAreaRect`, de la clé de regroupement du débit et du repère gravé ne
 * sont **pas** retouchés : leur correction changeait des sorties d'escaliers non hélicoïdaux
 * (question F10 (11)) ; d'où `ROT180` ici, et les écarts admis du test des exports.
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { Layout, Model } from "../model/derived.js";
import type { Polygon2 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import {
  compareValues,
  flatRotated180,
  gapPaths,
  gapSummary,
  helicalParity,
  helicalParityProjectArb,
  LENGTH_TOL,
  tieOnReference,
  type Gaps,
} from "../layout/cage/helical-parity-helpers.js";
import {
  HELICAL_PARITY_CASES,
  HELICAL_PARITY_ERROR_CASES,
  type ParityCase,
} from "../layout/cage/helical-parity-cases-helpers.js";
import { buildModel } from "./build.js";

const flags = vi.hoisted(() => ({ legacy: false }));

vi.mock("../layout/layout.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../layout/layout.js")>();
  const legacy = await import("../layout/legacyHelical.js");
  return {
    ...mod,
    computeLayout: (project: Project, options?: Parameters<typeof mod.computeLayout>[1]) =>
      flags.legacy && project.stair.layout.kind === "helical"
        ? legacy.legacyComputeHelicalLayout(project, project.stair.layout)
        : mod.computeLayout(project, options),
  };
});

vi.mock("../stepping/stepping.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../stepping/stepping.js")>();
  const legacy = await import("../layout/legacyHelical.js");
  return {
    ...mod,
    computeStepping: (
      project: Project,
      layout: Layout,
      options?: Parameters<typeof mod.computeStepping>[2],
    ) =>
      flags.legacy && layout.helical && !layout.helicalOrigin
        ? legacy.legacyComputeHelicalStepping(project, layout)
        : mod.computeStepping(project, layout, options),
  };
});

/** `buildModel` par l'ancien chemin (copie figée), puis par le pipeline basculé. */
function both(project: Project): { before: Model; after: Model } {
  flags.legacy = true;
  try {
    const before = buildModel(project, { memo: false });
    flags.legacy = false;
    const after = buildModel(project, { memo: false });
    return { before, after };
  } finally {
    flags.legacy = false;
  }
}

/** Même polygone à une permutation circulaire près (1e-6 mm) ; rend le décalage, ou `null`. */
function cyclicShift(a: Polygon2, b: Polygon2): number | null {
  if (a.length !== b.length) return null;
  for (let k = 0; k < a.length; k++) {
    if (
      a.every((p, i) => {
        const q = b[(i + k) % b.length]!;
        return Math.abs(p.x - q.x) <= LENGTH_TOL && Math.abs(p.y - q.y) <= LENGTH_TOL;
      })
    ) {
      return k;
    }
  }
  return null;
}

/**
 * Polygone privé de ses sommets alignés (à moins de 1e-6 mm de la droite de ses voisins, entre
 * eux) : l'enveloppe convexe (`geom2d/collide.ts`) garde ou retire un sommet aligné selon le
 * bruit d'arrondi.
 */
function dropAligned(poly: Polygon2): Polygon2 {
  const out = [...poly];
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length]!;
      const p = out[i]!;
      const b = out[(i + 1) % out.length]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
      const t = len > 0 ? ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len ** 2 : 0;
      if (len > 0 && Math.abs(cross) / len <= LENGTH_TOL && t > 0 && t < 1) {
        out.splice(i, 1);
        changed = true;
      }
    }
  }
  return out;
}

const LAYOUT_ADDITIONS = ["layout.sections", "layout.walklineSide", "layout.helicalOrigin"];

/**
 * HALF sur un message : seuls diffèrent des nombres arrondis (`dec`, `{ num, digits }`), d'un
 * pas exactement, et la valeur brute `raw` (grandeur mesurée du constat, égale des deux côtés
 * à 1e-6 près, comparée ailleurs) est au milieu de ces deux arrondis à 1e-6 près.
 */
function halfOnly(a: unknown, b: unknown, raw: number | undefined): boolean {
  let differs = false;
  const walk = (x: unknown, y: unknown): boolean => {
    if (x !== null && y !== null && typeof x === "object" && typeof y === "object") {
      const ox = x as Record<string, unknown>;
      const oy = y as Record<string, unknown>;
      if (typeof ox.num === "number" && typeof oy.num === "number" && ox.num !== oy.num) {
        const step = 10 ** -(ox.digits as number);
        const mid = (ox.num + oy.num) / 2;
        differs = true;
        return (
          ox.digits === oy.digits &&
          Math.abs(Math.abs(ox.num - oy.num) - step) <= 1e-9 &&
          raw !== undefined &&
          Math.abs(raw - mid) <= 1e-6
        );
      }
      const keys = new Set([...Object.keys(ox), ...Object.keys(oy)]);
      return [...keys].every((k) => walk(ox[k], oy[k]));
    }
    return x === y;
  };
  return walk(a, b) && differs;
}

/** Écarts entre l'ancien modèle et le nouveau (voir l'en-tête). */
function modelGaps(before: Model, after: Model): Gaps {
  const gaps: Gaps = new Map();
  const { parts: pa, siteFit: fa, compliance: ca, ...ra } = before;
  const { parts: pb, siteFit: fb, compliance: cb, ...rb } = after;
  compareValues(ra, rb, "", gaps, new Set(LAYOUT_ADDITIONS));
  // Contrôle de conception : RuleResult par RuleResult ; un message ne peut différer que par
  // HALF, vérifié sur la grandeur mesurée brute (`measured`).
  const { results: resA, ...sumA } = ca;
  const { results: resB, ...sumB } = cb;
  compareValues(sumA, sumB, "compliance", gaps);
  if (resA.length !== resB.length) gaps.set("compliance.results.length", Number.NaN);
  else {
    resA.forEach((r, i) => {
      const s = resB[i]!;
      const { message: m, ...or } = r;
      const { message: n, ...os } = s;
      // Règles d'échappée rangées à part : seules à pouvoir suivre CUT × TIE (voir l'en-tête).
      const prefix = `compliance.results[${ruleTag(r.ruleId)}]`;
      compareValues(or, os, prefix, gaps);
      const g: Gaps = new Map();
      compareValues(m, n, `${prefix}.message`, g);
      if (g.size === 0) return;
      if (halfOnly(m, n, r.measured)) gaps.set("compliance.results[*].message:half", 0);
      else for (const [k, v] of g) gaps.set(k, v);
    });
  }
  // `Layout.helical` au bit près (`helicalLayoutOf`).
  if (before.layout.helical) {
    const exact: Gaps = new Map();
    compareValues(before.layout.helical, after.layout.helical, "", exact, new Set(), "", true);
    if (exact.size > 0) gaps.set("layout.helical:inexact", Number.NaN);
    // Ajouts du tracé de cage : un tronçon à axe en arc (centre, rayon, balayage), côté de Γ,
    // fût ou jour et palier d'arrivée ; pas de marque de cage saisie.
    const h = before.layout.helical;
    const sign = h.direction === "left" ? 1 : -1;
    const sec = after.layout.sections;
    const additions: Gaps = new Map();
    if (sec?.length !== 1 || sec[0]!.kind !== "arc") additions.set("sections", Number.NaN);
    else {
      compareValues(
        { center: h.center, radius: h.innerRadius, sweep: sign * h.totalAngle },
        sec[0]!.arc,
        "sections[*].arc",
        additions,
      );
    }
    if (after.layout.walklineSide !== h.direction) additions.set("walklineSide", Number.NaN);
    compareValues(
      { core: h.core, arrivalSweep: sign * h.landingAngle, arrivalOutline: h.landingOutline },
      after.layout.helicalOrigin,
      "helicalOrigin",
      additions,
    );
    if (after.layout.cage !== undefined) additions.set("cage", Number.NaN);
    for (const [k, v] of additions) gaps.set(`layout.additions.${k}`, v);
  }
  // Pièces : même liste d'identifiants, dans le même ordre ; pièces de marche à part (CUT).
  const ids = (ps: readonly { id: string }[]) => ps.map((p) => p.id).join("|");
  if (ids(pa) !== ids(pb)) gaps.set("parts.ids", Number.NaN);
  else {
    pa.forEach((p, i) => {
      const q = pb[i]!;
      const prefix = p.id.startsWith("tread-") ? "treadParts[*]" : "parts[*]";
      // ROT180 : développé retourné d'un demi-tour dans sa boîte (voir l'en-tête), constaté
      // puis le reste de la pièce comparé strictement.
      if (p.flat && q.flat && flatRotated180(p.flat, q.flat)) {
        gaps.set(`${prefix}.flat:rot180`, 0);
        compareValues({ ...p, flat: q.flat }, q, prefix, gaps);
        return;
      }
      compareValues(p, q, prefix, gaps);
    });
  }
  // Contrôle sur le site : zone de collision comparée à une permutation circulaire près (ROT).
  if ((fa ?? []).length !== (fb ?? []).length) gaps.set("siteFit.length", Number.NaN);
  else {
    (fa ?? []).forEach((f, i) => {
      const g = fb![i]!;
      const { zone: za, message: ma, ...oa } = f;
      const { zone: zb, message: mb, ...ob } = g;
      const prefix = `siteFit[${ruleTag(f.ruleId)}]`;
      compareValues(oa, ob, prefix, gaps);
      // Message repris d'un constat (même `ruleId`) : HALF vérifié sur sa grandeur mesurée.
      const mg: Gaps = new Map();
      compareValues(ma, mb, `${prefix}.message`, mg);
      if (mg.size > 0) {
        const raw = resA.find(
          (r) => r.ruleId === f.ruleId && JSON.stringify(r.message) === JSON.stringify(ma),
        )?.measured;
        if (halfOnly(ma, mb, raw)) gaps.set("siteFit[*].message:half", 0);
        else for (const [k, v] of mg) gaps.set(k, v);
      }
      const shift = cyclicShift(za, zb);
      if (shift === 0) return;
      if (shift !== null) gaps.set("siteFit[*].zone:rotated", shift);
      else if (cyclicShift(dropAligned(za), dropAligned(zb)) !== null) {
        gaps.set("siteFit[*].zone:aligned", 0);
      } else gaps.set(`${prefix}.zone`, Number.NaN);
    });
  }
  return gaps;
}

/** Étiquette d'une règle dans les chemins d'écart : `echappee` pour `ECHAPPEE_*`, sinon `*`. */
function ruleTag(ruleId: string | undefined): string {
  return ruleId?.startsWith("ECHAPPEE_") ? "echappee" : "*";
}

/** Chemins CUT (voir l'en-tête). */
const CUT_PATH =
  /^(stepping\.(treads|soffits)\[\*\]\.outline(\.length|\[\*\]\.[xy])|treadParts\[\*\]\.(solid\..+|quantities\..+|stock\.(length|width))|figures\.footprint\.[xy])$/;

/** Valeur à mi-chemin de deux arrondis au pas `step` (à 1e-6 près, relatif au pas). */
const atHalf = (x: number, step: number): boolean => {
  const f = x / step - Math.floor(x / step);
  return Math.abs(f - 0.5) < 1e-6;
};

/** Le tirage relève-t-il de CUT (d / sin Δθ entre r_i et R_e, Δθ < 90°, voir P1) ? */
function isCut(project: Project, m: Model): boolean {
  const h = m.layout.helical;
  if (!h) return false;
  const d = project.stair.treads.nosing;
  const rho = d / Math.sin(h.stepAngle);
  return (
    d > 0 &&
    m.stepping.riserCount >= 3 &&
    h.stepAngle < Math.PI / 2 &&
    rho > h.innerRadius &&
    rho < h.outerRadius
  );
}

/** Chemins admis pour un tirage (voir l'en-tête), d'après l'ancien modèle. */
function allowedFor(project: Project, before: Model): (path: string) => boolean {
  const cut = isCut(project, before);
  const half = new Set<string>();
  const h = before.layout.helical;
  if (h) {
    const deg = 180 / Math.PI;
    const raw: Record<string, number> = {
      stepAngle: h.stepAngle * deg,
      treadsPerTurn: h.treadsPerTurn,
      totalAngle: h.totalAngle * deg,
      going: before.stepping.going,
      walklineRadius: h.walklineRadius,
      collet: h.innerRadius * h.stepAngle,
    };
    for (const [k, v] of Object.entries(raw)) {
      if (atHalf(v, 0.1)) half.add(`stepping.notes[*].params.${k}.num`);
    }
  }
  let tie: { walkline: boolean; width: boolean } | undefined;
  return (path) => {
    if (path === "siteFit[*].zone:rotated" || path === "siteFit[*].zone:aligned") return true;
    if (path === "compliance.results[*].message:half" || path === "siteFit[*].message:half") {
      return true;
    }
    if (half.has(path)) return true;
    if (!cut) return false;
    if (CUT_PATH.test(path)) return true;
    // CUT × TIE : emplacement du minimum d'échappée, vérifié sur la référence.
    tie ??= (() => {
      const r = helicalParity(project);
      return tieOnReference(r.helical, r.cage);
    })();
    if (tie.walkline && /^headroom\.(at\.[xyz]|s|nosingIndex)$/.test(path)) return true;
    if (tie.width && /^headroomWidth\.(at\.[xyz]|nosing)$/.test(path)) return true;
    // Conséquences du seul emplacement, pour les seules règles d'échappée (`[echappee]`) :
    // point et nez localisant le constat, marche citée par son message, zone (marche
    // concernée) et message de son conflit sur le site. Une autre règle reste stricte.
    return (
      (tie.walkline || tie.width) &&
      /^(compliance\.results\[echappee\]\.(location\.(at\.[xyz]|nosingIndex)|message\.params\.label\.params\.tread)|siteFit\[echappee\]\.(zone|message\.params\.label\.params\.tread))$/.test(
        path,
      )
    );
  };
}

/** CUT, angle 90° (Δθ = 6°) : sommets déplacés, même nombre. */
const CUT_90 = [
  "stepping.soffits[*].outline[*].x",
  "stepping.soffits[*].outline[*].y",
  "stepping.treads[*].outline[*].x",
  "stepping.treads[*].outline[*].y",
  "treadParts[*].quantities.length_mm",
  "treadParts[*].quantities.mass_kg",
  "treadParts[*].quantities.stock_volume_m3",
  "treadParts[*].quantities.surface",
  "treadParts[*].quantities.surface_m2",
  "treadParts[*].quantities.volume",
  "treadParts[*].quantities.volume_m3",
  "treadParts[*].solid.profile.outer[*].x",
  "treadParts[*].solid.profile.outer[*].y",
  "treadParts[*].stock.length",
];
/** CUT, r_i = 50, d = 40, Δθ = 30° : nombre de sommets différent. */
const CUT_NEAR_CORE = [
  "stepping.soffits[*].outline.length",
  "stepping.treads[*].outline.length",
  "treadParts[*].quantities.length_mm",
  "treadParts[*].quantities.mass_kg",
  "treadParts[*].quantities.stock_volume_m3",
  "treadParts[*].quantities.surface",
  "treadParts[*].quantities.surface_m2",
  "treadParts[*].quantities.volume",
  "treadParts[*].quantities.volume_m3",
  "treadParts[*].solid.profile.outer.length",
  "treadParts[*].stock.length",
];
/** Écarts attendus au niveau du `Model`, par cas du catalogue (absent : aucun). */
const MODEL_GAPS: Readonly<Record<string, readonly string[]>> = {
  "angle 90°": CUT_90,
  "débord proche de r_i (r_i = 50, d = 40, Δθ = 30°)": CUT_NEAR_CORE,
  // ROT180 (question F10 (6)) : gabarits de couches retournés (voir le test dédié).
  "exemple j5c-limon-central-bois-helicoidal": ["parts[*].flat:rot180"],
  "exemple j5c-limon-central-bois-helicoidal sans palier": ["parts[*].flat:rot180"],
};

/** Identifiants des pièces en écart ROT180 (développé retourné d'un demi-tour). */
const rotatedParts = (before: Model, after: Model): string[] =>
  before.parts.flatMap((p, i) => {
    const q = after.parts[i];
    return p.flat && q?.flat && flatRotated180(p.flat, q.flat) ? [p.id] : [];
  });

const report = (c: ParityCase | { name: string; project: () => Project }) => {
  const project = c.project();
  const { before, after } = both(project);
  return { project, before, after, gaps: modelGaps(before, after) };
};

describe("bascule de l'hélicoïdal (F10, P2) — parité du Model, catalogue", () => {
  it.each(HELICAL_PARITY_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const { project, before, after, gaps } = report(c);
    // La commutation a bien pris : ancien tracé sans `helicalOrigin`, nouveau avec.
    expect(before.layout.helicalOrigin).toBeUndefined();
    expect(before.layout.sections).toBeUndefined();
    expect(after.layout.helicalOrigin).toBeDefined();
    const expected = [...(MODEL_GAPS[c.name] ?? [])].sort();
    expect(gapPaths(gaps), JSON.stringify(gapSummary(gaps))).toEqual(expected);
    // Les écarts CUT ne viennent que des cas CUT du catalogue de P1.
    expect(isCut(project, before)).toBe(c.gaps?.CUT !== undefined);
    // Aucun nouveau contrôle de contour sur l'hélicoïdal (`Model.soffits` absent, comme avant).
    expect(before.soffits).toBeUndefined();
    expect(after.soffits).toBeUndefined();
  });

  it("ROT180 : seuls des gabarits de couches de la poutre en couches, retournés d'un demi-tour", () => {
    const seen: Record<string, number> = {};
    for (const c of HELICAL_PARITY_CASES) {
      const { before, after } = report(c);
      const ids = rotatedParts(before, after);
      if (ids.length === 0) continue;
      seen[c.name] = ids.length;
      for (const id of ids) expect(id).toMatch(/^wood-central-layer-\d+-\d+$/);
    }
    // Constat mesuré à la bascule (11 gabarits sur les 163 couches de l'exemple, 11 aussi sans
    // palier) : un changement de ce nombre signale un autre départage par le bruit, à examiner.
    expect(seen).toEqual({
      "exemple j5c-limon-central-bois-helicoidal": 11,
      "exemple j5c-limon-central-bois-helicoidal sans palier": 11,
    });
  });

  it("exemples : RuleResult par RuleResult, pièces, garde-corps, remarques identiques", () => {
    // Redondant avec la comparaison complète, explicite pour les champs cités par la décision.
    for (const c of HELICAL_PARITY_CASES.filter((x) => x.name.startsWith("exemple"))) {
      const { before, after } = report(c);
      expect(after.compliance.results.map((r) => [r.ruleId, r.status, r.severity])).toEqual(
        before.compliance.results.map((r) => [r.ruleId, r.status, r.severity]),
      );
      expect(after.compliance.results.map((r) => r.message)).toEqual(
        before.compliance.results.map((r) => r.message),
      );
      expect(after.compliance.summary).toEqual(before.compliance.summary);
      expect(after.parts.map((p) => [p.id, p.mark, p.family])).toEqual(
        before.parts.map((p) => [p.id, p.mark, p.family]),
      );
      expect(after.stepping.notes).toEqual(before.stepping.notes);
      expect(after.errors).toEqual(before.errors);
      expect(after.headroomWidth?.nosing).toBe(before.headroomWidth?.nosing);
      expect(after.headroom?.nosingIndex).toBe(before.headroom?.nosingIndex);
    }
  });
});

describe("bascule de l'hélicoïdal (F10, P2) — parité du Model, erreurs", () => {
  it.each(HELICAL_PARITY_ERROR_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const { before, after, gaps } = report(c);
    // `buildModel` ne lève pas : même erreur, au même étage, et même modèle partiel.
    expect(before.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(after.errors)).toContain(`"${c.key}"`);
    expect(after.errors).toEqual(before.errors);
    expect(gapPaths(gaps), JSON.stringify(gapSummary(gaps))).toEqual([]);
  });
});

describe("bascule de l'hélicoïdal (F10, P2) — parité du Model, propriété", () => {
  it("chaque tirage ne s'écarte que par les écarts admis (CUT, CUT × TIE, HALF, ROT)", () => {
    fc.assert(
      fc.property(helicalParityProjectArb, (project) => {
        const { before, after } = both(project);
        const gaps = modelGaps(before, after);
        const allowed = allowedFor(project, before);
        const unexpected = gapPaths(gaps).filter((p) => !allowed(p));
        expect(unexpected, JSON.stringify(gapSummary(gaps))).toEqual([]);
      }),
      { numRuns: Number(process.env.HELICAL_SWITCH_RUNS ?? 250) },
    );
  }, 600_000);
});
