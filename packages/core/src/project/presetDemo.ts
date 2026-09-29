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
] as const;
export type DemoPresetId = (typeof DEMO_PRESET_IDS)[number];

export const DEMO_PRESET_LABELS: Readonly<Record<DemoPresetId, string>> = {
  "demo-helical-glass": "Hélicoïdal acier, verre et inox",
  "demo-quarter-curved": "Quart tournant débillardé soudé",
  "demo-u-oak": "Deux quarts en U, chêne massif",
  "demo-half-turn-industrial": "Demi-tournant industriel en tôle pliée",
  "demo-straight-loft": "Escalier droit loft sur UPN",
  "demo-quarter-landing-ash": "Quart tournant à palier, frêne et verre",
  "demo-erp-grand": "Grand escalier d'ERP",
  "demo-helical-well": "Hélicoïdal à jour central",
};

/** Description d'une ligne de chaque démo (sélecteur de l'interface). */
export const DEMO_PRESET_DESCRIPTIONS: Readonly<Record<DemoPresetId, string>> = {
  "demo-helical-glass":
    "Fût acier noir, marches chêne rayonnantes, garde-corps verre et main courante inox.",
  "demo-quarter-curved":
    "Limon acier débillardé soudé autour d'un jour en arc, marches chêne, garde-corps verre.",
  "demo-u-oak": "Limons à la française, poteaux d'angle et balustres, tout en chêne huilé.",
  "demo-half-turn-industrial":
    "Limons en plat laser anthracite, marches en tôle pliée en Z gris clair, barreaudage graphite.",
  "demo-straight-loft":
    "Limons UPN noirs, marches massives de 80 mm en chêne foncé sans contremarche, verre fumé.",
  "demo-quarter-landing-ash":
    "Limons à la française et poteau en frêne clair, palier d'angle, garde-corps verre.",
  "demo-erp-grand": "Emmarchement de 1 400 mm, mains courantes des deux côtés, contextes ERP neuf.",
  "demo-helical-well":
    "Marches portées par deux limons hélicoïdaux roulés autour d'un jour central.",
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

function helicalGlass(): Project {
  const p = createHelicalProject({
    name: DEMO_PRESET_LABELS["demo-helical-glass"],
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

function quarterCurved(): Project {
  const [l1, l2] = [1800, 2830];
  const p = createProject("quarter-left", {
    name: DEMO_PRESET_LABELS["demo-quarter-curved"],
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

function uOak(): Project {
  const base = createProject("two-quarters-u", { name: DEMO_PRESET_LABELS["demo-u-oak"] });
  const chosen = applyStructureChoice(base, "wood-housed", { material: "wood-oak" }).project;
  return withPatch(chosen, {
    guards: { infill: { kind: "balusters" }, material: "wood-oak" },
    appearance: { woodTone: "natural" },
  });
}

function halfTurnIndustrial(): Project {
  const base = createProject("half-turn");
  const legs = base.stair.layout.legs.map((l) => l.length as number);
  const width = base.stair.layout.width;
  const p = createProject("half-turn", {
    name: DEMO_PRESET_LABELS["demo-half-turn-industrial"],
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

function straightLoft(): Project {
  const p = createProject("straight", {
    name: DEMO_PRESET_LABELS["demo-straight-loft"],
    patch: { stair: { treads: { thickness: 80, risers: "none" } } },
  });
  return withPatch(applyStructureChoice(p, "steel-profile", { family: "UPN" }).project, {
    guards: { infill: { kind: "glass" }, material: "steel-painted" },
    appearance: { paintColor: "#1f2328", woodTone: "dark", glassTint: "smoked" },
  });
}

function quarterLandingAsh(): Project {
  const base = createProject("quarter-landing", {
    name: DEMO_PRESET_LABELS["demo-quarter-landing-ash"],
  });
  const chosen = applyStructureChoice(base, "wood-housed", { material: "wood-ash" }).project;
  return withPatch(chosen, {
    stair: { treads: { material: "wood-ash" } },
    guards: { infill: { kind: "glass" }, material: "wood-ash" },
    appearance: { woodTone: "light", glassTint: "extra-clear" },
  });
}

function erpGrand(): Project {
  const p = createProject("straight", {
    name: DEMO_PRESET_LABELS["demo-erp-grand"],
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

function helicalWell(): Project {
  const p = createHelicalProject({
    name: DEMO_PRESET_LABELS["demo-helical-well"],
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

const BUILDERS: Readonly<Record<DemoPresetId, () => Project>> = {
  "demo-helical-glass": helicalGlass,
  "demo-quarter-curved": quarterCurved,
  "demo-u-oak": uOak,
  "demo-half-turn-industrial": halfTurnIndustrial,
  "demo-straight-loft": straightLoft,
  "demo-quarter-landing-ash": quarterLandingAsh,
  "demo-erp-grand": erpGrand,
  "demo-helical-well": helicalWell,
};

/** Vrai si `id` est une démo. */
export function isDemoPresetId(id: string): id is DemoPresetId {
  return (DEMO_PRESET_IDS as readonly string[]).includes(id);
}

/** Projet complet d'une démo (tracé, structure, garde-corps, apparence). */
export function createDemoProject(id: DemoPresetId): Project {
  return BUILDERS[id]();
}
