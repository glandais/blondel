/**
 * Instantanés des **exports** des escaliers hélicoïdaux (F10, sous-lot P3, décision (10b)) :
 * non-régression qui remplace la parité des exports contre la copie figée de l'ancien moteur
 * (`helicalSwitch.parity.test.ts`) avant son retrait. Enregistrés sur l'état P2 (commit
 * 5a1e407), avant tout retrait. Mêmes projets que `packages/core/src/pipeline/
 * helicalOutputs.test.ts` : les 6 exemples hélicoïdaux, le préréglage `helical`, les 3 démos
 * hélicoïdales et `cage-arc` (référence de la décision (9), sans marche droite).
 *
 * Contenu, par projet (`buildModel(p, { memo: false })`) :
 * - plan et élévation SVG (fr et en, clair et sombre) : empreinte SHA-256 du texte, nombre
 *   d'éléments par `data-kind` et de groupes de cote par `data-dimension` ; en clair, les cotes
 *   du plan fr clair (rôle, texte, `data-value`, tracé en px à 0,01) ;
 * - plan DXF R12 et AC1021 (fr et en) : par calque, nombre d'entités et empreinte (nombres
 *   réécrits à 1e-6, poignées et propriétaires AC1021 retirés, car ils se décalent quand une
 *   entité s'ajoute ailleurs) ; en clair, le calque des cotes du R12 fr ;
 * - listes CSV de débit et de visserie (fr et en) : texte entier sous 200 lignes, sinon nombre
 *   de lignes et empreinte ;
 * - fiche de débit (`cutSheet`, données du dossier PDF) : une ligne par groupe et par ligne,
 *   nombres à 1e-6 ;
 * - DXF des développés (`exportPartsDxf`) : nom, quantité, pièces et empreinte par fichier
 *   (nombres à 1e-6) ;
 * - glTF (`readGlb`) : nœuds, matériaux, maillages, accesseurs (type, nombre, boîte à 1e-3) et
 *   empreinte des données (flottants arrondis à 1e-3).
 * Pas d'instantané du PDF (polices, dates) ni du ZIP (même contenu que ci-dessus).
 *
 * Garde-fou : un écart d'instantané doit venir d'une décision et être justifié ligne à ligne au
 * ledger du chantier. Toute mise à jour se fait par `pnpm vitest run <ce fichier> -u`, ciblée
 * sur ce fichier, **jamais** par un `-u` global.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModel,
  createDemoProject,
  createProject,
  parseProjectText,
  type Model,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { exportCutListCsv } from "./csv/cutlist.js";
import { exportFastenersCsv } from "./csv/fasteners.js";
import { cutSheet } from "./cutsheet.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { exportPlanDxf, planLayers } from "./dxf/plan.js";
import { exportGlb } from "./gltf/glb.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderPlanSvg } from "./svg/plan.js";
import { readGlb } from "./testing/glb-reader.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
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

const LOCALES = ["fr", "en"] as const;
const THEMES = ["light", "dark"] as const;

// ------------------------------------------------------------------ mise en forme stable

const sha = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Arrondi au pas `1 / scale`, sans zéro négatif. */
function round(x: number, scale: number): number | string {
  if (!Number.isFinite(x)) return String(x);
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r;
}

/** Valeur canonique : nombres arrondis au pas `1 / scale`, champs indéfinis omis. */
function canon(value: unknown, scale: number): unknown {
  if (typeof value === "number") return round(value, scale);
  if (Array.isArray(value)) return value.map((v) => canon(v, scale));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = canon(v, scale);
    }
    return out;
  }
  return value;
}

const json = (value: unknown, scale = 1e6): string => JSON.stringify(canon(value, scale));

/** Nombre d'occurrences de chaque valeur, triées. */
function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of [...values].sort()) out[v] = (out[v] ?? 0) + 1;
  return out;
}

// ------------------------------------------------------------------ SVG

const attrValues = (svg: string, attr: string): string[] =>
  [...svg.matchAll(new RegExp(`${attr}="([^"]*)"`, "g"))].map((m) => m[1]!);

function svgSummary(svg: string): string {
  return json({
    sha: sha(svg),
    kinds: tally(attrValues(svg, "data-kind")),
    dimensions: tally(attrValues(svg, "data-dimension")),
  });
}

/** Groupes de cote du plan, en clair : rôle, texte, valeur, tracé (px, 0,01). */
function svgDimensions(svg: string): string[] {
  const re =
    /<g data-dimension="([^"]*)"><path d="([^"]*)"\/><text [^>]*data-value="([^"]*)"[^>]*>([^<]*)<\/text><\/g>/g;
  const found = [...svg.matchAll(re)].map(
    (m) => `cote ${m[1]} « ${m[4]} » value=${m[3]} d=${m[2]}`,
  );
  expect(found.length).toBe(attrValues(svg, "data-dimension").length);
  return found;
}

// ------------------------------------------------------------------ DXF

/** Codes de groupe réels (coordonnées, longueurs, angles) : réécrits à 1e-6. */
const isRealCode = (c: number): boolean =>
  (c >= 10 && c <= 59) ||
  (c >= 110 && c <= 149) ||
  (c >= 210 && c <= 239) ||
  (c >= 1010 && c <= 1059);

/** Poignée et propriétaires (AC1021) : retirés, ils dépendent des entités écrites avant. */
const HANDLE_CODES = new Set([5, 102, 330, 360]);

type Pair = readonly [number, string];

function dxfPairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    const raw = lines[i + 1]!;
    const value = isRealCode(code) ? String(round(Number(raw.trim()), 1e6)) : raw.trim();
    out.push([code, value]);
  }
  return out;
}

/** Entités de la section ENTITIES (VERTEX et SEQEND rattachés à leur POLYLINE), par calque. */
function dxfEntities(text: string): { readonly layer: string; readonly text: string }[] {
  const pairs = dxfPairs(text);
  const start = pairs.findIndex(
    ([c, v], i) => c === 2 && v === "ENTITIES" && pairs[i - 1]?.[1] === "SECTION",
  );
  expect(start).toBeGreaterThan(0);
  const out: { layer: string; parts: string[] }[] = [];
  for (let i = start + 1; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0 && value === "ENDSEC") break;
    if (code === 0 && value !== "VERTEX" && value !== "SEQEND") {
      out.push({ layer: "", parts: [value] });
      continue;
    }
    const current = out[out.length - 1];
    if (current === undefined) continue;
    if (code === 0) current.parts.push(value);
    else if (!HANDLE_CODES.has(code)) {
      if (code === 8 && current.layer === "") current.layer = value;
      current.parts.push(`${code}=${value}`);
    }
  }
  return out.map((e) => ({ layer: e.layer, text: e.parts.join(" ") }));
}

function dxfLayers(text: string): string[] {
  const byLayer = new Map<string, string[]>();
  for (const e of dxfEntities(text)) {
    const list = byLayer.get(e.layer) ?? [];
    list.push(e.text);
    byLayer.set(e.layer, list);
  }
  return [...byLayer.keys()]
    .sort()
    .map(
      (l) => `calque ${l} : ${byLayer.get(l)!.length} entités, ${sha(byLayer.get(l)!.join("\n"))}`,
    );
}

/** Texte d'un DXF, nombres réels réécrits à 1e-6 (empreinte stable). */
const dxfNormalized = (text: string): string =>
  dxfPairs(text)
    .map(([c, v]) => `${c}=${v}`)
    .join("\n");

// ------------------------------------------------------------------ CSV et glTF

function csvText(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.length < 200 ? text : `${lines.length} lignes, ${sha(text)}`;
}

function glbSummary(bytes: Uint8Array): string[] {
  const { doc, accessorData } = readGlb(bytes);
  const accessors = doc.accessors ?? [];
  const dataSha = (i: number): string => {
    const data = accessorData[i]!;
    const values =
      data instanceof Float32Array ? Array.from(data, (v) => round(v, 1e3)) : Array.from(data);
    return sha(JSON.stringify(values));
  };
  return [
    `scène ${json(doc.scenes[doc.scene], 1e3)}`,
    `nœuds ${doc.nodes.length}`,
    ...doc.nodes.map((n, i) => `nœud ${i} ${json(n, 1e3)}`),
    `matériaux ${json(doc.materials?.map((m) => m.name) ?? [])}`,
    `maillages ${doc.meshes?.length ?? 0}`,
    ...(doc.meshes ?? []).map((m, i) => {
      const prims = m.primitives.map((p) => {
        const pos = accessors[p.attributes.POSITION]!;
        return {
          material: p.material,
          mode: p.mode,
          vertices: pos.count,
          indices: accessors[p.indices]!.count,
          min: pos.min,
          max: pos.max,
          positions: dataSha(p.attributes.POSITION),
          normals: dataSha(p.attributes.NORMAL),
          triangles: dataSha(p.indices),
        };
      });
      return `maillage ${i} ${m.name} ${json(prims, 1e3)}`;
    }),
    `accesseurs ${accessors.length}`,
  ];
}

// ------------------------------------------------------------------ résumés

function sections(model: Model, project: Project): Record<string, string> {
  const plan: string[] = [];
  const elevation: string[] = [];
  let planFrLight = "";
  for (const locale of LOCALES) {
    for (const theme of THEMES) {
      const opts = { project, theme, title: project.name, locale };
      const p = renderPlanSvg(model, opts);
      if (locale === "fr" && theme === "light") planFrLight = p;
      plan.push(`plan.svg ${locale} ${theme} ${svgSummary(p)}`);
      elevation.push(
        `elevation.svg ${locale} ${theme} ${svgSummary(renderElevationSvg(model, opts))}`,
      );
    }
  }
  const dxf: string[] = [];
  let r12Fr = "";
  for (const version of ["R12", "AC1021"] as const) {
    for (const locale of LOCALES) {
      const text = exportPlanDxf(model, { project, version, locale });
      if (version === "R12" && locale === "fr") r12Fr = text;
      dxf.push(`plan.dxf ${version} ${locale}`, ...dxfLayers(text));
    }
  }
  const dimLayer = planLayers().dimensions.name;
  const csv: string[] = [];
  for (const locale of LOCALES) {
    csv.push(`--- cutlist.csv ${locale}`, csvText(exportCutListCsv(model, { locale })));
    csv.push(`--- fasteners.csv ${locale}`, csvText(exportFastenersCsv(model, { locale })));
  }
  const sheet = cutSheet(model.parts).flatMap((g) => [
    `groupe ${json({ ...g, rows: undefined })}`,
    ...g.rows.map((r) => `  ligne ${json(r)}`),
  ]);
  const parts = exportPartsDxf(model).map(
    (f) =>
      `${f.filename} ×${f.quantity} ${f.mark} [${f.partIds.join(", ")}] ${sha(dxfNormalized(f.content))}`,
  );
  return {
    "plan SVG": [...plan, ...svgDimensions(planFrLight)].join("\n"),
    "élévation SVG": elevation.join("\n"),
    "plan DXF": [
      ...dxf,
      `--- calque ${dimLayer} du R12 fr`,
      ...dxfEntities(r12Fr)
        .filter((e) => e.layer === dimLayer)
        .map((e) => e.text),
    ].join("\n"),
    "listes CSV": csv.join("\n"),
    "fiche de débit": [`groupes ${sheet.length}`, ...sheet].join("\n"),
    "DXF des développés": [`fichiers ${parts.length}`, ...parts].join("\n"),
    glTF: glbSummary(exportGlb(model, { project })).join("\n"),
  };
}

// ------------------------------------------------------------------ instantanés

describe("sorties hélicoïdales — exports (F10, P3, décision (10b))", () => {
  it.each(PROJECTS.map(([name, make]) => [name, make] as const))("%s", (_name, make) => {
    const project = make();
    const model = buildModel(project, { memo: false });
    for (const [title, text] of Object.entries(sections(model, project))) {
      expect(`\n${text}\n`).toMatchSnapshot(title);
    }
  });
});
