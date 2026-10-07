import { RULES } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { RULE_SECTION_PREFIXES, ruleSection } from "./ruleSections.js";
import { isSectionId } from "./sectionIds.js";

describe("section à ouvrir pour corriger une règle", () => {
  it("préfixes du découpage, du balancement, du tracé et du site", () => {
    expect(ruleSection("H_MAX_DTU")).toBe("stepping");
    expect(ruleSection("G_MIN_DTU")).toBe("stepping");
    expect(ruleSection("BLONDEL_DTU")).toBe("stepping");
    expect(ruleSection("CONFORT_CLASSE")).toBe("stepping");
    expect(ruleSection("RECULEMENT")).toBe("stepping");
    expect(ruleSection("VOLEE_MAX_DTU")).toBe("stepping");
    expect(ruleSection("G_COLLET_MIN")).toBe("balancing");
    expect(ruleSection("G_BALANCE_VS_DROITE")).toBe("balancing");
    expect(ruleSection("ERP_TOURNANT_BALANCEMENT_CONTINU")).toBe("balancing");
    expect(ruleSection("LF_POSITION_DTU_LARGE")).toBe("layout");
    expect(ruleSection("E_MIN_DTU")).toBe("layout");
    expect(ruleSection("LARGEUR_MIN_LOGEMENT")).toBe("layout");
    expect(ruleSection("PALIER_LONGUEUR_METIER")).toBe("layout");
    expect(ruleSection("ECHAPPEE_MIN_DTU")).toBe("site");
    expect(ruleSection("TREMIE_LONGUEUR")).toBe("site");
    expect(ruleSection("HAUTEUR_ETAGE_TOLERANCE")).toBe("site");
  });

  it("garde-corps, marches et structure", () => {
    expect(ruleSection("GC_CONFLIT_DALLE")).toBe("guards");
    expect(ruleSection("MC_HAUTEUR")).toBe("guards");
    expect(ruleSection("VIDE_ENTRE_MARCHES")).toBe("guards");
    expect(ruleSection("DEBORD_NEZ_ERP")).toBe("treads");
    expect(ruleSection("RECOUVREMENT_INDUSTRIEL")).toBe("treads");
    expect(ruleSection("CONTREMARCHE_EXTREMES")).toBe("treads");
    expect(ruleSection("NEZ_CONTRASTE")).toBe("treads");
    expect(ruleSection("BANDE_EVEIL")).toBe("treads");
    expect(ruleSection("FAB_SUPPORT_LONGUEUR_MIN")).toBe("structure");
    expect(ruleSection("LIMON_EPAISSEUR_MIN_DTU")).toBe("structure");
    expect(ruleSection("CREMAILLERE_REGLE_MOYENS")).toBe("structure");
    expect(ruleSection("PRECHECK_FLECHE")).toBe("structure");
    expect(ruleSection("CHARGE_ESCALIER_A")).toBe("structure");
    expect(ruleSection("DEFORMATION_CINTRAGE")).toBe("structure");
    expect(ruleSection("HELICOIDAL_PORTE_A_FAUX")).toBe("structure");
    // Lamellé-collé cintré du limon central bois (A29, vague 2).
    expect(ruleSection("LAMELLE_CINTRE_KR")).toBe("structure");
    expect(ruleSection("LAMELLE_PLIS_MINCES")).toBe("structure");
  });

  it("le plus long préfixe l'emporte ; préfixe inconnu : aucune section", () => {
    expect(ruleSection("G_COLLET_MONOTONE")).toBe("balancing");
    expect(ruleSection("ANGLE_ECHELLE_MARCHES")).toBeNull();
    expect(ruleSection("EXC_CLASSE_EXECUTION")).toBeNull();
    expect(ruleSection("")).toBeNull();
  });

  it("table : sections valides ; la plupart des règles de rules.yaml ont une section", () => {
    for (const [, s] of RULE_SECTION_PREFIXES) expect(isSectionId(s)).toBe(true);
    const covered = RULES.filter((r) => ruleSection(r.id) !== null).length;
    expect(covered / RULES.length).toBeGreaterThan(0.9);
  });
});
