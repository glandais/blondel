/**
 * Instantanés des **sorties de fabrication** des exemples (chantier `stable-tiebreaks`, sous-lot
 * S1, décision F10 (7) et (11)) : enregistrés sur l'état de `develop` 56f79d8, **avant toute
 * correction** des départages sensibles au bruit d'arrondi (`minAreaRect`, clé de regroupement
 * de la liste et de la fiche de débit, repère gravé, clé des DXF de développés). Le sous-lot S2
 * justifie chaque écart.
 *
 * Projets : les exemples de `examples/` (liste triée du dossier) et le préréglage `helical`
 * (seul absent de `examples/`) ; les autres préréglages et les démos y sont déjà sérialisés.
 * `buildModel(p, { memo: false })`, sorties en français seulement (les départages visés ne
 * dépendent pas de la langue).
 *
 * Contenu, par projet :
 * - liste de débit CSV : texte entier ; pour tout repère présent sur plusieurs lignes, les
 *   composantes brutes de la clé de regroupement de chaque pièce (`String(x)`, 17 chiffres) ;
 * - fiche de débit (`cutSheet`) : groupes et lignes à 1e-6 ; même sous-section des repères en
 *   double sur la clé de `cutSheet` (dimensions de débit brutes, lames, masse) ;
 * - DXF des développés (`exportPartsDxf`) : par fichier, entités par calque, boîte, contour
 *   (sommets, sens, premier sommet), repère gravé (`flatEngravingPoint` et entité TEXT relue),
 *   rectangle d'aire minimale (`minAreaRect`), empreinte du DXF (codes réels arrondis à 1e-4) ;
 *   pour un fichier suffixé (`-2`, `-3` : même repère, développé différent), la différence avec
 *   le premier fichier du repère en trois mesures : écart géométrique (plus grand écart entre
 *   nombres de même place du contour, trous compris, des extrémités des lignes, de l'épaisseur
 *   et des cotes de ligne `bendAngle`, `bendRadius`, `depth`), décomptes qui diffèrent et
 *   premiers chemins non géométriques qui diffèrent (paramètres de `Message`, nature de ligne,
 *   matériau…), puis le qualificatif `bruit seul` (écart géométrique ≤ 1e-9 et rien d'autre ne
 *   diffère : le suffixe ne vient que du bruit d'arrondi, S2 doit le faire disparaître) ou
 *   `différence réelle` (le suffixe est légitime et doit rester).
 * Recouvrement : 5 exemples hélicoïdaux sont aussi figés (en empreintes) par
 * `helicalOutputs.test.ts`.
 *
 * Stabilité : des écarts de l'ordre de 1e-13 et des nombres bruts (`String(x)`) sont figés au bit
 * près, à dessein (ils montrent le bruit) ; ils sont déterministes sous un même moteur, mais
 * dépendent de `Math.sin`, `Math.cos`… : après une montée de version de Node, un écart limité
 * à ces lignes vient du moteur, pas d'une régression ni de S2.
 *
 * Chaque section est vérifiée par `expect.soft` : un écart dans une section ne masque pas celui
 * d'une section suivante du même projet.
 *
 * Garde-fou : tout écart d'instantané est justifié ligne à ligne dans
 * `docs/ledger/LEDGER-stable-tiebreaks.md`. Toute mise à jour se fait par
 * `pnpm vitest run <ce fichier> -u`, ciblée sur ce fichier, **jamais** par un `-u` global.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bbox,
  buildModel,
  createProject,
  minAreaRect,
  parseProjectText,
  signedArea,
  type Model,
  type Part,
  type Project,
  type Vec2,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  cutListRows,
  cutParts,
  exportCutListCsv,
  partMassKg,
  QUANTITY_VOLUME,
} from "./csv/cutlist.js";
import { cutSheet } from "./cutsheet.js";
import { flatEngravingPoint, partLayers } from "./dxf/part.js";
import { exportPartsDxf, type PartDxfFile } from "./dxf/parts.js";
import { encodeDxfText } from "./dxf/r12.js";
import { translatorOf, trOpt } from "./i18n.js";
import { readDxf } from "./testing/dxf-reader.js";
import { dxfNormalized, json, round, sha, tally } from "./testing/snapshotFormat.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const SUFFIX = ".blondel.json";

/** Projets couverts (voir l'en-tête). */
const PROJECTS: readonly (readonly [string, () => Project])[] = [
  ...readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(SUFFIX))
    .sort()
    .map(
      (f) =>
        [
          `exemple ${f.slice(0, -SUFFIX.length)}`,
          () => parseProjectText(readFileSync(join(EXAMPLES_DIR, f), "utf8")),
        ] as const,
    ),
  ["préréglage helical", () => createProject("helical")],
];

// ------------------------------------------------------------------ mise en forme

/** Nombre brut (17 chiffres significatifs au plus, forme la plus courte) ou `-`. */
const raw = (x: number | string | undefined | null): string =>
  x === undefined || x === null ? "-" : String(x);

const pt = (p: Vec2): string => `(${round(p.x, 1e6)}, ${round(p.y, 1e6)})`;

/** Repères présents plus d'une fois dans la liste. */
function duplicated(marks: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const m of marks) (seen.has(m) ? dup : seen).add(m);
  return dup;
}

// ------------------------------------------------------------------ liste de débit CSV

function cutListSection(model: Model): string {
  const csv = exportCutListCsv(model, { locale: "fr" });
  const dup = duplicated(cutListRows(model.parts, { locale: "fr" }).map((r) => r.mark));
  const t = translatorOf({ locale: "fr" });
  const lines = [csv, `--- repères en double ${dup.size}`];
  for (const p of cutParts(model.parts)) {
    if (!dup.has(p.mark)) continue;
    const s = p.stock;
    lines.push(
      [
        p.mark,
        p.id,
        `cat=${p.category}`,
        `matériau=${p.material}`,
        `section=${raw(trOpt(t, p.section))}`,
        `L=${raw(s?.length)}`,
        `l=${raw(s?.width)}`,
        `e=${raw(s?.thickness)}`,
        `lames=${raw(s ? (s.count ?? 1) : undefined)}`,
        `appro=${raw(s?.supply)}`,
        `volume=${raw(p.quantities[QUANTITY_VOLUME])}`,
        `masse=${raw(partMassKg(p))}`,
      ].join(" "),
    );
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ fiche de débit

/** Dimensions de débit de `cutSheet` (reprise de `cutDims`, non exportée). */
function sheetDims(p: Part): { length?: number; width?: number; thickness?: number } {
  if (p.stock)
    return { length: p.stock.length, width: p.stock.width, thickness: p.stock.thickness };
  if (p.flat && p.flat.outline.outer.length >= 3) {
    const b = bbox(p.flat.outline.outer);
    const w = b.max.x - b.min.x;
    const h = b.max.y - b.min.y;
    return { length: Math.max(w, h), width: Math.min(w, h), thickness: p.flat.thickness };
  }
  return {};
}

function cutSheetSection(model: Model): string {
  const groups = cutSheet(model.parts, { locale: "fr" });
  const lines = [`groupes ${groups.length}`];
  for (const g of groups) {
    lines.push(
      `groupe ${g.material} ${g.basis} ${g.thickness !== undefined ? round(g.thickness, 1e6) : `« ${g.section ?? ""} »`} ${json(g.totals)}`,
    );
    for (const r of g.rows) {
      const dims = [r.length, r.width, r.thickness]
        .map((v) => (v === undefined ? "-" : round(v, 1e6)))
        .join("×");
      lines.push(
        `  ${r.mark} ×${r.quantity} ${dims} ${r.unitMass === undefined ? "-" : round(r.unitMass, 1e6)} ${r.supply ?? "-"} ${r.source}`,
      );
    }
  }
  const dup = duplicated(groups.flatMap((g) => g.rows.map((r) => r.mark)));
  lines.push(`--- repères en double ${dup.size}`);
  const t = translatorOf({ locale: "fr" });
  for (const p of cutParts(model.parts)) {
    if (!dup.has(p.mark)) continue;
    const d = sheetDims(p);
    const pieces = p.stock?.count !== undefined && p.stock.count > 1 ? p.stock.count : 1;
    const mass = partMassKg(p);
    lines.push(
      [
        p.mark,
        p.id,
        `matériau=${p.material}`,
        `section=${raw(trOpt(t, p.section))}`,
        `L=${raw(d.length)}`,
        `l=${raw(d.width)}`,
        `e=${raw(d.thickness)}`,
        `lames=${pieces}`,
        `masse=${raw(mass !== undefined ? mass / pieces : undefined)}`,
        `appro=${raw(p.stock?.supply)}`,
      ].join(" "),
    );
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ DXF des développés

/** Chemins numériques du développé qui portent de la géométrie (voir l'en-tête). */
const GEOMETRIC_PATH =
  /^(outline\.|thickness$|lines\[\d+\]\.(a|b)\.|lines\[\d+\]\.(bendAngle|bendRadius|depth)$)/;

/** Différence entre deux développés : écart géométrique, décomptes et autres chemins. */
interface FlatDiff {
  gap: number;
  /** Décomptes qui diffèrent (sommets, trous, lignes). */
  counts: string[];
  /** Chemins non géométriques qui diffèrent, avec les deux valeurs. */
  texts: string[];
}

const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
};

function flatDiff(a: unknown, b: unknown, path: string, out: FlatDiff): void {
  if (typeof a === "number" && typeof b === "number" && GEOMETRIC_PATH.test(path)) {
    out.gap = Math.max(out.gap, Math.abs(a - b));
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.counts.push(`${path} ${b.length} contre ${a.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      flatDiff(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort();
    for (const k of keys) {
      const p = path === "" ? k : `${path}.${k}`;
      if (ra[k] === undefined && rb[k] === undefined) continue;
      if (ra[k] === undefined || rb[k] === undefined) {
        out.texts.push(`${p} ${short(ra[k] ?? "-")}/${short(rb[k] ?? "-")}`);
        continue;
      }
      flatDiff(ra[k], rb[k], p, out);
    }
    return;
  }
  if (!Object.is(a, b)) out.texts.push(`${path} ${short(a)}/${short(b)}`);
}

/** Ligne « écart avec … » d'un fichier suffixé (voir l'en-tête). */
function gapLine(firstName: string, ref: Part, part: Part): string {
  const d: FlatDiff = { gap: 0, counts: [], texts: [] };
  if (ref.material !== part.material) d.texts.push(`matériau ${ref.material}/${part.material}`);
  flatDiff(ref.flat, part.flat, "", d);
  const real = d.gap > 1e-9 || d.counts.length > 0 || d.texts.length > 0;
  const shown = d.texts.slice(0, 3);
  return (
    `  écart avec ${firstName} géométrie ${d.gap.toExponential(3)}` +
    (d.counts.length > 0 ? ` décomptes [${d.counts.join("; ")}]` : "") +
    (shown.length > 0
      ? ` textes [${shown.join("; ")}${d.texts.length > 3 ? `; +${d.texts.length - 3}` : ""}]`
      : "") +
    ` ${real ? "différence réelle" : "bruit seul"}`
  );
}

function partFileLines(model: Model, f: PartDxfFile, first: PartDxfFile | undefined): string[] {
  const part = model.parts.find((p) => p.id === f.partIds[0])!;
  const flat = part.flat!;
  const outer = flat.outline.outer;
  const dxf = readDxf(f.content);
  const textLayer = partLayers().text.name;
  const markText = encodeDxfText(part.mark);
  const texts = dxf.entities.filter(
    (e): e is Extract<typeof e, { type: "TEXT" }> =>
      e.type === "TEXT" && e.layer === textLayer && e.value === markText,
  );
  const engraved = texts[texts.length - 1];
  const spot = flatEngravingPoint(flat);
  const rect = minAreaRect(outer);
  const box = bbox(outer);
  const lines = [
    `${f.filename} ×${f.quantity} ${f.mark} [${f.partIds.join(", ")}]`,
    `  calques ${JSON.stringify(tally(dxf.entities.map((e) => e.layer)))}`,
    `  boîte ${json(box)}`,
    `  contour ${outer.length} sommets ${signedArea(outer) >= 0 ? "CCW" : "CW"} premier ${outer.length > 0 ? pt(outer[0]!) : "-"}`,
    `  repère « ${part.mark} » ${pt(spot.at)} dégagement ${round(spot.clearance, 1e6)}` +
      (engraved ? ` texte h ${round(engraved.height, 1e6)} ${pt(engraved.at)}` : " texte absent") +
      (texts.length > 1 ? ` (${texts.length} textes)` : ""),
    `  rectMin L ${round(rect.length, 1e6)} l ${round(rect.width, 1e6)} axe ${rect.axis ? pt(rect.axis) : "-"} coin ${rect.corners.length > 0 ? pt(rect.corners[0]!) : "-"}`,
    `  empreinte ${sha(dxfNormalized(f.content, 1e4))}`,
  ];
  if (first !== undefined) {
    const ref = model.parts.find((p) => p.id === first.partIds[0])!;
    lines.push(gapLine(first.filename, ref, part));
  }
  return lines;
}

function partsDxfSection(model: Model): string {
  const files = exportPartsDxf(model);
  const firstByMark = new Map<string, PartDxfFile>();
  const lines = [`fichiers ${files.length}`];
  for (const f of files) {
    const first = firstByMark.get(f.mark);
    if (first === undefined) firstByMark.set(f.mark, f);
    lines.push(...partFileLines(model, f, first));
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ instantanés

describe("sorties de fabrication des exemples (stable-tiebreaks, S1)", () => {
  it("couvre tous les exemples", () => {
    expect(PROJECTS.length).toBeGreaterThan(40);
  });

  it.each(PROJECTS.map(([name, make]) => [name, make] as const))("%s", (_name, make) => {
    const model = buildModel(make(), { memo: false });
    const sections: Record<string, string> = {
      "liste de débit CSV": cutListSection(model),
      "fiche de débit": cutSheetSection(model),
      "DXF des développés": partsDxfSection(model),
    };
    for (const [title, text] of Object.entries(sections)) {
      expect.soft(`\n${text}\n`).toMatchSnapshot(title);
    }
  });
});
