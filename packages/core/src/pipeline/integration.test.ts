/**
 * Interactions entre étapes du pipeline (intégration de la vague D : jalons 3b, 3c, 4 et
 * balancement corrigé), sur `examples/j4-demi-tournant-acier-garde-corps.blondel.json` :
 * demi-tournant balancé à deux poteaux d'angle, limons en plat acier, marches en tôle pliée en
 * Z, garde-corps barreaudé. Vérifie que chaque étape consomme bien le résultat des autres
 * (découpage → structure → garde-corps → contrôle) et que la mémoïsation par étape reste juste.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { Model } from "../model/derived.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import "../structures/index.js";
import { buildModel, clearModelCache, modelCacheStats } from "./build.js";

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const load = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES, file), "utf8"));

const HALF_TURN = "j4-demi-tournant-acier-garde-corps.blondel.json";

/**
 * Projet modifié en gardant l'identité des sous-arbres inchangés (comme le partage structurel
 * de l'application web) : le sous-arbre changé est validé à part.
 */
function patched(p: Project, change: Partial<Project>): Project {
  const parsed = ProjectSchema.parse({ ...p, ...change });
  const out: Record<string, unknown> = { ...p };
  for (const k of Object.keys(change)) out[k] = parsed[k as keyof Project];
  return out as unknown as Project;
}

const byCategory = (m: Model, c: string) => m.parts.filter((p) => p.category === c);
const violations = (m: Model, severity: string) =>
  m.compliance.results.filter((r) => r.status === "violation" && r.severity === severity);

beforeEach(() => clearModelCache());

describe("intégration : demi-tournant balancé, acier, tôle pliée, garde-corps", () => {
  it("modèle complet sans erreur ni violation bloquante", () => {
    const m = buildModel(load(HALF_TURN));
    expect(m.errors).toEqual([]);
    expect(violations(m, "bloquant")).toEqual([]);
  });

  it("balancement : zone(s) retenue(s), collets > 0 sur toutes les marches balancées", () => {
    const m = buildModel(load(HALF_TURN));
    // Demi-tournant : une zone unique de 180° peut couvrir les deux coins (K3 par coin : point
    // en suspens du ledger).
    expect(m.stepping.balancedZones.length).toBeGreaterThan(0);
    const winders = m.stepping.treads.filter((t) => t.kind !== "straight");
    expect(winders.length).toBeGreaterThan(0);
    // Poteaux d'angle de 100 mm : aucun collet nul (jour vif interdit).
    for (const t of winders) expect(t.colletArc, `M${t.number}`).toBeGreaterThan(0);
  });

  it("structure métal : pièces sur le découpage réel, contremarches bois supprimées, EXC", () => {
    const m = buildModel(load(HALF_TURN));
    const treads = byCategory(m, "tread");
    expect(treads.map((p) => p.id)).toEqual(m.stepping.treads.map((t) => `tread-${t.number}`));
    // Marches en tôle pliée Z (la contremarche est pliée dans la pièce) : aucune contremarche.
    expect(byCategory(m, "riser")).toEqual([]);
    for (const t of treads) {
      expect(t.material, t.id).toBe("steel-painted");
      expect(
        t.flat?.lines.filter((l) => l.kind === "bend"),
        t.id,
      ).toHaveLength(2);
    }
    // Deux volées par tournant : limons de jour et muraux, deux poteaux d'angle.
    const stringers = byCategory(m, "stringer").map((p) => p.mark);
    expect([...stringers].sort()).toEqual(["LE1", "LE2", "LE3", "LI1", "LI2", "LI3"]);
    const newels = byCategory(m, "post").filter((p) => !p.id.startsWith("guard-"));
    expect(newels.map((p) => p.mark).sort()).toEqual(["PT1", "PT2"]);
    // Classe d'exécution reportée par le pipeline, cohérente avec la ligne du contrôle.
    expect(m.executionClass).toBe("EXC1");
    const exc = m.compliance.results.find((r) => r.ruleId === "EXC_CLASSE_EXECUTION");
    expect(exc?.message).toContain("EXC1");
  });

  it("garde-corps : côté jour et côté extérieur, sur les hauteurs du découpage", () => {
    const m = buildModel(load(HALF_TURN));
    const guards = m.parts.filter((p) => p.id.startsWith("guard-"));
    expect(guards.some((p) => p.id.startsWith("guard-inner"))).toBe(true);
    expect(guards.some((p) => p.category === "baluster")).toBe(true);
    expect(guards.some((p) => p.category === "handrail")).toBe(true);
    for (const p of guards) expect(p.mark, p.id).toMatch(/^(PG|BA|MC)\d+$/);
    // Trémie du préréglage élargie du jeu latéral (`openingClearance`, 100 mm à valider) le long
    // des bords de l'escalier : aucun rampant ne traverse la dalle haute.
    const clash = m.compliance.results.filter((r) => r.ruleId === "GC_CONFLIT_DALLE");
    expect(clash).toEqual([]);
  });

  it("mémoïsation : changer les garde-corps ne recalcule ni découpage ni structure", () => {
    const p = load(HALF_TURN);
    const first = buildModel(p);
    const before = modelCacheStats();
    const q = patched(p, { guards: { infill: { kind: "rails", count: 8 } } } as Partial<Project>);
    const second = buildModel(q);
    const after = modelCacheStats();
    expect(after.stepping.hits).toBe(before.stepping.hits + 1);
    expect(after.structure.hits).toBe(before.structure.hits + 1);
    expect(after.guards.misses).toBe(before.guards.misses + 1);
    // Mêmes pièces de structure (identité), garde-corps différents.
    const structural = (m: Model) => m.parts.filter((x) => !x.id.startsWith("guard-"));
    expect(structural(second)).toEqual(structural(first));
    expect(second.parts.some((x) => x.name === "Lisse")).toBe(true);
    expect(second.executionClass).toBe("EXC1");
  });

  it("mémoïsation : changer la structure ne recalcule pas les garde-corps", () => {
    const p = load(HALF_TURN);
    buildModel(p);
    const before = modelCacheStats();
    const q = { ...p, stair: { ...p.stair, structure: { kind: "steel-flat", params: {} } } };
    const m = buildModel(q);
    const after = modelCacheStats();
    expect(after.guards.hits).toBe(before.guards.hits + 1);
    expect(after.structure.misses).toBe(before.structure.misses + 1);
    // Marches bois : les contremarches de base reviennent, plus de marche en acier.
    expect(byCategory(m, "riser")).toHaveLength(m.stepping.riserCount);
    expect(byCategory(m, "tread").every((t) => t.material.startsWith("wood-"))).toBe(true);
  });

  it("structure bois (sans métal) : pas de classe d'exécution", () => {
    const m = buildModel(load("j3a-acceptance-01-bois.blondel.json"));
    expect(m.executionClass).toBeUndefined();
  });
});
