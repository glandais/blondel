/**
 * Marches dansantes sur un tronçon à axe en arc (décision F10 (1), `stepping/treads.ts`) : effet
 * **borné** sur les cages saisies à axe en arc. Le `Model` calculé par le pipeline est comparé,
 * à l'égalité exacte, à celui d'un pipeline dont le classement des marches suit l'ancienne règle
 * (marches d'un axe en arc `straight`, sauf zone balancée, nez réorienté ou tournant balancé).
 *
 * Commutation : `vi.mock` de `stepping/treads.js` (premier usage de `vi.mock` dans le dépôt),
 * `buildTreads` enveloppé : avec le drapeau levé, il rend les marches du calcul courant avec la
 * nature calculée sur un tracé dont les tronçons en arc sont déclarés droits (seul `buildTreads`
 * lit `LayoutSection.kind` pour la nature ; aucun autre champ de la marche n'en dépend). Les
 * deux `buildModel` sont appelés avec `memo: false`, pour qu'aucun cache ne mélange les chemins.
 *
 * Seuls peuvent changer : la nature des marches recouvrant l'arc ; le contrôle de conception
 * (contexte `tournant` activé ; règles des marches balancées ajoutées : G_TOL_BALANCEE,
 * G_COLLET_MIN, G_COLLET_MONOTONE, G_BALANCE_VS_DROITE, toutes conformes sur les trois
 * exemples ; étiquette « marche balancée » de la marche citée par G_MIN_DTU et G_MIN_LOGEMENT ;
 * population de G_TOL_DROITE réduite aux marches droites) et le collet minimal des chiffres
 * clés. Statuts, gravités et synthèse du contrôle inchangés. Tracé, nez, contours, pièces,
 * échappée, garde-corps restent identiques (égalité exacte).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Layout } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { GEOM_EPS } from "../geom2d/tolerance.js";
import { compareValues, gapPaths, type Gaps } from "../layout/cage/helical-parity-helpers.js";
import { buildModel } from "./build.js";

const flags = vi.hoisted(() => ({ legacy: false }));

vi.mock("../stepping/treads.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../stepping/treads.js")>();
  return {
    ...mod,
    buildTreads: (ctx: Parameters<typeof mod.buildTreads>[0]) => {
      const treads = mod.buildTreads(ctx);
      if (!flags.legacy || !ctx.layout.sections) return treads;
      const layout: Layout = {
        ...ctx.layout,
        sections: ctx.layout.sections.map((s) => ({ ...s, kind: "straight" as const })),
      };
      const legacy = mod.buildTreads({ ...ctx, layout });
      return treads.map((t, i) => ({ ...t, kind: legacy[i]!.kind }));
    },
  };
});

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const loadExample = (name: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"));

function both(project: Project) {
  flags.legacy = true;
  const before = buildModel(project, { memo: false });
  flags.legacy = false;
  const after = buildModel(project, { memo: false });
  return { before, after };
}

/** Chemins (normalisés) admis en écart : nature des marches, contrôle, collet minimal. */
const ALLOWED = /^(stepping\.treads\[\*\]\.kind|compliance\.|figures\.minCollet)/;

describe("marches dansantes sur axe en arc (décision F10 (1)) — effet borné", () => {
  it.each([
    ["cage-arc", "w".repeat(14), "s".repeat(14)],
    ["cage-arc-palier-cintre", "sssssslwwwwwww", "sssssslsssssss"],
    ["demo-cage-arc-glass", "wwwwwwwlssssss", "ssssssslssssss"],
  ])("%s", (name, expectedAfter, expectedBefore) => {
    const { before, after } = both(loadExample(name));
    const kinds = (m: typeof after) => m.stepping.treads.map((t) => t.kind[0]).join("");
    expect(kinds(before)).toBe(expectedBefore);
    expect(kinds(after)).toBe(expectedAfter);
    // Marches devenues dansantes = exactement celles qui recouvrent un tronçon en arc.
    const arcs = (after.layout.sections ?? []).filter((s) => s.kind === "arc");
    expect(arcs.length).toBeGreaterThan(0);
    after.stepping.treads.forEach((t, k) => {
      const a = after.stepping.nosings[k]!;
      const b = after.stepping.nosings[k + 1]!;
      const onArc = arcs.some((s) => a.s < s.sEnd - GEOM_EPS && b.s > s.sStart + GEOM_EPS);
      const changed = before.stepping.treads[k]!.kind !== t.kind;
      expect(changed, `marche ${t.number}`).toBe(onArc && t.kind !== "landing");
    });
    // Tout le reste du Model est identique, à l'égalité exacte.
    const gaps: Gaps = new Map();
    compareValues(before, after, "", gaps, new Set(), "", true);
    const paths = gapPaths(gaps);
    expect(paths.filter((p) => !ALLOWED.test(p))).toEqual([]);
    expect(paths).toEqual([
      "compliance.contexts.length",
      "compliance.notes[*].params.contexts",
      "compliance.results.length",
      "figures.minCollet:extra",
      "stepping.treads[*].kind",
    ]);
    // Contrôle de conception : contexte `tournant` ajouté (activé par les marches dansantes),
    // les autres contextes inchangés.
    expect(before.compliance.contexts).not.toContain("tournant");
    expect(after.compliance.contexts).toContain("tournant");
    expect(after.compliance.contexts.filter((c) => c !== "tournant")).toEqual(
      before.compliance.contexts,
    );
    // Résultats : ceux d'avant, identiques et dans le même ordre, plus les règles des marches
    // balancées, toutes conformes sur ces trois exemples.
    const ids = new Set(before.compliance.results.map((r) => r.ruleId));
    const added = after.compliance.results.filter((r) => !ids.has(r.ruleId));
    const kept = after.compliance.results.filter((r) => ids.has(r.ruleId));
    // Statut, gravité, bornes, emplacement, sources : identiques pour toutes les règles.
    const g: Gaps = new Map();
    const skip = new Set(["results[*].message", "results[*].measured"]);
    compareValues(before.compliance.results, kept, "results", g, skip, "", true);
    expect(gapPaths(g)).toEqual([]);
    // Messages et mesures : seuls changent l'étiquette de la marche citée (« marche balancée »)
    // des règles de giron, et la population de la tolérance des marches droites (G_TOL_DROITE :
    // les marches de l'arc n'y sont plus, plus aucune marche droite pour `cage-arc`).
    const straight = after.stepping.treads.filter((t) => t.kind === "straight").length;
    const changed: string[] = [];
    kept.forEach((r, i) => {
      const b = before.compliance.results[i]!;
      if (JSON.stringify(b) === JSON.stringify(r)) return;
      changed.push(r.ruleId);
      if (r.ruleId === "G_TOL_DROITE") {
        if (straight === 0) {
          expect(r.message).toEqual({ key: "rules.G_TOL_DROITE.none" });
          expect(r.measured).toBeUndefined();
        } else {
          const params = (r.message as { params: Record<string, unknown> }).params;
          expect(params.count).toMatchObject({ num: straight });
          expect(r.measured).toBe(b.measured);
        }
        return;
      }
      // Giron sur Γ : même mesure, même message, à l'étiquette de la marche citée près.
      const relabel = JSON.stringify(b.message).replace(
        '"key":"compliance.item.tread"',
        '"key":"compliance.item.winderTread"',
      );
      expect(JSON.stringify(r.message), r.ruleId).toBe(relabel);
      expect(r.measured, r.ruleId).toBe(b.measured);
    });
    expect(changed).toEqual(["G_MIN_DTU", "G_TOL_DROITE", "G_MIN_LOGEMENT"]);
    expect(added.map((r) => [r.ruleId, r.status])).toEqual([
      ["G_TOL_BALANCEE", "ok"],
      ["G_COLLET_MIN", "ok"],
      ["G_COLLET_MONOTONE", "ok"],
      ["G_BALANCE_VS_DROITE", "ok"],
    ]);
    expect(after.compliance.summary).toEqual(before.compliance.summary);
    // Collet minimal des chiffres clés : celui des marches de l'arc.
    const winders = after.stepping.treads.filter((t) => t.kind === "winder");
    expect(after.figures?.minCollet).toBe(Math.min(...winders.map((t) => t.colletChord)));
  });
});
