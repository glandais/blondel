/**
 * Instantanés du `Model` des escaliers hélicoïdaux (F10, sous-lot P3, décision (10b)) :
 * non-régression qui remplace la parité contre la copie figée de l'ancien moteur
 * (`layout/legacyHelical.ts`) avant son retrait. Enregistrés sur l'état P2 (commit 5a1e407,
 * hélicoïdal calculé par le moteur de cage), avant tout retrait.
 *
 * Projets : les 6 exemples hélicoïdaux du dépôt, le préréglage `helical`, les 3 démos
 * hélicoïdales (clés séparées même quand elles valent un exemple) et `cage-arc` (non
 * hélicoïdal, référence de la décision (9), sans marche droite).
 *
 * Contenu, par projet, `buildModel(p, { memo: false })` résumé en lignes lisibles (une ligne
 * JSON par élément) : pièces (repère, catégorie, matériau, quantités, débit, solide : nombre de
 * points de la description, boîte englobante et empreinte), contrôle de conception résultat par
 * résultat, erreurs et remarques, échappée, sous-faces, chiffres clés, adéquation au site,
 * prédimensionnement, valeurs « auto », tracé (dont `Layout.helical`) et découpage. Nombres
 * arrondis à 1e-6 (angles à 1e-9) ; un tableau de plus de 4 points est remplacé par son
 * nombre de points, sa boîte et l'empreinte SHA-256 de ses coordonnées arrondies.
 *
 * Les sous-faces sont lues dans `Model.soffits` : depuis P3 (décision (10a)), elles sont
 * calculées à l'étape d'échappée pour toute cage qui se recouvre, hélicoïdal compris
 * (`Stepping.soffits` retiré). À l'enregistrement (état P2), un accesseur neutre lisait aussi
 * `Stepping.soffits` : l'instantané ne dépend pas de l'endroit où elles sont rangées.
 *
 * Garde-fou : un écart d'instantané doit venir d'une décision et être justifié ligne à ligne au
 * ledger du chantier. Toute mise à jour se fait par `pnpm vitest run <ce fichier> -u`, ciblée
 * sur ce fichier, **jamais** par un `-u` global.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Model, Part, Soffit, SolidDesc } from "../model/derived.js";
import type { Vec3 } from "../model/primitives.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { createDemoProject } from "../project/presetDemo.js";
import { createProject } from "../project/presets.js";
import { buildModel } from "./build.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const example = (name: string) => (): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

/** Projets couverts (voir l'en-tête). */
const PROJECTS: readonly (readonly [string, () => Project])[] = [
  ["exemple j5a-helicoidal", example("j5a-helicoidal")],
  ["exemple j5c-limon-central-helicoidal", example("j5c-limon-central-helicoidal")],
  ["exemple j5c-limon-central-bois-helicoidal", example("j5c-limon-central-bois-helicoidal")],
  ["exemple demo-helical-glass", example("demo-helical-glass")],
  ["exemple demo-helical-well", example("demo-helical-well")],
  ["exemple demo-central-glulam", example("demo-central-glulam")],
  ["préréglage helical", () => createProject("helical")],
  ["démo demo-helical-glass", () => createDemoProject("demo-helical-glass")],
  ["démo demo-helical-well", () => createDemoProject("demo-helical-well")],
  ["démo demo-central-glulam", () => createDemoProject("demo-central-glulam")],
  ["exemple cage-arc", example("cage-arc")],
];

// ------------------------------------------------------------------ mise en forme stable

const ANGLE_KEY = /angle|sweep/i;

/** Arrondi au pas `1 / scale`, sans zéro négatif. */
function round(x: number, scale: number): number | string {
  if (!Number.isFinite(x)) return String(x);
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r;
}

const sha = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

const isPoint = (v: unknown): v is { x: number; y: number; z?: number } =>
  v !== null &&
  typeof v === "object" &&
  typeof (v as { x?: unknown }).x === "number" &&
  typeof (v as { y?: unknown }).y === "number";

type Pt = { readonly x: number; readonly y: number; readonly z?: number };

/** Boîte englobante (2D ou 3D) arrondie. */
function bbox(points: readonly Pt[]): (number | string)[] {
  const has3 = points.some((p) => typeof p.z === "number");
  const axes = has3 ? (["x", "y", "z"] as const) : (["x", "y"] as const);
  const lo = axes.map((a) => Math.min(...points.map((p) => p[a] ?? 0)));
  const hi = axes.map((a) => Math.max(...points.map((p) => p[a] ?? 0)));
  return [...lo, ...hi].map((v) => round(v, 1e6));
}

const onlyKeys = (v: object, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));

/** Paramètre numérique d'un message (`num`) : « valeur~décimales unité ». */
const isNumberParam = (v: object): v is { num: number; digits?: number; unit?: string } =>
  typeof (v as { num?: unknown }).num === "number" &&
  onlyKeys(v, ["num", "digits", "unit", "trimZeros", "grouping"]);

/** `Message` : clé et paramètres. */
const isMessage = (v: object): v is { key: string; params?: Record<string, unknown> } =>
  typeof (v as { key?: unknown }).key === "string" && onlyKeys(v, ["key", "params"]);

/** Message en une chaîne compacte : `clé(nom=valeur, …)`, nombres arrondis. */
function messageText(m: { key: string; params?: Record<string, unknown> }): string {
  if (m.params === undefined) return m.key;
  const params = Object.entries(m.params).map(([k, v]) => {
    const c = canon(v, k);
    const text = typeof c === "string" ? (typeof v === "string" ? `'${c}'` : c) : JSON.stringify(c);
    return `${k}=${text}`;
  });
  return `${m.key}(${params.join(", ")})`;
}

/**
 * Valeur canonique : nombres arrondis (1e-6, angles 1e-9), champs indéfinis omis, messages en
 * chaîne compacte, tableau de plus de 4 points remplacé par son nombre de points, sa boîte et
 * son empreinte.
 */
function canon(value: unknown, key = ""): unknown {
  if (typeof value === "number") return round(value, ANGLE_KEY.test(key) ? 1e9 : 1e6);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (isNumberParam(value)) {
      const n = canon(value.num, key);
      const d = value.digits === undefined ? "" : `~${value.digits}`;
      return `${String(n)}${d}${value.unit === undefined ? "" : ` ${value.unit}`}`;
    }
    if (isMessage(value)) return messageText(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => canon(v, key));
    if (value.length > 4 && value.every(isPoint)) {
      return { points: value.length, bbox: bbox(value), sha: sha(items) };
    }
    return items;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = canon(v, k);
    }
    return out;
  }
  return value;
}

const line = (label: string, value: unknown): string => `${label} ${JSON.stringify(canon(value))}`;

// ------------------------------------------------------------------ résumés

/** Points 3D d'un solide (repère du projet) et nombre de points de sa description. */
function solidPoints(s: SolidDesc): { readonly count: number; readonly world: Vec3[] } {
  if (s.kind === "extrusion") {
    const { origin: o, xAxis: X, yAxis: Y, zAxis: Z } = s.frame;
    const ring = [s.profile.outer, ...s.profile.holes].flat();
    const world = [0, s.depth].flatMap((d) =>
      ring.map((p) => ({
        x: o.x + p.x * X.x + p.y * Y.x + d * Z.x,
        y: o.y + p.x * X.y + p.y * Y.y + d * Z.y,
        z: o.z + p.x * X.z + p.y * Y.z + d * Z.z,
      })),
    );
    return { count: ring.length, world };
  }
  if (s.kind === "ruled") return { count: s.a.length + s.b.length, world: [...s.a, ...s.b] };
  return { count: s.path.length * s.section.outer.length, world: [...s.path] };
}

function partLine(p: Part): string {
  const { count, world } = solidPoints(p.solid);
  return line(`pièce ${p.id}`, {
    mark: p.mark,
    category: p.category,
    material: p.material,
    name: p.name,
    section: p.section,
    componentOf: p.componentOf,
    quantities: p.quantities,
    stock: p.stock,
    grain: p.grain,
    solid: { kind: p.solid.kind, points: count, bbox: bbox(world), sha: sha(canon(p.solid)) },
    flat:
      p.flat === undefined
        ? undefined
        : {
            outer: p.flat.outline.outer.length,
            holes: p.flat.outline.holes.length,
            lines: p.flat.lines.length,
            thickness: p.flat.thickness,
            sha: sha(canon(p.flat)),
          },
  });
}

/** Sous-faces de l'étape d'échappée (voir l'en-tête). */
const soffitsOf = (m: Model): readonly Soffit[] => m.soffits ?? [];

function sections(m: Model): Record<string, string> {
  const { layout: l, stepping: s } = m;
  const soffits = soffitsOf(m);
  return {
    pièces: [`pièces ${m.parts.length}`, ...m.parts.map(partLine)].join("\n"),
    contrôle: [
      line("contrôle", {
        rulesVersion: m.compliance.rulesVersion,
        contexts: m.compliance.contexts,
        profile: m.compliance.profile,
        summary: m.compliance.summary,
        notes: m.compliance.notes,
      }),
      ...m.compliance.results.map((r) =>
        line(`règle ${r.ruleId}`, {
          status: r.status,
          severity: r.severity,
          declaredSeverity: r.declaredSeverity,
          measured: r.measured,
          min: r.min,
          max: r.max,
          unit: r.unit,
          location: r.location,
          message: r.message,
          downgradeReason: r.downgradeReason,
          justification: r.justification,
        }),
      ),
    ].join("\n"),
    "erreurs et remarques": [
      line("Model.errors", m.errors),
      line("Model.notes", m.notes ?? []),
      line("Layout.errors", l.errors ?? []),
      line("Layout.notes", l.notes ?? []),
      line("Stepping.notes", s.notes),
      line("precheck.notes", m.precheck?.notes ?? []),
    ].join("\n"),
    échappée: [
      line("headroom", m.headroom ?? null),
      line("headroomWidth", m.headroomWidth ?? null),
      line("headroomUnlimited", m.headroomUnlimited ?? null),
      line("headroomAtNosings", m.headroomAtNosings ?? null),
    ].join("\n"),
    "sous-faces": [
      `sous-faces ${soffits.length}`,
      ...soffits.map((f, i) =>
        line(`sous-face ${i}`, {
          z: f.z,
          sStart: f.sStart,
          tread: f.tread,
          outline: { points: f.outline.length, sha: sha(canon(f.outline)) },
        }),
      ),
    ].join("\n"),
    "chiffres et site": [
      line("figures", m.figures ?? null),
      line("executionClass", m.executionClass ?? null),
      line("autoValues", m.autoValues ?? null),
      line("upperFloor", m.upperFloor ?? null),
      line("precheck", m.precheck === undefined ? null : { ...m.precheck, notes: undefined }),
      `siteFit ${m.siteFit?.length ?? 0}`,
      ...(m.siteFit ?? []).map((c, i) =>
        line(`conflit ${i}`, { ...c, zone: { points: c.zone.length, sha: sha(canon(c.zone)) } }),
      ),
      `visserie ${m.fasteners?.length ?? 0}`,
      ...(m.fasteners ?? []).map((f, i) => line(`visserie ${i}`, f)),
    ].join("\n"),
    tracé: [
      line("Layout.helical", l.helical ?? null),
      line("Layout.helicalOrigin", l.helicalOrigin ?? null),
      line("Layout", {
        walklineOffset: l.walklineOffset,
        innerSide: l.innerSide,
        walklineSide: l.walklineSide,
        cage: l.cage,
        sections: l.sections?.length,
        turns: l.turns,
        footprint: l.footprint,
        footprintHoles: l.footprintHoles,
        inner: sha(canon(l.inner)),
        outer: sha(canon(l.outer)),
        walkline: sha(canon(l.walkline)),
      }),
    ].join("\n"),
    découpage: [
      line("Stepping", {
        riserCount: s.riserCount,
        rise: s.rise,
        going: s.going,
        blondel: s.blondel,
        run: s.run,
        helical: s.helical,
        kinds: s.treads.map((t) => t.kind[0]).join(""),
        balancedZones: s.balancedZones,
      }),
      line("rises", s.rises),
      line(
        "going",
        s.treads.map((t) => t.going),
      ),
      line(
        "goingOuter",
        s.treads.map((t) => t.goingOuter),
      ),
      line(
        "colletArc",
        s.treads.map((t) => t.colletArc),
      ),
      line(
        "colletChord",
        s.treads.map((t) => t.colletChord),
      ),
      line(
        "z",
        s.treads.map((t) => t.z),
      ),
      line("nosings", { count: s.nosings.length, sha: sha(canon(s.nosings)) }),
      line("treads.outline", sha(s.treads.map((t) => canon(t.outline)))),
      line("treads.walkingSurface", sha(s.treads.map((t) => canon(t.walkingSurface)))),
    ].join("\n"),
  };
}

// ------------------------------------------------------------------ instantanés

describe("sorties hélicoïdales — Model (F10, P3, décision (10b))", () => {
  it.each(PROJECTS.map(([name, make]) => [name, make] as const))("%s", (_name, make) => {
    const model = buildModel(make(), { memo: false });
    for (const [title, text] of Object.entries(sections(model))) {
      expect(`\n${text}\n`).toMatchSnapshot(title);
    }
  });
});
