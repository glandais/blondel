/**
 * Lignes des valeurs ◆ (ADR-0009 point 9) : éléments et ordre de `toValidateItems`, valeurs
 * effectives (défauts compris), état de validation et caducité, mise en forme fr / en, lignes
 * du dossier PDF.
 */
import {
  DEFAULT_FASTENER_PROFILE,
  ROTATION_DEFAULT_REACH,
  buildModel,
  createProject,
  fastenerKindLabel,
  msg,
  parseProjectText,
  withValidatedValues,
  type Fastener,
  type Model,
  type Project,
} from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { toWinAnsi } from "@blondel/exports/pdf";
import { describe, expect, it } from "vitest";
import ashText from "../../../../examples/demo-quarter-landing-ash.blondel.json?raw";
import { defaultGuards } from "./guardsForm.js";
import { availableStructures } from "./optionalApi.js";
import { guidedStepOfRow } from "./guidedSteps.js";
import { toValidateItems } from "./paramTiers.js";
import {
  MARK_REPRESENTATIVE_AREA_KEY,
  MARK_REPRESENTATIVE_KEY,
  partMarksInModel,
} from "./partMarks.js";
import {
  formatToValidateValue,
  pendingValidationEntries,
  toValidateDocRows,
  toValidateRows,
  validationEntry,
  type ToValidateRow,
} from "./toValidate.js";

const FR = translatorFor("fr");
const EN = translatorFor("en");

const base = createProject("quarter-left");
/** Projet à garde-corps (balustres) et structure acier à limons plats. */
const steel: Project = {
  ...base,
  stair: { ...base.stair, structure: { kind: "steel-flat", params: {} } },
  guards: defaultGuards(),
};
const steelModel = buildModel(steel);

const rowOf = (rows: readonly ToValidateRow[], key: string): ToValidateRow => {
  const r = rows.find((x) => x.key === key);
  if (r === undefined) throw new Error(`ligne absente : ${key}`);
  return r;
};

describe("toValidateRows", () => {
  it("mêmes éléments et même ordre que toValidateItems, défauts compris", () => {
    const rows = toValidateRows(steel, steelModel);
    expect(rows.map((r) => r.key)).toEqual(toValidateItems(steel, steelModel).map((i) => i.key));
    expect(rows.every((r) => !r.validated)).toBe(true);
    // Garde-corps : défauts du schéma.
    expect(rowOf(rows, "guards.posts.size")).toMatchObject({
      value: 80,
      unit: "mm",
      section: "guards",
    });
    expect(rowOf(rows, "guards.posts.cornerAngle").unit).toBe("°");
    expect(rowOf(rows, "guards.material").value).toBe("wood-oak");
    // Paramètre de plugin : défaut du plugin, plugin retenu.
    const thickness = rowOf(rows, "stair.structure.params.thickness");
    expect(thickness.structureKind).toBe("steel-flat");
    expect(typeof thickness.value).toBe("number");
    expect(thickness.unit).toBe("mm");
    expect(FR.t(thickness.label)).toBe(FR.t("ui.param.steelFlat.thickness.label"));
  });

  it("libellé préfixé du groupe (fieldset) pour un chemin imbriqué", () => {
    const rows = toValidateRows(steel, steelModel);
    expect(FR.t(rowOf(rows, "guards.posts.size").label)).toBe(
      `${FR.t("ui.guards.posts.legend")} · ${FR.t("ui.guards.posts.size")}`,
    );
    expect(FR.t(rowOf(rows, "guards.material").label)).toBe(
      `${FR.t("ui.params.guards.title")} · ${FR.t("ui.guards.material")}`,
    );
    const nested = rows.find(
      (r) => r.key.startsWith("stair.structure.params.") && r.path.length > 4,
    );
    if (nested !== undefined) expect(FR.t(nested.label)).toContain(" · ");
  });

  it("validée après withValidatedValues, caduque après un changement de valeur", () => {
    const rows = toValidateRows(steel, steelModel);
    const entries = [
      rowOf(rows, "guards.posts.size"),
      rowOf(rows, "stair.structure.params.thickness"),
    ]
      .map(validationEntry)
      .filter((e) => e !== null);
    expect(entries[1]).toMatchObject({ structureKind: "steel-flat" });
    const validated = withValidatedValues(steel, entries);
    const after = toValidateRows(validated, steelModel);
    expect(rowOf(after, "guards.posts.size").validated).toBe(true);
    expect(rowOf(after, "stair.structure.params.thickness").validated).toBe(true);
    expect(after.filter((r) => r.validated)).toHaveLength(2);
    expect(pendingValidationEntries(after)).toHaveLength(after.length - 2);
    // Valeur changée ensuite : caduque.
    const changed: Project = {
      ...validated,
      guards: { ...validated.guards!, posts: { ...validated.guards!.posts, size: 90 } },
    };
    expect(rowOf(toValidateRows(changed, steelModel), "guards.posts.size").validated).toBe(false);
  });

  it("M6 : défauts du cœur, unité en girons", () => {
    const p: Project = {
      ...base,
      stair: { ...base.stair, balancing: { ...base.stair.balancing, method: "M6" } },
    };
    const reach = rowOf(toValidateRows(p, null), "stair.balancing.rotationReach");
    expect(reach.value).toBe(ROTATION_DEFAULT_REACH);
    expect(formatToValidateValue(reach, FR)).toContain(FR.t("ui.params.rotation.goings"));
  });
});

describe("formatToValidateValue", () => {
  const rows = toValidateRows(steel, steelModel);
  const row = (key: string) => rowOf(rows, key);

  it("nombres avec unité, entiers sans décimale (fr / en)", () => {
    expect(formatToValidateValue(row("guards.posts.size"), FR)).toBe("80 mm");
    expect(formatToValidateValue(row("guards.posts.size"), EN)).toBe("80 mm");
    expect(formatToValidateValue(row("guards.posts.cornerAngle"), FR)).toBe("30°");
    expect(formatToValidateValue({ ...row("guards.posts.size"), value: 1.35, unit: "" }, FR)).toBe(
      "1,35",
    );
    expect(formatToValidateValue({ ...row("guards.posts.size"), value: 1.35, unit: "" }, EN)).toBe(
      "1.35",
    );
  });

  it("choix d'une liste, booléens, valeur non calculable", () => {
    expect(formatToValidateValue(row("guards.material"), FR)).toBe(FR.t("material.woodOak"));
    expect(formatToValidateValue(row("guards.material"), EN)).toBe(EN.t("material.woodOak"));
    const r = row("guards.posts.size");
    expect(formatToValidateValue({ ...r, value: true }, FR)).toBe("oui");
    expect(formatToValidateValue({ ...r, value: false }, EN)).toBe("no");
    expect(formatToValidateValue({ ...r, value: undefined }, FR)).toBe("–");
    expect(validationEntry({ ...r, value: undefined })).toBeNull();
  });
});

describe("toValidateDocRows", () => {
  it("lignes du dossier : valeur formatée dans la langue, section, état", () => {
    const p = withValidatedValues(steel, [{ path: "guards.posts.size", value: 80 }]);
    const fr = toValidateDocRows(p, steelModel, FR);
    const en = toValidateDocRows(p, steelModel, EN);
    expect(fr).toHaveLength(toValidateRows(p, steelModel).length);
    const i = toValidateRows(p, steelModel).findIndex((r) => r.key === "guards.posts.size");
    expect(fr[i]).toMatchObject({ value: "80 mm", validated: true });
    expect(FR.t(fr[i]!.section)).toBe(FR.t("ui.params.guards.title"));
    expect(en[i]!.value).toBe("80 mm");
    expect(fr.filter((r) => r.validated)).toHaveLength(1);
  });

  it("aucun libellé ◆ d'aucun plugin ne devient « ? » en WinAnsi (fr / en)", () => {
    const bad: string[] = [];
    for (const plugin of availableStructures()) {
      const p: Project = {
        ...steel,
        stair: { ...steel.stair, structure: { kind: plugin.kind, params: {} } },
      };
      const m = buildModel(p);
      for (const t of [FR, EN]) {
        for (const r of toValidateDocRows(p, m, t)) {
          const text = `${t.t(r.label)} ${r.value} ${t.t(r.section)}`;
          if (toWinAnsi(text).includes("?")) bad.push(`${plugin.kind} (${t.locale}) : ${text}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("visserie du profil d'atelier (QUESTIONS A27)", () => {
  const fastener = (o: Partial<Fastener> & Pick<Fastener, "id" | "mark" | "joint">): Fastener => ({
    kind: "anchor",
    grade: "zinc-plated",
    diameter: 12,
    length: 100,
    quantity: 4,
    name: fastenerKindLabel("anchor"),
    origin: msg("fastener.joint.plateFloor"),
    partIds: [steelModel.parts[0]!.id],
    deduced: ["diameter", "quantity"],
    ...o,
  });
  /** Modèle réel complété d'une visserie de test (le calcul du cœur n'est pas requis). */
  const model: Model = {
    ...steelModel,
    fasteners: [
      fastener({ id: "a", mark: "VS1", joint: "plateFloor" }),
      fastener({ id: "b", mark: "VS2", joint: "handrailWall", deduced: ["quantity"] }),
    ],
  };
  const fasteners = (rows: readonly ToValidateRow[]) =>
    rows.filter((r) => r.key.startsWith("workshop.fasteners."));

  it("réglages des assemblages présents seulement, section Structure, valeurs par défaut", () => {
    expect(fasteners(toValidateRows(steel, { ...model, fasteners: [] }))).toEqual([]);
    const rows = fasteners(toValidateRows(steel, model));
    expect(rows.map((r) => r.key)).toEqual([
      "workshop.fasteners.holeClearance",
      "workshop.fasteners.nominalDiameters",
      "workshop.fasteners.bracketSpacing",
      "workshop.fasteners.joints.plateFloor.kind",
      "workshop.fasteners.joints.plateFloor.grade",
      "workshop.fasteners.joints.plateFloor.length",
      "workshop.fasteners.joints.plateFloor.perPoint",
      "workshop.fasteners.joints.handrailWall.kind",
      "workshop.fasteners.joints.handrailWall.grade",
      "workshop.fasteners.joints.handrailWall.diameter",
      "workshop.fasteners.joints.handrailWall.length",
      "workshop.fasteners.joints.handrailWall.perPoint",
    ]);
    expect(rows.every((r) => r.section === "structure" && !r.validated)).toBe(true);
    const length = rowOf(rows, "workshop.fasteners.joints.plateFloor.length");
    expect(length).toMatchObject({
      value: DEFAULT_FASTENER_PROFILE.joints.plateFloor.length,
      unit: "mm",
    });
    expect(rowOf(rows, "workshop.fasteners.joints.plateFloor.perPoint").unit).toBeUndefined();
  });

  it("libellés « Visserie · assemblage · champ », valeurs et choix traduits", () => {
    const rows = toValidateRows(steel, model);
    const kind = rowOf(rows, "workshop.fasteners.joints.plateFloor.kind");
    expect(FR.t(kind.label)).toBe("Visserie · Platine sur sol · Nature");
    expect(EN.t(kind.label)).toBe("Fixings · Plate to floor · Type");
    expect(formatToValidateValue(kind, FR)).toBe("Cheville mécanique");
    expect(formatToValidateValue(kind, EN)).toBe("Expansion anchor");
    const grade = rowOf(rows, "workshop.fasteners.joints.plateFloor.grade");
    expect(formatToValidateValue(grade, FR)).toBe("acier zingué");
    const length = rowOf(rows, "workshop.fasteners.joints.plateFloor.length");
    expect(formatToValidateValue(length, FR)).toMatch(/^100\s?mm$/u);
    expect(FR.t(rowOf(rows, "workshop.fasteners.holeClearance").label)).toBe(
      "Visserie · Jeu de perçage",
    );
    const series = rowOf(rows, "workshop.fasteners.nominalDiameters");
    expect(FR.t(series.label)).toBe("Visserie · Série des diamètres nominaux (mm)");
    expect(formatToValidateValue(series, EN)).toBe(
      "3 ; 4 ; 5 ; 6 ; 8 ; 10 ; 12 ; 16 ; 20 ; 24 ; 30",
    );
    // Lignes du dossier PDF : imprimables en WinAnsi.
    for (const t of [FR, EN]) {
      for (const r of toValidateDocRows(steel, model, t)) {
        expect(toWinAnsi(`${t.t(r.label)} ${r.value}`)).not.toContain("?");
      }
    }
  });

  it("valeur du projet et validation (caduque si la valeur change)", () => {
    const key = "workshop.fasteners.joints.plateFloor.length";
    const own: Project = {
      ...steel,
      workshop: { fasteners: { joints: { plateFloor: { length: 120 } } } },
    };
    expect(rowOf(toValidateRows(own, model), key).value).toBe(120);
    const validated = withValidatedValues(own, [{ path: key, value: 120 }]);
    const row = rowOf(toValidateRows(validated, model), key);
    expect(row.validated).toBe(true);
    expect(validationEntry(row)).toEqual({ path: key, value: 120 });
    const changed: Project = {
      ...validated,
      workshop: { fasteners: { joints: { plateFloor: { length: 140 } } } },
    };
    expect(rowOf(toValidateRows(changed, model), key).validated).toBe(false);
  });
});

describe("repérage des pièces (F10 (21), (30) ; G-Q7)", () => {
  const T = "workshop.identicalPartTolerance";
  const R = MARK_REPRESENTATIVE_KEY;
  const A = MARK_REPRESENTATIVE_AREA_KEY;
  const keys = (rows: readonly ToValidateRow[]) => rows.map((r) => r.key);

  it("trois lignes (barres et développés), section Structure, après la visserie, étape 7 du guidé", () => {
    expect(partMarksInModel(steelModel)).toBe(true);
    const rows = toValidateRows(steel, steelModel);
    const k = keys(rows);
    expect(k.slice(-3)).toEqual([T, R, A]);
    const lastFastener = k.findLastIndex((x) => x.startsWith("workshop.fasteners."));
    expect(k.indexOf(T)).toBeGreaterThan(lastFastener);
    for (const key of [T, R, A]) {
      const row = rowOf(rows, key);
      expect(row.section).toBe("structure");
      expect(row.validated).toBe(false);
      expect(guidedStepOfRow(row)).toBe(7);
    }
  });

  it("valeurs et libellés fr / en : 0,5 mm par défaut, « la plus courte »", () => {
    const rows = toValidateRows(steel, steelModel);
    const t = rowOf(rows, T);
    expect(t).toMatchObject({ value: 0.5, unit: "mm" });
    expect(FR.t(t.label)).toBe("Repérage des pièces · Tolérance d'identité des pièces repérées");
    expect(EN.t(t.label)).toBe("Part marking · Identity tolerance of marked parts");
    expect(formatToValidateValue(t, FR)).toMatch(/^0,5\s?mm$/u);
    expect(formatToValidateValue(t, EN)).toMatch(/^0\.5\s?mm$/u);
    const r = rowOf(rows, R);
    expect(r.value).toBe("shortest");
    expect(FR.t(r.label)).toBe(
      "Repérage des pièces · Représentant d'un repère de barres (cornières, supports, garde-corps)",
    );
    expect(formatToValidateValue(r, FR)).toBe("la plus courte");
    expect(formatToValidateValue(r, EN)).toBe("the shortest");
    const a = rowOf(rows, A);
    expect(a.value).toBe("smallestNetArea");
    expect(FR.t(a.label)).toBe(
      "Repérage des pièces · Représentant d'un repère de développés ou de panneaux",
    );
    expect(EN.t(a.label)).toBe("Part marking · Representative of a flat-pattern or panel mark");
    expect(formatToValidateValue(a, FR)).toBe("la plus petite par l'aire nette");
    expect(formatToValidateValue(a, EN)).toBe("the smallest by net area");
    const own: Project = { ...steel, workshop: { identicalPartTolerance: 0.3 } };
    expect(rowOf(toValidateRows(own, steelModel), T).value).toBe(0.3);
    // Dossier PDF : mêmes lignes, imprimables en WinAnsi.
    for (const tr of [FR, EN]) {
      const doc = toValidateDocRows(steel, steelModel, tr).slice(-3);
      expect(doc).toHaveLength(3);
      for (const d of doc) expect(toWinAnsi(`${tr.t(d.label)} ${d.value}`)).not.toContain("?");
    }
  });

  it("absentes sans pièce repérée par identité (bois) et sans modèle", () => {
    const wood = buildModel(base);
    expect(partMarksInModel(wood)).toBe(false);
    for (const key of [T, R, A]) {
      expect(keys(toValidateRows(base, wood))).not.toContain(key);
      expect(keys(toValidateRows(steel, null))).not.toContain(key);
    }
  });

  it("une ligne par règle appliquée dans le modèle (G-Q7)", () => {
    const tail = (p: Project, m: Model) =>
      keys(toValidateRows(p, m)).filter((k) => k === T || k === R || k === A);
    // Bois à balustres : barres seulement, sans ligne « développés ou panneaux » (correction de
    // l'affichage transitoire de G2c).
    const woodGuards: Project = { ...base, guards: defaultGuards() };
    expect(tail(woodGuards, buildModel(woodGuards))).toEqual([T, R]);
    // Bois à panneaux de verre : barres et panneaux.
    const ash = parseProjectText(ashText);
    expect(tail(ash, buildModel(ash))).toEqual([T, R, A]);
    // Limon central acier sans garde-corps : développés seulement, sans « la plus courte »
    // (aucune barre repérée ; défaut d'affichage de R2d corrigé).
    expect(availableStructures().some((s) => s.kind === "steel-central")).toBe(true);
    const central: Project = {
      ...base,
      stair: { ...base.stair, structure: { kind: "steel-central", params: {} } },
    };
    const centralModel = buildModel(central);
    expect(centralModel.errors).toEqual([]);
    expect(tail(central, centralModel)).toEqual([T, A]);
  });

  it("validation : T validé, caduc si T change ; rappel validé sous sa clé `ui:`", () => {
    const rows = toValidateRows(steel, steelModel);
    expect(validationEntry(rowOf(rows, R))).toEqual({ path: R, value: "shortest" });
    expect(validationEntry(rowOf(rows, A))).toEqual({ path: A, value: "smallestNetArea" });
    const validated = withValidatedValues(steel, pendingValidationEntries(rows));
    const after = toValidateRows(validated, steelModel);
    expect(rowOf(after, T).validated).toBe(true);
    expect(rowOf(after, R).validated).toBe(true);
    expect(rowOf(after, A).validated).toBe(true);
    const changed: Project = { ...validated, workshop: { identicalPartTolerance: 0.3 } };
    expect(rowOf(toValidateRows(changed, steelModel), T).validated).toBe(false);
    expect(rowOf(toValidateRows(changed, steelModel), R).validated).toBe(true);
  });
});
