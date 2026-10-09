/**
 * Plugin `wood-central` : limon central bois (QUESTIONS A29, décisions de l'utilisateur du
 * 2026-10-06, vague 2 ; SPEC §2.3, §2.4 ; C §1.4 à §1.7).
 *
 * Une crémaillère centrale unique sous les marches (`woodCentralParams.ts`), à l'axe de
 * l'emmarchement par défaut, sur la trace partagée avec `steel-central` (`centralTrace.ts`) :
 * droite (escalier droit : massif ou couches collées), débillardée (tournants) ou hélicoïdale
 * (lamellé-collé cintré sur moule, règle k_r `LAMELLE_CINTRE_KR`, ou couches horizontales
 * empilées sans moule, défaut au-delà de 60 mm, QUESTIONS A33 (e)). La poutre, ses entailles,
 * ses boulons et tire-fonds, ses ancrages (sabots en U ou platines à âme noyée, A33 (f),
 * A34 (c)) et ses couches sont construits par `woodCentralBeam.ts` ; ce module assemble la
 * sortie du plugin et ses contrôles :
 *
 * - **Règles de rules.yaml** (contexte déduit `limon_central_bois`) : `CREMAILLERE_REGLE_MOYENS`
 *   (reste sous entaille de chaque assise contre le tableau FCBA lu à b / `facteur_centrale` ;
 *   `non-evaluee` avec sa raison hors du domaine du tableau, en particulier sur une trace courbe :
 *   le tableau est établi pour un escalier droit), `LIMON_EPAISSEUR_MIN_DTU` (largeur b),
 *   `LIMON_ENTAILLE_MIN` (entaille arrière de chaque marche dans la dent suivante, marche
 *   d'arrivée exclue), `LAMELLE_CINTRE_KR` (r_in / t des lamelles cintrées, refus bloquant sous
 *   `min` ; poutre droite, massive ou en couches empilées : k_r = 1).
 * - **Contrôles du plugin** : plis minces (`LAMELLE_PLIS_MINCES`, SPEC Q10, avertissement et
 *   justification jointe comme A12), double porte-à-faux et torsion (`LIMON_CENTRAL_PORTE_A_FAUX`,
 *   repris de `steel-central`, toujours présent dès qu'il y a des marches).
 * - **Prédimensionnement** en flexion de la poutre (`precheck/`) : largeur reprise = emmarchement
 *   entier (une seule poutre), classe de bois du réglage `precheck.woodClass` (`auto` : GL24h
 *   pour l'essence lamellé-collé, classes GL de la NF EN 14080 via C §1.11 [71], QUESTIONS
 *   A33 (a) ; classe massive de l'essence pour une poutre en lamellé-collé feuillu, D40 pour le
 *   chêne, à valider, A35 (k) ; C24 sinon), résistance de calcul multipliée par
 *   k_r quand les lamelles sont cintrées sous `recommande` (C §1.6, EN 1995-1-1 via [71]) ;
 *   en **couches empilées** (fil horizontal), résistance et module réduits selon l'angle θ entre
 *   le fil et l'axe de la poutre par la formule de type Hankinson du Wood Handbook
 *   (`precheck/grain.ts`, paramètres `grainAngle`, C §1.11 [81], à valider, A35 (j)) ;
 *   torsion et déversement non vérifiés (remarque du prédimensionnement).
 *
 * `build` ne lève jamais : toute erreur devient un `Message` de `errors`.
 */
import { dec, errorMessage, msg, textMessage, type Message } from "@blondel/i18n";
import type { Part, RuleResult } from "../model/derived.js";
import type {
  StructureContext,
  StructureKind,
  StructureLayoutTraits,
  StructureOutput,
  UnsupportedParamOption,
} from "../model/plugins.js";
import type { Mm } from "../model/primitives.js";
import { buildBasicParts } from "../parts/basic.js";
import { analyzeInclinedBeam } from "../precheck/beam.js";
import { precheckNotEvaluated, precheckResults, type PrecheckedBeam } from "../precheck/checks.js";
import { grainAngle, hankinsonFactor } from "../precheck/grain.js";
import { stairLoads } from "../precheck/loads.js";
import {
  HARDWOOD_WOOD_CLASS,
  PrecheckSettingsSchema,
  woodMaterialOf,
  type BeamMaterial,
} from "../precheck/settings.js";
import { activeContexts, permanentAreaLoad } from "../precheck/stringers.js";
import { sourceSpec } from "../rules/sources.js";
import type { RuleDef } from "../rules/table.js";
import type { Finding } from "../rules/types.js";
import { resolveWorkshopProfile } from "../workshop/profile.js";
import { buildCentralTrace, type CentralTraceKind } from "./centralTrace.js";
import {
  CheckCollector,
  pluginRuleDef,
  stringerRulesOutOfDomain,
  type CheckItem,
  type PluginRuleSpec,
} from "./checks.js";
import { CREMAILLERE_RULE_ID, fcbaTable } from "./fcba.js";
import { CENTRAL_RULES } from "./steelCentral.js";
import { deduceExecutionClass, executionClassReasons } from "./steelCommon.js";
import { buildWoodCentralBeam, type WoodCentralBeamResult } from "./woodCentralBeam.js";
import { WoodCentralParamsSchema, type WoodCentralParams } from "./woodCentralParams.js";
import { resolvePlateWidth } from "./woodCentralPlates.js";
import { fcbaHardwoodAutoNote } from "./woodCut.js";
import { woodCentralBoltSpacing } from "./woodSpacing.js";

export {
  WOOD_CENTRAL_SECTION_KINDS,
  WOOD_CENTRAL_STRENGTH_CLASSES,
  WoodCentralParamsSchema,
  type WoodCentralParams,
  type WoodCentralSectionKind,
} from "./woodCentralParams.js";

/** Identifiant de la règle k_r du lamellé-collé cintré (rules.yaml). */
export const LAMELLE_CINTRE_KR_ID = "LAMELLE_CINTRE_KR";

/**
 * Contrôles propres au plugin (hors rules.yaml) ; titres et descriptions : `rules.<id>.title` /
 * `rules.<id>.description`. Le contrôle « double porte-à-faux et torsion » réutilise
 * `CENTRAL_RULES.cantilever` (`LIMON_CENTRAL_PORTE_A_FAUX`, `steelCentral.ts`) et n'est pas
 * redéclaré ici. Nom **figé** (repris par `rules/messages.test.ts`).
 */
export const WOOD_CENTRAL_RULES = {
  /**
   * Lamellé-collé cintré en plis minces (SPEC Q10 ; C §1.6 ⚠️ [7] : plis de 1 à 7 mm, hors
   * NF EN 14080) : avertissement « justification requise », justification jointe (même
   * traitement que `LIMON_CENTRAL_PORTE_A_FAUX`, décision A12). Seuil : paramètre
   * `section.thinPlyMax` (à valider, QUESTIONS A33).
   */
  thinPlies: {
    id: "LAMELLE_PLIS_MINCES",
    ...sourceSpec(msg("compliance.source.thinPlies")),
    confidence: "faible",
    nature: "metier",
    severity: "avertissement",
    unit: "mm",
  },
} as const satisfies Record<string, PluginRuleSpec>;

/**
 * Le tracé porte-t-il une trace courbe (tournant ou hélicoïdal) ? Lamelles cintrées, plis
 * minces et section massive refusée en dépendent ; repris par l'interface (paramètres
 * applicables) pour ne pas dupliquer le critère.
 */
export function woodCentralCurvedLayout(traits: StructureLayoutTraits): boolean {
  return traits.kind === "helical" || traits.turns > 0;
}

/**
 * Options non prises en charge : section massive sur une trace courbe (tournant, hélicoïdal) —
 * le massif courbe se taille par tronçons (quartiers) dans des blocs dont l'équarrissage croît
 * avec la longueur (C §1.6 [6], §4.2) : filière non prise en charge, le lamellé-collé cintré sur
 * moule (C §1.6 [7]) est la seule section proposée sur une trace courbe.
 */
export function woodCentralUnsupportedOptions(
  traits: StructureLayoutTraits,
): readonly UnsupportedParamOption[] {
  return woodCentralCurvedLayout(traits)
    ? [
        {
          path: ["section", "kind"],
          value: "solid",
          reason: msg("structure.woodCentral.unsupported.solidCurved"),
        },
      ]
    : [];
}

/** Construction. Ne lève jamais. */
export function buildWoodCentral(
  ctx: StructureContext,
  params: WoodCentralParams,
): StructureOutput {
  try {
    return buildUnsafe(ctx, params);
  } catch (err) {
    const checks = new CheckCollector(ctx.project, ctx.stepping);
    if (ctx.stepping.treads.length > 0) addCantileverCheck(checks, params);
    return {
      parts: [],
      checks: checks.results,
      notes: [],
      errors: [
        msg("structure.steelCentral.error.notGenerated", {
          label: msg("structure.woodCentral.shortLabel"),
          detail: errorMessage(err),
        }),
      ],
    };
  }
}

/**
 * Contrôle « double porte-à-faux et torsion » (A29 n° 4, comme A12) : toujours présent. Les
 * messages de `steel-central` parlent du « limon central » sans matériau : repris tels quels.
 */
function addCantileverCheck(checks: CheckCollector, params: WoodCentralParams): void {
  const justification = params.cantileverJustification.trim();
  checks.add(pluginRuleDef(CENTRAL_RULES.cantilever), [
    justification === ""
      ? { status: "violation", message: msg("structure.steelCentral.check.cantileverRequired") }
      : {
          // Une justification n'est pas une vérification : l'avertissement reste affiché,
          // justification jointe au résultat et reprise dans le dossier (décision A12).
          status: "violation",
          message: msg("structure.steelCentral.check.cantileverJustified", { justification }),
          justification,
        },
  ]);
}

/** Largeur reprise par la poutre : l'emmarchement entier (une seule poutre). */
function tributaryWidth(ctx: StructureContext): Mm {
  const h = ctx.layout.helical;
  if (h) return h.outerRadius - h.innerRadius;
  const lay = ctx.project.stair.layout;
  return lay.kind === "helical" ? 0 : lay.width;
}

function traceKindLabel(kind: CentralTraceKind): Message {
  return msg(
    kind === "straight"
      ? "structure.steelCentral.traceKind.straight"
      : kind === "turning"
        ? "structure.steelCentral.traceKind.turning"
        : "structure.steelCentral.traceKind.helical",
  );
}

function buildUnsafe(ctx: StructureContext, params: WoodCentralParams): StructureOutput {
  const { project, stepping } = ctx;
  const checks = new CheckCollector(project, stepping);
  const hasTreads = stepping.treads.length > 0;

  // 1. Trace (configuration non prise en charge : aucune pièce).
  const traced = buildCentralTrace(ctx, params);
  if (!traced.ok) {
    if (hasTreads) addCantileverCheck(checks, params);
    return { parts: [], checks: checks.results, notes: [], errors: traced.errors };
  }
  const trace = traced.trace;

  // 2. Poutre, entailles, boulons, sabots (contrôles de fabrication ajoutés par la poutre).
  const beam = buildWoodCentralBeam({ ctx, params, trace, checks });
  const hasBeam = beam.beamPartId !== undefined;
  const curved = trace.kind !== "straight";

  // 3. Contrôles de rules.yaml et du plugin.
  const krRule = checks.yamlRule(LAMELLE_CINTRE_KR_ID);
  if (krRule) addKrCheck(checks, krRule, beam, hasBeam);
  if (hasBeam) {
    addMeansChecks(ctx, checks, params, beam, curved);
    addThinPliesCheck(checks, params, beam);
  }
  if (hasTreads) addCantileverCheck(checks, params);

  // 4. Prédimensionnement en flexion de la poutre (largeur reprise : E entier).
  const notes: Message[] = [...trace.notes, ...beam.notes];
  let precheckOut: StructureOutput["precheck"];
  let precheckChecks: readonly RuleResult[] = [];
  const beamPart = hasBeam ? beam.parts.find((p) => p.id === beam.beamPartId) : undefined;
  if (beamPart && beam.spanH > 0 && beam.section.i > 0) {
    const profile = resolveWorkshopProfile(project.workshop);
    const pc = PrecheckSettingsSchema.parse(params.precheck);
    const loads = stairLoads(pc, activeContexts(project, stepping));
    const permanentArea =
      permanentAreaLoad(
        ctx.baseParts ?? buildBasicParts(project, ctx.layout, stepping).parts,
        stepping,
        profile,
      ) + pc.extraPermanent;
    // Classe retenue : réglage, ou `auto` → GL24h pour l'essence lamellé-collé (QUESTIONS
    // A33 (a), NF EN 14080 via C §1.11 [71]), D30 pour une essence feuillue, massive ou
    // lamellée-collée (classe visuelle 1 du chêne, à valider, A36 (1)), C24 sinon.
    // Classe FCBA saisie (C30, D40) : même hypothèse pour une essence feuillue.
    const glulam = beam.lamination.kind === "glulam";
    const imposed =
      params.strengthClass === "C30" || params.strengthClass === "D40"
        ? params.strengthClass
        : undefined;
    const base = woodMaterialOf(
      pc,
      profile.wood.densities[params.material],
      params.material,
      imposed !== undefined ? { strengthClass: imposed } : undefined,
    );
    const kr = beam.lamination.kr;
    // k_r réduit la résistance de calcul du lamellé cintré (C §1.6, EN 1995-1-1 via [71]).
    const reduced = Number.isFinite(kr) && kr > 0 && kr < 1;
    // Couches empilées (A33 (e)) : fil horizontal, à θ de l'axe de la poutre inclinée ; résistance
    // et module réduits par la formule de type Hankinson (A35 (j), C §1.11 [81], à valider).
    const grain = beam.lamination.method === "stacked" ? stackedGrainReduction(params, beam) : null;
    const grainOk =
      grain !== null && [grain.theta, grain.kf, grain.kE].every((v) => Number.isFinite(v));
    let material: BeamMaterial = reduced ? { ...base, design: base.design * kr } : base;
    if (grain !== null && grainOk) {
      material = {
        ...material,
        e: material.e * grain.kE,
        strength: material.strength * grain.kf,
        design: material.design * grain.kf,
      };
    }
    const result = analyzeInclinedBeam({
      spanH: beam.spanH,
      slope: Math.max(0, beam.slope),
      section: beam.section,
      material,
      tributaryWidth: tributaryWidth(ctx),
      permanentArea,
      loads,
      settings: pc,
    });
    const beamLabel = msg("structure.steelCentral.precheck.beam", {
      mark: beamPart.mark,
      section: beam.sectionLabel,
      grade: base.label,
    });
    // Angle du fil ou facteurs non finis (paramètres dégénérés) : non évalué, avec sa raison.
    const notEvaluated =
      grain !== null && !grainOk ? msg("structure.woodCentral.precheck.grainNotFinite") : null;
    const beams: PrecheckedBeam[] = notEvaluated
      ? []
      : [{ partId: beamPart.id, label: beamLabel, result }];
    precheckChecks = notEvaluated
      ? precheckNotEvaluated(project, stepping, beamPart.id, beamLabel, notEvaluated)
      : precheckResults(project, stepping, beams);
    // Remarque du prédimensionnement de `steel-central` (limon central sans matériau) : poutre
    // unique, largeur reprise = emmarchement entier, torsion et déversement non vérifiés.
    const precheckNote = msg("structure.steelCentral.note.precheck", {
      qk: dec(loads.qk, 1),
      Qk: dec(loads.Qk, 1),
      source: loads.sourceMessage,
      permanent: dec(permanentArea, 2),
    });
    const precheckNotes: Message[] = [precheckNote];
    if (reduced) {
      precheckNotes.push(msg("structure.woodCentral.note.precheckKr", { kr: dec(kr, 3) }));
    }
    // Classe d'une essence feuillue retenue par `auto` (A35 (k), A36 (1)), massive ou
    // lamellée-collée : remarque propre ; autre classe d'un lamellé-collé : rappel du réglage.
    const hardwood = HARDWOOD_WOOD_CLASS[params.material];
    const species =
      pc.woodClass === "auto" && hardwood !== undefined && base.label === (imposed ?? hardwood);
    if (species || glulam) {
      precheckNotes.push(
        msg(
          species
            ? "structure.woodCentral.note.precheckClassSpecies"
            : "structure.woodCentral.note.precheckClassSetting",
          { woodClass: base.label },
        ),
      );
    }
    if (grain !== null && grainOk) {
      const deg = (a: number) => dec((a * 180) / Math.PI, 1);
      precheckNotes.push(
        msg("structure.woodCentral.note.precheckGrain", {
          angle: deg(grain.theta),
          slope: deg(Math.atan(Math.max(0, beam.slope))),
          deviation: deg(grain.deviation),
          kf: dec(grain.kf, 3),
          kE: dec(grain.kE, 3),
          strengthRatio: dec(params.grainAngle.strengthRatio, 3),
          strengthExponent: dec(params.grainAngle.strengthExponent, 2),
          modulusRatio: dec(params.grainAngle.modulusRatio, 3),
          modulusExponent: dec(params.grainAngle.modulusExponent, 2),
        }),
      );
    }
    if (notEvaluated) {
      precheckNotes.push(
        msg("structure.woodCentral.note.precheckStacked", { reason: notEvaluated }),
      );
    }
    notes.push(...precheckNotes);
    precheckOut = { beams, loads, permanentArea, notes: precheckNotes };
  }

  // 5. Remarque de synthèse : section, lamellation, k_r, reste sous entaille et sa provenance.
  if (hasBeam) notes.push(summaryNote(params, beam, trace.kind));
  // Lecture FCBA `auto` d'une essence feuillue D30 : colonne C30 (QUESTIONS A37 (2)).
  if (
    hasBeam &&
    params.section.residual === "auto" &&
    beam.fcba.required !== null &&
    beam.fcba.unusable === undefined
  ) {
    const hardwood = fcbaHardwoodAutoNote(params.material, params.strengthClass);
    if (hardwood) notes.push(hardwood);
  }

  // 6. Classe d'exécution des ancrages : sabots en tôle pliée boulonnée et chevillée, **sans
  // soudure** ni joint bout à bout (C §2.1 : PC1 pour les éléments non soudés, toutes nuances)
  // ⇒ EXC1 ; platines à âme noyée, âme **soudée** en T sur la platine (`anchorsWelded`). La
  // classe n'est rendue que s'il y a des pièces en acier (ancrages), comme les autres plugins
  // mixtes ; sans ancrage, aucune pièce métallique : pas de classe d'exécution.
  const steelParts = beam.parts.filter((p) => p.material.startsWith("steel"));
  let executionClass: "EXC1" | "EXC2" | undefined;
  if (steelParts.length > 0) {
    const grade = params.anchors.grade;
    const exc = deduceExecutionClass({ grade, buttWeld: 0, welded: beam.anchorsWelded });
    executionClass = exc.executionClass;
    notes.push(
      msg("structure.steel.exc.note", {
        executionClass: exc.executionClass,
        reasons: executionClassReasons(exc, grade),
      }),
    );
  }

  // 7. Valeurs `auto` retenues (finies seulement).
  const autoValues: Record<string, number> = {};
  if (params.section.residual === "auto" && hasBeam && Number.isFinite(beam.residual)) {
    autoValues["section.residual"] = beam.residual;
  }
  // Épaisseur de lamelle : couches droites ou lamelles cintrées (les couches empilées ont leur
  // propre épaisseur, `section.layerThickness`).
  if (
    params.section.lamellaThickness === "auto" &&
    hasBeam &&
    beam.lamination.kind === "glulam" &&
    beam.lamination.method !== "stacked" &&
    Number.isFinite(beam.lamination.lamellaThickness)
  ) {
    autoValues["section.lamellaThickness"] = beam.lamination.lamellaThickness;
  }
  if (hasBeam && beam.stacked) {
    if (params.section.layerThickness === "auto" && Number.isFinite(beam.stacked.layerThickness))
      autoValues["section.layerThickness"] = beam.stacked.layerThickness;
    if (
      params.section.dressingAllowance === "auto" &&
      Number.isFinite(beam.stacked.dressingAllowance)
    )
      autoValues["section.dressingAllowance"] = beam.stacked.dressingAllowance;
  }
  if (params.notch.rearDepth === "auto" && hasBeam && Number.isFinite(beam.rearDepth)) {
    autoValues["notch.rearDepth"] = beam.rearDepth;
  }
  // Entraxe et pince des organes de marche : bornes « tous angles » de l'EC5 (A34 (b)) ;
  // tire-fonds au plus sévère des règles latérales et axiales (A35 (l)).
  if (hasBeam) {
    const spacing = woodCentralBoltSpacing(
      params.bolts,
      resolveWorkshopProfile(project.workshop).fasteners,
      params.lagScrews,
    );
    if (params.bolts.minSpacing === "auto") autoValues["bolts.minSpacing"] = spacing.minSpacing;
    if (params.bolts.edgeDistance === "auto")
      autoValues["bolts.edgeDistance"] = spacing.edgeDistance;
    if (params.lagScrews.minSpacing === "auto" && Number.isFinite(spacing.lag.minSpacing))
      autoValues["lagScrews.minSpacing"] = spacing.lag.minSpacing;
    if (params.lagScrews.endDistance === "auto" && Number.isFinite(spacing.lag.frontEndDistance))
      autoValues["lagScrews.endDistance"] = spacing.lag.frontEndDistance;
    // Pince axiale a1,CG le long du fil (QUESTIONS A36 (4)).
    if (
      params.lagScrews.threadEndDistance === "auto" &&
      Number.isFinite(spacing.lag.threadEndDistance)
    )
      autoValues["lagScrews.threadEndDistance"] = spacing.lag.threadEndDistance;
  }
  // Largeur de la platine à âme noyée (A33 (f)).
  if (
    hasBeam &&
    beam.anchorKind === "embeddedPlate" &&
    params.anchors.plate.width === "auto" &&
    (params.anchors.foot || params.anchors.head)
  ) {
    autoValues["anchors.plate.width"] = resolvePlateWidth(params);
  }
  // Longueur de l'âme de pied prolongée (A35 (a)), quand la poutre en a une.
  if (
    hasBeam &&
    params.anchors.plate.footWebLength === "auto" &&
    beam.footWebLength !== undefined &&
    Number.isFinite(beam.footWebLength)
  ) {
    autoValues["anchors.plate.footWebLength"] = beam.footWebLength;
  }

  return {
    parts: beam.parts,
    checks: [...checks.results, ...precheckChecks],
    notes,
    ...(executionClass !== undefined ? { executionClass } : {}),
    ...(precheckOut ? { precheck: precheckOut } : {}),
    ...(beam.errors.length > 0 ? { errors: beam.errors } : {}),
    ...(Object.keys(autoValues).length > 0 ? { autoValues } : {}),
    ...(beam.assemblies.length > 0 ? { assemblies: beam.assemblies } : {}),
  };
}

/** Réduction de Hankinson d'une poutre en couches empilées (A35 (j)). */
interface GrainReduction {
  /** Écart en plan du fil des planches retenu (rad). */
  readonly deviation: number;
  /** Angle entre le fil et l'axe de la poutre (rad). */
  readonly theta: number;
  /** Facteurs de la résistance en flexion et du module. */
  readonly kf: number;
  readonly kE: number;
}

/**
 * θ = acos(cos α · cos β) (α : pente de la poutre, β : plus grand écart en plan du fil des
 * planches, 0 sans planches) et facteurs de Hankinson des paramètres `grainAngle` (C §1.11
 * [81], à valider).
 */
function stackedGrainReduction(
  params: WoodCentralParams,
  beam: WoodCentralBeamResult,
): GrainReduction {
  const g = params.grainAngle;
  const deviation = beam.stacked?.maxGrainDeviation ?? 0;
  const theta = grainAngle(Math.max(0, beam.slope), deviation);
  return {
    deviation,
    theta,
    kf: hankinsonFactor(g.strengthRatio, g.strengthExponent, theta),
    kE: hankinsonFactor(g.modulusRatio, g.modulusExponent, theta),
  };
}

// ------------------------------------------------------------------ contrôles

/** Repère de la marche portée par une assise (pièce de base), sinon `M<n>`. */
function seatLabel(ctx: StructureContext, treadPartId: string, tread: number): Message {
  const part = ctx.baseParts?.find((p: Part) => p.id === treadPartId);
  return textMessage(part?.mark ?? `M${tread}`);
}

/**
 * Raison pour laquelle le tableau FCBA n'est pas exploitable : celle de la poutre (classe
 * inconnue, largeur sous le tableau, hauteur ou projection hors de l'exemple…), sinon la trace
 * courbe (tableau établi pour un escalier droit) ; `null` s'il est exploitable.
 */
function fcbaUnusableReason(beam: WoodCentralBeamResult, curved: boolean): Message | null {
  if (beam.fcba.unusable !== undefined) return beam.fcba.unusable;
  if (curved) return msg("structure.woodCentral.fcba.curved");
  if (beam.fcba.required === null) return msg("structure.woodCut.fcba.missingValue");
  return null;
}

/** Règles de moyens bois : reste sous entaille, largeur, entaille arrière. */
function addMeansChecks(
  ctx: StructureContext,
  checks: CheckCollector,
  params: WoodCentralParams,
  beam: WoodCentralBeamResult,
  curved: boolean,
): void {
  const beamId = beam.beamPartId!;
  const b = params.section.width;
  const seatItem = (s: WoodCentralBeamResult["seats"][number], value: number): CheckItem => ({
    value,
    label: seatLabel(ctx, s.treadPartId, s.tread),
    partId: beamId,
    treadNumber: s.tread,
  });

  // CREMAILLERE_REGLE_MOYENS : crémaillère centrale, tableau lu à b / facteur_centrale.
  const cremaillere = checks.yamlRule(CREMAILLERE_RULE_ID);
  if (cremaillere) {
    const reason = fcbaUnusableReason(beam, curved);
    if (reason !== null || beam.fcba.required === null) {
      checks.add(cremaillere, [
        {
          status: "non-evaluee",
          location: { kind: "part", partId: beamId },
          message: msg("structure.woodCut.check.fcbaUnusable", {
            reason: reason ?? msg("structure.woodCut.fcba.missingValue"),
          }),
        },
      ]);
    } else {
      const factor = fcbaTable().centralFactor;
      checks.addItems(
        cremaillere,
        beam.seats.map((s) => seatItem(s, s.residual)),
        msg("structure.woodCentral.check.residual", {
          cls: beam.fcba.cls,
          width: dec(b, 0),
          equivalent: dec(b / factor, 1),
        }),
        { min: beam.fcba.required, max: null },
      );
    }
  }

  // LIMON_EPAISSEUR_MIN_DTU : largeur b de la crémaillère centrale.
  const thicknessRule = checks.yamlRule("LIMON_EPAISSEUR_MIN_DTU");
  if (thicknessRule) {
    const outside = stringerRulesOutOfDomain(thicknessRule, ctx.project.stair.layout.width);
    if (outside !== null) {
      checks.add(thicknessRule, [
        {
          status: "non-evaluee",
          location: { kind: "part", partId: beamId },
          message: msg("structure.woodCut.check.outOfDomain", { detail: outside }),
        },
      ]);
    } else {
      const mark = beam.parts.find((p) => p.id === beamId)?.mark ?? beamId;
      checks.addItems(
        thicknessRule,
        [{ value: b, label: textMessage(mark), partId: beamId }],
        msg("structure.woodCentral.check.width"),
        { min: thicknessRule.min, max: thicknessRule.max },
      );
    }
  }

  // LIMON_ENTAILLE_MIN : entaille arrière de chaque marche dans la dent suivante ; la marche
  // d'arrivée (aucune dent au-dessus, arrière contre le chevêtre) est exclue.
  const housing = checks.yamlRule("LIMON_ENTAILLE_MIN");
  if (housing) {
    const last = Math.max(...ctx.stepping.treads.map((t) => t.number));
    const seats = beam.seats.filter((s) => s.tread !== last);
    const zero = seats.filter((s) => Number.isFinite(s.rearDepth) && s.rearDepth <= 1e-9);
    const housed = seats.filter((s) => !zero.includes(s));
    const quantity = msg("structure.woodCentral.check.rearHousing");
    const bounds = { min: housing.min, max: housing.max };
    if (zero.length === 0) {
      checks.addItems(
        housing,
        housed.map((s) => seatItem(s, s.rearDepth)),
        quantity,
        bounds,
      );
    } else {
      // Marches simplement posées (contremarches pleines devant la dent) : constat explicite.
      checks.add(
        housing,
        zero.map((s): Finding => ({
          status: "violation",
          measured: 0,
          min: housing.min,
          max: housing.max,
          location: { kind: "part", partId: beamId, treadNumber: s.tread },
          message: msg("structure.woodCentral.check.rearHousingNone", {
            item: seatLabel(ctx, s.treadPartId, s.tread),
            min: dec(housing.min ?? Number.NaN, 0),
          }),
        })),
      );
      // Autres marches : seules leurs non-conformités (aucun « conforme » à côté des violations).
      const bad = housed.filter(
        (s) => Number.isFinite(s.rearDepth) && housing.min !== null && s.rearDepth < housing.min,
      );
      if (bad.length > 0) {
        checks.addItems(
          housing,
          bad.map((s) => seatItem(s, s.rearDepth)),
          quantity,
          bounds,
        );
      }
    }
  }
}

/**
 * `LAMELLE_CINTRE_KR` : lamelles cintrées → r_in / t contre `min` (refus bloquant dessous, la
 * poutre n'est alors pas générée et `beam.errors` porte le refus) ; poutre droite ou massive →
 * conforme, k_r = 1.
 */
function addKrCheck(
  checks: CheckCollector,
  rule: RuleDef,
  beam: WoodCentralBeamResult,
  hasBeam: boolean,
): void {
  const lam = beam.lamination;
  const location =
    beam.beamPartId !== undefined
      ? { kind: "part" as const, partId: beam.beamPartId }
      : { kind: "stair" as const };
  if (lam.method === "stacked") {
    // Couches horizontales découpées selon le plan : aucun cintrage (A33 (e)).
    if (!hasBeam) return;
    checks.add(rule, [
      { status: "ok", location, message: msg("structure.woodCentral.check.krStacked") },
    ]);
    return;
  }
  if (!lam.curved || lam.kind === "solid") {
    if (!hasBeam) return;
    checks.add(rule, [
      { status: "ok", location, message: msg("structure.woodCentral.check.krStraight") },
    ]);
    return;
  }
  if (!Number.isFinite(lam.ratio)) {
    checks.add(rule, [
      {
        status: "non-evaluee",
        location,
        message: msg("structure.woodCentral.check.krNotComputed"),
      },
    ]);
    return;
  }
  const min = rule.min ?? Number.NaN;
  const args = {
    thickness: dec(lam.lamellaThickness, 1),
    radius: dec(lam.innerRadius, 0),
    ratio: dec(lam.ratio, 0),
    min: dec(min, 0),
    recommended: dec(rule.recommande ?? Number.NaN, 0),
  };
  const refused = lam.ratio < min;
  checks.add(rule, [
    {
      status: refused ? "violation" : "ok",
      measured: lam.ratio,
      min: rule.min,
      max: rule.max,
      location,
      message: refused
        ? // Lamelle de 1 mm (plus petite épaisseur saisissable) déjà insuffisante : seul le
          // rayon (jour, décalage de la trace) reste à agir.
          msg(
            lam.innerRadius < min
              ? "structure.woodCentral.check.krRefusedMinPly"
              : "structure.woodCentral.check.krRefused",
            args,
          )
        : msg("structure.woodCentral.check.kr", { ...args, kr: dec(lam.kr, 3) }),
    },
  ]);
}

/** `LAMELLE_PLIS_MINCES` (SPEC Q10) : lamelles cintrées seulement. */
function addThinPliesCheck(
  checks: CheckCollector,
  params: WoodCentralParams,
  beam: WoodCentralBeamResult,
): void {
  const lam = beam.lamination;
  if (!lam.curved || lam.kind !== "glulam") return;
  const max = params.section.thinPlyMax;
  const location = { kind: "part" as const, partId: beam.beamPartId! };
  const args = { thickness: dec(lam.lamellaThickness, 1), max: dec(max, 0) };
  const rule = pluginRuleDef(WOOD_CENTRAL_RULES.thinPlies);
  if (!(lam.lamellaThickness <= max)) {
    checks.add(rule, [
      {
        status: "ok",
        measured: lam.lamellaThickness,
        location,
        message: msg("structure.woodCentral.check.thinPliesOk", args),
      },
    ]);
    return;
  }
  const justification = params.laminationJustification.trim();
  checks.add(rule, [
    justification === ""
      ? {
          status: "violation",
          measured: lam.lamellaThickness,
          location,
          message: msg("structure.woodCentral.check.thinPliesRequired", args),
        }
      : {
          // Même traitement que le porte-à-faux (A12) : l'avertissement reste, justification
          // jointe au résultat et reprise dans le dossier.
          status: "violation",
          measured: lam.lamellaThickness,
          location,
          message: msg("structure.woodCentral.check.thinPliesJustified", {
            ...args,
            justification,
          }),
          justification,
        },
  ]);
}

// ------------------------------------------------------------------ remarques

/**
 * Remarque de synthèse (même esprit que les résumés de `wood-cut`) : désignation de la poutre
 * (section et lamellation), trace, k_r, reste sous entaille retenu et sa provenance.
 */
function summaryNote(
  params: WoodCentralParams,
  beam: WoodCentralBeamResult,
  traceKind: CentralTraceKind,
): Message {
  const residual = dec(beam.residual, 0);
  const fcbaUsed =
    beam.fcba.required !== null &&
    beam.fcba.unusable === undefined &&
    Math.abs(beam.residual - beam.fcba.required) < 1e-9;
  const residualNote =
    params.section.residual !== "auto"
      ? msg("structure.woodCentral.note.residual.entered", { residual })
      : fcbaUsed && beam.fcba.cls !== "unknown"
        ? msg("structure.woodCentral.note.residual.fcba", {
            residual,
            cls: beam.fcba.cls,
            equivalent: dec(params.section.width / fcbaTable().centralFactor, 1),
          })
        : msg("structure.woodCentral.note.residual.fallback", {
            residual,
            reason:
              fcbaUnusableReason(beam, traceKind !== "straight") ??
              msg("structure.woodCut.fcba.missingValue"),
          });
  return msg("structure.woodCentral.note.summary", {
    section: beam.sectionLabel,
    trace: traceKindLabel(traceKind),
    offset: dec(params.trace.lateralOffset, 0),
    // Section et lamellation : désignation de la poutre (« lamellé-collé cintré 88 × 351, … »).
    kr: dec(beam.lamination.kr, 3),
    residual: residualNote,
  });
}

export const WOOD_CENTRAL: StructureKind<WoodCentralParams> = {
  kind: "wood-central",
  labelKey: "structure.woodCentral.label",
  family: "bois",
  paramsSchema: WoodCentralParamsSchema,
  // Lamellé-collé par défaut : pris en charge sur tous les tracés (droit, tournants, hélicoïdal).
  defaults: (_ctx: StructureContext) => WoodCentralParamsSchema.parse({}),
  build: (ctx, params) => buildWoodCentral(ctx, params),
  capabilities: {
    layouts: ["flights", "helical"],
    requiresNewel: false,
    // Poutre sous les marches : aucune épaisseur hors de l'emmarchement utile.
    lateralThickness: () => ({ inner: 0, outer: 0 }),
    unsupportedOptions: woodCentralUnsupportedOptions,
  },
};
