import { describe, expect, it } from "vitest";
import { ComplianceSettingsSchema } from "../model/project.js";
import { getRule } from "../rules/table.js";
import {
  assistantContexts,
  boundsQuantity,
  enumerationBounds,
  goingRange,
  riserCountRange,
} from "./bounds.js";
import { ASSISTANT_DEFAULTS } from "./defaults.js";

const fallbacks = {
  riseMax: ASSISTANT_DEFAULTS.riseMaxFallback,
  riseMin: ASSISTANT_DEFAULTS.riseMinFallback,
  blondelTarget: ASSISTANT_DEFAULTS.blondelTargetFallback,
};

function boundsOf(settings: Parameters<typeof ComplianceSettingsSchema.parse>[0], shapes = []) {
  const s = ComplianceSettingsSchema.parse(settings);
  return enumerationBounds(s, assistantContexts(s, shapes), fallbacks);
}

describe("reconnaissance des grandeurs bornées dans rules.yaml", () => {
  it("encadrements simples seulement", () => {
    expect(boundsQuantity(getRule("H_MAX_LOGEMENT"), "h")).toBe(true);
    expect(boundsQuantity(getRule("H_CONFORT"), "h")).toBe(true);
    expect(boundsQuantity(getRule("G_MIN_LOGEMENT"), "g")).toBe(true);
    expect(boundsQuantity(getRule("BLONDEL_DTU"), "2*h + g")).toBe(true);
    expect(boundsQuantity(getRule("ECHAPPEE_MIN_DTU"), "e")).toBe(true);
    expect(boundsQuantity(getRule("LARGEUR_MIN_LOGEMENT"), "L_passage")).toBe(true);
    // Autres variables ou formules composées : non reconnues.
    expect(boundsQuantity(getRule("G_COLLET_MIN"), "g")).toBe(false);
    expect(boundsQuantity(getRule("G_COLLET_MIN"), "g_collet")).toBe(true);
    expect(boundsQuantity(getRule("H_REGULARITE"), "h")).toBe(false);
    expect(boundsQuantity(getRule("CONFORT_CLASSE"), "h")).toBe(false);
    expect(boundsQuantity(getRule("LF_POSITION_DTU_ETROIT"), "E")).toBe(false);
  });
});

describe("bornes de l'énumération", () => {
  it("contextes par défaut (bois_dtu + logement_interieur)", () => {
    const b = boundsOf({});
    expect(b.riseMax).toEqual({ value: 180, ruleId: "H_MAX_LOGEMENT" });
    expect(b.riseMin).toEqual({ value: 160, ruleId: "H_CONFORT" });
    expect(b.goingMin).toEqual({ value: 240, ruleId: "G_MIN_LOGEMENT" });
    expect(b.blondelMin?.value).toBe(580);
    expect(b.blondelMax?.value).toBe(660);
    expect(b.blondelTarget).toBe(630);
    expect(b.widthMin).toEqual({ value: 800, ruleId: "LARGEUR_MIN_LOGEMENT" });
    expect(b.headroomMin).toEqual({ value: 1900, ruleId: "ECHAPPEE_MIN_DTU" });
    expect(b.headroomRecommended).toBe(2100);
    // Le collet n'est borné que dans les contextes de forme (tournant).
    expect(b.colletRecommended).toBeNull();
    expect(boundsOf({}, ["tournant"] as never).colletRecommended).toBe(150);
    expect(riserCountRange(2700, b)).toEqual([15, 16, 17]);
    expect(goingRange(180, b)).toEqual({ lo: 240, hi: 300, target: 270 });
  });

  it("bois_dtu seul : h_max du DTU, E minimal du DTU", () => {
    const b = boundsOf({ contexts: ["bois_dtu"] });
    expect(b.riseMax).toEqual({ value: 210, ruleId: "H_MAX_DTU" });
    expect(b.goingMin).toEqual({ value: 190, ruleId: "G_MIN_DTU" });
    expect(b.widthMin).toEqual({ value: 700, ruleId: "E_MIN_DTU" });
    expect(riserCountRange(2700, b)).toEqual([13, 14, 15, 16, 17]);
  });

  it("profil souple : l'échappée (source secondaire) n'est plus bloquante", () => {
    const b = boundsOf({ contexts: ["bois_dtu"], profile: "souple" });
    expect(b.headroomMin).toBeNull();
    // h_max bloquant absent (H_MAX_DTU rétrogradé) : repli sur la borne en avertissement.
    expect(b.riseMax.ruleId).toBe("H_MAX_DTU");
  });

  it("surcharge « ignore » : la règle ne borne plus", () => {
    const b = boundsOf({
      overrides: [{ ruleId: "G_MIN_LOGEMENT", severity: "ignore", justification: "essai" }],
    });
    expect(b.goingMin?.ruleId).toBe("G_MIN_DTU");
  });

  it("module hors d'atteinte : aucun giron", () => {
    const b = boundsOf({});
    expect(goingRange(215, b)).toBeNull(); // 660 − 430 = 230 < 240
  });
});
