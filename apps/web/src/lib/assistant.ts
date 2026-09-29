/**
 * Assistant d'initialisation dans l'interface (prompt 2 §3, SPEC §2.2, CHALLENGE G8) : saisie du
 * site (H, dalle, trémie rectangulaire ou relevée, murs), du contexte d'usage et de la structure
 * visée → `AssistantInput` de `proposeDesigns` (cœur, exécuté dans un Web Worker annulable,
 * `model/assistantClient.ts`) ; croquis en plan des candidats ; projet retenu.
 *
 * Aucune règle métier ici : bornes, énumération, filtrage et score sont ceux du cœur. Les
 * correspondances « usage → contextes de rules.yaml » et l'épaisseur proposée des murs sont des
 * choix de présentation, **à valider** (LEDGER §2).
 */
import {
  GuardsSpecSchema,
  ProjectSchema,
  openingFromSurvey,
  openingPolygon,
  polygonOpening,
  type AssistantInput,
  type DesignCandidate,
  type Model,
  type Opening,
  type OpeningSurvey,
  type Project,
  type SurveyMeasure,
  type TypologyId,
  type Vec2,
  type Wall,
} from "@blondel/core";
import { DEFAULT_WALL_THICKNESS_MM, stairOverlay } from "../views/planSiteGeometry.js";

// ------------------------------------------------------------------ Usage → contextes

export type UsageId = "house" | "collective" | "erp-new" | "erp-existing" | "other";

/**
 * Usage proposé et contextes de rules.yaml correspondants. **À valider** : un ERP ajoute
 * `erp_securite` (« tout escalier ERP destiné au public ») ; « autre » ne garde que `tous`.
 */
export const USAGES: readonly {
  readonly id: UsageId;
  readonly label: string;
  readonly contexts: readonly string[];
}[] = [
  {
    id: "house",
    label: "Maison individuelle ou intérieur d'un logement",
    contexts: ["logement_interieur"],
  },
  {
    id: "collective",
    label: "Logement collectif — parties communes",
    contexts: ["bhc_parties_communes"],
  },
  { id: "erp-new", label: "ERP neuf", contexts: ["erp_neuf", "erp_securite"] },
  { id: "erp-existing", label: "ERP existant", contexts: ["erp_existant", "erp_securite"] },
  { id: "other", label: "Autre (règles générales seulement)", contexts: [] },
];

/** Contextes cumulés : usage, bois (NF DTU 36.3), extérieur. */
export function contextsFor(usage: UsageId, wood: boolean, outdoor: boolean): string[] {
  const base = USAGES.find((u) => u.id === usage)?.contexts ?? [];
  return [...(wood ? ["bois_dtu"] : []), ...base, ...(outdoor ? ["exterieur"] : [])];
}

/**
 * Contextes du projet courant que le formulaire ne gère pas et qu'il faut **conserver** : le
 * régime des garde-corps choisi explicitement (`garde_corps_1988` / `garde_corps_2024`, sinon
 * déduit de la date de référence par le cœur). Les contextes de forme (`tournant`,
 * `helicoidal`) sont déduits du tracé par le cœur et ne sont pas repris.
 */
const KEPT_CONTEXTS: ReadonlySet<string> = new Set(["garde_corps_1988", "garde_corps_2024"]);

/** Contextes de la proposition : ceux du formulaire, plus les contextes conservés du projet. */
export function assistantContexts(
  form: Pick<AssistantForm, "usage" | "wood" | "outdoor">,
  current: readonly string[],
): string[] {
  const out = contextsFor(form.usage, form.wood, form.outdoor);
  for (const c of current) if (KEPT_CONTEXTS.has(c) && !out.includes(c)) out.push(c);
  return out;
}

/** Usage et options déduits des contextes d'un projet (valeurs initiales du formulaire). */
export function usageOf(contexts: readonly string[]): {
  usage: UsageId;
  wood: boolean;
  outdoor: boolean;
} {
  const has = (c: string) => contexts.includes(c);
  const usage: UsageId = has("erp_neuf")
    ? "erp-new"
    : has("erp_existant")
      ? "erp-existing"
      : has("bhc_parties_communes")
        ? "collective"
        : has("logement_interieur")
          ? "house"
          : "other";
  return { usage, wood: has("bois_dtu"), outdoor: has("exterieur") };
}

// ------------------------------------------------------------------ Formulaire

export type OpeningMode = "rect" | "survey" | "project" | "none";

/** Saisies du formulaire (texte : validées à la construction de l'entrée). */
export interface AssistantForm {
  readonly floorToFloor: string;
  readonly upperSlabThickness: string;
  readonly openingMode: OpeningMode;
  /** Trémie rectangulaire : coin min (x, y) et dimensions ; relevé : position du point A. */
  readonly openingX: string;
  readonly openingY: string;
  readonly sizeX: string;
  readonly sizeY: string;
  readonly survey: Readonly<Record<SurveyMeasure, string>>;
  /** Garder les murs déjà saisis dans le projet. */
  readonly keepWalls: boolean;
  /** Murs à ajouter le long des côtés de la trémie (indice du côté b1…bn). */
  readonly wallSides: readonly number[];
  readonly wallThickness: string;
  readonly usage: UsageId;
  readonly wood: boolean;
  readonly outdoor: boolean;
  /** Plugin de structure visé (`none` : aucune préférence). */
  readonly structure: string;
  /** Typologies à explorer ; vide = toutes. */
  readonly typologies: readonly TypologyId[];
  readonly direction: "both" | "left" | "right";
  /** Emmarchement E imposé (mm) ; vide = grille du cœur. */
  readonly width: string;
  /** Ajouter les garde-corps (côtés vides d'après les murs) au projet retenu. */
  readonly guards: boolean;
}

const EMPTY_SURVEY: Readonly<Record<SurveyMeasure, string>> = {
  ab: "",
  bc: "",
  cd: "",
  da: "",
  ac: "",
  bd: "",
};

const str = (v: number): string => String(Math.round(v));

/** Formulaire initial repris du projet courant (site, contextes, structure). */
export function formFromProject(p: Project): AssistantForm {
  const o = p.site.opening;
  const poly = openingPolygon(o);
  const xs = poly?.map((q) => q.x) ?? [0];
  const ys = poly?.map((q) => q.y) ?? [0];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const { usage, wood, outdoor } = usageOf(p.compliance.contexts);
  return {
    floorToFloor: str(p.site.floorToFloor),
    upperSlabThickness: str(p.site.upperSlabThickness),
    openingMode: !o ? "none" : o.kind === "rect" ? "rect" : "project",
    openingX: str(o?.kind === "rect" ? o.x : minX),
    openingY: str(o?.kind === "rect" ? o.y : minY),
    sizeX: str(o?.kind === "rect" ? o.sizeX : Math.max(...xs) - minX || 900),
    sizeY: str(o?.kind === "rect" ? o.sizeY : Math.max(...ys) - minY || 2800),
    survey: EMPTY_SURVEY,
    keepWalls: true,
    wallSides: [],
    wallThickness: String(DEFAULT_WALL_THICKNESS_MM),
    usage,
    wood,
    outdoor,
    structure: p.stair.structure.kind === "helical-core" ? "none" : p.stair.structure.kind,
    typologies: [],
    direction: "both",
    width: "",
    guards: true,
  };
}

/** Lecture d'une saisie en mm entiers ; `null` si vide ou illisible. */
export function parseInt10(text: string): number | null {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * Trémie saisie : rectangle, relevé 4 côtés + 2 diagonales (quadrilatère du cœur, A au point
 * saisi, AB selon +X), trémie du projet, ou aucune. Erreur lisible sinon.
 */
export function formOpening(
  form: AssistantForm,
  project: Project,
):
  | { readonly ok: true; readonly opening: Opening | undefined }
  | { readonly ok: false; readonly error: string } {
  const x = parseInt10(form.openingX);
  const y = parseInt10(form.openingY);
  switch (form.openingMode) {
    case "none":
      return { ok: true, opening: undefined };
    case "project":
      return project.site.opening
        ? { ok: true, opening: project.site.opening }
        : { ok: false, error: "Le projet n'a pas de trémie." };
    case "rect": {
      const sx = parseInt10(form.sizeX);
      const sy = parseInt10(form.sizeY);
      if (x === null || y === null) return { ok: false, error: "Position de la trémie invalide." };
      if (sx === null || sy === null || sx <= 0 || sy <= 0) {
        return { ok: false, error: "Dimensions de la trémie : mm entiers positifs attendus." };
      }
      return { ok: true, opening: { kind: "rect", x, y, sizeX: sx, sizeY: sy } };
    }
    case "survey": {
      if (x === null || y === null) return { ok: false, error: "Position du point A invalide." };
      const m: Partial<Record<SurveyMeasure, number>> = {};
      for (const k of Object.keys(EMPTY_SURVEY) as SurveyMeasure[]) {
        const v = parseInt10(form.survey[k]);
        if (v === null || v <= 0) {
          return { ok: false, error: `Relevé : mesure « ${k.toUpperCase()} » manquante.` };
        }
        m[k] = v;
      }
      const r = openingFromSurvey(m as OpeningSurvey, { origin: { x, y } });
      if (!r.ok) return { ok: false, error: `Relevé incohérent : ${r.reason}` };
      if (!r.consistent) {
        return {
          ok: false,
          error: `Relevé incohérent : écart de ${Math.round(r.maxResidual)} mm entre les mesures ; les vérifier.`,
        };
      }
      try {
        return { ok: true, opening: polygonOpening(r.points) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }
}

/**
 * Murs posés le long des côtés `sides` de la trémie (contour trigonométrique du cœur, côtés
 * b1…bn = indices 0…n−1) : **nu du mur au bord de la trémie**, corps du mur à l'extérieur
 * (à droite du côté parcouru dans le sens trigonométrique). Identifiants `wall-N` libres.
 */
export function wallsAlongOpening(
  polygon: readonly Vec2[],
  sides: readonly number[],
  thickness: number,
  existing: readonly Wall[] = [],
): Wall[] {
  const used = new Set(existing.map((w) => w.id));
  let next = existing.length + 1;
  const out: Wall[] = [];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  for (const i of [...new Set(sides)].sort((a, b) => a - b)) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!a || !b || i >= polygon.length) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(L >= 1)) continue;
    // Normale à droite du côté (extérieur d'un contour trigonométrique).
    const nx = (b.y - a.y) / L;
    const ny = -(b.x - a.x) / L;
    const h = thickness / 2;
    while (used.has(`wall-${next}`)) next++;
    const id = `wall-${next}`;
    used.add(id);
    out.push({
      id,
      a: { x: r1(a.x + nx * h), y: r1(a.y + ny * h) },
      b: { x: r1(b.x + nx * h), y: r1(b.y + ny * h) },
      thickness,
      loadBearing: false,
    });
  }
  return out;
}

/** Nom lisible d'un côté de trémie (rectangle : orientation sur le plan ; sinon b1…bn). */
export function openingSideLabel(polygon: readonly Vec2[], i: number): string {
  const a = polygon[i]!;
  const b = polygon[(i + 1) % polygon.length]!;
  const L = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let where = "";
  if (polygon.length === 4) {
    if (Math.abs(dy) < 1e-6) where = dx > 0 ? " (bas du plan)" : " (haut du plan)";
    else if (Math.abs(dx) < 1e-6) where = dy > 0 ? " (droite du plan)" : " (gauche du plan)";
  }
  return `Côté b${i + 1}${where}, ${L.toLocaleString("fr-FR")} mm`;
}

export type FormResult =
  | { readonly ok: true; readonly input: AssistantInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Entrée de `proposeDesigns` : site (validé par le schéma du cœur), contextes, profil d'atelier
 * et date de référence du projet courant, préférences. Sans `shouldStop` (non clonable : le
 * worker est interrompu par l'interface).
 */
export function assistantInput(form: AssistantForm, project: Project): FormResult {
  const errors: string[] = [];
  const H = parseInt10(form.floorToFloor);
  const slab = parseInt10(form.upperSlabThickness);
  if (H === null || H <= 0) errors.push("Hauteur à monter H : mm entiers positifs attendus.");
  if (slab === null || slab <= 0) errors.push("Épaisseur de dalle : mm entiers positifs attendus.");
  const opening = formOpening(form, project);
  if (!opening.ok) errors.push(opening.error);
  const thickness = parseInt10(form.wallThickness);
  const polygon = opening.ok ? openingPolygon(opening.opening) : null;
  // Murs le long de la trémie : seulement s'il y a une trémie (cases masquées sinon).
  const wallSides = polygon ? form.wallSides.filter((i) => i >= 0 && i < polygon.length) : [];
  if (wallSides.length > 0 && (thickness === null || thickness <= 0)) {
    errors.push("Épaisseur des murs : mm entiers positifs attendus.");
  }
  let width: number | undefined;
  if (form.width.trim() !== "") {
    const w = parseInt10(form.width);
    if (w === null || w <= 0) errors.push("Emmarchement imposé : mm entiers positifs attendus.");
    else width = w;
  }
  if (errors.length > 0) return { ok: false, errors };

  const kept = form.keepWalls ? project.site.walls : [];
  const added =
    polygon && thickness !== null ? wallsAlongOpening(polygon, wallSides, thickness, kept) : [];
  const site = {
    floorToFloor: H!,
    upperSlabThickness: slab!,
    lowerFinish: project.site.lowerFinish,
    upperFinish: project.site.upperFinish,
    ...(opening.ok && opening.opening ? { opening: opening.opening } : {}),
    walls: [...kept, ...added],
  };
  const parsed = ProjectSchema.shape.site.safeParse(site);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`),
    };
  }
  const structure = form.structure !== "none" ? { structure: { kind: form.structure } } : {};
  return {
    ok: true,
    input: {
      site: parsed.data,
      compliance: {
        ...project.compliance,
        contexts: assistantContexts(form, project.compliance.contexts),
      },
      ...(project.workshop ? { workshop: project.workshop } : {}),
      preferences: {
        ...(form.typologies.length > 0 ? { typologies: form.typologies } : {}),
        ...(form.direction !== "both" ? { direction: form.direction } : {}),
        ...(width !== undefined ? { width } : {}),
        ...structure,
      },
    },
  };
}

/**
 * Projet retenu : celui du candidat, nommé comme le projet courant, calque de fond conservé,
 * garde-corps par défaut du cœur (côtés « automatiques » d'après les murs) si demandé. Validé
 * par le schéma (forme canonique).
 */
export function chosenProject(
  candidate: Pick<DesignCandidate, "project">,
  current: Project,
  options: { readonly guards: boolean },
): Project {
  const p = candidate.project;
  const underlay = current.site.underlay;
  return ProjectSchema.parse({
    ...p,
    name: current.name,
    site: { ...p.site, ...(underlay ? { underlay } : {}) },
    ...(options.guards && !p.guards ? { guards: GuardsSpecSchema.parse({}) } : {}),
  });
}

// ------------------------------------------------------------------ Croquis des candidats

/** Croquis en plan d'un candidat (données clonables, dessinées en SVG par l'interface). */
export interface CandidateSketch {
  readonly footprint: readonly Vec2[];
  readonly nosings: readonly (readonly [Vec2, Vec2])[];
  readonly walkline: readonly Vec2[];
  readonly opening: readonly Vec2[] | null;
  readonly walls: readonly (readonly Vec2[])[];
  /** Boîte de l'ensemble : x, y min, largeur, hauteur (mm). */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

function wallCorners(w: Wall): Vec2[] {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * (w.thickness / 2);
  const ny = (dx / L) * (w.thickness / 2);
  return [
    { x: w.a.x + nx, y: w.a.y + ny },
    { x: w.b.x + nx, y: w.b.y + ny },
    { x: w.b.x - nx, y: w.b.y - ny },
    { x: w.a.x - nx, y: w.a.y - ny },
  ];
}

/** Croquis d'un candidat à partir de son modèle (tracé et nez) et de son site. */
export function candidateSketch(model: Model, project: Project): CandidateSketch {
  const o = stairOverlay(model);
  const opening = openingPolygon(project.site.opening);
  const walls = project.site.walls.map(wallCorners);
  const pts = [...o.footprint, ...(opening ?? []), ...walls.flat()];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = pts.length ? Math.min(...xs) : 0;
  const y = pts.length ? Math.min(...ys) : 0;
  const w = pts.length ? Math.max(...xs) - x : 1000;
  const h = pts.length ? Math.max(...ys) - y : 1000;
  const r = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });
  return {
    footprint: o.footprint.map(r),
    nosings: o.nosings.map(([a, b]) => [r(a), r(b)] as const),
    walkline: o.walkline.filter((_, i) => i % 4 === 0 || i === o.walkline.length - 1).map(r),
    opening: opening ? opening.map(r) : null,
    walls: walls.map((ws) => ws.map(r)),
    box: { x, y, w: Math.max(w, 1), h: Math.max(h, 1) },
  };
}

// ------------------------------------------------------------------ Affichage

const n0 = (v: number): string => Math.round(v).toLocaleString("fr-FR");
const n1 = (v: number): string =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Cotes principales d'une carte : n, h, g, 2h + g, E, collet, échappée. */
export function summaryFacts(
  c: Pick<DesignCandidate, "summary">,
): readonly { readonly label: string; readonly value: string }[] {
  const s = c.summary;
  return [
    { label: "Hauteurs n", value: String(s.riserCount) },
    { label: "Hauteur h", value: `${n1(s.rise)} mm` },
    { label: "Giron g", value: `${n1(s.going)} mm` },
    { label: "2h + g", value: `${n1(s.blondel)} mm` },
    { label: "Emmarchement E", value: `${n0(s.width)} mm` },
    { label: "Collet mini", value: s.minCollet === null ? "—" : `${n0(s.minCollet)} mm` },
    {
      label: "Échappée mini",
      value:
        s.headroom === null
          ? "—"
          : `${n0(s.headroom)} mm${s.headroomMargin !== null ? ` (marge ${n0(s.headroomMargin)})` : ""}`,
    },
  ];
}

export function formatScore(v: number): string {
  return n1(v);
}
