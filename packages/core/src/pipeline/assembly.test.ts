/**
 * Assemblages entre pièces (`Part.assembledWith`, inspecteur Pièce, ADR-0009) : normalisation
 * (`normalizeAssemblies`) et assemblages déclarés par les plugins sur des projets réels.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { textMessage } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Model, Part } from "../model/derived.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { stairArb } from "../stepping/test-helpers.js";
import "../structures/index.js";
import { normalizeAssemblies } from "./assembly.js";
import { buildModel } from "./build.js";

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const examples = readdirSync(EXAMPLES).filter((f) => f.endsWith(".blondel.json"));
const load = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES, file), "utf8"));

const part = (id: string, extra: Partial<Part> = {}): Part => ({
  id,
  mark: id.toUpperCase(),
  category: "support",
  name: textMessage(id),
  material: "steel-painted",
  solid: {
    kind: "extrusion",
    frame: undefined as never,
    profile: { outer: [], holes: [] },
    depth: 1,
  },
  quantities: {},
  ...extra,
});

/** Invariants de la relation : symétrie, ids connus, sans soi ni doublon, ordre du modèle. */
function expectNormalized(m: Pick<Model, "parts">): void {
  const rank = new Map(m.parts.map((p, i) => [p.id, i]));
  const byId = new Map(m.parts.map((p) => [p.id, p]));
  for (const p of m.parts) {
    const list = p.assembledWith;
    if (list === undefined) continue;
    expect(list.length, p.id).toBeGreaterThan(0);
    expect(new Set(list).size, p.id).toBe(list.length);
    expect(list, p.id).not.toContain(p.id);
    const ranks = list.map((id) => rank.get(id));
    expect(
      ranks.every((r) => r !== undefined),
      p.id,
    ).toBe(true);
    expect(
      [...ranks].sort((a, b) => a! - b!),
      p.id,
    ).toEqual(ranks);
    for (const id of list)
      expect(byId.get(id)!.assembledWith ?? [], `${id} ↔ ${p.id}`).toContain(p.id);
  }
}

/** Chaque support est assemblé à une pièce de marche et à une pièce porteuse (limon, poteau). */
function expectSupportsLinked(m: Model): void {
  const byId = new Map(m.parts.map((p) => [p.id, p]));
  for (const s of m.parts.filter((p) => p.id.startsWith("support-"))) {
    expect(s.treadNumber, s.id).toBeUndefined();
    const linked = (s.assembledWith ?? []).map((id) => byId.get(id)!);
    expect(
      linked.some((p) => p.treadNumber !== undefined),
      s.id,
    ).toBe(true);
    expect(
      linked.some((p) => p.category === "stringer" || p.category === "post"),
      s.id,
    ).toBe(true);
  }
}

describe("normalizeAssemblies", () => {
  it("symétrise, résout les numéros de marche, ignore inconnus et auto-références", () => {
    const parts = [
      part("tread-1", { category: "tread", treadNumber: 1 }),
      part("tread-2", { category: "tread", treadNumber: 2 }),
      part("stringer"),
      part("support-a", { assembledWith: ["stringer", "ghost", "support-a"] }),
    ];
    const out = normalizeAssemblies(parts, [
      { a: { partId: "support-a" }, b: { treadNumber: 2 } },
      { a: { partId: "support-a" }, b: { treadNumber: 2 } },
      { a: { partId: "stringer" }, b: { treadNumber: 9 } },
    ]);
    expect(out.map((p) => p.assembledWith)).toEqual([
      undefined,
      ["support-a"],
      ["support-a"],
      ["tread-2", "stringer"],
    ]);
    expectNormalized({ parts: out });
    // Pièces sans assemblage : identité conservée.
    expect(out[0]).toBe(parts[0]);
  });

  it("sans assemblage : tableau d'entrée rendu tel quel ; liste vide retirée", () => {
    const parts = [part("a"), part("b")];
    expect(normalizeAssemblies(parts)).toBe(parts);
    const lonely = [part("a", { assembledWith: ["ghost"] })];
    const out = normalizeAssemblies(lonely);
    expect(out[0]!.assembledWith).toBeUndefined();
    expect("assembledWith" in out[0]!).toBe(false);
    // Déjà normalisé : même tableau.
    const done = normalizeAssemblies(
      [part("a"), part("b")],
      [{ a: { partId: "a" }, b: { partId: "b" } }],
    );
    expect(normalizeAssemblies(done)).toBe(done);
  });
});

describe("Part.assembledWith — exemples", () => {
  it.each(examples)("%s : relation normalisée, supports liés", (file) => {
    const m = buildModel(load(file));
    expectNormalized(m);
    expectSupportsLinked(m);
  });

  it("structures : assemblages attendus par plugin", () => {
    const linkedTo = (m: Model, id: string) =>
      m.parts.find((p) => p.id === id)?.assembledWith ?? [];
    // Bois : limons ↔ marches encastrées, poteau ↔ limons de jour.
    const wood = buildModel(load("j3a-acceptance-01-bois.blondel.json"));
    const stringers = wood.parts.filter((p) => p.category === "stringer");
    expect(stringers.length).toBeGreaterThan(0);
    for (const s of stringers) {
      const treads = linkedTo(wood, s.id).filter((id) =>
        wood.parts.some((p) => p.id === id && p.treadNumber !== undefined),
      );
      expect(treads.length, s.id).toBeGreaterThan(0);
    }
    for (const post of wood.parts.filter((p) => p.category === "post"))
      expect(linkedTo(wood, post.id).length, post.id).toBeGreaterThan(0);
    // Débillardé : tronçons consécutifs assemblés.
    const curved = buildModel(load("j5b-debillarde-soude.blondel.json"));
    const segs = curved.parts.filter((p) => /^stringer-inner-curved-\d+$/.test(p.id));
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i + 1 < segs.length; i++)
      expect(linkedTo(curved, segs[i]!.id)).toContain(segs[i + 1]!.id);
    // Platines ↔ limon ou poteau.
    for (const m of [curved, buildModel(load("j3b-acceptance-01-acier-plat.blondel.json"))]) {
      for (const pl of m.parts.filter((p) => p.id.startsWith("plate-")))
        expect(linkedTo(m, pl.id).length, pl.id).toBeGreaterThan(0);
    }
    // Hélicoïdal à fût : marches assemblées au fût.
    const helical = buildModel(load("j5a-helicoidal.blondel.json"));
    const column = linkedTo(helical, "helical-column");
    expect(column.length).toBe(
      helical.parts.filter((p) => p.treadNumber !== undefined).length +
        (helical.parts.some((p) => p.id === "landing-arrival") ? 1 : 0),
    );
  });

  it("garde-corps sans assemblage déclaré : identité des pièces de structure conservée", () => {
    const p = load("j4-acceptance-01-garde-corps.blondel.json");
    const a = buildModel(p);
    const b = buildModel({ ...p, name: "autre" });
    expect(b.parts).toBe(a.parts);
  });
});

describe("Part.assembledWith — propriétés (structures acier, tracés générés)", () => {
  it("relation symétrique, ids valides ; tout support lié à une marche et à un limon ou poteau", () => {
    fc.assert(
      fc.property(
        stairArb(),
        fc.constantFrom("steel-flat", "steel-profile", "wood-housed"),
        ({ project }, kind) => {
          const p = ProjectSchema.parse({
            ...project,
            stair: { ...project.stair, structure: { kind, params: {} } },
          });
          const m = buildModel(p, { memo: false });
          expectNormalized(m);
          expectSupportsLinked(m);
        },
      ),
      { numRuns: Number(process.env["STEPPING_RUNS"] ?? 30) },
    );
  }, 600_000);
});
