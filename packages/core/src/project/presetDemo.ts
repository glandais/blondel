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
import {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  type CageLayoutSpecInput,
  type Project,
  type ProjectInput,
} from "../model/project.js";
import { ensureCCW } from "../geom2d/polygon.js";
import * as V from "../geom2d/vec.js";
import { polygonOpening } from "../site/opening.js";
import { computeLayout } from "../layout/layout.js";
import { computeStepping } from "../stepping/stepping.js";
import { clipConvex, clipHalfPlane } from "../structures/geom.js";
import { defaultOpening } from "./defaultOpening.js";
import { createHelicalProject } from "./presetHelical.js";
import {
  computeOpening,
  createProject,
  deepMerge,
  DEFAULT_FLOOR_TO_FLOOR,
  DEFAULT_SLAB_THICKNESS,
  PRESET_NOSING,
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
  "demo-straight-central-glulam",
  "demo-straight-cut-oak",
  "demo-cage-oak-60",
  "demo-cage-flared-steel",
  "demo-cage-central-steel",
  "demo-cage-arc-glass",
  "demo-cage-room",
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
  "demo-straight-central-glulam": "preset.demo.straightCentralGlulam.label",
  "demo-straight-cut-oak": "preset.demo.straightCutOak.label",
  "demo-cage-oak-60": "preset.demo.cageOak60.label",
  "demo-cage-flared-steel": "preset.demo.cageFlaredSteel.label",
  "demo-cage-central-steel": "preset.demo.cageCentralSteel.label",
  "demo-cage-arc-glass": "preset.demo.cageArcGlass.label",
  "demo-cage-room": "preset.demo.cageRoom.label",
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
  "demo-straight-central-glulam": "preset.demo.straightCentralGlulam.description",
  "demo-straight-cut-oak": "preset.demo.straightCutOak.description",
  "demo-cage-oak-60": "preset.demo.cageOak60.description",
  "demo-cage-flared-steel": "preset.demo.cageFlaredSteel.description",
  "demo-cage-central-steel": "preset.demo.cageCentralSteel.description",
  "demo-cage-arc-glass": "preset.demo.cageArcGlass.description",
  "demo-cage-room": "preset.demo.cageRoom.description",
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
          // Jour de 300 mm : appuis des marches balancées d'au moins 50 mm sur le limon débillardé
          // (avec 250 mm, M6 n'avait que 37 mm d'appui, FAB_SUPPORT_LONGUEUR_MIN).
          turns: [{ direction: "left", mode: "winders", inner: { kind: "arc", radius: 300 } }],
        },
      },
    },
  });
  return withPatch(withOpening(p), {
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
 * Hélicoïdal à grand rayon (R_e = 1 600 mm, jour central de 700 mm de rayon, emmarchement de
 * 900 mm) sur limon central bois en lamellé-collé cintré sur moule (QUESTIONS A29, A39) :
 * marches chêne de 80 mm sans contremarche entaillées dans la poutre et fixées par tire-fonds,
 * platines à âme noyée en pied et en tête, garde-corps vitré. Trace à l'axe de l'emmarchement
 * (r = 1 150 mm, r_in = 1 106 mm) : lamelles `auto` t = ⌊r_in / 240⌋ = 4 mm, 22 lamelles de
 * 4 mm pour b = 88 mm, au lieu de 1 mm sur l'ancien quart tournant (r_in = 406 mm) ; 7 mm
 * exigerait r_in ≥ 1 680 mm, hors de portée de ce rayon (sondage A39 du 2026-10-13).
 *
 * Reste sous entaille **saisi** à 250 mm : au repli de 180 mm (tableau FCBA non exploitable
 * sur une trace courbe, A37 (2)), le prédimensionnement porte deux constats bloquants
 * (`PRECHECK_FLECHE`, `PRECHECK_CONTRAINTE`) ; à 200 mm, `PRECHECK_FLECHE` reste bloquant ; à
 * 220 mm, seul un conseil de flèche demeure ; 250 mm le lève aussi. Cintrage sur moule imposé :
 * les couches empilées restent montrées par l'exemple `j5c-limon-central-bois-helicoidal`.
 */
function centralGlulam(name: string): Project {
  const p = createHelicalProject({
    name,
    floorToFloor: 2750,
    outerRadius: 1600,
    patch: {
      stair: {
        layout: { core: { kind: "well", radius: 700 } },
        // Marches ouvertes : l'arrière de chaque marche se loge dans la dent suivante.
        treads: { risers: "none", thickness: 80 },
      },
    },
  });
  return withPatch(p, {
    stair: {
      structure: {
        kind: "wood-central",
        params: { section: { kind: "glulam", curvedMethod: "mould", residual: 250 } },
      },
    },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#2b2f33", woodTone: "natural", glassTint: "clear" },
  });
}

/**
 * Escalier droit sur limon central bois en lamellé-collé droit (QUESTIONS A29) : marches chêne
 * de 80 mm sans contremarche entaillées dans la poutre, fixées par tire-fonds, sabots en U en
 * pied et en tête (ancrage `auto` d'une poutre droite, QUESTIONS A34 (c)), garde-corps vitré.
 */
function straightCentralGlulam(name: string): Project {
  const p = createProject("straight", {
    name,
    patch: { stair: { treads: { risers: "none", thickness: 80 } } },
  });
  return withPatch(p, {
    stair: { structure: { kind: "wood-central", params: { section: { kind: "glulam" } } } },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#1f2328", woodTone: "light", glassTint: "extra-clear" },
  });
}

/**
 * Escalier droit à crémaillères en chêne (`wood-cut`, escalier droit seulement) : marches posées
 * sur les dents, sans contremarche, garde-corps à balustres chêne.
 */
function straightCutOak(name: string): Project {
  const p = createProject("straight", {
    name,
    patch: { stair: { treads: { risers: "none" } } },
  });
  const chosen = applyStructureChoice(p, "wood-cut", { material: "wood-oak" }).project;
  return withPatch(chosen, {
    guards: { infill: { kind: "balusters" }, material: "wood-oak" },
    appearance: { woodTone: "natural" },
  });
}

// ------------------------------------------------------------------ Tracé libre (ADR-0010)

/** Tronçon droit de cage (largeur constante, ou de `width` à `widthEnd`). */
function straightSection(
  length: number,
  width = 900,
  widthEnd?: number,
): CageLayoutSpecInput["sections"][number] {
  return {
    axis: { kind: "straight", length },
    width,
    ...(widthEnd !== undefined ? { widthEnd } : {}),
  };
}

/**
 * Projet sur une cage saisie (tracé libre, ADR-0010) : site des préréglages (H = 2 700, dalle de
 * 200 mm, nez `PRESET_NOSING`), trémie du calcul des préréglages (`defaultOpening`), comme les
 * exemples `examples/cage-*`. `site` complète le site (murs, contour de pièce, obstacles).
 */
function cageProject(
  name: string,
  layout: CageLayoutSpecInput,
  stair: DeepPartial<ProjectInput["stair"]> = {},
  site: Partial<ProjectInput["site"]> = {},
): Project {
  const base = ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    site: { floorToFloor: DEFAULT_FLOOR_TO_FLOOR, upperSlabThickness: DEFAULT_SLAB_THICKNESS },
    stair: deepMerge(
      {
        placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        layout,
        treads: { nosing: PRESET_NOSING },
      },
      stair,
    ),
  });
  const opening = defaultOpening(base);
  return structuredClone(
    ProjectSchema.parse({
      ...base,
      site: { ...base.site, ...(opening ? { opening } : {}), ...site },
    }),
  );
}

/**
 * Tracé libre (ADR-0010) : jonction à 60° balancée à jour en pan coupé, palier droit puis volée
 * d'arrivée, sur limons à la française en chêne (sous-lot 6a ; assemblages à queues aux angles,
 * raccord des limons au milieu du palier droit), balustres chêne. Tracé de l'exemple
 * `cage-60-palier-limon`, tourné de −60° pour que la volée d'arrivée longe un axe du site : la
 * trémie rectangulaire du préréglage borde alors les garde-corps rampants (aucun constat
 * `GC_CONFLIT_DALLE`, qui apparaît sur une arrivée oblique).
 */
function cageOak60(name: string): Project {
  const p = cageProject(
    name,
    {
      kind: "cage",
      sections: [straightSection(1100), straightSection(500), straightSection(1300)],
      junctions: [
        { angle: 60, mode: "winders", well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 } },
        { angle: 0, mode: "landing", depth: 900 },
      ],
    },
    { placement: { rotation: -60 } },
  );
  return withPatch(p, {
    stair: { structure: { kind: "wood-housed", params: { material: "wood-oak" } } },
    guards: { infill: { kind: "balusters" }, material: "wood-oak" },
    appearance: { woodTone: "natural" },
  });
}

/**
 * Tracé libre : volée de départ évasée en trapèze (1 200 mm au pied, 900 mm au tournant), quart
 * tournant balancé à jour en pan coupé de 250 mm (appui des marches balancées, comme
 * `cage-45-palier-acier`), limons acier en plat (sous-lot 6b), barreaudage en plats d'acier.
 */
function cageFlaredSteel(name: string): Project {
  const p = cageProject(name, {
    kind: "cage",
    sections: [straightSection(1400, 1200, 900), straightSection(1650)],
    junctions: [
      { angle: 90, mode: "winders", well: { kind: "chamfer", setbackIn: 250, setbackOut: 250 } },
    ],
  });
  return withPatch(p, {
    stair: { structure: { kind: "steel-flat", params: { finish: "painted" } } },
    guards: {
      infill: {
        kind: "balusters",
        spacing: 110,
        section: { kind: "rect", width: 12, height: 40 },
      },
      material: "steel-painted",
    },
    appearance: { paintColor: "#2b2f33", guardPaintColor: "#2b2f33", woodTone: "natural" },
  });
}

/**
 * Tracé libre : jonction à 120° balancée à jour en pan coupé, sur limon central acier en caisson
 * débillardé (sous-lot 6c ; trace autour des extrémités du pan coupé à la demi-largeur, F18),
 * marches chêne, garde-corps vitré. Tournée de −120° : volée d'arrivée le long d'un axe du site
 * (voir `cageOak60`).
 */
function cageCentralSteel(name: string): Project {
  const p = cageProject(
    name,
    {
      kind: "cage",
      sections: [straightSection(1400), straightSection(1400)],
      junctions: [
        { angle: 120, mode: "winders", well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 } },
      ],
    },
    { placement: { rotation: -120 } },
  );
  return withPatch(p, {
    stair: {
      structure: {
        kind: "steel-central",
        params: { section: { kind: "box" }, finish: "painted" },
      },
    },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#2b2f33", woodTone: "natural", glassTint: "clear" },
  });
}

/**
 * Tracé libre : volée courbe à axe en arc (R = 1 800 mm, 60°), palier droit puis volée droite
 * d'arrivée, sur limons débillardés acier des deux côtés (sous-lot 6d, F19), garde-corps vitré à
 * main courante inox. Tournée de −60° : volée d'arrivée le long d'un axe du site (une arrivée en
 * arc sous une trémie rectangulaire fait passer les garde-corps sous la dalle).
 */
function cageArcGlass(name: string): Project {
  const p = cageProject(
    name,
    {
      kind: "cage",
      sections: [
        { axis: { kind: "arc", radius: 1800, sweep: 60 }, width: 900 },
        straightSection(1620),
      ],
      junctions: [{ angle: 0, mode: "landing", depth: 900 }],
    },
    { placement: { rotation: -60 } },
  );
  return withPatch(p, {
    stair: { structure: { kind: "steel-curved", params: { finish: "painted" } } },
    guards: GLASS_GUARDS,
    appearance: { paintColor: "#f2f2ee", woodTone: "natural", glassTint: "clear" },
  });
}

/**
 * Recul (mm) du côté d'arrivée de la trémie de `demo-cage-room` au-delà du nez d'arrivée : pas de
 * 10 mm des trémies des préréglages, choix de présentation à valider.
 */
const ROOM_DEMO_ARRIVAL_SETBACK = 10;

/**
 * Escalier dans sa pièce (ADR-0010, site libre) : contour de pièce à mur biais, jonction à 105°
 * balancée qui suit ce mur, limons à la française et garde-corps vitré en frêne. Obstacles du
 * site : poteau, porte (débattement vers la pièce) et fenêtre, placés hors de l'emprise de
 * l'escalier et de son dégagement d'arrivée (`Model.siteFit` sans erreur ni avertissement de
 * porte). Côté mur, le bord des marches est à 60 mm du contour (le limon mural tient dans ce
 * jeu). Trémie polygonale : celle du préréglage, menée jusqu'aux murs droit et biais et rognée
 * au contour de la pièce et au nez d'arrivée oblique (aucun mur traversé, sortie sur la dalle
 * sans garde-corps de trémie).
 */
function cageRoom(name: string): Project {
  /** Nu intérieur du mur droit (x, mm), le long de la première volée (bord des marches à x = 900). */
  const rightWall = 960;
  const p = cageProject(
    name,
    {
      kind: "cage",
      sections: [straightSection(1500), straightSection(1500)],
      junctions: [
        {
          angle: 105,
          mode: "winders",
          well: { kind: "chamfer", setbackIn: 150, setbackOut: 150 },
        },
      ],
    },
    {},
    {
      // Murs de 200 mm au nu du contour le long de l'escalier : garde-corps côté mur supprimés
      // (`guards.flight.outer` = `auto`, mur à moins de `wallTolerance`).
      walls: [
        {
          id: "wall-1",
          a: { x: 1060, y: -1600 },
          b: { x: 1060, y: 2882 },
          thickness: 200,
          loadBearing: true,
        },
        {
          id: "wall-2",
          a: { x: 1060, y: 2882 },
          b: { x: -3100, y: 1767 },
          thickness: 200,
          loadBearing: true,
        },
      ],
      room: {
        points: [
          { x: rightWall, y: -1500 },
          { x: rightWall, y: 2751 },
          { x: -3000, y: 1690 },
          { x: -3000, y: -1500 },
        ],
      },
      obstacles: [
        { kind: "post", id: "post-1", center: { x: -2500, y: 200 }, sizeX: 200, sizeY: 200 },
        {
          kind: "door",
          id: "door-1",
          a: { x: -1500, y: -1500 },
          b: { x: -670, y: -1500 },
          hinge: "a",
          swing: "left",
        },
        {
          kind: "window",
          id: "window-1",
          a: { x: -3000, y: -200 },
          b: { x: -3000, y: 1000 },
          sill: 900,
          head: 2150,
        },
      ],
    },
  );
  // Trémie : rectangle du préréglage étendu jusqu'aux murs, rogné au contour de la pièce (nus des
  // murs droit et biais : la trémie ne traverse aucun mur, ses côtés le long des murs n'ont pas de
  // garde-corps) et au nez d'arrivée, oblique de 15° (côté d'arrivée exclu du garde-corps de
  // trémie, `openingChains` ; un côté droit du préréglage, non parallèle au nez, le fermerait).
  const room = p.site.room;
  const opening = p.site.opening;
  const nosings = computeStepping(p, computeLayout(p)).nosings;
  const arrival = nosings[nosings.length - 1];
  const clipped =
    opening?.kind === "rect" && room && arrival
      ? (() => {
          const top = Math.max(...room.points.map((q) => q.y));
          const left = Math.min(...room.points.map((q) => q.x));
          const rect = [
            { x: left, y: opening.y },
            { x: opening.x + opening.sizeX, y: opening.y },
            { x: opening.x + opening.sizeX, y: top },
            { x: left, y: top },
          ];
          // Côté de l'escalier par rapport au nez d'arrivée : opposé au sens de la montée
          // (normale gauche du nez, de q vers r). Coupe reculée de `ROOM_DEMO_ARRIVAL_SETBACK`
          // au-delà du nez (le nez reste dans la trémie malgré l'arrondi des sommets).
          const climb = V.normalize(V.perpLeft(V.sub(arrival.r, arrival.q)));
          const cut = V.addScaled(arrival.q, climb, ROOM_DEMO_ARRIVAL_SETBACK);
          return polygonOpening(
            clipHalfPlane(clipConvex(rect, ensureCCW(room.points)), cut, V.scale(climb, -1)),
          );
        })()
      : opening;
  return withPatch(
    { ...p, site: { ...p.site, opening: clipped } },
    {
      stair: {
        treads: { material: "wood-ash" },
        structure: { kind: "wood-housed", params: { material: "wood-ash" } },
      },
      guards: { infill: { kind: "glass" }, material: "wood-ash" },
      appearance: { woodTone: "light", glassTint: "extra-clear" },
    },
  );
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
  "demo-straight-central-glulam": straightCentralGlulam,
  "demo-straight-cut-oak": straightCutOak,
  "demo-cage-oak-60": cageOak60,
  "demo-cage-flared-steel": cageFlaredSteel,
  "demo-cage-central-steel": cageCentralSteel,
  "demo-cage-arc-glass": cageArcGlass,
  "demo-cage-room": cageRoom,
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
