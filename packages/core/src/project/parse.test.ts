import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION } from "../model/project.js";
import { ProjectParseError } from "./errors.js";
import { migrateProjectJson, PROJECT_MIGRATIONS, type Migration } from "./migrations.js";
import { parseProject, parseProjectText } from "./parse.js";
import { PRESET_NOSING } from "./presets.js";
import { serializeProject } from "./serialize.js";

const minimal = () => ({
  schemaVersion: 1,
  site: { floorToFloor: 2700, upperSlabThickness: 200 },
  stair: {
    placement: { origin: { x: 0, y: 0 } },
    layout: { width: 900, legs: [{ length: "auto" }], turns: [] },
  },
});

function parseError(fn: () => unknown): ProjectParseError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProjectParseError) return e;
    throw e;
  }
  throw new Error("aucune erreur levée");
}

describe("débord de nez par défaut (QUESTIONS A9)", () => {
  it("10 mm quand le champ est absent", () => {
    expect(parseProject(minimal()).stair.treads.nosing).toBe(10);
  });

  it("défaut du schéma = valeur recommandée de DEBORD_NEZ_LOGEMENT (celle des préréglages)", () => {
    expect(parseProject(minimal()).stair.treads.nosing).toBe(PRESET_NOSING);
  });

  it("un projet enregistré porte toujours `treads.nosing` : pas de changement silencieux", () => {
    // `serializeProject` écrit le projet complet (défauts appliqués) : l'ancien défaut (30 mm)
    // d'un projet enregistré est donc relu tel quel, sans migration.
    const legacy = parseProject({
      ...minimal(),
      stair: { ...minimal().stair, treads: { nosing: 30 } },
    });
    const text = serializeProject(legacy);
    expect(JSON.parse(text).stair.treads.nosing).toBe(30);
    expect(parseProjectText(text).stair.treads.nosing).toBe(30);
    expect(JSON.parse(serializeProject(parseProject(minimal()))).stair.treads.nosing).toBe(10);
  });
});

describe("parseProject", () => {
  it("complète les valeurs par défaut (y compris les objets par défaut via prefault)", () => {
    const p = parseProject(minimal());
    expect(p.name).toBe("Sans titre");
    expect(p.stair.stepping).toEqual({
      riserCount: "auto",
      targetRise: 175,
      targetGoing: "auto",
      firstRiseOffset: 0,
    });
    expect(p.stair.balancing.method).toBe("M3");
    expect(p.stair.treads.thickness).toBe(40);
    expect(p.stair.structure).toEqual({ kind: "none", params: {} });
    expect(p.compliance.contexts).toEqual(["bois_dtu", "logement_interieur"]);
    expect(p.site.walls).toEqual([]);
    expect(p.stair.placement.rotation).toBe(0);
  });

  it("retire les champs inconnus", () => {
    const p = parseProject({ ...minimal(), extra: 42 });
    expect("extra" in p).toBe(false);
  });

  it("ne modifie pas l'entrée", () => {
    const json = minimal();
    const copy = structuredClone(json);
    parseProject(json);
    expect(json).toEqual(copy);
  });

  it("produit des erreurs lisibles en français, localisées par chemin", () => {
    const json = minimal() as Record<string, unknown>;
    json["site"] = { floorToFloor: -5, upperSlabThickness: 200.5 };
    (json["stair"] as { layout: { legs: unknown[] } }).layout.legs = [{ length: "long" }];
    const err = parseError(() => parseProject(json));
    expect(err.message.startsWith("Projet invalide :")).toBe(true);
    const paths = err.issues.map((i) => i.path);
    expect(paths).toContain("site.floorToFloor (hauteur à monter)");
    expect(paths).toContain("site.upperSlabThickness (épaisseur du plancher haut)");
    expect(paths.some((p) => p.startsWith("stair.layout.legs[0].length"))).toBe(true);
    const floor = err.issues.find((i) => i.path.startsWith("site.floorToFloor"));
    expect(floor?.message).toMatch(/trop petit|attendu/i);
    expect(err.message).toContain("- site.floorToFloor (hauteur à monter) : ");
  });

  it("explique une valeur de discriminant inconnue", () => {
    const json = minimal() as { site: Record<string, unknown> };
    json.site["opening"] = { kind: "circle", radius: 3 };
    const err = parseError(() => parseProject(json));
    const issue = err.issues.find((i) => i.path.startsWith("site.opening"));
    expect(issue?.message).toBe('valeur de « kind » inconnue (attendu : "rect", "polygon")');
  });

  it("refuse une racine qui n'est pas un objet", () => {
    for (const bad of [null, 3, "x", [1]]) {
      expect(parseError(() => parseProject(bad)).message).toContain("un objet JSON est attendu");
    }
  });

  it("refuse l'absence ou l'invalidité de schemaVersion", () => {
    const { schemaVersion: _omit, ...rest } = minimal();
    expect(parseError(() => parseProject(rest)).message).toContain(
      "« schemaVersion » (version du format) est absent",
    );
    expect(parseError(() => parseProject({ ...rest, schemaVersion: "1" })).message).toContain(
      "entier positif",
    );
    expect(parseError(() => parseProject({ ...rest, schemaVersion: 1.5 })).message).toContain(
      "entier positif",
    );
  });

  it("refuse un format plus récent que le logiciel", () => {
    const err = parseError(() =>
      parseProject({ ...minimal(), schemaVersion: PROJECT_SCHEMA_VERSION + 1 }),
    );
    expect(err.message).toContain("plus récent");
  });

  it("signale une migration manquante", () => {
    const err = parseError(() => parseProject({ ...minimal(), schemaVersion: 0 }));
    expect(err.message).toContain("Aucune migration disponible du format 0 vers le format 1");
  });
});

describe("migrations", () => {
  it("le registre est vide en version 1", () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(1);
    expect(PROJECT_MIGRATIONS).toEqual([]);
  });

  /** Migration factice : le format 0 nommait l'emmarchement `emmarchement`. */
  const fake0to1: Migration = {
    from: 0,
    description: "renommage de emmarchement en width",
    migrate(json) {
      const layout = (json["stair"] as { layout?: Record<string, unknown> } | undefined)?.layout;
      if (layout !== undefined && "emmarchement" in layout) {
        layout["width"] = layout["emmarchement"];
        delete layout["emmarchement"];
      }
      return json;
    },
  };

  it("applique une migration factice avant la validation, sans modifier l'entrée", () => {
    const v0 = minimal() as { schemaVersion: number; stair: { layout: Record<string, unknown> } };
    v0.schemaVersion = 0;
    v0.stair.layout["emmarchement"] = 850;
    delete v0.stair.layout["width"];
    const before = structuredClone(v0);
    const p = parseProject(v0, { migrations: [fake0to1] });
    expect(p.schemaVersion).toBe(1);
    expect(p.stair.layout.width).toBe(850);
    expect(v0).toEqual(before);
  });

  it("chaîne les migrations dans l'ordre des versions, quel que soit l'ordre du registre", () => {
    const log: number[] = [];
    const step = (from: number): Migration => ({
      from,
      description: `étape ${from}`,
      migrate: (json) => {
        log.push(from);
        return { ...json, [`v${from}`]: true };
      },
    });
    const out = migrateProjectJson({ schemaVersion: 1 }, [step(3), step(1), step(2)], 4);
    expect(log).toEqual([1, 2, 3]);
    expect(out).toEqual({ schemaVersion: 4, v1: true, v2: true, v3: true });
  });

  it("impose schemaVersion = from + 1 même si la migration l'oublie", () => {
    const out = migrateProjectJson(
      { schemaVersion: 1 },
      [{ from: 1, description: "rien", migrate: (j) => ({ ...j, schemaVersion: 99 }) }],
      2,
    );
    expect(out["schemaVersion"]).toBe(2);
  });

  it("encapsule l'échec d'une migration dans une erreur lisible", () => {
    const boom: Migration = {
      from: 1,
      description: "casse",
      migrate: () => {
        throw new Error("champ introuvable");
      },
    };
    expect(parseError(() => migrateProjectJson({ schemaVersion: 1 }, [boom], 2)).message).toBe(
      "Échec de la migration du format 1 vers 2 (casse) : champ introuvable",
    );
    const notObject: Migration = { from: 1, description: "mauvaise", migrate: () => [] as never };
    expect(
      parseError(() => migrateProjectJson({ schemaVersion: 1 }, [notObject], 2)).message,
    ).toContain("n'a pas produit un objet JSON");
  });
});

describe("parseProjectText", () => {
  it("lit un texte JSON", () => {
    expect(parseProjectText(JSON.stringify(minimal())).site.floorToFloor).toBe(2700);
  });

  it("signale un JSON mal formé", () => {
    expect(parseError(() => parseProjectText("{ pas du json")).message).toContain("JSON mal formé");
  });
});

describe("parseProject — entrées non JSON", () => {
  it("refuse un objet non sérialisable par une ProjectParseError", () => {
    const json = { ...minimal(), name: () => "x" };
    expect(() => parseProject(json)).toThrow(ProjectParseError);
  });

  it("accepte schemaVersion 0 comme version (migration manquante) et signale « positif ou nul »", () => {
    expect(() => parseProject({ ...minimal(), schemaVersion: 0 })).toThrow(/Aucune migration/);
    expect(() => parseProject({ ...minimal(), schemaVersion: -1 })).toThrow(/positif ou nul/);
  });
});

describe("parseProject — isolation", () => {
  it("deux projets lus ne partagent aucun objet (valeurs par défaut comprises)", () => {
    const a = parseProject(minimal());
    const b = parseProject(minimal());
    expect(a.stair.structure.params).not.toBe(b.stair.structure.params);
    (a.stair.structure.params as Record<string, unknown>)["x"] = 1;
    expect(b.stair.structure.params).toEqual({});
    expect(parseProject(minimal()).stair.structure.params).toEqual({});
  });
});
