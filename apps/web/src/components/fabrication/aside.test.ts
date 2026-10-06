/**
 * Colonne de droite du mode Fabrication : réglages d'atelier de la pièce (niveau Atelier
 * seulement, ◆ non validées), encart « Forme du … » et retour vers la Conception, invitation
 * sans pièce, sorties (dossier PDF, fiche de pose, liste de débit, autres exports, coût) ; parties
 * pures (choix des gabarits, remplissage du barème, coût de la variante courante).
 * Rendu serveur, modèle calculé ici sans le worker.
 */
import { buildModel, createProject, type CostRates, type Model, type Project } from "@blondel/core";
import { textMessage, translatorFor } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGuards } from "../../lib/guardsForm.js";
import { structureParamEntry } from "../../lib/paramTiers.js";
import { toValidateRows, validationEntry } from "../../lib/toValidate.js";
import { runVariants, type CompareOutcome, type VariantRow } from "../../lib/variants.js";
import { COST_FIELDS, withWorkshopRates } from "../../lib/workshopRates.js";
import { appStore, journeyStore, modelService, workshopStore } from "../../store/appStore.js";
import { uiStore } from "../../store/uiStore.js";
import { CostEstimate, costProfileFill, currentCostText } from "./CostEstimate.js";
import { FabricationAside, openPartInDesign } from "./FabricationAside.js";
import { TEMPLATE_CHOICES, templateChoiceReason } from "./OutputsBlock.js";
import { ToValidateList } from "./ToValidateList.js";

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
  // Un projet de l'assistant ouvre le guidé : ces tests portent sur le parcours libre.
  journeyStore.getState().setJourney("free");
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
    // Le glyphe de la mention est masqué aux lecteurs d'écran.
    expect(html).toContain(
      '<small class="part-insp__tv-note"><span class="tv-mark tv-mark--inherit" aria-hidden="true">◆</span> valeur par défaut à valider</small>',
    );
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

  it("poteau de garde-corps : réglages Atelier de la section Garde-corps, note de portée", () => {
    const model = load({ ...createProject("straight"), guards: defaultGuards() });
    const post = model.parts.find((p) => p.family === "guards" && p.category === "post")!;
    selectPart(post.id);
    const html = render();
    const text = decode(html);
    expect(text).toContain("Réglages d'atelier de la pièce");
    expect(text).toContain(FR.t("ui.guards.posts.size"));
    expect(text).toContain(FR.t("ui.fabAside.workshop.noteGuards"));
    expect(text).not.toContain(FR.t("ui.fabAside.workshop.note"));
    // Niveau Atelier seulement : la hauteur de main courante (Conception) n'est pas reprise.
    expect(html).toContain('data-setting="guards.posts.size"');
    expect(html).toContain('data-to-validate="true"');
    expect(text).toContain("Forme du garde-corps");
    noRawKeys(html);
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

describe("liste des valeurs ◆", () => {
  const html = (): string =>
    decode(renderToStaticMarkup(createElement(ToValidateList, { variant: "compact" })));

  it("projet sans valeur ◆ : seul « Aucune valeur à valider », ni « toutes validées », ni « Tout valider »", () => {
    load(createProject("straight"));
    const empty = html();
    expect(empty).toContain(FR.t("ui.toValidate.noneInProject"));
    expect(empty).not.toContain(FR.t("ui.toValidate.allValidated"));
    expect(empty).not.toContain("Tout valider");
    // Avec des valeurs ◆ : compte et bouton reviennent.
    load(steelFlat());
    const full = html();
    expect(full).toContain("Tout valider");
    expect(full).not.toContain(FR.t("ui.toValidate.noneInProject"));
  });

  it("guidé imposé (< 760 px) : réglage sans étape guidée (M6) → explication, pas de « Ouvrir » inerte", () => {
    const base = createProject("quarter-left");
    load({
      ...base,
      stair: { ...base.stair, balancing: { ...base.stair.balancing, method: "M6" } },
    });
    const narrowNote = FR.t("ui.topbar.journey.freeNarrow");
    const rotation = (out: string): string =>
      out.split("<li").find((li) => li.includes(FR.t("ui.params.rotation.reach"))) ?? "";
    // Fenêtre large : « Ouvrir » partout.
    expect(rotation(html())).toContain(FR.t("ui.toValidate.open"));
    journeyStore.setState({ journey: "guided", guidedImposed: true });
    try {
      const narrow = html();
      expect(rotation(narrow)).toContain(narrowNote);
      expect(rotation(narrow)).not.toContain(`>${FR.t("ui.toValidate.open")}<`);
    } finally {
      journeyStore.setState({ journey: "free", guidedImposed: false });
    }
  });

  it("glyphe ◆ hors des noms accessibles : titre de la région, cases, compteur", () => {
    load(steelFlat());
    const raw = renderToStaticMarkup(createElement(ToValidateList, { variant: "compact" }));
    // Titre : « Valeurs ◆ à valider » visible mais masqué aux lecteurs d'écran, nom sans glyphe.
    expect(raw).toMatch(
      /<h2 id="[^"]+" class="tv-list__title"><span aria-hidden="true">Valeurs ◆ à valider<\/span><span class="visually-hidden">Valeurs à valider<\/span><\/h2>/,
    );
    // Aucun attribut de nom ou de titre ne contient le glyphe.
    expect(raw).not.toMatch(/(aria-label|title)="[^"]*◆/);
    // Chaque ◆ visible est dans un élément aria-hidden.
    const visible = raw.replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, "");
    expect(visible).not.toContain("◆");
    // Toutes validées : message sans glyphe.
    const rows = toValidateRows(
      appStore.getState().project,
      buildModel(appStore.getState().project),
    );
    const entries = rows.map(validationEntry).filter((e) => e !== null);
    expect(appStore.getState().setValuesValidated(entries, true).ok).toBe(true);
    expect(html()).toContain(FR.t("ui.toValidate.allValidated"));
    expect(FR.t("ui.toValidate.allValidated")).not.toContain("◆");
    appStore.getState().undo();
  });
});

describe("ligne « Coût estimé » (rendu serveur)", () => {
  const initialRates = workshopStore.getState().rates;
  const initialCompare = modelService.store.getState().compare;
  afterEach(() => {
    workshopStore.setState({ rates: initialRates });
    modelService.store.setState({ compare: initialCompare });
  });

  const FULL_RATES = Object.fromEntries(COST_FIELDS.map((f) => [f.key, 2])) as CostRates;

  /** Comparaison terminée pour le projet effectivement comparé (barème fusionné). */
  function compareDone(rows: readonly VariantRow[]): void {
    const requested = withWorkshopRates(
      appStore.getState().project,
      workshopStore.getState().rates,
    );
    modelService.store.setState({
      compare: { project: requested, outcome: { rows, timeMs: 1 }, pending: false },
    });
  }

  it("barème incomplet : lien « Compléter le profil d'atelier (n / 9) », aucun coût", () => {
    load(steelFlat());
    workshopStore.getState().setRates({ hourlyRate: 50, minutesPerCut: 2 });
    const text = decode(renderToStaticMarkup(createElement(CostEstimate)));
    expect(text).toContain("Coût estimé");
    expect(text).toContain("Compléter le profil d'atelier (2 / 9)");
    expect(text).not.toContain("€");
  });

  it("barème complet : « calcul… » tant que la comparaison du projet courant manque", () => {
    load(steelFlat());
    workshopStore.getState().setRates(FULL_RATES);
    const html = renderToStaticMarkup(createElement(CostEstimate));
    expect(html).toContain('role="status"');
    expect(decode(html)).toContain("calcul…");
    expect(decode(html)).not.toContain("Compléter le profil d'atelier");
  });

  it("barème complet et comparaison terminée : coût de la variante courante", () => {
    load(steelFlat());
    workshopStore.getState().setRates(FULL_RATES);
    const base = runVariants(steelFlat(), [
      { id: "cur", kind: "steel-flat", label: textMessage("Plat") },
    ]).rows[0]!;
    compareDone([
      {
        ...base,
        current: true,
        cost: { total: 1234, material: 0, labour: 0, hours: 0, finish: 0 },
      },
    ]);
    const html = renderToStaticMarkup(createElement(CostEstimate));
    const text = decode(html);
    expect(html).toContain('class="fab-cost__value num"');
    expect(text).toMatch(/1\s?234\s€/u);
    expect(text).not.toContain("calcul…");
    // Aucune variante courante : lien vers le comparateur.
    compareDone([{ ...base, current: false }]);
    expect(decode(renderToStaticMarkup(createElement(CostEstimate)))).toContain(
      "Voir le coût dans le comparateur",
    );
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
