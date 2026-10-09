import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assemblyQuantity, fabricatedParts, rootAssemblyId } from "./components.js";

interface Lite {
  readonly id: string;
  readonly componentOf?: string;
}

/**
 * Lot synthétique d'une poutre en couches empilées (QUESTIONS A36 (9)) : LC1, une couche
 * composée de deux planches, une couche d'une seule planche, une marche autonome.
 */
function nested(): Lite[] {
  return [
    { id: "beam" },
    { id: "tread-1" },
    { id: "layer-1", componentOf: "beam" },
    { id: "layer-1-1", componentOf: "layer-1" },
    { id: "layer-1-2", componentOf: "layer-1" },
    { id: "layer-2", componentOf: "beam" },
  ];
}

describe("fabricatedParts", () => {
  it("sans composante : le lot inchangé (même objet)", () => {
    const parts = [{ id: "a" }, { id: "b" }];
    expect(fabricatedParts(parts)).toBe(parts);
  });

  it("pièce finie faite de composantes : retirée, composantes et autres pièces gardées", () => {
    const parts = [
      { id: "beam" },
      { id: "tread-1" },
      { id: "layer-1", componentOf: "beam" },
      { id: "layer-2", componentOf: "beam" },
    ];
    expect(fabricatedParts(parts).map((p) => p.id)).toEqual(["tread-1", "layer-1", "layer-2"]);
  });

  it("composante d'une pièce absente du lot : rien n'est retiré", () => {
    const parts = [{ id: "a" }, { id: "layer-1", componentOf: "beam" }];
    expect(fabricatedParts(parts).map((p) => p.id)).toEqual(["a", "layer-1"]);
  });

  it("composantes imbriquées (A36 (9)) : LC1 et couche composée exclues, planches et couche simple gardées", () => {
    expect(fabricatedParts(nested()).map((p) => p.id)).toEqual([
      "tread-1",
      "layer-1-1",
      "layer-1-2",
      "layer-2",
    ]);
  });
});

describe("rootAssemblyId", () => {
  it("planche → couche → LC1 ; couche → LC1 ; pièce autonome → elle-même", () => {
    const parts = nested();
    expect(rootAssemblyId(parts, "layer-1-2")).toBe("beam");
    expect(rootAssemblyId(parts, "layer-1")).toBe("beam");
    expect(rootAssemblyId(parts, "layer-2")).toBe("beam");
    expect(rootAssemblyId(parts, "beam")).toBe("beam");
    expect(rootAssemblyId(parts, "tread-1")).toBe("tread-1");
  });

  it("pièce finie absente du lot, identifiant inconnu : on s'arrête sur la pièce", () => {
    const parts = [{ id: "board", componentOf: "layer" }];
    expect(rootAssemblyId(parts, "board")).toBe("board");
    expect(rootAssemblyId(parts, "inconnue")).toBe("inconnue");
  });

  it("boucle (lot incohérent) : termine sur la dernière pièce visitée", () => {
    const parts = [
      { id: "a", componentOf: "b" },
      { id: "b", componentOf: "c" },
      { id: "c", componentOf: "a" },
    ];
    expect(rootAssemblyId(parts, "a")).toBe("c");
    expect(rootAssemblyId(parts, "b")).toBe("a");
    expect(rootAssemblyId([{ id: "x", componentOf: "x" }], "x")).toBe("x");
  });
});

/**
 * Forêt de composantes générée : la pièce i a pour pièce finie une pièce j < i (ou aucune),
 * puis le lot est mélangé. Arbres de profondeur quelconque (poutre, couches, planches…).
 */
const forest = fc
  .integer({ min: 1, max: 24 })
  .chain((n) =>
    fc.tuple(
      fc.tuple(
        ...Array.from({ length: n }, (_, i) =>
          i === 0 ? fc.constant(-1) : fc.integer({ min: -1, max: i - 1 }),
        ),
      ),
      fc.array(fc.nat(), { minLength: n, maxLength: n }),
      fc.array(fc.integer({ min: 1, max: 100 }), { minLength: n, maxLength: n }),
    ),
  )
  .map(([parents, order, qty]) => {
    const parts: (Lite & { qty: number })[] = parents.map((parent, i) => ({
      id: `p${i}`,
      ...(parent < 0 ? {} : { componentOf: `p${parent}` }),
      qty: qty[i]!,
    }));
    const keyed = parts.map((p, i) => ({ p, k: order[i]! }));
    keyed.sort((a, b) => a.k - b.k);
    return keyed.map((e) => e.p);
  });

describe("propriétés sur des arbres de composantes", () => {
  it("fabriquées = feuilles ; racine = ancêtre sans pièce finie ; aucun double compte", () => {
    fc.assert(
      fc.property(forest, (parts) => {
        const ids = new Set(parts.map((p) => p.id));
        const hasChildren = new Set(parts.flatMap((p) => (p.componentOf ? [p.componentOf] : [])));
        const fab = fabricatedParts(parts);
        // Fabriquées : exactement les pièces sans composante dans le lot, dans l'ordre du lot.
        expect(fab.map((p) => p.id)).toEqual(
          parts.filter((p) => !hasChildren.has(p.id)).map((p) => p.id),
        );
        const fabIds = new Set(fab.map((p) => p.id));
        const byId = new Map(parts.map((p) => [p.id, p]));
        // Racines : pièces dessinées (sans pièce finie) ; chaque pièce en a exactement une.
        const roots = new Set(parts.filter((p) => p.componentOf === undefined).map((p) => p.id));
        for (const p of parts) {
          const root = rootAssemblyId(parts, p.id);
          expect(ids.has(root)).toBe(true);
          expect(roots.has(root)).toBe(true);
          // Aucun ancêtre d'une pièce fabriquée n'est fabriqué (aucun double compte).
          let up = p.componentOf;
          const chain: string[] = [];
          while (up !== undefined) {
            chain.push(up);
            if (fabIds.has(p.id)) expect(fabIds.has(up)).toBe(false);
            up = byId.get(up)?.componentOf;
          }
          expect(chain.length === 0 ? p.id : chain[chain.length - 1]).toBe(root);
        }
        // Grandeurs portées par les seules feuilles : la somme sur les pièces fabriquées est
        // la somme, racine par racine, des feuilles de chaque arbre (chaque feuille une fois).
        const perRoot = new Map<string, number>();
        for (const p of fab) {
          const r = rootAssemblyId(parts, p.id);
          perRoot.set(r, (perRoot.get(r) ?? 0) + p.qty);
        }
        const total = fab.reduce((s, p) => s + p.qty, 0);
        expect([...perRoot.values()].reduce((s, q) => s + q, 0)).toBe(total);
        expect([...perRoot.keys()].every((r) => roots.has(r))).toBe(true);
        // Toute racine a au moins une pièce fabriquée (elle-même ou une feuille).
        expect(perRoot.size).toBe(roots.size);
      }),
      { numRuns: 200 },
    );
  });
});

describe("assemblyQuantity", () => {
  const lot: readonly {
    readonly id: string;
    readonly componentOf?: string;
    readonly quantities: Readonly<Record<string, number>>;
  }[] = [
    { id: "beam", quantities: {} },
    { id: "tread-1", quantities: { mass_kg: 4 } },
    { id: "layer-1", componentOf: "beam", quantities: {} },
    { id: "layer-1-1", componentOf: "layer-1", quantities: { mass_kg: 1.5 } },
    { id: "layer-1-2", componentOf: "layer-1", quantities: { mass_kg: 2 } },
    { id: "layer-2", componentOf: "beam", quantities: { mass_kg: 3 } },
  ];

  it("somme des feuilles, composantes imbriquées (planche → couche → poutre)", () => {
    expect(assemblyQuantity(lot, "beam", "mass_kg")).toBe(6.5);
    expect(assemblyQuantity(lot, "layer-1", "mass_kg")).toBe(3.5);
    expect(assemblyQuantity(lot, "tread-1", "mass_kg")).toBe(4);
  });

  it("feuille sans la grandeur, pièce absente ou boucle : undefined", () => {
    expect(assemblyQuantity(lot, "beam", "volume_m3")).toBeUndefined();
    expect(assemblyQuantity(lot, "absent", "mass_kg")).toBeUndefined();
    const loop = [
      { id: "a", componentOf: "b", quantities: { mass_kg: 1 } },
      { id: "b", componentOf: "a", quantities: { mass_kg: 1 } },
    ];
    expect(assemblyQuantity(loop, "a", "mass_kg")).toBeUndefined();
  });
});
