import { translatorFor } from "@blondel/i18n";
import { buildModel, createProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  realign,
  realignDisabledReason,
  REALIGN_HINT_KEY,
  WALKLINE_SIDE_HINT_KEY,
  walklineSideApplies,
  walklineSideChoice,
  withWalklineSide,
} from "./realign.js";

const FR = translatorFor("fr");

describe("recalage des volées et de la trémie (A18 a)", () => {
  it("H modifié : dernière volée et trémie recalées, position du tournant conservée", () => {
    const p = createProject("quarter-left");
    const edited = { ...p, site: { ...p.site, floorToFloor: 2900 } };
    const r = realign(edited);
    expect(r.project.stair.layout.legs[0]).toEqual(p.stair.layout.legs[0]);
    expect(r.project.stair.layout.legs[1]).not.toEqual(p.stair.layout.legs[1]);
    expect(FR.t(r.notice!)).toMatch(/Dernière volée recalée/);
    expect(FR.t(r.notice!)).toMatch(/Trémie recalée/);
    expect(realignDisabledReason(edited)).toBeNull();
  });

  it("hélicoïdal : refus explicite, bouton désactivé avec la raison du cœur", () => {
    expect(() => realign(createProject("helical"))).toThrow(/hélicoïdal/);
    expect(FR.t(realignDisabledReason(createProject("helical"))!)).toMatch(/hélicoïdal/);
  });

  it("palier hors d'un nombre entier de girons : bouton désactivé, longueur proposée", () => {
    const p = createProject("quarter-landing");
    const edited = { ...p, site: { ...p.site, floorToFloor: 2900 } };
    expect(FR.t(realignDisabledReason(edited)!)).toMatch(/saisir .* mm pour la volée 1/);
    expect(FR.t(REALIGN_HINT_KEY)).toMatch(/position des tournants saisie conservée/);
  });
});

describe("bord de mesure de la ligne de foulée (A16)", () => {
  it("auto par défaut, gauche / droite imposés, retour à auto", () => {
    const s = createProject("straight");
    const p = { ...s, stair: { ...s.stair, layout: { ...s.stair.layout, width: 1400 } } };
    expect(walklineSideApplies(p)).toBe(true);
    expect(walklineSideChoice(p)).toBe("auto");
    const right = withWalklineSide(p, "right");
    expect(right.stair.walkline).toEqual({ mode: "dtu", side: "right" });
    expect(buildModel(right).layout.walklineSide).toBe("right");
    const back = withWalklineSide(right, "auto");
    expect(back.stair.walkline).toEqual({ mode: "dtu" });
    expect(walklineSideApplies(createProject("quarter-left"))).toBe(false);
  });
});

describe("aide du bord de mesure (relecture adverse)", () => {
  it("aucun seuil en dur : ni 600 mm ni 1 200 mm recopiés de rules.yaml", () => {
    expect(FR.t(WALKLINE_SIDE_HINT_KEY)).not.toMatch(/\d/);
    expect(translatorFor("en").t(WALKLINE_SIDE_HINT_KEY)).not.toMatch(/\d/);
    expect(FR.t(WALKLINE_SIDE_HINT_KEY)).toMatch(/main courante principale/);
  });
});
