/**
 * Garde-corps et mains courantes (jalon 4) : règles GC_*, MC_*, CHARGE_GC_HORIZONTALE et
 * largeur entre mains courantes. Les grandeurs viennent de l'étape « garde-corps » du pipeline
 * (`ComplianceInput.guards`, `guards/compute.ts`) : hauteurs à la verticale du nez, vides
 * analytiques (entraxes, sections, jeux), appuis, prolongements. Chaque constat est localisé
 * sur la pièce concernée (main courante, balustre, lisse, panneau) ou sur le point de chute.
 *
 * - Section `guards` absente du projet : règles « non évaluées » (garde-corps non décrits).
 * - Régimes 1988 / 2024 : contextes `garde_corps_1988` / `garde_corps_2024` résolus par le
 *   moteur depuis `referenceDate` (`rules/contexts.ts`).
 * - Tolérances : aucune (NF P01-012:2024 : vides +0 mm) ; tolérance numérique seulement.
 */
import { computeGuards } from "../../guards/compute.js";
import type { GapMeasure, GuardRun, GuardsAnalysis, HandrailRun } from "../../guards/types.js";
import type { Location, Stepping } from "../../model/derived.js";
import type { Project } from "../../model/project.js";
import {
  STAIR,
  boundsText,
  fmt,
  notApplicable,
  notEvaluated,
  within,
  type Bounds,
} from "../check.js";
import {
  GC_B_BASE,
  GC_B_ZONE_MAX,
  GC_B_ZONE_MIN,
  GC_LOAD_HOUSING,
  GC_LOAD_PUBLIC,
  GC_T1_ZONE_TOP,
  MC_CORE_DIAMETER_MAX,
  MC_WALL_CLEARANCE_OTHER,
  UP2_WIDTH,
} from "../formula-constants.js";
import { getRule } from "../table.js";
import type { EvaluatorContext, Finding, RuleEvaluator } from "../types.js";

// ------------------------------------------------------------------ Analyse des garde-corps

const lazy = new WeakMap<Stepping, WeakMap<Project, GuardsAnalysis | null>>();

/**
 * Analyse des garde-corps : celle du pipeline (`ctx.guards`), sinon calculée à la demande
 * (appel direct du moteur). `undefined` : section `guards` absente ; `null` : non calculable.
 */
export function guardsOf(ctx: EvaluatorContext): GuardsAnalysis | null | undefined {
  if (!ctx.project.guards) return undefined;
  if (ctx.guards !== undefined) return ctx.guards;
  if (ctx.incomplete) return null;
  let byProject = lazy.get(ctx.stepping);
  if (!byProject) {
    byProject = new WeakMap();
    lazy.set(ctx.stepping, byProject);
  }
  if (!byProject.has(ctx.project)) {
    let a: GuardsAnalysis | null;
    try {
      a = computeGuards(ctx.project, ctx.layout, ctx.stepping);
    } catch {
      a = null;
    }
    byProject.set(ctx.project, a);
  }
  return byProject.get(ctx.project) ?? null;
}

/** Évaluateur qui exige l'analyse des garde-corps. */
function withGuards(fn: (ctx: EvaluatorContext, g: GuardsAnalysis) => Finding[]): RuleEvaluator {
  return (ctx) => {
    const g = guardsOf(ctx);
    if (g === undefined)
      return [
        notEvaluated(
          "Garde-corps et mains courantes non décrits dans le projet (section « guards » absente).",
        ),
      ];
    if (g === null) return [notEvaluated("Garde-corps non calculés (voir les erreurs du modèle).")];
    return fn(ctx, g);
  };
}

// ------------------------------------------------------------------ Outils

interface BoundedItem {
  readonly value: number;
  readonly location: Location;
  readonly label: string;
  readonly bounds: Bounds;
}

/**
 * Série d'éléments à bornes individuelles : un constat par élément non conforme, sinon un
 * constat `ok` portant l'élément le plus défavorable (localisé sur sa pièce).
 */
function checkBounded(
  ctx: EvaluatorContext,
  items: readonly BoundedItem[],
  quantity: string,
  empty: string,
): Finding[] {
  if (items.length === 0) return [notApplicable(empty)];
  const unit = ctx.rule.unite;
  const u = unit && unit !== "ratio" ? ` ${unit}` : "";
  const nan = items.filter((it) => !Number.isFinite(it.value));
  if (nan.length > 0)
    return nan.map((it) =>
      notEvaluated(`${quantity}, ${it.label} : valeur non calculable.`, it.location),
    );
  const bad = items.filter((it) => !within(it.value, it.bounds));
  if (bad.length > 0) {
    return bad.map((it) => ({
      status: "violation" as const,
      measured: it.value,
      min: it.bounds.min,
      max: it.bounds.max,
      location: it.location,
      message: `${quantity}, ${it.label} : ${fmt(it.value, 2)}${u} (attendu ${boundsText(it.bounds, unit)}).`,
    }));
  }
  let worst = items[0]!;
  let margin = Infinity;
  for (const it of items) {
    const m = Math.min(
      it.bounds.min !== null ? it.value - it.bounds.min : Infinity,
      it.bounds.max !== null ? it.bounds.max - it.value : Infinity,
    );
    if (m < margin) {
      margin = m;
      worst = it;
    }
  }
  return [
    {
      status: "ok",
      measured: worst.value,
      min: worst.bounds.min,
      max: worst.bounds.max,
      location: worst.location,
      message: `${quantity} conforme sur ${items.length} élément(s) ; valeur la plus défavorable ${fmt(worst.value, 2)}${u} (${worst.label}), attendu ${boundsText(worst.bounds, unit)}.`,
    },
  ];
}

const rule = (ctx: EvaluatorContext): Bounds => ({ min: ctx.rule.min, max: ctx.rule.max });
const strictMax = (ctx: EvaluatorContext): Bounds => ({ ...rule(ctx), strictMax: true });
const partLoc = (partId: string): Location => ({ kind: "part", partId });

const rakeRuns = (g: GuardsAnalysis): GuardRun[] => g.runs.filter((r) => r.kind === "rake");
/** Lignes comportant une partie horizontale (trémie, paliers). */
const levelRuns = (g: GuardsAnalysis): GuardRun[] =>
  g.runs.filter((r) => r.kind === "opening" || r.horizontalLength > 1);

function gapItems(
  g: GuardsAnalysis,
  filter: (gap: GapMeasure, run: GuardRun) => boolean,
  bounds: Bounds,
): BoundedItem[] {
  const out: BoundedItem[] = [];
  for (const run of g.runs)
    for (const gap of run.gaps)
      if (filter(gap, run))
        out.push({ value: gap.value, location: gap.location, label: gap.label, bounds });
  return out;
}

// ------------------------------------------------------------------ Obligation

const mandatory: RuleEvaluator = withGuards((ctx, g) => {
  const limit = ctx.rule.max;
  if (limit === null) return [notEvaluated("Seuil de hauteur de chute absent de la table.")];
  const out: Finding[] = [];
  const oks: string[] = [];
  let worst = 0;
  const label = { inner: "côté jour", outer: "côté extérieur" } as const;
  for (const side of g.sides) {
    if (!side.intervals.some((iv) => iv.kind === "void")) continue;
    worst = Math.max(worst, side.maxFall);
    const runs = g.runs.filter((r) => r.side === side.side);
    if (side.maxFall <= limit) {
      oks.push(`${label[side.side]} : chute ${fmt(side.maxFall)} mm ≤ ${fmt(limit)} mm`);
    } else if (runs.length > 0) {
      oks.push(`${label[side.side]} : chute ${fmt(side.maxFall)} mm, garde-corps présent`);
    } else {
      out.push({
        status: "violation",
        measured: side.maxFall,
        max: limit,
        location: side.maxFallAt ? { kind: "point", at: side.maxFallAt } : STAIR,
        message: `Hauteur de chute ${fmt(side.maxFall)} mm > ${fmt(limit)} mm ${label[side.side]} sans garde-corps.`,
      });
    }
  }
  if (g.unguardedOpeningEdges.length > 0 && g.openingFall > limit) {
    for (const e of g.unguardedOpeningEdges) {
      out.push({
        status: "violation",
        measured: g.openingFall,
        max: limit,
        location: {
          kind: "point",
          at: { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, z: g.openingFall },
        },
        message: `Côté libre de trémie sans garde-corps : hauteur de chute ${fmt(g.openingFall)} mm > ${fmt(limit)} mm.`,
      });
    }
  }
  const openingRuns = g.runs.filter((r) => r.kind === "opening");
  if (openingRuns.length > 0) {
    worst = Math.max(worst, g.openingFall);
    oks.push(`trémie : chute ${fmt(g.openingFall)} mm, garde-corps présent`);
  }
  if (out.length > 0) return out;
  if (oks.length === 0) return [notApplicable("Sans objet : aucun côté vide ni trémie.")];
  // Chute supérieure au seuil mais protégée : la borne ne s'applique plus à la mesure (la
  // conformité tient à la présence du garde-corps) ; ne pas afficher « attendu ≤ seuil ».
  return [
    {
      status: "ok",
      measured: worst,
      max: worst <= limit ? limit : null,
      location: g.runs[0] ? partLoc(g.runs[0].primaryPartId) : STAIR,
      message: `Protection contre les chutes : ${oks.join(" ; ")}.`,
    },
  ];
});

// ------------------------------------------------------------------ Hauteurs

/** Hauteur minimale mesurée à la verticale des nez sur les garde-corps rampants. */
const rakeHeight: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    rakeRuns(g)
      .filter((r) => r.nosingHeights.length > 0)
      .map((r) => ({
        value: Math.min(...r.nosingHeights.map((n) => n.height)),
        location: partLoc(r.primaryPartId),
        label: `${r.label} (à la verticale des nez)`,
        bounds: rule(ctx),
      })),
    "Hauteur du garde-corps rampant",
    "Sans objet : aucun garde-corps rampant.",
  ),
);

/** Hauteur des garde-corps horizontaux (trémie, paliers) au-dessus du sol ou du palier. */
const levelHeight: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    levelRuns(g).map((r) => ({
      value: r.height,
      location: partLoc(r.primaryPartId),
      label: r.label,
      bounds: rule(ctx),
    })),
    "Hauteur du garde-corps horizontal",
    "Sans objet : aucun garde-corps horizontal (trémie, palier).",
  ),
);

export interface GuardHeightStep {
  /** `le` : E ≤ e ; `gt` : E > e. */
  readonly op: "le" | "gt";
  readonly e: number;
  readonly h: number;
  /** Valeur soumise au renvoi (b), condition non vérifiée. */
  readonly conditional: boolean;
}

/**
 * Table h(E) de GC_HAUTEUR_2024, lue dans sa description (« E<=250:1000 ; <=300:975 ; … ;
 * >500:800(b) ») et plancher des valeurs à condition (b) (« ne pas descendre sous 900 »).
 * `null` si la table n'est pas exploitable.
 */
export function guardHeightTable(): { steps: GuardHeightStep[]; floorB: number } | null {
  const d = getRule("GC_HAUTEUR_2024").description;
  const steps: GuardHeightStep[] = [];
  for (const m of d.matchAll(/(<=|>)\s*(\d+)\s*:\s*(\d+)\s*(\(b\))?/g)) {
    steps.push({
      op: m[1] === "<=" ? "le" : "gt",
      e: Number(m[2]),
      h: Number(m[3]),
      conditional: m[4] !== undefined,
    });
  }
  const floor = /ne pas descendre sous (\d+)/.exec(d);
  if (steps.length === 0 || !floor) return null;
  return { steps, floorB: Number(floor[1]) };
}

/** Hauteur minimale h(E) (mm) pour une épaisseur E (mm) de l'élément de protection. */
export function requiredGuardHeight2024(e: number): number | null {
  const t = guardHeightTable();
  if (!t) return null;
  const step = t.steps.find((s) => (s.op === "le" ? e <= s.e : e > s.e));
  if (!step) return null;
  return step.conditional ? Math.max(step.h, t.floorB) : step.h;
}

const height2024: RuleEvaluator = withGuards((ctx, g) => {
  const items: BoundedItem[] = [];
  for (const r of levelRuns(g)) {
    const h = requiredGuardHeight2024(r.thickness);
    if (h === null) return [notEvaluated("Table h(E) de GC_HAUTEUR_2024 non exploitable.")];
    items.push({
      value: r.height,
      location: partLoc(r.primaryPartId),
      label: `${r.label}, épaisseur E = ${fmt(r.thickness)} mm, h(E) = ${fmt(h)} mm`,
      bounds: { min: Math.max(h, ctx.rule.min ?? h), max: null },
    });
  }
  return checkBounded(
    ctx,
    items,
    "Hauteur de protection depuis la zone d'activité",
    "Sans objet : aucun garde-corps horizontal (trémie, palier) ; rampants : GC_HAUTEUR_RAMPANT_2024.",
  );
});

/** Gabarit B : un appui à X ∈ [100 ; 600[ exige H ≥ 1 000 + X. */
const templateB: RuleEvaluator = withGuards((ctx, g) => {
  if (g.runs.length === 0) return [notApplicable("Sans objet : aucun garde-corps.")];
  const items: BoundedItem[] = [];
  for (const r of g.runs) {
    const inZone = r.footholds.filter(
      (f) => f.x >= GC_B_ZONE_MIN.value && f.x < GC_B_ZONE_MAX.value,
    );
    if (inZone.length === 0) continue;
    const top = inZone.reduce((a, b) => (b.x > a.x ? b : a));
    items.push({
      value: r.height,
      location: top.location,
      label: `${r.label}, appui à X = ${fmt(top.x)} mm (${top.label}) : H ≥ ${fmt(GC_B_BASE.value)} + X`,
      bounds: { min: GC_B_BASE.value + top.x, max: null },
    });
  }
  if (items.length === 0)
    return [
      {
        ...notApplicable(
          `Aucun appui (élément filant) entre ${GC_B_ZONE_MIN.value} et ${GC_B_ZONE_MAX.value} mm au-dessus de la zone d'activité.`,
        ),
        location: partLoc(g.runs[0]!.primaryPartId),
      },
    ];
  return checkBounded(ctx, items, "Hauteur au-dessus d'un appui (gabarit B)", "");
});

// ------------------------------------------------------------------ Vides

const t1: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    gapItems(g, (gap) => gap.zBottom < GC_T1_ZONE_TOP.value, strictMax(ctx)),
    `Vide (gabarit T1, de 0 à ${GC_T1_ZONE_TOP.value} mm)`,
    "Sans objet : aucun garde-corps.",
  ),
);

const t2: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    gapItems(g, (gap) => gap.zTop > GC_T1_ZONE_TOP.value, strictMax(ctx)),
    `Vide (gabarit T2, au-dessus de ${GC_T1_ZONE_TOP.value} mm)`,
    `Sans objet : aucun vide au-dessus de ${GC_T1_ZONE_TOP.value} mm.`,
  ),
);

const t3: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    g.runs.flatMap((r) =>
      r.meshOpenings.map((m) => ({
        value: m.value,
        location: m.location,
        label: m.label,
        bounds: strictMax(ctx),
      })),
    ),
    "Maille du remplissage (gabarit T3)",
    "Sans objet : aucun remplissage à mailles répétitives (tôle perforée).",
  ),
);

/** 1988 : vides entre éléments verticaux (balustres, panneaux, poteaux) et sous le remplissage. */
const gap1988Bars: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    gapItems(
      g,
      (gap, run) =>
        gap.kind === "vertical" ||
        (gap.kind === "bottom" && run.infill !== "rails" && run.infill !== "cables"),
      rule(ctx),
    ),
    "Vide entre éléments verticaux",
    "Sans objet : aucun garde-corps.",
  ),
);

/** 1988 : vides entre lisses (et câbles) au-dessus de la partie basse, perpendiculaires à la pente. */
const gap1988Rails: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    gapItems(g, (gap) => gap.kind === "horizontal", rule(ctx)),
    "Vide entre lisses",
    "Sans objet : aucune lisse ni câble.",
  ),
);

/** 1988 : partie basse non escaladable = hauteur du premier appui (lisse, câble), sinon H. */
const lowPart1988: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    g.runs.map((r) => {
      const low = r.footholds.length > 0 ? r.footholds.reduce((a, b) => (b.x < a.x ? b : a)) : null;
      return {
        value: low ? low.x : r.height,
        location: low ? low.location : partLoc(r.primaryPartId),
        label: low ? `${r.label}, ${low.label}` : `${r.label}, sans élément filant`,
        bounds: rule(ctx),
      };
    }),
    "Partie basse non escaladable",
    "Sans objet : aucun garde-corps.",
  ),
);

const levels2024: RuleEvaluator = withGuards((_ctx, g) =>
  g.runs.length === 0
    ? [notApplicable("Sans objet : aucun garde-corps.")]
    : [
        notEvaluated(
          "Dénivelés au pied du garde-corps : formule de la NF P01-012:2024 non vérifiée (C §3.1) et dénivelés de la zone d'activité non décrits.",
          partLoc(g.runs[0]!.primaryPartId),
        ),
      ],
);

/** Information de dimensionnement : charge horizontale à reprendre (non vérifiée). */
const horizontalLoad: RuleEvaluator = withGuards((ctx, g) => {
  if (g.runs.length === 0) return [notApplicable("Sans objet : aucun garde-corps.")];
  const publicUse = ["erp_neuf", "erp_existant", "erp_securite"].some((c) => ctx.contexts.has(c));
  const q = publicUse ? GC_LOAD_PUBLIC : GC_LOAD_HOUSING;
  return [
    {
      status: "non-evaluee",
      location: partLoc(g.runs[0]!.primaryPartId),
      message: `Information : charge horizontale de ${fmt(q.value, 2)} kN/m (${publicUse ? "catégories C1 à C4, établissement recevant du public" : "catégorie A, habitation"}) appliquée à 1 m du sol fini, à reprendre par les poteaux et leurs fixations ; résistance non vérifiée par Blondel.`,
    },
  ];
});

// ------------------------------------------------------------------ Mains courantes

const flightHandrails = (g: GuardsAnalysis): readonly HandrailRun[] => g.handrails;
const handrailSides = (g: GuardsAnalysis): number =>
  new Set(flightHandrails(g).map((h) => h.side)).size;

function handrailCount(ctx: EvaluatorContext, g: GuardsAnalysis, min: number | null): Finding[] {
  const n = handrailSides(g);
  const b: Bounds = { min, max: null };
  const first = flightHandrails(g)[0];
  return [
    {
      status: within(n, b) ? "ok" : "violation",
      measured: n,
      min,
      max: null,
      location: first ? partLoc(first.partId) : STAIR,
      message: `Mains courantes le long de la volée : ${n} côté(s) équipé(s) (attendu ${boundsText(b, ctx.rule.unite)}).`,
    },
  ];
}

const handrailMin: RuleEvaluator = withGuards((ctx, g) => handrailCount(ctx, g, ctx.rule.min));

/**
 * Diamètre du fût central (mm) si l'exception de MC_DEUX_COTES s'applique : ERP neuf (et non
 * BHC, « quelle que soit sa conception »), hélicoïdal à fût (`core.kind === "column"`) de
 * diamètre ≤ `MC_CORE_DIAMETER_MAX` ; `null` sinon (jour central : pas d'exception).
 */
function smallCoreDiameter(ctx: EvaluatorContext): number | null {
  const c = ctx.contexts;
  if (!c.has("erp_neuf") || c.has("bhc_parties_communes") || !c.has("helicoidal")) return null;
  const layout = ctx.project.stair.layout;
  if (layout.kind !== "helical" || layout.core.kind !== "column") return null;
  const d = 2 * layout.core.radius;
  return d <= MC_CORE_DIAMETER_MAX.value ? d : null;
}

/** Une main courante de chaque côté, sauf hélicoïdal ERP neuf à fût de Ø ≤ 400 mm (une seule). */
const handrailBothSides: RuleEvaluator = withGuards((ctx, g) => {
  const d = smallCoreDiameter(ctx);
  if (d === null) return handrailCount(ctx, g, ctx.rule.min);
  return handrailCount(ctx, g, 1).map((f) => ({
    ...f,
    message: `${f.message} Exception ERP neuf : hélicoïdal à fût central de Ø ${fmt(d)} mm ≤ ${fmt(MC_CORE_DIAMETER_MAX.value)} mm, une seule main courante exigée.`,
  }));
});

/**
 * ERP : une main courante dès 1 UP, de chaque côté dès 2 UP (largeur ≥ 1 400 mm) ; pour un
 * tournant (ou un hélicoïdal) d'1 UP, la main courante doit être côté extérieur (CO 56 §3).
 */
const handrailUp: RuleEvaluator = withGuards((ctx, g) => {
  const twoUp = ctx.project.stair.layout.width >= UP2_WIDTH.value;
  const count = handrailCount(ctx, g, twoUp ? 2 : (ctx.rule.min ?? 1));
  const turning = ctx.contexts.has("tournant") || ctx.contexts.has("helicoidal");
  if (twoUp || !turning || count.some((f) => f.status === "violation")) return count;
  const outer = flightHandrails(g).find((h) => h.side === "outer");
  if (outer)
    return count.map((f) => ({
      ...f,
      location: partLoc(outer.partId),
      message: `${f.message} Tournant d'1 UP : main courante côté extérieur présente.`,
    }));
  return [
    {
      status: "violation",
      measured: 0,
      min: 1,
      max: null,
      location: count[0]?.location ?? STAIR,
      message: `Tournant d'1 UP : main courante exigée côté extérieur (CO 56 §3), aucune n'y est posée (${handrailSides(g)} côté(s) équipé(s) le long de la volée).`,
    },
  ];
});

const handrailHeight: RuleEvaluator = withGuards((ctx, g) => {
  const items: BoundedItem[] = [];
  for (const h of flightHandrails(g)) {
    if (h.nosingHeights.length === 0) continue;
    const vs = h.nosingHeights.map((n) => n.height);
    const label = h.onGuard
      ? `main courante du garde-corps (${h.side === "inner" ? "côté jour" : "côté extérieur"})`
      : `main courante murale (${h.side === "inner" ? "côté jour" : "côté extérieur"})`;
    items.push({
      value: Math.min(...vs),
      location: partLoc(h.partId),
      label: `${label}, minimum`,
      bounds: rule(ctx),
    });
    items.push({
      value: Math.max(...vs),
      location: partLoc(h.partId),
      label: `${label}, maximum`,
      bounds: rule(ctx),
    });
  }
  return checkBounded(
    ctx,
    items,
    "Hauteur de main courante à la verticale du nez",
    "Sans objet : aucune main courante le long de la volée.",
  );
});

const handrailExtension: RuleEvaluator = withGuards((ctx, g) => {
  const hs = flightHandrails(g);
  if (hs.length === 0)
    return [notApplicable("Sans objet : aucune main courante le long de la volée.")];
  const going = ctx.stepping.going;
  const b: Bounds = { min: going, max: null };
  const items: BoundedItem[] = [];
  const bottoms = hs.filter((h) => h.extensionBottom !== undefined);
  const tops = hs.filter((h) => h.extensionTop !== undefined);
  for (const h of bottoms)
    items.push({
      value: h.extensionBottom!,
      location: partLoc(h.partId),
      label: "prolongement bas (avant la 1re marche)",
      bounds: b,
    });
  for (const h of tops)
    items.push({
      value: h.extensionTop!,
      location: partLoc(h.partId),
      label: "prolongement haut (après la dernière marche)",
      bounds: b,
    });
  if (bottoms.length === 0)
    items.push({
      value: 0,
      location: partLoc(hs[0]!.partId),
      label: "aucune main courante au départ de l'escalier",
      bounds: b,
    });
  if (tops.length === 0)
    items.push({
      value: 0,
      location: partLoc(hs[0]!.partId),
      label: "aucune main courante à l'arrivée de l'escalier",
      bounds: b,
    });
  return checkBounded(
    ctx,
    items,
    `Prolongement horizontal de la main courante (≥ giron ${fmt(going)} mm)`,
    "",
  );
});

const handrailDiscontinuity: RuleEvaluator = withGuards((ctx, g) => {
  const items: BoundedItem[] = [];
  for (const side of ["inner", "outer"] as const) {
    const hs = flightHandrails(g)
      .filter((h) => h.side === side)
      .sort((a, b) => a.from - b.from);
    // Côté comportant une portion murale et au moins une main courante (murale ou de
    // garde-corps) : la main courante doit y être continue (garde-corps / mur / garde-corps).
    const walled = g.sides.some(
      (s) => s.side === side && s.intervals.some((i) => i.kind === "wall"),
    );
    if (hs.length === 0 || !walled) continue;
    let gap = 0;
    let at = hs[0]!;
    for (let i = 1; i < hs.length; i++) {
      const d = hs[i]!.from - hs[i - 1]!.to;
      if (d > gap) {
        gap = d;
        at = hs[i]!;
      }
    }
    items.push({
      value: gap,
      location: partLoc(at.partId),
      label: side === "inner" ? "côté jour" : "côté extérieur",
      bounds: strictMax(ctx),
    });
  }
  return checkBounded(
    ctx,
    items,
    "Discontinuité de main courante côté mur",
    "Sans objet : aucun côté à la fois mural et équipé d'une main courante.",
  );
});

const handrailThickness: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    flightHandrails(g).map((h) => ({
      value: h.sectionWidth,
      location: partLoc(h.partId),
      label: h.onGuard ? "main courante de garde-corps" : "main courante murale",
      bounds: rule(ctx),
    })),
    "Épaisseur de main courante",
    "Sans objet : aucune main courante.",
  ),
);

const handrailClearance: RuleEvaluator = withGuards((ctx, g) => {
  const min = ctx.contexts.has("logement_interieur") ? ctx.rule.min : MC_WALL_CLEARANCE_OTHER.value;
  return checkBounded(
    ctx,
    flightHandrails(g)
      .filter((h) => h.wallClearance !== undefined)
      .map((h) => ({
        value: h.wallClearance!,
        location: partLoc(h.partId),
        label: `main courante murale (${h.side === "inner" ? "côté jour" : "côté extérieur"})`,
        bounds: { min, max: null },
      })),
    "Dégagement entre main courante et paroi",
    "Sans objet : aucune main courante murale.",
  );
});

// ------------------------------------------------------------------ Largeur entre mains courantes

/**
 * Largeur libre entre mains courantes : emmarchement E diminué de l'empiètement des mains
 * courantes de chaque côté. `null` : garde-corps non décrits ou non calculés.
 */
export function handrailClearWidth(
  ctx: EvaluatorContext,
): { width: number; location: Location } | null {
  const g = guardsOf(ctx);
  if (!g) return null;
  let width = ctx.project.stair.layout.width;
  let location: Location = STAIR;
  for (const side of ["inner", "outer"] as const) {
    const hs = g.handrails.filter((h) => h.side === side);
    if (hs.length === 0) continue;
    const worst = hs.reduce((a, b) => (b.intrusion > a.intrusion ? b : a));
    width -= worst.intrusion;
    if (worst.intrusion > 0) location = partLoc(worst.partId);
  }
  return { width, location };
}

export const GUARD_EVALUATORS: Readonly<Record<string, RuleEvaluator>> = {
  GC_OBLIGATOIRE: mandatory,
  GC_HAUTEUR_RAMPANT_1988: rakeHeight,
  GC_HAUTEUR_RAMPANT_2024: rakeHeight,
  GC_HAUTEUR_PALIER_1988: levelHeight,
  GC_HAUTEUR_2024: height2024,
  GC_VIDE_1988_BARREAUX: gap1988Bars,
  GC_VIDE_1988_LISSES: gap1988Rails,
  GC_PARTIE_BASSE_1988: lowPart1988,
  GC_GABARIT_T1_2024: t1,
  GC_GABARIT_T2_2024: t2,
  GC_GABARIT_T3_2024: t3,
  GC_GABARIT_B_2024: templateB,
  GC_DENIVELES_2024: levels2024,
  CHARGE_GC_HORIZONTALE: horizontalLoad,
  MC_LOGEMENT: handrailMin,
  MC_DEUX_COTES: handrailBothSides,
  ECHELLE_MEUNIER_MC: handrailMin,
  MC_UP_ERP: handrailUp,
  MC_HAUTEUR: handrailHeight,
  MC_HAUTEUR_INDUSTRIEL: handrailHeight,
  MC_PROLONGEMENT_ERP: handrailExtension,
  MC_PROLONGEMENT_BHC: handrailExtension,
  MC_DISCONTINUITE: handrailDiscontinuity,
  MC_EPAISSEUR_MAX: handrailThickness,
  MC_DEGAGEMENT_MUR: handrailClearance,
};
