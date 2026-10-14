/**
 * Instantanés des **zones de conflit** et des pièces hors tout des exemples (chantier
 * `stable-tiebreaks`, sous-lot S1, décision F10 (7) et (11)) : enregistrés sur l'état de
 * `develop` 56f79d8, **avant toute correction** de l'enveloppe convexe de `geom2d/collide.ts`
 * (départage sensible au bruit d'arrondi). Le sous-lot S2 justifie chaque écart.
 *
 * Projets : les exemples de `examples/` (liste triée du dossier) et le préréglage `helical`.
 * Sortie : `buildPlanPreview(p, { memo: false })` (tracé, découpage, conflits géométriques ; les
 * conflits d'échappée `headroom`, zones sans enveloppe, sont hors du champ).
 *
 * Contenu, par projet :
 * - pièces hors tout (`stairGrossPieces`, enveloppe de `collide.ts` lue directement) : marche,
 *   altitude, nombre de sommets, aire à 1e-6, empreinte des sommets dans l'ordre produit,
 *   empreinte canonique (rotation qui commence au plus petit sommet arrondi) et tous les
 *   sommets à 1e-6 dans l'ordre produit (un sommet quasi aligné ou quasi confondu ajouté,
 *   retiré ou remplacé par l'enveloppe se lit directement) ;
 * - conflits de l'aperçu : type, sévérité, règle ou clé, cible, zone (sommets à 1e-6 dans
 *   l'ordre produit, aire signée, empreinte canonique), marches dont la pièce recoupe la zone ;
 * - conflits provoqués : les exemples n'ont aucun conflit `wall`, `obstacle` ni `outsideRoom` ;
 *   un site de test déterministe (murs, poteaux, contour, en mm entiers, tiré de la boîte des
 *   pièces hors tout) les provoque, sur le tracé et le découpage de l'aperçu.
 *
 * Stabilité : les sommets arrondis à 1e-6 sont déterministes sous un même moteur, mais dépendent
 * de `Math.sin`, `Math.cos`… : après une montée de version de Node, un écart limité à des
 * chiffres au millionième vient du moteur, pas d'une régression ni de S2.
 *
 * Chaque section est vérifiée par `expect.soft` : un écart dans une section ne masque pas celui
 * d'une section suivante du même projet.
 *
 * Garde-fou : tout écart d'instantané est justifié ligne à ligne dans
 * `docs/ledger/LEDGER-stable-tiebreaks.md`. Toute mise à jour se fait par
 * `pnpm vitest run <ce fichier> -u`, ciblée sur ce fichier, **jamais** par un `-u` global.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { convexOverlap } from "../geom2d/collide.js";
import { bbox, signedArea } from "../geom2d/polygon.js";
import type { SiteConflict } from "../model/derived.js";
import type { Polygon2, Vec2 } from "../model/primitives.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { buildPlanPreview } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { createProject } from "../project/presets.js";
import {
  projectLateralThickness,
  siteGeometryConflicts,
  SITE_FIT_CONTACT_TOL,
  stairGrossPieces,
  type GrossPiece,
} from "./fit.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
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

// ------------------------------------------------------------------ mise en forme stable

const sha = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Arrondi au pas `1 / scale`, sans zéro négatif. */
function round(x: number, scale: number): number | string {
  if (!Number.isFinite(x)) return String(x);
  const r = Math.round(x * scale) / scale;
  return r === 0 ? 0 : r;
}

const r6 = (x: number): number | string => round(x, 1e6);
const pt = (p: Vec2): string => `(${r6(p.x)}, ${r6(p.y)})`;

/** Sommets arrondis à 1e-6. */
const rounded = (poly: Polygon2): [number | string, number | string][] =>
  poly.map((p) => [r6(p.x), r6(p.y)]);

/** Empreinte de la rotation qui commence au plus petit sommet arrondi (x, puis y). */
function canonicalSha(poly: Polygon2): string {
  const pts = rounded(poly);
  if (pts.length === 0) return sha("[]");
  const less = (a: (number | string)[], b: (number | string)[]): boolean =>
    Number(a[0]) < Number(b[0]) || (Number(a[0]) === Number(b[0]) && Number(a[1]) < Number(b[1]));
  let start = 0;
  for (let i = 1; i < pts.length; i++) if (less(pts[i]!, pts[start]!)) start = i;
  return sha(JSON.stringify([...pts.slice(start), ...pts.slice(0, start)]));
}

function pieceLines(pieces: readonly GrossPiece[]): string[] {
  return [
    `pièces ${pieces.length}`,
    ...pieces.flatMap((p) => [
      [
        p.tread !== undefined ? `marche ${p.tread}` : "tronçon",
        `z ${p.z !== undefined ? r6(p.z) : "-"}`,
        `${p.polygon.length} sommets`,
        `aire ${r6(signedArea(p.polygon))}`,
        `sha ${sha(JSON.stringify(rounded(p.polygon)))}`,
        `canonique ${canonicalSha(p.polygon)}`,
      ].join(" "),
      `  sommets ${p.polygon.map(pt).join(" ")}`,
    ]),
  ];
}

function conflictLines(
  conflicts: readonly SiteConflict[],
  pieces: readonly GrossPiece[],
): string[] {
  const out = [`conflits ${conflicts.length}`];
  for (const c of conflicts) {
    const z = c.zone;
    const area = signedArea(z);
    const touched = pieces
      .filter((p) => z.length >= 3 && convexOverlap(p.polygon, z, SITE_FIT_CONTACT_TOL))
      .map((p) => p.tread ?? "-");
    out.push(
      [c.kind, c.severity, c.ruleId ?? c.message.key, c.targetId ?? "-"].join(" "),
      `  zone ${z.length} sommets aire ${r6(Math.abs(area))} ${area >= 0 ? "CCW" : "CW"} canonique ${canonicalSha(z)}`,
      `  sommets ${z.map(pt).join(" ")}`,
      `  marches [${touched.join(", ")}]`,
    );
  }
  return out;
}

/**
 * Site de test (voir l'en-tête) : boîte arrondie des pièces hors tout [x0, y0, x1, y1], centre
 * (cx, cy) ; murs horizontal par le centre et diagonal, poteau carré au centre, poteau rond au
 * quart, contour réduit de 200 mm sur chaque bord. Mm entiers.
 */
function provokingSite(project: Project, pieces: readonly GrossPiece[]): Project {
  const b = bbox(pieces.flatMap((p) => p.polygon));
  const x0 = Math.floor(b.min.x);
  const y0 = Math.floor(b.min.y);
  const x1 = Math.ceil(b.max.x);
  const y1 = Math.ceil(b.max.y);
  const cx = Math.round((x0 + x1) / 2);
  const cy = Math.round((y0 + y1) / 2);
  const qx = Math.round(x0 + (x1 - x0) / 4);
  const qy = Math.round(y0 + (y1 - y0) / 4);
  return ProjectSchema.parse({
    ...project,
    site: {
      ...project.site,
      walls: [
        {
          id: "T1",
          a: { x: x0 - 500, y: cy },
          b: { x: x1 + 500, y: cy },
          thickness: 200,
          loadBearing: false,
        },
        { id: "T2", a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, thickness: 200, loadBearing: false },
      ],
      obstacles: [
        { kind: "post", id: "P1", center: { x: cx, y: cy }, sizeX: 300, sizeY: 300, rotation: 0 },
        { kind: "circularPost", id: "P2", center: { x: qx, y: qy }, radius: 150 },
      ],
      room: {
        points: [
          { x: x0 + 200, y: y0 + 200 },
          { x: x1 - 200, y: y0 + 200 },
          { x: x1 - 200, y: y1 - 200 },
          { x: x0 + 200, y: y1 - 200 },
        ],
      },
    },
  });
}

// ------------------------------------------------------------------ instantanés

describe("zones de conflit des exemples (stable-tiebreaks, S1)", () => {
  it("couvre tous les exemples", () => {
    expect(PROJECTS.length).toBeGreaterThan(40);
  });

  it.each(PROJECTS.map(([name, make]) => [name, make] as const))("%s", (_name, make) => {
    const project = make();
    const preview = buildPlanPreview(project, { memo: false });
    expect(preview.errors).toEqual([]);
    const layout = preview.layout!;
    const stepping = preview.stepping;
    const lateral = projectLateralThickness(project);
    const pieces = stairGrossPieces(layout, stepping, lateral);
    expect(pieces.length).toBeGreaterThan(0);
    const siteProject = provokingSite(project, pieces);
    const provoked = siteGeometryConflicts(siteProject, layout, stepping, lateral);
    const sections: Record<string, string> = {
      "pièces hors tout": pieceLines(pieces).join("\n"),
      conflits: conflictLines(preview.siteFit, pieces).join("\n"),
      "conflits provoqués": conflictLines(provoked, pieces).join("\n"),
    };
    for (const [title, text] of Object.entries(sections)) {
      expect.soft(`\n${text}\n`).toMatchSnapshot(title);
    }
  });

  it("le site de test ne change pas le tracé d'un exemple tournant", () => {
    const project = parseProjectText(
      readFileSync(join(EXAMPLES_DIR, `acceptance-01-quart-tournant${SUFFIX}`), "utf8"),
    );
    const preview = buildPlanPreview(project, { memo: false });
    const pieces = stairGrossPieces(
      preview.layout!,
      preview.stepping,
      projectLateralThickness(project),
    );
    const siteProject = provokingSite(project, pieces);
    expect(buildPlanPreview(siteProject, { memo: false }).layout).toEqual(preview.layout);
  });
});
