/**
 * Colonne de droite du mode Fabrication : réglages d'atelier de la pièce (niveau Atelier
 * seulement, ◆ non validées), encart « Forme du … » et retour vers la Conception, invitation
 * sans pièce, sorties (dossier PDF, fiche de pose, liste de débit, autres exports, coût) ; parties
 * pures (choix des gabarits, remplissage du barème, coût de la variante courante).
 * Rendu serveur, modèle calculé ici sans le worker.
 */
import { buildModel, createProject, type Model, type Project } from "@blondel/core";
import { textMessage, translatorFor } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { structureParamEntry } from "../../lib/paramTiers.js";
import { toValidateRows, validationEntry } from "../../lib/toValidate.js";
import { runVariants, type CompareOutcome, type VariantRow } from "../../lib/variants.js";
import { appStore, journeyStore, modelService, workshopStore } from "../../store/appStore.js";
import { uiStore } from "../../store/uiStore.js";
import { costProfileFill, currentCostText } from "./CostEstimate.js";
import { FabricationAside, openPartInDesign } from "./FabricationAside.js";
import { TEMPLATE_CHOICES, templateChoiceReason } from "./OutputsBlock.js";

const initial = appStore.getState().project;
const FR = translatorFor("fr");

appStore.getInitialState = appStore.getState;
modelService.store.getInitialState = modelService.store.getState;
journeyStore.getInitialState = journeyStore.getState;
uiStore.getInitialState = uiStore.getState;
workshopStore.getInitialState = workshopStore.getState;

/** Projet courant et son modèle (calculé ici, sans le worker). */
function load(p: Project): Model {
  appStore.getState().replaceProject(p);
  const project = appStore.getState().project;
  const model = buildModel(project);
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project, pending: false },
  }));
  return model;
}

afterEach(() => {
  appStore.getState().select(null);
  appStore.getState().setLocale("fr");
  journeyStore.getState().setWorkspace("design");
  journeyStore.getState().closeFreePanel();
  load(initial);
});

function render(locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(FabricationAside));
}

const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/gu, " ");

const steelFlat = (): Project => ({
  ...createProject("straight"),
  stair: {
    ...createProject("straight").stair,
    structure: { kind: "steel-flat", params: {} },
  },
});

function selectPart(partId: string): void {
  appStore.getState().select({ location: { kind: "part", partId } });
}

const noRawKeys = (html: string): void => {
  expect(html).not.toMatch(/ui\.[a-zA-Z]+\.[a-zA-Z.]+/);
};

describe("colonne de droite du mode Fabrication", () => {
  it("sans pièce : invitation, sorties et lien vers le profil d'atelier", () => {
    load(steelFlat());
    workshopStore.setState({ rates: {} });
    const html = render();
    const text = decode(html);
    expect(html).toMatch(/^<aside class="fab-aside" aria-label="[^"]+">/);
    expect(text).toContain("Choisissez une pièce dans la liste");
    expect(text).toContain("Dossier PDF");
    expect(text).toContain("Générer…");
    expect(html).toMatch(/class="btn btn-primary blueprint fab-outputs__open"/);
    expect(text).toContain("Fiche de pose (PDF)");
    expect(text).toContain("Liste de débit (CSV)");
    expect(text).toContain("Autres exports");
    expect(text).toContain("Coût estimé");
    expect(text).toMatch(/Compléter le profil d'atelier \(\d+ \/ 9\)/);
    expect(text).not.toContain("Réglages d'atelier de la pièce");
    // Mention du contrôle de conception, toujours présente en Fabrication.
    expect(html).toContain('<p class="fab-aside__disclaimer">');
    expect(text).toContain(
      "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
    );
    noRawKeys(html);
    noRawKeys(render("en"));
  });

  it("support acier : champs de niveau Atelier seulement, ◆ à valider, note, forme", () => {
    const model = load(steelFlat());
    const support = model.parts.find((p) => p.category === "support")!;
    selectPart(support.id);
    const html = render();
    const text = decode(html);
    expect(text).toContain("Réglages d'atelier de la pièce");
    expect(text).toContain(
      "Modifiés ici, ils s'appliquent à toute la structure (section Structure).",
    );
    // supports.angleLeg est une valeur ◆ de niveau Atelier : mention sous le champ.
    expect(structureParamEntry("steel-flat", ["supports", "angleLeg"]).tier).toBe("workshop");
    expect(text).toContain("◆ valeur par défaut à valider");
    expect(html).toContain('data-to-validate="true"');
    expect(text).toContain("Forme des supports");
    expect(text).toContain("Ouvrir dans Conception");
    // La flèche ← est une icône décorative.
    expect(html).toMatch(/<svg[^>]*lucide-arrow-left" aria-hidden="true"/);
    noRawKeys(html);
  });

  it("valeur ◆ validée : plus de mention ; annulée : la mention revient", () => {
    const model = load(steelFlat());
    const support = model.parts.find((p) => p.category === "support")!;
    selectPart(support.id);
    const before = (render().match(/data-to-validate="true"/g) ?? []).length;
    expect(before).toBeGreaterThan(0);
    const entries = toValidateRows(appStore.getState().project, model)
      .filter((r) => r.key.startsWith("stair.structure.params.supports."))
      .map(validationEntry)
      .filter((e) => e !== null);
    expect(appStore.getState().setValuesValidated(entries, true).ok).toBe(true);
    // Le modèle affiché reste celui du projet précédent : la validation se lit dans le projet.
    expect(render()).not.toContain('data-to-validate="true"');
    appStore.getState().undo();
    expect((render().match(/data-to-validate="true"/g) ?? []).length).toBe(before);
  });

  it("limon acier : seuls les champs Atelier repris ; encart « Forme du limon »", () => {
    const model = load(steelFlat());
    const stringer = model.parts.find((p) => p.category === "stringer")!;
    selectPart(stringer.id);
    const text = decode(render());
    expect(text).toContain("Forme du limon");
    expect(text).toContain("Épaisseur, rives, jour : réglages de conception.");
    // L'épaisseur du limon (niveau Conception) n'est pas reprise ici.
    expect(structureParamEntry("steel-flat", ["thickness"]).tier).not.toBe("workshop");
    expect(text).not.toMatch(/Épaisseur du limon|Épaisseur de tôle/);
  });

  it("marche bois : aucun réglage d'atelier, forme de la marche", () => {
    const model = load(createProject("straight"));
    const tread = model.parts.find((p) => p.category === "tread")!;
    selectPart(tread.id);
    const text = decode(render());
    expect(text).not.toContain("Réglages d'atelier de la pièce");
    expect(text).toContain("Forme de la marche");
    expect(text).toContain("Ouvrir dans Conception");
  });

  it("« Ouvrir dans Conception » : Conception, panneau de la pièce, sélection conservée", () => {
    const model = load(steelFlat());
    const tread = model.parts.find((p) => p.category === "tread")!;
    selectPart(tread.id);
    journeyStore.getState().setWorkspace("fabrication");
    const selection = appStore.getState().selection;
    openPartInDesign(tread);
    expect(journeyStore.getState().workspace).toBe("design");
    expect(journeyStore.getState().freePanel).toBe("treads");
    expect(appStore.getState().selection).toBe(selection);
    const stringer = model.parts.find((p) => p.category === "stringer")!;
    openPartInDesign(stringer);
    expect(journeyStore.getState().freePanel).toBe("structure");
  });
});

describe("parties pures des sorties", () => {
  it("gabarits : famille sans développé désactivée avec son motif ; tous / aucun toujours permis", () => {
    const model = buildModel(createProject("straight"));
    expect(TEMPLATE_CHOICES.map((c) => FR.t(c.label))).toEqual([
      "Tous",
      "Limons et structure",
      "Marches",
      "Garde-corps",
      "Aucun",
    ]);
    expect(templateChoiceReason("all", model)).toBeUndefined();
    expect(templateChoiceReason("none", model)).toBeUndefined();
    expect(templateChoiceReason("stringers", model)).toBe("ui.label.export.noFamilyFlat");
    // Sans modèle : aucun motif (le bouton attend le calcul).
    expect(templateChoiceReason("stringers", null)).toBeUndefined();
    const steel = buildModel(steelFlat());
    expect(templateChoiceReason("stringers", steel)).toBeUndefined();
  });

  it("remplissage du barème : vide → incomplet, 0 / 9", () => {
    const fill = costProfileFill(createProject("straight"), {});
    expect(fill).toEqual({ incomplete: true, applied: 0, total: 9 });
  });

  it("coût de la variante courante au format du comparateur ; aucune ligne courante → null", () => {
    // Lignes réelles de la comparaison (calculée ici), coût imposé.
    const base = runVariants(steelFlat(), [
      { id: "cur", kind: "steel-flat", label: textMessage("Plat") },
    ]).rows[0]!;
    const row = (current: boolean, total: number): VariantRow => ({
      ...base,
      current,
      cost: { total, material: 0, labour: 0, hours: 0, finish: 0 },
    });
    const outcome: CompareOutcome = { rows: [row(false, 99), row(true, 1234)], timeMs: 1 };
    expect(currentCostText(outcome, FR)).toMatch(/^1\s?234\s€$/u);
    expect(currentCostText({ rows: [row(false, 5)], timeMs: 1 }, FR)).toBeNull();
    expect(currentCostText(null, FR)).toBeNull();
  });
});
