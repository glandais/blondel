/**
 * Instantané préalable des **repères de garde-corps** des exemples (chantier `guard-marks`,
 * sous-lot G2a) : enregistré avant tout changement de l'attribution des repères de garde-corps
 * (regroupement à T par le descripteur de forme, mains courantes, représentant : sous-lots G2b
 * et G2c), pour justifier leurs écarts.
 *
 * Projets : les exemples de `examples/` (liste triée du dossier) et le préréglage `helical`,
 * comme `fabricationOutputs.test.ts`. `buildModel(p, { memo: false })`. Un projet sans pièce de
 * garde-corps s'écrit `-`.
 *
 * Contenu, par projet :
 * - en-tête : nombre de repères, de pièces, et `countUniqueParts` des pièces de garde-corps à la
 *   tolérance d'identité du profil d'atelier (décision CG8 : à rapprocher du nombre de repères) ;
 * - une ligne par repère, dans l'ordre de première apparition : repère, catégorie, clé de la
 *   désignation, matériau, nombre de pièces, débit longueur × largeur × épaisseur (au 1/10 mm),
 *   et `MULTI` si les pièces du repère n'ont pas toutes le même débit (aucune aujourd'hui).
 *
 * Garde-fou : tout écart d'instantané est justifié ligne à ligne dans
 * `docs/ledger/LEDGER-guard-marks.md`. Toute mise à jour se fait par
 * `pnpm vitest run <ce fichier> -u`, ciblée sur ce fichier, **jamais** par un `-u` global.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModel,
  countUniqueParts,
  createProject,
  parseProjectText,
  resolveWorkshopProfile,
  type Part,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import { round } from "./testing/snapshotFormat.js";

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

/** Débit au 1/10 mm : « L × l × e ». */
function stockText(p: Part): string {
  const s = p.stock;
  if (!s) return "-";
  return `${round(s.length, 10)} × ${round(s.width, 10)} × ${round(s.thickness, 10)}`;
}

/** Résumé des repères de garde-corps d'un projet (voir l'en-tête). */
function guardMarksSection(project: Project): string {
  const parts = buildModel(project, { memo: false }).parts.filter((p) => p.family === "guards");
  if (parts.length === 0) return "-";
  const byMark = new Map<string, Part[]>();
  for (const p of parts) byMark.set(p.mark, [...(byMark.get(p.mark) ?? []), p]);
  const tol = resolveWorkshopProfile(project.workshop).identicalPartTolerance;
  const lines = [
    `repères ${byMark.size} ; pièces ${parts.length} ; pièces uniques ${countUniqueParts(parts, tol)} (T = ${tol})`,
  ];
  for (const [mark, ps] of byMark) {
    const r = ps[0]!;
    const multi = new Set(ps.map(stockText)).size > 1 ? " MULTI" : "";
    lines.push(
      `${mark} ${r.category} ${r.name.key} ${r.material} ×${ps.length} ${stockText(r)}${multi}`,
    );
  }
  return lines.join("\n");
}

describe("repères de garde-corps des exemples (guard-marks, G2a)", () => {
  it("couvre tous les exemples", () => {
    expect(PROJECTS.length).toBeGreaterThan(40);
  });

  it.each(PROJECTS.map(([name, make]) => [name, make] as const))("%s", (_name, make) => {
    expect(`\n${guardMarksSection(make())}\n`).toMatchSnapshot();
  });
});
