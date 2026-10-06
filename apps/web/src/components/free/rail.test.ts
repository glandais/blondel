/**
 * Rail des 8 sections, modèle ARIA des onglets à activation manuelle (vague 6, vérification du
 * clavier) : un seul arrêt de tabulation (focus itinérant), flèches haut / bas et gauche /
 * droite, Début et Fin, entrées désactivées sautées.
 */
import { describe, expect, it } from "vitest";
import { SECTION_IDS } from "../../lib/sectionIds.js";
import { disabledSections, railKeyTarget, railTabId, railTabStop } from "./Rail.js";

const NONE = disabledSections(1);
const NO_TURN = disabledSections(0);
const balancing = SECTION_IDS.indexOf("balancing");

describe("rail : clavier", () => {
  it("arrêt de tabulation : la section ouverte, sinon la première disponible", () => {
    expect(railTabStop(null, NONE)).toBe(0);
    expect(railTabStop("guards", NONE)).toBe(SECTION_IDS.indexOf("guards"));
    // Section ouverte indisponible : première disponible.
    expect(railTabStop("balancing", NO_TURN)).toBe(0);
  });

  it("flèches dans les deux orientations, en boucle ; Début / Fin", () => {
    expect(railKeyTarget(0, "ArrowDown", NONE)).toBe(1);
    expect(railKeyTarget(0, "ArrowRight", NONE)).toBe(1);
    expect(railKeyTarget(0, "ArrowUp", NONE)).toBe(SECTION_IDS.length - 1);
    expect(railKeyTarget(0, "ArrowLeft", NONE)).toBe(SECTION_IDS.length - 1);
    expect(railKeyTarget(3, "Home", NONE)).toBe(0);
    expect(railKeyTarget(3, "End", NONE)).toBe(SECTION_IDS.length - 1);
    // Entrée et Espace activent (clic natif du bouton) : pas de déplacement.
    expect(railKeyTarget(3, "Enter", NONE)).toBeNull();
    expect(railKeyTarget(3, " ", NONE)).toBeNull();
  });

  it("Balancement désactivé (sans tournant) : sauté par les flèches", () => {
    expect(railKeyTarget(balancing - 1, "ArrowDown", NO_TURN)).toBe(balancing + 1);
    expect(railKeyTarget(balancing + 1, "ArrowUp", NO_TURN)).toBe(balancing - 1);
  });

  it("identifiants des onglets : #rail-tab-<section>", () => {
    expect(railTabId("site")).toBe("rail-tab-site");
  });
});
