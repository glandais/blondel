/**
 * Préréglages **de démonstration** : escaliers complets (tracé, structure, garde-corps,
 * matériaux et teintes) qui montrent ce que Blondel sait concevoir. Séparés des préréglages de
 * base (`presets.ts`, inchangés) : chacun part d'un préréglage de base ou d'un exemple
 * d'acceptation et n'ajoute que des paramètres existants (structure, garde-corps, contextes,
 * `appearance`). Chaque démo est vérifiée par `presetDemo.test.ts` : aucun bloquant, aucune
 * erreur de génération, exports de bout en bout.
 *
 * Toutes les valeurs propres aux démos (rayons, épaisseurs, jour, teintes) sont des **choix de
 * présentation Blondel, à valider** : aucune n'est une règle métier.
 */
import { DEFAULT_LOCALE, translatorFor, type MessageKey } from "@blondel/i18n";
import { ProjectSchema, type Project, type ProjectInput } from "../model/project.js";
import { createHelicalProject } from "./presetHelical.js";
import {
  computeOpening,
  createProject,
  deepMerge,
  PRESET_OPENING_CLEARANCE,
  type DeepPartial,
} from "./presets.js";
import { applyStructureChoice } from "./structureChoice.js";

/** Identifiants des démos (ordre d'affichage). */
export const DEMO_PRESET_IDS = [
  "demo-helical-glass",
  "demo-quarter-curved",
  "demo-u-oak",
  "demo-half-turn-industrial",
  "demo-straight-loft",
  "demo-quarter-landing-ash",
  "demo-erp-grand",
  "demo-helical-well",
  "demo-central-wreathed",
  "demo-central-glulam",
] as const;
export type DemoPresetId = (typeof DEMO_PRESET_IDS)[number];

/** Clés des libellés des démos (nom du projet créé, sélecteur de l'interface). */
export const DEMO_PRESET_LABELS: Readonly<Record<DemoPresetId, MessageKey>> = {
  "demo-helical-glass": "preset.demo.helicalGlass.label",
  "demo-quarter-curved": "preset.demo.quarterCurved.label",
  "demo-u-oak": "preset.demo.uOak.label",
  "demo-half-turn-industrial": "preset.demo.halfTurnIndustrial.label",
  "demo-straight-loft": "preset.demo.straightLoft.label",
  "demo-quarter-landing-ash": "preset.demo.quarterLandingAsh.label",
  "demo-erp-grand": "preset.demo.erpGrand.label",
  "demo-helical-well": "preset.demo.helicalWell.label",
  "demo-central-wreathed": "preset.demo.centralWreathed.label",
  "demo-central-glulam": "preset.demo.centralGlulam.label",
};

/** Clés des descriptions d'une ligne de chaque démo (sélecteur de l'interface). */
export const DEMO_PRESET_DESCRIPTIONS: Readonly<Record<DemoPresetId, MessageKey>> = {
  "demo-helical-glass": "preset.demo.helicalGlass.description",
  "demo-quarter-curved": "preset.demo.quarterCurved.description",
  "demo-u-oak": "preset.demo.uOak.description",
  "demo-half-turn-industrial": "preset.demo.halfTurnIndustrial.description",
  "demo-straight-loft": "preset.demo.straightLoft.description",
  "demo-quarter-landing-ash": "preset.demo.quarterLandingAsh.description",
  "demo-erp-grand": "preset.demo.erpGrand.description",
  "demo-helical-well": "preset.demo.helicalWell.description",
  "demo-central-wreathed": "preset.demo.centralWreathed.description",
  "demo-central-glulam": "preset.demo.centralGlulam.description",
};

/** Garde-corps vitré à main courante inox (commun à plusieurs démos). */
const GLASS_GUARDS: DeepPartial<ProjectInput["guards"]> = {
  infill: { kind: "glass" },
  material: "stainless-brushed",
};

/** Applique une surcharge profonde et revalide (copie profonde, voir `createProject`). */
function withPatch(project: Project, patch: DeepPartial<ProjectInput>): Project {
  return structuredClone(ProjectSchema.parse(deepMerge(project, patch)));
}

/** Recalcule la trémie rectangulaire du préréglage après un changement de tracé. */
function withOpening(project: Project): Project {
  const opening = computeOpening(project, PRESET_OPENING_CLEARANCE);
  if (opening === null) return project;
  return withPatch(project, { site: { opening: { kind: "rect", ...opening } } });
}

function helicalGlass(name: string): Project {
  const p = createHelicalProject({
    name,
    floorToFloor: 2750,
    // 15 marches par tour (au lieu des 13 du préréglage) : palier d'arrivée de 80° au lieu de
    // 40° sous la contrainte d'échappée, sortie vers la dalle plus large que l'emmarchement ;
    // R_e = 1 100 garde le giron au-dessus de G_MIN_LOGEMENT.
    outerRadius: 1100,
    patch: {
      stair: {
        layout: { sweep: { mode: "treadsPerTurn", count: 15 } },
        treads: { risers: "none", thickness: 80 },
      },
    },
  });
  return withPatch(p, {
    stair: {
      structure: {
        kind: "helical-core",
        params: { finish: "painted", treads: { material: "wood" }, handrail: { enabled: false } },
      },
    },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#1f2328", glassTint: "extra-clear" },
  });
}

function quarterCurved(name: string): Project {
  const [l1, l2] = [1800, 2830];
  const p = createProject("quarter-left", {
    name,
    width: 900,
    patch: {
      stair: {
        layout: {
          legs: [{ length: l1 }, { length: l2 }],
          turns: [{ direction: "left", mode: "winders", inner: { kind: "arc", radius: 250 } }],
        },
      },
    },
  });
  return withPatch(p, {
    stair: { structure: { kind: "steel-curved", params: { finish: "painted" } } },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#f2f2ee", woodTone: "natural", glassTint: "clear" },
  });
}

function uOak(name: string): Project {
  const base = createProject("two-quarters-u", { name });
  const chosen = applyStructureChoice(base, "wood-housed", { material: "wood-oak" }).project;
  return withPatch(chosen, {
    guards: { infill: { kind: "balusters" }, material: "wood-oak" },
    appearance: { woodTone: "natural" },
  });
}

function halfTurnIndustrial(name: string): Project {
  const base = createProject("half-turn");
  const legs = base.stair.layout.legs.map((l) => l.length as number);
  const width = base.stair.layout.width;
  const p = createProject("half-turn", {
    name,
    patch: {
      stair: {
        layout: {
          legs: [legs[0]!, 2 * width + 340, legs[2]! - 100].map((length) => ({ length })),
          turns: base.stair.layout.turns.map((t) => ({
            ...t,
            inner: { kind: "newel" as const, size: 100 },
          })),
        },
      },
    },
  });
  return withPatch(p, {
    stair: {
      structure: {
        kind: "steel-flat",
        params: { finish: "painted", treadKind: "folded-steel", folded: { profile: "Z" } },
      },
    },
    guards: {
      // Barreaudage en plats d'acier (40 × 12, entraxe 110) : vides < 110 mm (gabarit T1).
      infill: { kind: "balusters", spacing: 110, section: { kind: "rect", width: 12, height: 40 } },
      material: "steel-painted",
    },
    // Acier peint en trois tons (thermolaquage) : ossature anthracite, marches gris clair,
    // garde-corps gris graphite, pour lire la structure même en rendu logiciel.
    appearance: { paintColor: "#3f454c", treadPaintColor: "#a3a8ab", guardPaintColor: "#767c83" },
  });
}

function straightLoft(name: string): Project {
  const p = createProject("straight", {
    name,
    patch: { stair: { treads: { thickness: 80, risers: "none" } } },
  });
  return withPatch(applyStructureChoice(p, "steel-profile", { family: "UPN" }).project, {
    guards: { infill: { kind: "glass" }, material: "steel-painted" },
    appearance: { paintColor: "#1f2328", woodTone: "dark", glassTint: "smoked" },
  });
}

function quarterLandingAsh(name: string): Project {
  const base = createProject("quarter-landing", {
    name,
  });
  const chosen = applyStructureChoice(base, "wood-housed", { material: "wood-ash" }).project;
  return withPatch(chosen, {
    stair: { treads: { material: "wood-ash" } },
    guards: { infill: { kind: "glass" }, material: "wood-ash" },
    appearance: { woodTone: "light", glassTint: "extra-clear" },
  });
}

function erpGrand(name: string): Project {
  const p = createProject("straight", {
    name,
    width: 1200,
    patch: { stair: { stepping: { targetRise: 160 } } },
  });
  const wide = withPatch(p, {
    stair: { layout: { width: 1400 } },
    compliance: { contexts: ["bois_dtu", "erp_neuf", "erp_securite"] },
  });
  return withPatch(withOpening({ ...wide, site: { ...wide.site, opening: undefined } }), {
    stair: { structure: { kind: "steel-profile", params: { family: "UPN" } } },
    guards: {
      infill: { kind: "glass" },
      material: "stainless-brushed",
      handrail: { wallSides: "both" },
    },
    appearance: { paintColor: "#f2f2ee", glassTint: "clear" },
  });
}

function helicalWell(name: string): Project {
  const p = createHelicalProject({
    name,
    floorToFloor: 2750,
    outerRadius: 1200,
    patch: {
      stair: {
        layout: { core: { kind: "well", radius: 350 } },
        treads: { risers: "none", thickness: 80, material: "wood-beech" },
      },
    },
  });
  return withPatch(p, {
    stair: {
      structure: {
        kind: "helical-core",
        params: { finish: "painted", treads: { material: "wood" }, handrail: { enabled: false } },
      },
    },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#6b2f25", woodTone: "natural" },
  });
}

/**
 * Quart tournant balancé sur limon central en caisson débillardé (QUESTIONS A29) : consoles
 * soudées, marches chêne, garde-corps vitré. Jour vif du préréglage (la trace du limon central
 * le contourne à l'axe de l'emmarchement).
 */
function centralWreathed(name: string): Project {
  const p = createProject("quarter-left", { name, width: 900 });
  return withPatch(p, {
    stair: {
      structure: { kind: "steel-central", params: { section: { kind: "box" }, finish: "painted" } },
    },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#2b2f33", woodTone: "natural", glassTint: "clear" },
  });
}

/**
 * Quart tournant balancé sur limon central bois en lamellé-collé cintré sur moule (QUESTIONS
 * A29, vague 2) : marches chêne entaillées et boulonnées, sabots acier peint en pied et en tête,
 * garde-corps vitré (comme `demo-central-wreathed`). Jour vif du préréglage : la trace contourne
 * le jour à l'axe de l'emmarchement.
 */
function centralGlulam(name: string): Project {
  const p = createProject("quarter-left", { name, width: 900 });
  return withPatch(p, {
    stair: {
      // Marches ouvertes (sans contremarche) : l'arrière de chaque marche se loge dans la dent
      // suivante (entaille arrière) ; avec des contremarches pleines, les marches seraient
      // posées sans entaille arrière (LIMON_ENTAILLE_MIN en violation).
      treads: { risers: "none", thickness: 80 },
      structure: { kind: "wood-central", params: { section: { kind: "glulam" } } },
    },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#2b2f33", woodTone: "natural", glassTint: "clear" },
  });
}

const BUILDERS: Readonly<Record<DemoPresetId, (name: string) => Project>> = {
  "demo-helical-glass": helicalGlass,
  "demo-quarter-curved": quarterCurved,
  "demo-u-oak": uOak,
  "demo-half-turn-industrial": halfTurnIndustrial,
  "demo-straight-loft": straightLoft,
  "demo-quarter-landing-ash": quarterLandingAsh,
  "demo-erp-grand": erpGrand,
  "demo-helical-well": helicalWell,
  "demo-central-wreathed": centralWreathed,
  "demo-central-glulam": centralGlulam,
};

/** Vrai si `id` est une démo. */
export function isDemoPresetId(id: string): id is DemoPresetId {
  return (DEMO_PRESET_IDS as readonly string[]).includes(id);
}

/**
 * Projet complet d'une démo (tracé, structure, garde-corps, apparence). Nom du projet : `name`,
 * sinon le libellé de la démo en français (projet stable, indépendant de la langue d'affichage).
 */
export function createDemoProject(
  id: DemoPresetId,
  options: { readonly name?: string } = {},
): Project {
  return BUILDERS[id](options.name ?? translatorFor(DEFAULT_LOCALE).t(DEMO_PRESET_LABELS[id]));
}
