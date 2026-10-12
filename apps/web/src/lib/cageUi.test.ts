/**
 * Prédicats de l'interface sur un tracé libre (cage, ADR-0010, sous-lot 4a) : `legs` et `turns`
 * d'une cage sont dérivés et vides ; aucun prédicat ne doit y lire un escalier droit.
 */
import cage60Text from "../../../../examples/cage-60.blondel.json?raw";
import cageArcText from "../../../../examples/cage-arc.blondel.json?raw";
import cagePalierText from "../../../../examples/cage-palier-droit.blondel.json?raw";
import cageTrapezeText from "../../../../examples/cage-trapeze.blondel.json?raw";
import { createProject, parseProjectText, type Project } from "@blondel/core";
import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { cageSummaryLines } from "./cageSummary.js";
import { addLeg, removeLastLeg } from "./layoutEdit.js";
import {
  layoutKindChoiceOf,
  layoutKindOf,
  layoutTypologyLabel,
  layoutWidthEditable,
  pressedShapes,
  switchLayoutKind,
} from "./layoutKind.js";
import { walklineSideApplies } from "./realign.js";

const FR = translatorFor("fr");
const cage60 = parseProjectText(cage60Text);
const palier = parseProjectText(cagePalierText);

describe("tracé libre : prédicats de l'interface", () => {
  it("typologie : tracé libre, pas « Escalier droit »", () => {
    expect(FR.t(layoutTypologyLabel(cage60.stair.layout))).toBe("Tracé libre (2 tronçons)");
    expect(FR.t(layoutTypologyLabel(createProject("straight").stair.layout))).toBe(
      "Escalier droit",
    );
    expect(FR.t(layoutTypologyLabel(createProject("helical").stair.layout))).toBe("Hélicoïdal");
  });

  it("cartes de forme : aucune enfoncée pour une cage", () => {
    expect(pressedShapes(cage60).size).toBe(0);
  });

  it("bord de mesure de la ligne de foulée : seulement sans jonction tournante", () => {
    expect(walklineSideApplies(cage60)).toBe(false);
    expect(walklineSideApplies(palier)).toBe(true);
  });

  it("ajout et retrait de volée sans effet sur une cage", () => {
    expect(addLeg(cage60)).toBe(cage60);
    expect(removeLastLeg(cage60)).toBe(cage60);
  });

  it("type de tracé : « cage » affiché ; « À volées » rend un préréglage à volées", () => {
    expect(layoutKindOf(cage60)).toBe("flights");
    expect(layoutKindChoiceOf(cage60)).toBe("cage");
    expect(layoutKindChoiceOf(createProject("straight"))).toBe("flights");
    const f = switchLayoutKind(cage60, "flights").project;
    expect(f.stair.layout.kind).not.toBe("cage");
    expect(f.site.floorToFloor).toBe(cage60.site.floorToFloor);
    const p = createProject("straight");
    expect(switchLayoutKind(p, "flights").project).toBe(p);
  });

  it("emmarchement global : non saisissable sur une cage (largeur dérivée des tronçons)", () => {
    expect(layoutWidthEditable(cage60.stair.layout)).toBe(false);
    expect(layoutWidthEditable(createProject("straight").stair.layout)).toBe(true);
    expect(layoutWidthEditable(createProject("helical").stair.layout)).toBe(false);
  });
});

describe("tracé libre : résumé de la section Tracé", () => {
  const lines = (p: Project): string[] => {
    const layout = p.stair.layout;
    if (layout.kind !== "cage") throw new Error("cage attendue");
    // Espaces des milliers (insécables, fines) ramenées à une espace simple.
    return cageSummaryLines(layout, "fr").map((m) => FR.t(m).replace(/\s/gu, " "));
  };

  it("tronçon en arc : rayon, balayage en degrés, largeur", () => {
    expect(lines(parseProjectText(cageArcText))).toEqual([
      "Tronçon 1 : en arc, rayon 2 150 mm, balayage 100°, largeur 900 mm",
    ]);
  });

  it("largeur variable et jonction balancée", () => {
    expect(lines(parseProjectText(cageTrapezeText))).toEqual([
      "Tronçon 1 : droit, partie droite 1 450 mm, largeur 900 → 1 200 mm",
      "Jonction 1 : 90°, marches balancées",
      "Tronçon 2 : droit, partie droite 1 400 mm, largeur 1 200 mm",
    ]);
  });

  it("palier droit et longueur automatique", () => {
    expect(lines(palier)).toEqual([
      "Tronçon 1 : droit, partie droite 1 890 mm, largeur 900 mm",
      "Jonction 1 : 0°, palier",
      "Tronçon 2 : droit, partie droite 1 620 mm, largeur 900 mm",
    ]);
    const layout = palier.stair.layout;
    if (layout.kind !== "cage") throw new Error("cage attendue");
    const auto: Project = {
      ...palier,
      stair: {
        ...palier.stair,
        layout: {
          ...layout,
          sections: layout.sections.map((s, i) =>
            i === 0 ? { ...s, axis: { kind: "straight" as const, length: "auto" as const } } : s,
          ),
        },
      },
    };
    expect(lines(auto)[0]).toBe("Tronçon 1 : droit, longueur automatique, largeur 900 mm");
  });
});
