import fc from "fast-check";
import {
  BalancingSchema,
  ProjectSchema,
  buildModel,
  createProject,
  TreadSpecSchema,
  type StructureContext,
  type StructureKind,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  deriveParamFields,
  enumOptions,
  fieldSchema,
  getParam,
  humanizeKey,
  numberConstraints,
  safeDefaults,
  setParam,
  structureContext,
  validateParams,
  withDefaults,
} from "./structureForm.js";

describe("lecture des schémas zod 4", () => {
  it("listes de choix d'un z.enum enveloppé par .default()", () => {
    expect(enumOptions(fieldSchema(BalancingSchema, "method"))).toEqual(["M0", "M1", "M3"]);
    expect(enumOptions(fieldSchema(TreadSpecSchema, "risers"))).toEqual(["full", "open", "none"]);
    expect(enumOptions(fieldSchema(BalancingSchema, "targetCollet"))).toBeUndefined();
    expect(enumOptions(undefined)).toBeUndefined();
  });

  it("union de littéraux et de nombres : pas une liste de choix", () => {
    expect(enumOptions(fieldSchema(BalancingSchema, "windersPerSide"))).toBeUndefined();
  });

  it("bornes et intégralité d'un nombre", () => {
    const c = numberConstraints(fieldSchema(BalancingSchema, "targetCollet"));
    expect(c.integer).toBe(true);
    expect(numberConstraints(fieldSchema(BalancingSchema, "method"))).toEqual({});
  });

  it(".int() sans borne : pas de bornes implicites ±MAX_SAFE_INTEGER", () => {
    // `rulesVersion` : z.number().int().default(1), sans borne.
    expect(numberConstraints(fieldSchema(ProjectSchema, "rulesVersion"))).toEqual({
      integer: true,
    });
  });
});

describe("champs déduits des défauts", () => {
  it("nombres, listes, booléens, texte, objets imbriqués, valeurs non éditables", () => {
    const fields = deriveParamFields(
      {
        method: "M3",
        targetCollet: 100,
        kFactor: 0.33,
        glued: true,
        note: "x",
        stringer: { width: 300, thickness: 60 },
        list: [1, 2],
      },
      BalancingSchema,
    );
    expect(fields.map((f) => [f.kind, f.path.join(".")])).toEqual([
      ["enum", "method"],
      ["number", "targetCollet"],
      ["number", "kFactor"],
      ["boolean", "glued"],
      ["text", "note"],
      ["number", "stringer.width"],
      ["number", "stringer.thickness"],
      ["readonly", "list"],
    ]);
    const k = fields.find((f) => f.path.join(".") === "kFactor");
    expect(k).toMatchObject({ kind: "number", integer: false, label: "K factor" });
    expect(fields.find((f) => f.path.join(".") === "stringer.width")?.label).toBe(
      "Stringer › width",
    );
  });

  it("défauts absents ou non objets : aucun champ", () => {
    expect(deriveParamFields(undefined, undefined)).toEqual([]);
    expect(deriveParamFields(42, undefined)).toEqual([]);
  });

  it("libellés", () => {
    expect(humanizeKey("stringerWidth")).toBe("Stringer width");
    expect(humanizeKey("max_span")).toBe("Max span");
  });
});

const keyArb = fc.constantFrom("a", "b", "c", "width", "depth");
const pathArb = fc.array(keyArb, { minLength: 1, maxLength: 4 });
const leafArb = fc.oneof(fc.integer(), fc.boolean(), fc.string());
const paramsArb = fc.dictionary(
  keyArb,
  fc.oneof(leafArb, fc.dictionary(keyArb, leafArb, { maxKeys: 3 })),
  { maxKeys: 4 },
);

describe("chemins de paramètres", () => {
  it("setParam puis getParam relit la valeur, sans muter l'original", () => {
    fc.assert(
      fc.property(paramsArb, pathArb, leafArb, (params, path, v) => {
        const before = JSON.stringify(params);
        const next = setParam(params, path, v);
        expect(getParam(next, path)).toEqual(v);
        expect(JSON.stringify(params)).toBe(before);
      }),
    );
  });

  it("withDefaults : valeurs du projet prioritaires, défauts complétés", () => {
    fc.assert(
      fc.property(paramsArb, paramsArb, (defaults, own) => {
        const m = withDefaults(defaults, own);
        for (const [k, v] of Object.entries(own)) {
          if (typeof v !== "object") expect(m[k]).toEqual(v);
        }
        for (const k of Object.keys(defaults)) expect(k in m).toBe(true);
      }),
    );
    expect(withDefaults({ s: { w: 1, t: 2 } }, { s: { w: 5 } })).toEqual({ s: { w: 5, t: 2 } });
    expect(withDefaults(undefined, undefined)).toEqual({});
  });
});

describe("plugin de structure", () => {
  const plugin: StructureKind<{ method: string; targetCollet: number }> = {
    kind: "fake",
    label: "Factice",
    family: "bois",
    paramsSchema: BalancingSchema as never,
    defaults: () => ({ method: "M3", targetCollet: 100 }),
    build: () => ({ parts: [], checks: [], notes: [] }),
  };
  const ctx = {} as StructureContext;

  it("défauts : sans contexte ou si le plugin lève → undefined", () => {
    expect(safeDefaults(plugin, ctx)).toEqual({ method: "M3", targetCollet: 100 });
    expect(safeDefaults(plugin, undefined)).toBeUndefined();
    const throwing = {
      ...plugin,
      defaults: () => {
        throw new Error("x");
      },
    };
    expect(safeDefaults(throwing, ctx)).toBeUndefined();
  });

  it("validation par le schéma du plugin, message avec le chemin", () => {
    expect(validateParams(plugin, { method: "M1", targetCollet: 120 })).toBeNull();
    expect(validateParams(plugin, { method: "M9" })).toMatch(/^method : /);
    expect(validateParams(plugin, { targetCollet: 12.5 })).toMatch(/^targetCollet : /);
  });
});

describe("contexte du plugin de structure", () => {
  const project = createProject("quarter-left");
  const model = buildModel(project);

  it("tracé et découpage calculés : contexte disponible", () => {
    expect(structureContext(project, model)).toMatchObject({
      layout: model.layout,
      stepping: model.stepping,
    });
    expect(structureContext(project, null)).toBeUndefined();
  });

  it("autres erreurs du modèle (ex. rapportées par le plugin) : le formulaire reste disponible", () => {
    const withErrors = { ...model, errors: ["Structure : jour en arc non pris en charge."] };
    expect(structureContext(project, withErrors)).toBeDefined();
  });

  it("tracé ou découpage en échec (modèle partiel) : pas de contexte", () => {
    const bad = { ...project, site: { ...project.site, floorToFloor: 50 } };
    const partial = buildModel(bad);
    expect(partial.errors.length).toBeGreaterThan(0);
    expect(structureContext(bad, partial)).toBeUndefined();
  });
});
