/**
 * Mise en page du parcours guidé (maquette 1a, ADR-0009), en rendu serveur, en français et en
 * anglais : barre du haut en variante guidée, barre d'étapes (onglets ARIA, coches, résumés),
 * vue (onglets de l'étape, vue conseillée), pied (comptes du contrôle, mention, étapes
 * précédente / suivante), encart « Vous connaissez le métier ? » et liste du contrôle.
 */
import { DEMO_PRESET_IDS, buildModel, type ComplianceReport, type Model } from "@blondel/core";
import { createTranslator } from "@blondel/i18n";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { controlCounts, groupResults } from "../../lib/compliance.js";
import { toValidateCountByStep } from "../../lib/paramTiers.js";
import { GUIDED_STEPS, type GuidedStep } from "../../lib/sectionIds.js";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { EMPTY_MODEL_VIEW } from "../../store/modelStore.js";
import { uiStore } from "../../store/uiStore.js";
import { TopBar } from "../topbar/TopBar.js";
import { ControlOverlay } from "./ControlOverlay.js";
import { FreeJourneyHint } from "./FreeJourneyHint.js";
import { GuidedFooter } from "./GuidedFooter.js";
import { GuidedView, selectionLegendText } from "./GuidedView.js";
import { StepBar, stepKeyTarget, stepTabId } from "./StepBar.js";

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant des stores.
for (const store of [appStore, modelService.store, journeyStore, uiStore]) {
  (store as { getInitialState: () => unknown }).getInitialState = store.getState;
}

const initialProject = appStore.getState().project;

afterEach(() => {
  appStore.getState().setLocale("fr");
  appStore.getState().replaceProject(initialProject);
  appStore.getState().select(null);
  appStore.getState().setView("plan");
  appStore.getState().setPlanMode("drawing");
  journeyStore.setState({
    journey: "free",
    guidedStep: 1,
    visitedSteps: new Set(),
    hintFreeJourneyDismissed: false,
    workspace: "design",
  });
  uiStore.setState({ guidedControlOpen: false, guidedControlContext: false });
  modelService.store.setState((s) => ({
    model: { ...EMPTY_MODEL_VIEW, pending: true },
    compare: s.compare,
  }));
});

/** Modèle du projet courant (calculé ici, sans le worker), rapport éventuellement remplacé. */
function withModel(report?: ComplianceReport): Model {
  const project = appStore.getState().project;
  const built = buildModel(project);
  const model = report === undefined ? built : { ...built, compliance: report };
  modelService.store.setState((s) => ({
    model: { model, errors: [], timeMs: 1, mesh: null, project, pending: false },
    compare: s.compare,
  }));
  return model;
}

/** Rapport sans aucun résultat (aucune règle bloquante). */
const EMPTY_REPORT = { results: [] } as unknown as ComplianceReport;

function guided(step: GuidedStep = 1): void {
  journeyStore.setState({ journey: "guided", guidedStep: step });
}

function render(component: FunctionComponent, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(component));
}

/** Onglets rendus : balise ouvrante et contenu. */
function tabs(html: string): { open: string; inner: string }[] {
  return [...html.matchAll(/<button([^>]*role="tab"[^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    open: m[1]!,
    inner: m[2]!,
  }));
}

const text = (inner: string): string => inner.replace(/<[^>]+>/g, "");

describe("TopBar en parcours guidé", () => {
  it("grand segmenté Guidé | Libre, Guidé actif ; ni Conception | Fabrication, ni Exporter", () => {
    guided();
    const html = render(TopBar);
    expect(html).toContain("topbar--guided");
    expect(html).toContain("journey-switch--guided");
    expect(html).toMatch(/aria-checked="true"[^>]*>Guidé</);
    for (const absent of ["Exporter", "Importer", ">Conception<", ">Fabrication<", ">Contrôle<"]) {
      expect(html).not.toContain(absent);
    }
    expect(render(TopBar, "en")).toMatch(/aria-checked="true"[^>]*>Guided</);
  });

  it("parcours libre : Guidé n'est pas désactivé", () => {
    const html = render(TopBar);
    expect(html).not.toMatch(/disabled=""[^>]*>Guidé</);
    expect(html).toMatch(/aria-checked="true"[^>]*>Libre</);
  });
});

describe("StepBar", () => {
  it("7 onglets ARIA, étape courante sélectionnée et seule dans l'ordre de tabulation", () => {
    guided(3);
    const html = render(StepBar);
    expect(html).toContain('role="tablist" aria-label="Étapes du parcours"');
    const list = tabs(html);
    expect(list).toHaveLength(7);
    list.forEach((tab, i) => {
      const step = GUIDED_STEPS[i]!;
      expect(tab.open).toContain(`id="${stepTabId(step)}"`);
      expect(tab.open).toContain('aria-controls="guided-step-panel"');
      expect(tab.open).toContain(`aria-selected="${String(step === 3)}"`);
      expect(tab.open).toContain(`tabindex="${step === 3 ? "0" : "-1"}"`);
    });
    expect(list.map((t) => t.inner.match(/step-bar__title">([^<]+)</)?.[1])).toEqual([
      "Site",
      "Forme",
      "Découpage",
      "Marches",
      "Structure",
      "Garde-corps",
      "Fabrication",
    ]);
  });

  it("✓ pour une étape vue sans bloquant, numéro sinon ; « étape faite » dit au lecteur d'écran", () => {
    withModel(EMPTY_REPORT);
    guided(3);
    journeyStore.setState({ visitedSteps: new Set<GuidedStep>([1, 3]) });
    const list = tabs(render(StepBar));
    const badge = (i: number) =>
      list[i]!.inner.match(/step-bar__badge"[^>]*>([\s\S]*?)<\/span>/)![1]!;
    expect(list[0]!.open).toContain('data-done="true"');
    expect(badge(0)).toContain("<svg");
    expect(list[0]!.inner).toContain('<span class="visually-hidden">étape faite</span>');
    expect(list[1]!.open).not.toContain("data-done");
    expect(badge(1)).toBe("2");
    expect(list[1]!.inner).not.toContain("étape faite");
    // Étape active et faite : pastille foncée (CSS), avec ✓.
    expect(list[2]!.open).toContain('data-done="true"');
    expect(list[2]!.open).toContain('aria-selected="true"');
  });

  it("étape vue mais règle bloquante rattachée : pas de ✓", () => {
    const blocking = {
      results: [
        {
          ruleId: "H_MAX",
          status: "violation",
          severity: "bloquant",
          declaredSeverity: "bloquant",
        },
      ],
    } as unknown as ComplianceReport;
    withModel(blocking);
    guided(1);
    journeyStore.setState({ visitedSteps: new Set<GuidedStep>([1, 3]) });
    const list = tabs(render(StepBar));
    expect(list[0]!.open).toContain('data-done="true"');
    expect(list[2]!.open).not.toContain("data-done");
  });

  it("résumé en ocre (data-to-validate) seulement s'il reste des ◆ à l'étape", () => {
    for (const id of DEMO_PRESET_IDS) {
      appStore.getState().loadDemo(id);
      const model = withModel();
      guided(1);
      const counts = toValidateCountByStep(appStore.getState().project, model);
      const list = tabs(render(StepBar));
      GUIDED_STEPS.forEach((step, i) => {
        const flagged = /step-bar__summary" data-to-validate="true"/.test(list[i]!.inner);
        expect(flagged, `${id}, étape ${step}`).toBe(counts[step] > 0);
      });
    }
    // Au moins une démo garde des ◆ à valider (l'étape 7 les reprend toutes).
    const some = DEMO_PRESET_IDS.some((id) => {
      appStore.getState().loadDemo(id);
      return toValidateCountByStep(appStore.getState().project, withModel())[7] > 0;
    });
    expect(some).toBe(true);
  });

  it("résumé : base tronquable et partie ◆ à part (jamais coupée), un seul nom pour la liste", () => {
    appStore.getState().loadDemo("demo-quarter-curved");
    const model = withModel();
    guided(1);
    const counts = toValidateCountByStep(appStore.getState().project, model);
    const html = render(StepBar);
    // Pas de repère `nav` doublant le nom de la liste d'onglets.
    expect(html).not.toContain("<nav");
    expect(html.match(/aria-label="Étapes du parcours"/g)).toHaveLength(1);
    const step5 = tabs(html)[4]!.inner;
    expect(text(step5)).toContain("Débillardé soudé · S235");
    expect(step5).toMatch(/<span class="step-bar__summary-base">Débillardé soudé · S235<\/span>/);
    expect(step5).toContain(
      `<span class="step-bar__summary-tv" aria-hidden="true">· ◆ ${counts[5]}</span>`,
    );
    expect(step5).toMatch(new RegExp(`visually-hidden">${counts[5]} valeurs? à valider<`));
  });

  it("anglais : titres traduits, aucun libellé français", () => {
    guided(1);
    const html = render(StepBar, "en");
    expect(html).toContain('aria-label="Journey steps"');
    expect(tabs(html).map((t) => t.inner.match(/step-bar__title">([^<]+)</)?.[1])).toEqual([
      "Site",
      "Shape",
      "Stepping",
      "Treads",
      "Structure",
      "Guarding",
      "Fabrication",
    ]);
    expect(html).not.toContain("Étapes du parcours");
  });

  it("clavier : flèches gauche / droite bouclent, Début / Fin aux extrémités", () => {
    expect(stepKeyTarget(0, "ArrowRight")).toBe(1);
    expect(stepKeyTarget(0, "ArrowLeft")).toBe(6);
    expect(stepKeyTarget(6, "ArrowRight")).toBe(0);
    expect(stepKeyTarget(3, "Home")).toBe(0);
    expect(stepKeyTarget(3, "End")).toBe(6);
    expect(stepKeyTarget(3, "Enter")).toBeNull();
  });
});

describe("GuidedFooter", () => {
  it("comptes du contrôle, mention indicative ; pas d'étape précédente à l'étape 1", () => {
    const model = withModel();
    const counts = controlCounts(groupResults(model.compliance));
    guided(1);
    const html = render(GuidedFooter);
    expect(html).toContain(
      "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
    );
    expect(html).toContain(`${counts.avertissement} avertissement`);
    expect(html).toContain(`${counts.conseil} conseil`);
    expect(html.includes('data-severity="bloquant"')).toBe(counts.bloquant > 0);
    expect(html).not.toContain("Étape précédente");
    expect(html).toContain('aria-label="Étape suivante : Forme"');
    expect(html).toContain("btn btn-primary blueprint");
  });

  it("étape 3 : précédente « Forme », suivante « Marches » ; étape 7 : pas de suivante", () => {
    guided(3);
    let html = render(GuidedFooter);
    expect(html).toContain('aria-label="Étape précédente : Forme"');
    expect(html).toContain('aria-label="Étape suivante : Marches"');
    guided(7);
    html = render(GuidedFooter);
    expect(html).toContain('aria-label="Étape précédente : Garde-corps"');
    expect(html).not.toContain("Étape suivante");
  });

  it("bloquants affichés s'il y en a ; sans modèle, ni compte ni bouton de sévérité", () => {
    guided(2);
    expect(render(GuidedFooter)).not.toContain("guided-footer__count");
    withModel({
      results: [
        {
          ruleId: "H_MAX",
          status: "violation",
          severity: "bloquant",
          declaredSeverity: "bloquant",
        },
      ],
    } as unknown as ComplianceReport);
    const html = render(GuidedFooter);
    expect(html).toContain('data-severity="bloquant"');
    expect(html).toContain("1 bloquant");
    expect(html).toContain("0 avertissement");
  });

  it("anglais", () => {
    withModel();
    guided(3);
    const html = render(GuidedFooter, "en");
    expect(html).toContain("Design check");
    expect(html).toContain('aria-label="Previous step: Shape"');
    expect(html).toContain('aria-label="Next step: Treads"');
    for (const fr of ["Étape", "avertissement", "conseil", "indicatif"]) {
      expect(text(html)).not.toContain(fr);
    }
    expect(html).not.toContain("Étape");
  });
});

describe("GuidedView", () => {
  it("étape 3 : Élévation | Plan | 3D, vue conseillée signalée en élévation", () => {
    guided(3);
    appStore.getState().setView("elevation");
    const html = render(GuidedView);
    const list = tabs(html);
    expect(list.map((t) => text(t.inner))).toEqual(["Élévation", "Plan", "3D"]);
    expect(list.map((t) => t.open.match(/id="([^"]+)"/)?.[1])).toEqual([
      "tab-elevation",
      "tab-plan",
      "tab-3d",
    ]);
    expect(html).toContain('role="tablist" aria-label="Vues"');
    expect(html).toContain("Vue conseillée pour cette étape");
    expect(html).toMatch(/id="view-panel" role="tabpanel" aria-labelledby="tab-elevation"/);
    expect(html).toContain("view blueprint guided-view__frame");
    expect(html).toMatch(/id="view-panel"[^>]*tabindex="0"/);
    expect(html).toContain("Recadrer");
  });

  it("vue différente de la conseillée : pas de mention", () => {
    guided(3);
    appStore.getState().setView("3d");
    expect(render(GuidedView)).not.toContain("Vue conseillée");
    // Étape 1 : plan « Site et saisie » conseillé, plan coté non.
    guided(1);
    appStore.getState().setView("plan");
    appStore.getState().setPlanMode("drawing");
    expect(render(GuidedView)).not.toContain("Vue conseillée");
    appStore.getState().setPlanMode("site");
    expect(render(GuidedView)).toContain("Vue conseillée");
  });

  it("étape 7 : Pièces | Nomenclature | Comparer | 3D ; vue hors onglets → vue conseillée", () => {
    guided(7);
    appStore.getState().setView("elevation");
    const html = render(GuidedView);
    expect(tabs(html).map((t) => text(t.inner))).toEqual([
      "Pièces",
      "Nomenclature",
      "Comparer",
      "3D",
    ]);
    expect(html).toMatch(/id="view-panel" role="tabpanel" aria-labelledby="tab-flat"/);
    expect(html).not.toContain("Vue conseillée");
  });

  it("légende de la sélection : marche ou pièce, absente sans sélection", () => {
    const model = withModel();
    guided(3);
    appStore.getState().setView("elevation");
    expect(render(GuidedView)).not.toContain("guided-view__selection");
    appStore.getState().select({ location: { kind: "tread", number: 3 } });
    expect(text(render(GuidedView))).toContain("Marche 3 sélectionnée");
    expect(text(render(GuidedView, "en"))).toContain("Tread 3 selected");
    const part = model.parts[0]!;
    appStore.getState().select({ location: { kind: "part", partId: part.id } });
    expect(text(render(GuidedView))).toContain(`Pièce ${part.mark} sélectionnée`);
    const t = createTranslator("fr");
    expect(selectionLegendText(null, model, t)).toBeNull();
    expect(selectionLegendText({ location: { kind: "tread", number: 999 } }, model, t)).toBeNull();
  });

  it("anglais : onglets traduits", () => {
    guided(3);
    appStore.getState().setView("elevation");
    const html = render(GuidedView, "en");
    expect(tabs(html).map((t) => text(t.inner))).toEqual(["Elevation", "Plan", "3D"]);
    expect(html).toContain("Recommended view for this step");
    expect(html).not.toContain("conseillée");
  });
});

describe("FreeJourneyHint", () => {
  it("encart nommé par son titre ; absent une fois fermé", () => {
    guided(3);
    const html = render(FreeJourneyHint);
    expect(html).toMatch(
      /<aside class="free-hint" aria-labelledby="([^"]+)"><div[^>]*><h2 id="\1"/,
    );
    for (const s of [
      "Vous connaissez le métier ?",
      "Le parcours libre montre toutes les sections",
      "Passer en parcours libre",
      'aria-label="Fermer l&#x27;encart"',
    ]) {
      expect(html).toContain(s);
    }
    const en = render(FreeJourneyHint, "en");
    expect(en).toContain("Switch to free mode");
    expect(en).not.toContain("parcours");
    journeyStore.getState().dismissFreeJourneyHint();
    expect(render(FreeJourneyHint)).toBe("");
  });

  it("dans la vue du guidé tant qu'il n'est pas fermé", () => {
    guided(3);
    expect(render(GuidedView)).toContain('class="free-hint"');
    journeyStore.setState({ hintFreeJourneyDismissed: true });
    expect(render(GuidedView)).not.toContain('class="free-hint"');
  });
});

describe("ControlOverlay", () => {
  it("rendu seulement si la liste est ouverte", () => {
    guided(3);
    expect(render(ControlOverlay)).toBe("");
    withModel();
    uiStore.setState({ guidedControlOpen: true });
    const html = render(ControlOverlay);
    expect(html).toContain('role="dialog" aria-modal="false"');
    expect(html).toContain("Contrôle de conception");
    expect(html).toContain('aria-label="Fermer le contrôle"');
    expect(html).toContain("<summary>Contexte de contrôle</summary>");
    expect(html).toContain('class="inspector"');
    expect(html).not.toMatch(/<details[^>]*open=""/);
  });

  it("Contexte de contrôle déplié par guidedControlContext ; anglais", () => {
    withModel();
    guided(3);
    uiStore.setState({ guidedControlOpen: true, guidedControlContext: true });
    expect(render(ControlOverlay)).toMatch(/<details class="control-overlay__context" open=""/);
    const en = render(ControlOverlay, "en");
    expect(en).toContain('aria-label="Close the design check"');
    expect(en).toContain("Design check context");
    expect(en).not.toContain("Contexte");
  });
});
