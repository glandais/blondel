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
import { dec, isMessage, msg, textMessage, type Message } from "@blondel/i18n";
import { computeGuards } from "../../guards/compute.js";
import { smallCoreDiameter } from "../../guards/handrailSides.js";
import type { GapMeasure, GuardRun, GuardsAnalysis, HandrailRun } from "../../guards/types.js";
import type { Location, Stepping } from "../../model/derived.js";
import type { Project } from "../../model/project.js";
import {
  STAIR,
  boundsText,
  notApplicable,
  notEvaluated,
  unitSuffix,
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
  GC_T2_ZONE_BOTTOM,
  MC_CORE_DIAMETER_MAX,
  MC_WALL_CLEARANCE_OTHER,
  UP2_WIDTH,
} from "../params.js";
import { numberCell, ruleParam, ruleTable } from "../table.js";
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
    if (g === undefined) return [notEvaluated(msg("compliance.guards.notDescribed"))];
    if (g === null) return [notEvaluated(msg("compliance.guards.notComputed"))];
    return fn(ctx, g);
  };
}

// ------------------------------------------------------------------ Outils

/**
 * Libellé d'un élément de l'analyse des garde-corps (ligne, vide, appui) : `Message` du domaine
 * garde-corps, ou texte brut tant qu'il n'est pas traduit.
 */
function labelOf(label: string | Message): Message {
  return isMessage(label) ? label : textMessage(label);
}

/** Côté de l'escalier dans un libellé (« côté jour », « côté extérieur »). */
function sideLabel(side: "inner" | "outer"): Message {
  return msg(side === "inner" ? "compliance.guards.side.inner" : "compliance.guards.side.outer");
}

/** « Sans objet : aucun garde-corps. » */
const noGuard = (): Message => msg("compliance.guards.noGuard");

interface BoundedItem {
  readonly value: number;
  readonly location: Location;
  readonly label: Message;
  readonly bounds: Bounds;
}

/**
 * Série d'éléments à bornes individuelles : un constat par élément non conforme, sinon un
 * constat `ok` portant l'élément le plus défavorable (localisé sur sa pièce). `empty` : constat
 * d'une série vide (par défaut « Sans objet. »).
 */
function checkBounded(
  ctx: EvaluatorContext,
  items: readonly BoundedItem[],
  quantity: Message,
  empty: Message = msg("compliance.notApplicable"),
): Finding[] {
  if (items.length === 0) return [notApplicable(empty)];
  const unit = ctx.rule.unite;
  const u = unitSuffix(unit);
  const nan = items.filter((it) => !Number.isFinite(it.value));
  if (nan.length > 0)
    return nan.map((it) =>
      notEvaluated(
        msg("structure.common.check.itemNotComputable", { quantity, item: it.label }),
        it.location,
      ),
    );
  const bad = items.filter((it) => !within(it.value, it.bounds));
  if (bad.length > 0) {
    return bad.map((it) => ({
      status: "violation" as const,
      measured: it.value,
      min: it.bounds.min,
      max: it.bounds.max,
      location: it.location,
      message: msg("compliance.check.item", {
        quantity,
        item: it.label,
        value: dec(it.value, 2),
        unit: u,
        bounds: boundsText(it.bounds, unit),
      }),
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
      message: msg("compliance.check.itemsOk", {
        quantity,
        count: String(items.length),
        value: dec(worst.value, 2),
        unit: u,
        item: worst.label,
        bounds: boundsText(worst.bounds, unit),
      }),
    },
  ];
}

const rule = (ctx: EvaluatorContext): Bounds => ({ min: ctx.rule.min, max: ctx.rule.max });
const strictMax = (ctx: EvaluatorContext): Bounds => ({ ...rule(ctx), strictMax: true });
const partLoc = (partId: string): Location => ({ kind: "part", partId });

const rakeRuns = (g: GuardsAnalysis): GuardRun[] => g.runs.filter((r) => r.kind === "rake");
/**
 * Lignes comportant une partie horizontale (trémie, paliers) ; leur hauteur de palier est
 * `levelHeight` (rehausse, QUESTIONS A1), à défaut `height`.
 */
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
        out.push({
          value: gap.value,
          location: gap.location,
          label: labelOf(gap.label),
          bounds,
        });
  return out;
}

// ------------------------------------------------------------------ Obligation

const mandatory: RuleEvaluator = withGuards((ctx, g) => {
  const limit = ctx.rule.max;
  if (limit === null) return [notEvaluated(msg("rules.GC_OBLIGATOIRE.noThreshold"))];
  const out: Finding[] = [];
  const oks: Message[] = [];
  let worst = 0;
  for (const side of g.sides) {
    if (!side.intervals.some((iv) => iv.kind === "void")) continue;
    worst = Math.max(worst, side.maxFall);
    const runs = g.runs.filter((r) => r.side === side.side);
    const where = sideLabel(side.side);
    if (side.maxFall <= limit) {
      oks.push(
        msg("rules.GC_OBLIGATOIRE.okBelow", {
          side: where,
          fall: dec(side.maxFall),
          limit: dec(limit),
        }),
      );
    } else if (side.side === "inner" && g.narrowJour) {
      // Jour plus étroit que la sphère T1 : pas de garde-corps de jour, constat en conseil
      // (décision de l'utilisateur 2026-09-29, QUESTIONS A10) pour la chute dans l'emprise du
      // jour ; hors de celle-ci (volée plus longue que celle d'en face, vide ouvert), le constat
      // garde sa sévérité (revue A10).
      const j = g.narrowJour;
      const jourSize = { width: dec(j.width, 0), threshold: dec(j.threshold, 0) };
      const jour = msg("rules.GC_OBLIGATOIRE.narrowJour", jourSize);
      if (j.jourFall > limit)
        out.push({
          status: "violation",
          measured: j.jourFall,
          max: limit,
          location: j.jourFallAt ? { kind: "point", at: j.jourFallAt } : STAIR,
          severity: "conseil",
          severityReason: msg("rules.GC_OBLIGATOIRE.narrowJourReason", jourSize),
          message: msg("rules.GC_OBLIGATOIRE.jourFall", {
            fall: dec(j.jourFall),
            limit: dec(limit),
            jour,
          }),
        });
      if (j.outsideFall > limit)
        out.push({
          status: "violation",
          measured: j.outsideFall,
          max: limit,
          location: j.outsideFallAt ? { kind: "point", at: j.outsideFallAt } : STAIR,
          message: msg(
            j.partialGuards
              ? "rules.GC_OBLIGATOIRE.outsideFallPartial"
              : "rules.GC_OBLIGATOIRE.outsideFall",
            { fall: dec(j.outsideFall), limit: dec(limit), jour },
          ),
        });
      // Garde-corps partiel hors du jour (décision A10 du 2026-09-30) : chute protégée.
      if (j.partialGuards && j.guardedFall !== undefined && j.guardedFall > limit)
        oks.push(msg("rules.GC_OBLIGATOIRE.okPartial", { side: where, fall: dec(j.guardedFall) }));
      if (j.jourFall <= limit && j.outsideFall <= limit && !(j.partialGuards && runs.length > 0))
        oks.push(
          msg("rules.GC_OBLIGATOIRE.okNarrowJour", {
            side: where,
            fall: dec(side.maxFall),
            jour,
          }),
        );
    } else if (runs.length > 0) {
      oks.push(msg("rules.GC_OBLIGATOIRE.okGuarded", { side: where, fall: dec(side.maxFall) }));
    } else {
      out.push({
        status: "violation",
        measured: side.maxFall,
        max: limit,
        location: side.maxFallAt ? { kind: "point", at: side.maxFallAt } : STAIR,
        message: msg("rules.GC_OBLIGATOIRE.unguarded", {
          fall: dec(side.maxFall),
          limit: dec(limit),
          side: where,
        }),
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
        message: msg("rules.GC_OBLIGATOIRE.openingEdge", {
          fall: dec(g.openingFall),
          limit: dec(limit),
        }),
      });
    }
  }
  const openingRuns = g.runs.filter((r) => r.kind === "opening");
  if (openingRuns.length > 0) {
    worst = Math.max(worst, g.openingFall);
    oks.push(msg("rules.GC_OBLIGATOIRE.okOpening", { fall: dec(g.openingFall) }));
  }
  if (out.length > 0) return out;
  if (oks.length === 0) return [notApplicable(msg("rules.GC_OBLIGATOIRE.none"))];
  // Chute supérieure au seuil mais protégée : la borne ne s'applique plus à la mesure (la
  // conformité tient à la présence du garde-corps) ; ne pas afficher « attendu ≤ seuil ».
  return [
    {
      status: "ok",
      measured: worst,
      max: worst <= limit ? limit : null,
      location: g.runs[0] ? partLoc(g.runs[0].primaryPartId) : STAIR,
      message: msg("rules.GC_OBLIGATOIRE.ok", {
        list: oks.reduce((first, next) => msg("compliance.join.semicolon", { first, next })),
      }),
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
        label: msg("compliance.guards.rake.item", { run: labelOf(r.label) }),
        bounds: rule(ctx),
      })),
    msg("compliance.guards.rake.quantity"),
    msg("compliance.guards.rake.none"),
  ),
);

/** Hauteur des garde-corps horizontaux (trémie, paliers) au-dessus du sol ou du palier. */
const levelHeight: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    levelRuns(g).map((r) => ({
      value: r.levelHeight ?? r.height,
      location: partLoc(r.primaryPartId),
      label: labelOf(r.label),
      bounds: rule(ctx),
    })),
    msg("rules.GC_HAUTEUR_PALIER_1988.quantity"),
    msg("rules.GC_HAUTEUR_PALIER_1988.none"),
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
 * Table h(E) de GC_HAUTEUR_2024, lue dans son champ structuré `tables.h_E` (lignes
 * `{ E_max, H, condition_b }`, `E_max: null` pour la dernière tranche « E > … ») et plancher des
 * valeurs à condition (b) (`parametres.H_plancher_condition_b`, « ne pas descendre sous 900 »).
 * `null` si la table n'est pas exploitable.
 */
export function guardHeightTable(): { steps: GuardHeightStep[]; floorB: number } | null {
  try {
    const rows = ruleTable("GC_HAUTEUR_2024", "h_E");
    const steps: GuardHeightStep[] = [];
    let previous: number | null = null;
    for (const row of rows) {
      const eMax = row["E_max"];
      const h = numberCell(row, "H");
      const conditional = row["condition_b"] === true;
      if (typeof eMax === "number") {
        steps.push({ op: "le", e: eMax, h, conditional });
        previous = eMax;
      } else if (eMax === null && previous !== null) {
        steps.push({ op: "gt", e: previous, h, conditional });
      } else return null;
    }
    if (steps.length === 0) return null;
    return { steps, floorB: ruleParam("GC_HAUTEUR_2024", "H_plancher_condition_b") };
  } catch {
    return null;
  }
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
    if (h === null) return [notEvaluated(msg("rules.GC_HAUTEUR_2024.tableUnusable"))];
    items.push({
      value: r.levelHeight ?? r.height,
      location: partLoc(r.primaryPartId),
      label: msg("rules.GC_HAUTEUR_2024.item", {
        run: labelOf(r.label),
        thickness: dec(r.thickness),
        height: dec(h),
      }),
      bounds: { min: Math.max(h, ctx.rule.min ?? h), max: null },
    });
  }
  return checkBounded(
    ctx,
    items,
    msg("rules.GC_HAUTEUR_2024.quantity"),
    msg("rules.GC_HAUTEUR_2024.none"),
  );
});

/** Gabarit B : un appui à X ∈ [100 ; 600[ exige H ≥ 1 000 + X. */
const templateB: RuleEvaluator = withGuards((ctx, g) => {
  if (g.runs.length === 0) return [notApplicable(noGuard())];
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
      label: msg("rules.GC_GABARIT_B_2024.item", {
        run: labelOf(r.label),
        x: dec(top.x),
        foothold: labelOf(top.label),
        base: dec(GC_B_BASE.value),
      }),
      bounds: { min: GC_B_BASE.value + top.x, max: null },
    });
  }
  if (items.length === 0)
    return [
      {
        ...notApplicable(
          msg("rules.GC_GABARIT_B_2024.noFoothold", {
            min: String(GC_B_ZONE_MIN.value),
            max: String(GC_B_ZONE_MAX.value),
          }),
        ),
        location: partLoc(g.runs[0]!.primaryPartId),
      },
    ];
  return checkBounded(ctx, items, msg("rules.GC_GABARIT_B_2024.quantity"));
});

// ------------------------------------------------------------------ Vides

const t1: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    gapItems(g, (gap) => gap.zBottom < GC_T1_ZONE_TOP.value, strictMax(ctx)),
    msg("rules.GC_GABARIT_T1_2024.quantity", { top: String(GC_T1_ZONE_TOP.value) }),
    noGuard(),
  ),
);

const t2: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    gapItems(g, (gap) => gap.zTop > GC_T2_ZONE_BOTTOM.value, strictMax(ctx)),
    msg("rules.GC_GABARIT_T2_2024.quantity", { bottom: String(GC_T2_ZONE_BOTTOM.value) }),
    msg("rules.GC_GABARIT_T2_2024.none", { bottom: String(GC_T2_ZONE_BOTTOM.value) }),
  ),
);

const t3: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    g.runs.flatMap((r) =>
      r.meshOpenings.map((m) => ({
        value: m.value,
        location: m.location,
        label: labelOf(m.label),
        bounds: strictMax(ctx),
      })),
    ),
    msg("rules.GC_GABARIT_T3_2024.quantity"),
    msg("rules.GC_GABARIT_T3_2024.none"),
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
    msg("rules.GC_VIDE_1988_BARREAUX.quantity"),
    noGuard(),
  ),
);

/** 1988 : vides entre lisses (et câbles) au-dessus de la partie basse, perpendiculaires à la pente. */
const gap1988Rails: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    gapItems(g, (gap) => gap.kind === "horizontal", rule(ctx)),
    msg("rules.GC_VIDE_1988_LISSES.quantity"),
    msg("rules.GC_VIDE_1988_LISSES.none"),
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
        label: low
          ? msg("rules.GC_PARTIE_BASSE_1988.item", {
              run: labelOf(r.label),
              foothold: labelOf(low.label),
            })
          : msg("rules.GC_PARTIE_BASSE_1988.itemNoFoothold", { run: labelOf(r.label) }),
        bounds: rule(ctx),
      };
    }),
    msg("rules.GC_PARTIE_BASSE_1988.quantity"),
    noGuard(),
  ),
);

const levels2024: RuleEvaluator = withGuards((_ctx, g) =>
  g.runs.length === 0
    ? [notApplicable(noGuard())]
    : [
        notEvaluated(
          msg("rules.GC_DENIVELES_2024.notEvaluated"),
          partLoc(g.runs[0]!.primaryPartId),
        ),
      ],
);

/** Information de dimensionnement : charge horizontale à reprendre (non vérifiée). */
const horizontalLoad: RuleEvaluator = withGuards((ctx, g) => {
  if (g.runs.length === 0) return [notApplicable(noGuard())];
  const publicUse = ["erp_neuf", "erp_existant", "erp_securite"].some((c) => ctx.contexts.has(c));
  const q = publicUse ? GC_LOAD_PUBLIC : GC_LOAD_HOUSING;
  return [
    {
      status: "non-evaluee",
      location: partLoc(g.runs[0]!.primaryPartId),
      message: msg("rules.CHARGE_GC_HORIZONTALE.info", {
        load: dec(q.value, 2),
        category: msg(
          publicUse
            ? "rules.CHARGE_GC_HORIZONTALE.categoryPublic"
            : "rules.CHARGE_GC_HORIZONTALE.categoryHousing",
        ),
      }),
    },
  ];
});

/**
 * GC_CABLES_DETENTE : remplissage à câbles. NF P01-012:2024 : les vides ne doivent pas augmenter
 * dans le temps (« attention aux câbles qui se détendent ») [C §3.1] ; SPEC X12 : câbles traités
 * comme des lisses **avec un avertissement de détente**. Un constat par garde-corps à câbles.
 */
const cableSlack: RuleEvaluator = withGuards((_ctx, g) => {
  const runs = g.runs.filter((r) => r.infill === "cables");
  if (runs.length === 0) return [notApplicable(msg("rules.GC_CABLES_DETENTE.none"))];
  return runs.map((run) => ({
    status: "violation" as const,
    location: run.infillPartIds[0] ? partLoc(run.infillPartIds[0]) : STAIR,
    message: msg("rules.GC_CABLES_DETENTE.warning", { run: labelOf(run.label) }),
  }));
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
      message: msg("compliance.handrails.count", {
        count: n,
        bounds: boundsText(b, ctx.rule.unite),
      }),
    },
  ];
}

const handrailMin: RuleEvaluator = withGuards((ctx, g) => handrailCount(ctx, g, ctx.rule.min));

/** Une main courante de chaque côté, sauf hélicoïdal ERP neuf à fût de Ø ≤ 400 mm (une seule). */
const handrailBothSides: RuleEvaluator = withGuards((ctx, g) => {
  const d = smallCoreDiameter(ctx.contexts, ctx.project);
  if (d === null) return handrailCount(ctx, g, ctx.rule.min);
  return handrailCount(ctx, g, 1).map((f) => ({
    ...f,
    message: msg("rules.MC_DEUX_COTES.exception", {
      message: f.message,
      diameter: dec(d),
      max: dec(MC_CORE_DIAMETER_MAX.value),
    }),
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
      message: msg("rules.MC_UP_ERP.outerPresent", { message: f.message }),
    }));
  return [
    {
      status: "violation",
      measured: 0,
      min: 1,
      max: null,
      location: count[0]?.location ?? STAIR,
      message: msg("rules.MC_UP_ERP.outerMissing", { count: handrailSides(g) }),
    },
  ];
});

const handrailHeight: RuleEvaluator = withGuards((ctx, g) => {
  const items: BoundedItem[] = [];
  for (const h of flightHandrails(g)) {
    if (h.nosingHeights.length === 0) continue;
    const vs = h.nosingHeights.map((n) => n.height);
    const handrail = msg(
      h.onGuard ? "compliance.handrails.onGuardSide" : "compliance.handrails.wallSide",
      { side: sideLabel(h.side) },
    );
    items.push({
      value: Math.min(...vs),
      location: partLoc(h.partId),
      label: msg("compliance.handrails.minimum", { handrail }),
      bounds: rule(ctx),
    });
    items.push({
      value: Math.max(...vs),
      location: partLoc(h.partId),
      label: msg("compliance.handrails.maximum", { handrail }),
      bounds: rule(ctx),
    });
  }
  return checkBounded(
    ctx,
    items,
    msg("compliance.handrails.heightQuantity"),
    msg("compliance.handrails.noFlightHandrail"),
  );
});

const handrailExtension: RuleEvaluator = withGuards((ctx, g) => {
  const hs = flightHandrails(g);
  if (hs.length === 0) return [notApplicable(msg("compliance.handrails.noFlightHandrail"))];
  const going = ctx.stepping.going;
  const b: Bounds = { min: going, max: null };
  const items: BoundedItem[] = [];
  const bottoms = hs.filter((h) => h.extensionBottom !== undefined);
  const tops = hs.filter((h) => h.extensionTop !== undefined);
  for (const h of bottoms)
    items.push({
      value: h.extensionBottom!,
      location: partLoc(h.partId),
      label: msg("compliance.handrails.extensionBottom"),
      bounds: b,
    });
  for (const h of tops)
    items.push({
      value: h.extensionTop!,
      location: partLoc(h.partId),
      label: msg("compliance.handrails.extensionTop"),
      bounds: b,
    });
  if (bottoms.length === 0)
    items.push({
      value: 0,
      location: partLoc(hs[0]!.partId),
      label: msg("compliance.handrails.noneAtStart"),
      bounds: b,
    });
  if (tops.length === 0)
    items.push({
      value: 0,
      location: partLoc(hs[0]!.partId),
      label: msg("compliance.handrails.noneAtArrival"),
      bounds: b,
    });
  return checkBounded(
    ctx,
    items,
    msg("compliance.handrails.extensionQuantity", { going: dec(going) }),
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
      label: sideLabel(side),
      bounds: strictMax(ctx),
    });
  }
  return checkBounded(
    ctx,
    items,
    msg("rules.MC_DISCONTINUITE.quantity"),
    msg("rules.MC_DISCONTINUITE.none"),
  );
});

const handrailThickness: RuleEvaluator = withGuards((ctx, g) =>
  checkBounded(
    ctx,
    flightHandrails(g).map((h) => ({
      value: h.sectionWidth,
      location: partLoc(h.partId),
      label: msg(h.onGuard ? "compliance.handrails.onGuard" : "compliance.handrails.wall"),
      bounds: rule(ctx),
    })),
    msg("rules.MC_EPAISSEUR_MAX.quantity"),
    msg("rules.MC_EPAISSEUR_MAX.none"),
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
        label: msg("compliance.handrails.wallSide", { side: sideLabel(h.side) }),
        bounds: { min, max: null },
      })),
    msg("rules.MC_DEGAGEMENT_MUR.quantity"),
    msg("rules.MC_DEGAGEMENT_MUR.none"),
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
  GC_CABLES_DETENTE: cableSlack,
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
