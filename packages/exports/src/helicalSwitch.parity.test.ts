/**
 * Bascule de l'hélicoïdal sur le moteur de cage (F10, sous-lot P2) : parité des **exports** sur
 * les exemples hélicoïdaux du dépôt. Pour chaque exemple, le `Model` est calculé par l'ancien
 * chemin (copie figée `packages/core/src/layout/legacyHelical.ts`, commutée par `vi.mock`
 * comme dans `packages/core/src/pipeline/helicalSwitch.parity.test.ts`) puis par le pipeline
 * basculé, et chaque export est comparé : plan et élévation SVG (thèmes clair et sombre, en
 * français et en anglais), plan DXF (R12 et AC1021), DXF des développés, liste de débit et
 * liste de visserie CSV : **même texte**, seuls les nombres écrits en pleine précision (DXF
 * AC1021) étant comparés à 1e-6 près ; aucun nombre arrondi pour l'affichage ne peut basculer
 * (aucun écart HALF admis sur ces exemples). Fiche de débit (données du dossier PDF) à 1e-6.
 * glTF : document JSON identique (nombres à 1e-3 mm), données des accesseurs à 1e-3 mm
 * (arrondi float32). Le PDF lui-même est hors comparaison (polices, dates).
 *
 * Portée : comme le test du `Model`, ce test isole l'effet du tracé et du découpage (l'aval est
 * le même code des deux côtés) ; la comparaison au vrai état d'avant P2 (commit 67672d2) a été
 * faite à part, voir le ledger du chantier.
 *
 * Écarts admis, par exemple (`EXPORT_GAPS` ; tout autre écart échoue, un écart attendu qui
 * disparaît aussi). Ce sont des départages par le bruit d'arrondi de l'aval, **non corrigés**
 * en P2 parce que leur correction changeait des sorties d'escaliers non hélicoïdaux (question
 * F10 (11)) :
 * - `parts:rot180` : développé d'un gabarit de couche retourné d'un demi-tour dans sa boîte
 *   (`minAreaRect`, voir le test du `Model`) ; vérifié par `flatRotated180`, puis le développé
 *   du nouveau chemin remplace l'ancien pour comparer le reste des exports ;
 * - `parts.dxf:engraving` : repère gravé (`engravingPoint`, premier maximum strict d'une
 *   recherche sur grille) placé sur un autre point de dégagement égal : seules diffèrent des
 *   lignes de coordonnées égales au repère de chaque chemin, et les dégagements sont égaux à
 *   1e-6 mm près ;
 * - `cutlist:split` / `cutsheet:split` : la liste et la fiche de débit regroupent les pièces
 *   par une clé en flottants exacts ; le bruit (1e-15 relatif) sépare autrement des pièces
 *   identiques (`j5c-limon-central-helicoidal`, EC1). Vérifié : mêmes lignes et mêmes
 *   quantités une fois les lignes de même repère et de mêmes cotes (9 chiffres significatifs)
 *   réunies ; seule la désignation (celle de la première pièce du groupe) peut changer.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText, type Layout, type Model, type Project } from "@blondel/core";
import { describe, expect, it, vi } from "vitest";
import { flatRotated180 } from "../../core/src/layout/cage/helical-parity-helpers.js";
import { cutListRows, exportCutListCsv } from "./csv/cutlist.js";
import { exportFastenersCsv } from "./csv/fasteners.js";
import { cutSheet } from "./cutsheet.js";
import { flatEngravingPoint } from "./dxf/part.js";
import { exportPartsDxf } from "./dxf/parts.js";
import { exportPlanDxf } from "./dxf/plan.js";
import { exportGlb } from "./gltf/glb.js";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderPlanSvg } from "./svg/plan.js";
import { readGlb } from "./testing/glb-reader.js";

const flags = vi.hoisted(() => ({ legacy: false }));

vi.mock("../../core/src/layout/layout.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../core/src/layout/layout.js")>();
  const legacy = await import("../../core/src/layout/legacyHelical.js");
  return {
    ...mod,
    computeLayout: (project: Project, options?: Parameters<typeof mod.computeLayout>[1]) =>
      flags.legacy && project.stair.layout.kind === "helical"
        ? legacy.legacyComputeHelicalLayout(project, project.stair.layout)
        : mod.computeLayout(project, options),
  };
});

vi.mock("../../core/src/stepping/stepping.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../core/src/stepping/stepping.js")>();
  const legacy = await import("../../core/src/layout/legacyHelical.js");
  return {
    ...mod,
    computeStepping: (
      project: Project,
      layout: Layout,
      options?: Parameters<typeof mod.computeStepping>[2],
    ) =>
      flags.legacy && layout.helical && !layout.helicalOrigin
        ? legacy.legacyComputeHelicalStepping(project, layout)
        : mod.computeStepping(project, layout, options),
  };
});

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const HELICAL_EXAMPLES = [
  "j5a-helicoidal",
  "j5c-limon-central-helicoidal",
  "j5c-limon-central-bois-helicoidal",
  "demo-helical-glass",
  "demo-helical-well",
  "demo-central-glulam",
] as const;

function both(project: Project): { before: Model; after: Model } {
  flags.legacy = true;
  try {
    const before = buildModel(project, { memo: false });
    flags.legacy = false;
    const after = buildModel(project, { memo: false });
    return { before, after };
  } finally {
    flags.legacy = false;
  }
}

/** Exports texte d'un modèle, par nom. */
function textExports(model: Model, project: Project): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of ["fr", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      const opts = { project, theme, title: project.name, locale };
      out[`plan.svg ${locale} ${theme}`] = renderPlanSvg(model, opts);
      out[`elevation.svg ${locale} ${theme}`] = renderElevationSvg(model, opts);
    }
    for (const version of ["R12", "AC1021"] as const) {
      out[`plan.dxf ${version} ${locale}`] = exportPlanDxf(model, { project, version, locale });
    }
    out[`cutlist.csv ${locale}`] = exportCutListCsv(model, { locale });
    out[`fasteners.csv ${locale}`] = exportFastenersCsv(model, { locale });
  }
  for (const f of exportPartsDxf(model)) out[`parts.dxf ${f.filename} ×${f.quantity}`] = f.content;
  return out;
}

/** Écarts admis par exemple (voir l'en-tête) ; absent : aucun. */
const EXPORT_GAPS: Readonly<Record<string, readonly string[]>> = {
  "j5c-limon-central-helicoidal": ["cutlist:split", "cutsheet:split"],
  "j5c-limon-central-bois-helicoidal": ["parts.dxf:engraving", "parts:rot180"],
};

/** Nombre arrondi à 9 chiffres significatifs (clé tolérante au bruit, voir l'en-tête). */
const sig = (x: number | undefined): string | null => (x === undefined ? null : x.toPrecision(9));

/**
 * `cutlist:split` : mêmes lignes de débit une fois réunies celles de même repère et de mêmes
 * caractéristiques (nombres à 9 chiffres significatifs), quantités sommées ; la désignation,
 * celle de la première pièce d'un groupe, est exclue de la clé.
 */
function mergedCutRows(model: Model): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of cutListRows(model.parts)) {
    const key = JSON.stringify([
      r.mark,
      r.category,
      r.material,
      r.section,
      sig(r.length),
      sig(r.width),
      sig(r.thickness),
      sig(r.unitVolume),
      sig(r.unitMass),
      r.supply ?? null,
    ]);
    out[key] = (out[key] ?? 0) + r.quantity;
  }
  return out;
}

/** `cutsheet:split` : même principe pour la fiche de débit (groupes, puis lignes). */
function mergedSheetRows(model: Model): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of cutSheet(model.parts)) {
    for (const r of g.rows) {
      const key = JSON.stringify([
        g.material,
        sig(g.thickness),
        g.section ?? null,
        r.mark,
        r.section,
        r.source,
        sig(r.length),
        sig(r.width),
        sig(r.thickness),
        sig(r.unitMass),
        r.supply ?? null,
      ]);
      out[key] = (out[key] ?? 0) + r.quantity;
    }
  }
  return out;
}

/**
 * `parts.dxf:engraving` : toute ligne différente est une coordonnée du repère gravé (abscisse
 * contre abscisse, ordonnée contre ordonnée, à 1e-6 près, nombres écrits à 6 décimales), et
 * les deux repères ont le même dégagement à 1e-6 mm près.
 */
function engravingOnly(a: string, b: string, before: Model, after: Model, ids: readonly string[]) {
  const pa = before.parts.find((p) => p.id === ids[0]);
  const pb = after.parts.find((p) => p.id === ids[0]);
  if (!pa?.flat || !pb?.flat) return false;
  const ea = flatEngravingPoint(pa.flat);
  const eb = flatEngravingPoint(pb.flat);
  if (Math.abs(ea.clearance - eb.clearance) > 1e-6) return false;
  const la = a.split("\n");
  const lb = b.split("\n");
  if (la.length !== lb.length) return false;
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-6;
  return la.every((x, i) => {
    const y = lb[i]!;
    if (x === y) return true;
    const u = Number(x);
    const v = Number(y);
    if (x.trim() === "" || y.trim() === "" || !Number.isFinite(u) || !Number.isFinite(v)) {
      return false;
    }
    return (near(u, ea.at.x) && near(v, eb.at.x)) || (near(u, ea.at.y) && near(v, eb.at.y));
  });
}

const NUMBER = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;

/**
 * Texte égal, nombres à 1e-6 près : seuls les nombres écrits en pleine précision (coordonnées
 * du DXF AC1021, `toString` d'un float64) peuvent porter le bruit d'arrondi des deux chemins ;
 * un nombre arrondi pour l'affichage (SVG, CSV, R12) qui bascule d'un pas est un écart (HALF
 * non admis sur les exemples). Rend la première ligne en écart, ou `null`.
 */
function textGap(a: string, b: string): string | null {
  const la = a.split("\n");
  const lb = b.split("\n");
  if (la.length !== lb.length) return `lignes ${la.length} → ${lb.length}`;
  for (let i = 0; i < la.length; i++) {
    const x = la[i]!;
    const y = lb[i]!;
    if (x === y) continue;
    const nx = x.match(NUMBER) ?? [];
    const ny = y.match(NUMBER) ?? [];
    const same =
      x.replace(NUMBER, "#") === y.replace(NUMBER, "#") &&
      nx.length === ny.length &&
      nx.every((v, k) => Math.abs(Number(v) - Number(ny[k])) <= 1e-6);
    if (!same) return `ligne ${i + 1} : ${x} → ${y}`;
  }
  return null;
}

/** Comparaison récursive, nombres à `tol` près. */
function closeTo(a: unknown, b: unknown, tol: number, path = ""): string[] {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= tol ? [] : [path];
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    if (Array.isArray(a) !== Array.isArray(b)) return [path];
    if (Array.isArray(a) && a.length !== (b as unknown[]).length) return [`${path}.length`];
    return [...keys].flatMap((k) =>
      closeTo(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        tol,
        `${path}.${k}`,
      ),
    );
  }
  return a === b ? [] : [path];
}

describe("bascule de l'hélicoïdal (F10, P2) — parité des exports sur les exemples", () => {
  it.each(HELICAL_EXAMPLES.map((n) => [n] as const))("%s", (name) => {
    const project = parseProjectText(
      readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"),
    );
    const { before: raw, after } = both(project);
    // La commutation a bien pris.
    expect(raw.layout.helicalOrigin).toBeUndefined();
    expect(after.layout.helicalOrigin).toBeDefined();
    const gaps = new Set<string>();
    // ROT180 : développé retourné reconnu, puis remplacé par celui du nouveau chemin.
    const before: Model = {
      ...raw,
      parts: raw.parts.map((p, i) => {
        const q = after.parts[i];
        if (!p.flat || q?.id !== p.id || !q.flat || !flatRotated180(p.flat, q.flat)) return p;
        gaps.add("parts:rot180");
        return { ...p, flat: q.flat };
      }),
    };
    const a = textExports(before, project);
    const b = textExports(after, project);
    expect(Object.keys(b)).toEqual(Object.keys(a));
    const files = new Map(exportPartsDxf(after).map((f) => [f.filename, f.partIds]));
    const differing = Object.keys(a).flatMap((k) => {
      const g = textGap(a[k]!, b[k]!);
      if (g === null) return [];
      if (
        k.startsWith("cutlist.csv") &&
        JSON.stringify(mergedCutRows(before)) === JSON.stringify(mergedCutRows(after))
      ) {
        gaps.add("cutlist:split");
        return [];
      }
      const file = /^parts\.dxf (\S+) ×\d+$/.exec(k)?.[1];
      const ids = file === undefined ? undefined : files.get(file);
      if (ids && engravingOnly(a[k]!, b[k]!, before, after, ids)) {
        gaps.add("parts.dxf:engraving");
        return [];
      }
      return [`${k} : ${g}`];
    });
    expect(differing).toEqual([]);
    // Fiche de débit (données du dossier PDF) : mêmes lignes, nombres à 1e-6 près.
    if (closeTo(cutSheet(before.parts), cutSheet(after.parts), 1e-6).length > 0) {
      expect(mergedSheetRows(after)).toEqual(mergedSheetRows(before));
      gaps.add("cutsheet:split");
    }
    expect([...gaps].sort()).toEqual([...(EXPORT_GAPS[name] ?? [])].sort());
    // glTF : document et accesseurs à 1e-3 mm (float32).
    const ga = readGlb(exportGlb(before, { project }));
    const gb = readGlb(exportGlb(after, { project }));
    expect(closeTo(ga.doc, gb.doc, 1e-3)).toEqual([]);
    expect(gb.accessorData.length).toBe(ga.accessorData.length);
    ga.accessorData.forEach((arr, i) => {
      const other = gb.accessorData[i]!;
      expect(other.length, `accesseur ${i}`).toBe(arr.length);
      let worst = 0;
      for (let k = 0; k < arr.length; k++) worst = Math.max(worst, Math.abs(arr[k]! - other[k]!));
      expect(worst, `accesseur ${i}`).toBeLessThanOrEqual(1e-3);
    });
  });
});
