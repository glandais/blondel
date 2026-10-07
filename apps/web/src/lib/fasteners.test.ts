/**
 * Visserie dans l'interface (QUESTIONS A27) : lignes affichées et filtre, réglages du profil
 * d'atelier qui s'appliquent au modèle (assemblages présents, diamètre lu sur les perçages, jeu
 * de perçage, entraxe des supports), valeur effective (défauts « à valider » compris).
 */
import {
  DEFAULT_FASTENER_PROFILE,
  buildModel,
  createProject,
  fastenerKindLabel,
  msg,
  type Fastener,
  type Model,
  type Project,
} from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import {
  BRACKET_SPACING_PATH,
  HOLE_CLEARANCE_PATH,
  NOMINAL_DIAMETERS_PATH,
  UNKNOWN_WALL_PATH,
  fastenerRows,
  formatNominalDiameters,
  parseNominalDiameters,
  fastenerSettingOf,
  fastenerSettingPath,
  fastenerSettingPaths,
  fastenerSettingValue,
  fastenerSettingsInModel,
  matchesFastenerFilter,
} from "./fasteners.js";

const FR = translatorFor("fr");
const EN = translatorFor("en");

const project = createProject("straight");
const model = buildModel(project);
const [p0, p1] = model.parts;

function fastener(o: Partial<Fastener> & Pick<Fastener, "id" | "mark">): Fastener {
  return {
    kind: "anchor",
    grade: "zinc-plated",
    diameter: 12,
    length: 100,
    quantity: 4,
    joint: "plateFloor",
    name: fastenerKindLabel(o.kind ?? "anchor"),
    origin: msg("fastener.joint.plateFloor"),
    partIds: [p0!.id],
    deduced: ["diameter", "quantity"],
    ...o,
  };
}

/** Modèle réel complété d'une visserie de test (le calcul du cœur n'est pas requis). */
const withFasteners = (fasteners: readonly Fastener[]): Model => ({ ...model, fasteners });

const fixture = withFasteners([
  fastener({ id: "a", mark: "VS1" }),
  fastener({
    id: "b",
    mark: "VS2",
    kind: "wood-screw",
    joint: "treadScrewed",
    diameter: 6,
    length: 30,
    quantity: 8,
    partIds: [p0!.id, p1!.id],
    deduced: ["quantity"],
  }),
  fastener({ id: "c", mark: "VS1", joint: "plateFloor", partIds: [p1!.id] }),
]);

describe("lignes de visserie", () => {
  it("une ligne par repère, textes dans la langue, rien sans visserie", () => {
    const rows = fastenerRows(fixture, FR);
    expect(rows.map((r) => [r.mark, r.quantity])).toEqual([
      ["VS1", 8],
      ["VS2", 8],
    ]);
    expect(rows[0]!.name).toBe("Cheville mécanique");
    expect(fastenerRows(fixture, EN)[0]!.name).toBe("Expansion anchor");
    expect(fastenerRows(model, FR)).toEqual([]);
  });

  it("filtre : repère, désignation, nature, classe ; sans casse ni accents", () => {
    const [vs1, vs2] = fastenerRows(fixture, FR);
    expect(matchesFastenerFilter(vs1!, "")).toBe(true);
    expect(matchesFastenerFilter(vs1!, "vs1")).toBe(true);
    expect(matchesFastenerFilter(vs1!, "CHEVILLE")).toBe(true);
    expect(matchesFastenerFilter(vs1!, "zingue")).toBe(true);
    expect(matchesFastenerFilter(vs2!, "cheville")).toBe(false);
    expect(matchesFastenerFilter(vs2!, "vis a bois")).toBe(true);
  });
});

describe("réglages de visserie du profil d'atelier", () => {
  it("aucun réglage sans visserie", () => {
    expect(fastenerSettingsInModel(model)).toEqual({
      joints: [],
      holeClearance: false,
      bracketSpacing: false,
      unknownWall: false,
    });
    expect(fastenerSettingsInModel(null).joints).toEqual([]);
    expect(fastenerSettingPaths(model)).toEqual([]);
  });

  it("assemblages présents (ordre du cœur) ; diamètre seulement sans perçage dimensionné", () => {
    const s = fastenerSettingsInModel(fixture);
    expect(s.joints.map((j) => j.joint)).toEqual(["plateFloor", "treadScrewed"]);
    expect(s.joints[0]!.fields).toEqual(["kind", "grade", "length", "perPoint"]);
    expect(s.joints[1]!.fields).toEqual(["kind", "grade", "diameter", "length", "perPoint"]);
    expect(s.holeClearance).toBe(true);
    expect(s.bracketSpacing).toBe(false);
    expect(fastenerSettingPaths(fixture).slice(0, 2)).toEqual([
      HOLE_CLEARANCE_PATH,
      NOMINAL_DIAMETERS_PATH,
    ]);
    expect(fastenerSettingPaths(fixture)).toContainEqual([
      "workshop",
      "fasteners",
      "joints",
      "treadScrewed",
      "diameter",
    ]);
  });

  it("boulons traversants du limon central bois : longueur déduite, réglage de longueur masqué", () => {
    const bolt = (id: string, deduced: Fastener["deduced"], length = 290) =>
      fastener({
        id,
        mark: `VS-${id}`,
        kind: "bolt",
        grade: "8.8",
        diameter: 10,
        length,
        joint: "treadBeamBolted",
        deduced,
      });
    const deduced = withFasteners([
      bolt("a", ["diameter", "quantity", "length"]),
      bolt("b", ["diameter", "quantity", "length"], 300),
      fastener({
        id: "s",
        mark: "VS-s",
        kind: "bolt",
        grade: "8.8",
        joint: "shoeBolted",
        deduced: ["diameter", "quantity", "length"],
      }),
    ]);
    const s = fastenerSettingsInModel(deduced);
    expect(s.joints.map((j) => j.joint)).toEqual(["treadBeamBolted", "shoeBolted"]);
    for (const j of s.joints) expect(j.fields).toEqual(["kind", "grade", "perPoint"]);
    expect(fastenerSettingPaths(deduced)).not.toContainEqual(
      fastenerSettingPath("treadBeamBolted", "length"),
    );
    // Un élément sans longueur déduite : le réglage de longueur du profil sert encore.
    const mixed = withFasteners([
      bolt("a", ["diameter", "quantity", "length"]),
      bolt("b", ["diameter", "quantity"]),
    ]);
    expect(fastenerSettingsInModel(mixed).joints[0]!.fields).toEqual([
      "kind",
      "grade",
      "length",
      "perPoint",
    ]);
  });

  it("entraxe des supports : seulement avec une main courante murale", () => {
    const m = withFasteners([
      fastener({ id: "h", mark: "VS3", joint: "handrailPartition", deduced: ["quantity"] }),
    ]);
    const s = fastenerSettingsInModel(m);
    expect(s.bracketSpacing).toBe(true);
    expect(s.holeClearance).toBe(false);
    expect(fastenerSettingPaths(m)[0]).toEqual(BRACKET_SPACING_PATH);
    expect(fastenerSettingPaths(m)).not.toContainEqual(UNKNOWN_WALL_PATH);
  });

  it("mur non décrit supposé porteur : seulement le long d'un mur que le site ne décrit pas", () => {
    const m = withFasteners([
      fastener({
        id: "h",
        mark: "VS3",
        joint: "handrailWall",
        deduced: ["quantity"],
        unknownWall: true,
      }),
    ]);
    expect(fastenerSettingsInModel(m).unknownWall).toBe(true);
    expect(fastenerSettingPaths(m)).toContainEqual(UNKNOWN_WALL_PATH);
    expect(fastenerSettingValue(project, UNKNOWN_WALL_PATH)).toBe(
      DEFAULT_FASTENER_PROFILE.unknownWallLoadBearing,
    );
    const own: Project = { ...project, workshop: { fasteners: { unknownWallLoadBearing: false } } };
    expect(fastenerSettingValue(own, UNKNOWN_WALL_PATH)).toBe(false);
  });

  it("série des diamètres nominaux : texte lu et mis en forme sans calcul", () => {
    expect(fastenerSettingValue(project, NOMINAL_DIAMETERS_PATH)).toBe(
      formatNominalDiameters(DEFAULT_FASTENER_PROFILE.nominalDiameters),
    );
    expect(formatNominalDiameters([6, 8, 10])).toBe("6 ; 8 ; 10");
    expect(parseNominalDiameters("6 ; 8;10 ; 12,5")).toEqual([6, 8, 10, 12.5]);
    expect(parseNominalDiameters(formatNominalDiameters([3, 4, 30]))).toEqual([3, 4, 30]);
    expect(parseNominalDiameters("")).toBeNull();
    expect(parseNominalDiameters("6, 8")).toBeNull();
    expect(parseNominalDiameters("6 ; M8")).toBeNull();
    expect(parseNominalDiameters("0 ; 8")).toBeNull();
  });

  it("valeur effective : réglage du projet, sinon défaut « à valider » du cœur", () => {
    const length = fastenerSettingPath("plateFloor", "length");
    expect(fastenerSettingValue(project, length)).toBe(
      DEFAULT_FASTENER_PROFILE.joints.plateFloor.length,
    );
    expect(fastenerSettingValue(project, HOLE_CLEARANCE_PATH)).toBe(
      DEFAULT_FASTENER_PROFILE.holeClearance,
    );
    const own: Project = {
      ...project,
      workshop: { fasteners: { holeClearance: 2, joints: { plateFloor: { length: 120 } } } },
    };
    expect(fastenerSettingValue(own, length)).toBe(120);
    expect(fastenerSettingValue(own, HOLE_CLEARANCE_PATH)).toBe(2);
    expect(fastenerSettingValue(own, fastenerSettingPath("plateFloor", "kind"))).toBe(
      DEFAULT_FASTENER_PROFILE.joints.plateFloor.kind,
    );
    expect(fastenerSettingValue(own, ["guards", "material"])).toBeUndefined();
    expect(fastenerSettingValue(own, ["workshop", "fasteners", "joints", "x", "length"])).toBe(
      undefined,
    );
  });

  it("assemblage et champ d'un chemin", () => {
    expect(fastenerSettingOf(fastenerSettingPath("handrailWall", "perPoint"))).toEqual({
      joint: "handrailWall",
      field: "perPoint",
    });
    expect(fastenerSettingOf(HOLE_CLEARANCE_PATH)).toBeUndefined();
    expect(fastenerSettingOf(["workshop", "fasteners", "joints", "x", "kind"])).toBeUndefined();
  });
});
