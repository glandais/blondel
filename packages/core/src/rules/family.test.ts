import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { RULE_FAMILIES, RULE_FAMILY_LABELS, ruleFamily } from "./family.js";
import { RULES } from "./table.js";

describe("familles de règles (QUESTIONS A23)", () => {
  it("chaque règle de la table a une famille connue", () => {
    for (const r of RULES) expect(RULE_FAMILIES).toContain(ruleFamily(r.id));
    for (const f of RULE_FAMILIES) expect(RULE_FAMILY_LABELS[f]).toBeTruthy();
  });

  it("libellés traduits (ADR-0007)", () => {
    const fr = translatorFor("fr");
    const en = translatorFor("en");
    expect(RULE_FAMILIES.map((f) => fr.t(RULE_FAMILY_LABELS[f]))).toEqual([
      "Géométrie",
      "Fabrication",
      "Garde-corps",
    ]);
    expect(RULE_FAMILIES.map((f) => en.t(RULE_FAMILY_LABELS[f]))).toEqual([
      "Geometry",
      "Fabrication",
      "Guarding",
    ]);
  });

  it("garde-corps et mains courantes, fabrication, géométrie", () => {
    expect(ruleFamily("GC_HAUTEUR_2024")).toBe("garde-corps");
    expect(ruleFamily("MC_HAUTEUR")).toBe("garde-corps");
    expect(ruleFamily("ECHELLE_MEUNIER_MC")).toBe("garde-corps");
    expect(ruleFamily("CHARGE_GC_HORIZONTALE")).toBe("garde-corps");
    expect(ruleFamily("FAB_MARCHE_PORTEE")).toBe("fabrication");
    expect(ruleFamily("LIMON_EPAISSEUR_MIN_DTU")).toBe("fabrication");
    expect(ruleFamily("HELICOIDAL_PORTE_A_FAUX")).toBe("fabrication");
    expect(ruleFamily("H_MAX_DTU")).toBe("geometrie");
    expect(ruleFamily("G_COLLET_MIN")).toBe("geometrie");
    expect(ruleFamily("ECHAPPEE_MIN_DTU")).toBe("geometrie");
    expect(ruleFamily("LARGEUR_MC_BHC_PC")).toBe("geometrie");
  });

  it("contrôle de plugin hors table : fabrication", () => {
    expect(ruleFamily("PLUGIN_INCONNU")).toBe("fabrication");
  });

  it("les trois familles sont représentées dans la table", () => {
    const seen = new Set(RULES.map((r) => ruleFamily(r.id)));
    expect([...seen].sort()).toEqual([...RULE_FAMILIES].sort());
  });
});
