/**
 * Lignes des valeurs ◆ (ADR-0009 point 9) : éléments et ordre de `toValidateItems`, valeurs
 * effectives (défauts compris), état de validation et caducité, mise en forme fr / en, lignes
 * du dossier PDF.
 */
import {
  ROTATION_DEFAULT_REACH,
  buildModel,
  createProject,
  withValidatedValues,
  type Project,
} from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { toWinAnsi } from "@blondel/exports/pdf";
import { describe, expect, it } from "vitest";
import { defaultGuards } from "./guardsForm.js";
import { availableStructures } from "./optionalApi.js";
import { toValidateItems } from "./paramTiers.js";
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
    expect(FR.t(rowOf(rows, "guards.material").label)).toBe(FR.t("ui.guards.material"));
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
