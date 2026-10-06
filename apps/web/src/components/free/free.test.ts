/**
 * Parcours libre (ADR-0009, maquette 1b) : rail des 8 sections, panneau unique, bande de chiffres
 * clés, en français et en anglais (rendu serveur). Reprend la couverture de l'ancien panneau de
 * paramètres (`paramsPanel.i18n.test.ts`) : mêmes libellés, section par section.
 */
import { buildModel, createProject, type Project } from "@blondel/core";
import { createTranslator } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGuards } from "../../lib/guardsForm.js";
import { switchLayoutKind } from "../../lib/layoutKind.js";
import { SECTION_IDS, type SectionId } from "../../lib/sectionIds.js";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { FreePanel, focusRailTab } from "./FreePanel.js";
import { Rail, disabledSections, railKeyTarget, railTabStop } from "./Rail.js";
import { sectionFigures } from "./SectionFigures.js";

const initial = appStore.getState().project;
const initialJourney = journeyStore.getState();

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant des stores.
appStore.getInitialState = appStore.getState;
journeyStore.getInitialState = journeyStore.getState;
modelService.store.getInitialState = modelService.store.getState;

/** Projet courant et son modèle (calculé ici, sans le worker). */
function load(p: Project): void {
  appStore.getState().replaceProject(p);
  const model = buildModel(appStore.getState().project);
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project: appStore.getState().project, pending: false },
  }));
}

afterEach(() => {
  appStore.getState().setLocale("fr");
  appStore.getState().setDisplayUnit("mm");
  load(initial);
  journeyStore.setState({
    freePanel: initialJourney.freePanel,
    freePanelPinned: initialJourney.freePanelPinned,
    freePanelFromGuided: false,
  });
});

function panel(section: SectionId, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  journeyStore.setState({ freePanel: section });
  return renderToStaticMarkup(createElement(FreePanel));
}

function rail(locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(Rail));
}

/** Tous les panneaux, l'un après l'autre. */
function allPanels(locale: "fr" | "en"): string {
  return SECTION_IDS.map((id) => panel(id, locale)).join("");
}

/** Onglets du rail : balise ouvrante et contenu. */
function tabs(html: string): { open: string; inner: string }[] {
  return [...html.matchAll(/<button([^>]*role="tab"[^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    open: m[1]!,
    inner: m[2]!,
  }));
}

/** Texte accessible d'un contenu : sans balises ni éléments `aria-hidden`. */
function accessibleText(inner: string): string {
  return inner
    .replace(/<([a-z]+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

describe("panneau unique : libellés de l'ancien panneau, section par section", () => {
  it("français : libellés inchangés", () => {
    load({ ...initial, guards: defaultGuards() });
    const html = allPanels("fr");
    for (const text of [
      "Hauteur à monter H",
      "Recaler volées et trémie",
      "Ajouter une volée",
      "Contexte de contrôle",
      "Aucune (marches, contremarches, paliers)",
      "Nombre de hauteurs n",
      "Épaisseur de marche",
      "Garde-corps de volée",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("anglais : libellés traduits, aucun texte français ni clé brute", () => {
    load({ ...initial, guards: defaultGuards() });
    const html = allPanels("en");
    for (const text of [
      "Total rise H",
      "Realign flights and opening",
      "Add a flight",
      "Design check context",
      "None (treads, risers, landings)",
      "Pin the panel",
      "Close the panel",
      "Key figures of the section",
    ]) {
      expect(html).toContain(text);
    }
    for (const text of ["Hauteur à monter", "Recaler", "Ajouter une volée", "Réglages"]) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toMatch(/\b(ui|compliance|assistant)\.[a-z]+\.[\w.]+/);
  });

  it("hélicoïdal : formulaire traduit", () => {
    load(switchLayoutKind(initial, "helical").project);
    expect(panel("layout")).toContain("Sens de rotation en montant");
    const html = panel("layout", "en");
    expect(html).toContain("Direction of rotation going up");
    expect(html).toContain("Stair width W = R_e − r: ");
    expect(html).not.toContain("Rayon extérieur");
    expect(html).not.toMatch(/\b(ui|compliance|assistant)\.[a-z]+\.[\w.]+/);
  });

  it("libre : niveau Atelier replié sous « Réglages d'atelier »", () => {
    load({ ...initial, guards: defaultGuards() });
    const html = panel("guards");
    expect(html).toContain("tiered__fold--workshop");
    expect(html).toContain("Réglages d&#x27;atelier");
  });
});

describe("FreePanel", () => {
  it("aucun panneau ouvert : rien", () => {
    journeyStore.setState({ freePanel: null });
    expect(renderToStaticMarkup(createElement(FreePanel))).toBe("");
  });

  it("titre, onglet qui le nomme, épingle et croix", () => {
    load(createProject("quarter-left"));
    journeyStore.setState({ freePanelPinned: false });
    const html = panel("stepping");
    expect(html).toMatch(
      /<aside id="free-panel" class="free-panel" role="tabpanel" aria-labelledby="rail-tab-stepping">/,
    );
    expect(html).toContain('<h3 class="free-panel__title">Découpage</h3>');
    expect(html).toMatch(/aria-pressed="false" aria-label="Épingler le panneau"/);
    expect(html).toContain('aria-label="Fermer le panneau"');
    journeyStore.setState({ freePanelPinned: true });
    expect(panel("stepping")).toMatch(/aria-pressed="true" aria-label="Épingler le panneau"/);
  });

  it("note « ouvert depuis le guidé » seulement après la bascule", () => {
    const note = "Ouvert sur la section où vous étiez dans le parcours guidé.";
    journeyStore.setState({ freePanelFromGuided: false });
    expect(panel("site")).not.toContain(note);
    journeyStore.setState({ freePanelFromGuided: true });
    expect(panel("site")).toContain(note);
    expect(panel("site", "en")).toContain("Opened on the section you were at");
  });

  it("bande de chiffres de Découpage : n, h, 2h + g", () => {
    load(createProject("quarter-left"));
    const st = buildModel(appStore.getState().project).stepping;
    const html = panel("stepping");
    expect(html).toContain('aria-label="Chiffres clés de la section"');
    expect(html).toContain(`<dt>n</dt><dd>${st.riserCount}</dd>`);
    // Unité à droite du chiffre, jamais dans la légende (spécification de contenu § 1).
    const rise = Math.round(st.rise);
    expect(html).toContain(`<dt>h</dt><dd>${rise}<span class="section-figures__unit">mm</span>`);
    expect(html).toContain("<dt>2h + g</dt><dd>");
    expect(html).not.toMatch(/<dt>[^<]*mm<\/dt>/);
    appStore.getState().setDisplayUnit("cm");
    expect(panel("stepping")).toMatch(
      /<dt>h<\/dt><dd>[\d,]+<span class="section-figures__unit">cm<\/span>/,
    );
  });

  it("bande de chiffres de Découpage : cinq chiffres sur trois colonnes, aucune case vide", () => {
    load(createProject("quarter-left"));
    const html = panel("stepping");
    expect(html).toContain("--figure-cols:3");
    // n, h, g sur la première ligne ; 2h + g, puis l'échappée qui s'étend jusqu'au bord.
    expect(html).toMatch(/data-figure="headroom" style="grid-column:span 2 \/ span 2"/);
  });

  it("balancement sans tournant : message au lieu des champs", () => {
    load(createProject("straight"));
    const html = panel("balancing");
    expect(html).toContain("Sans objet pour un escalier droit.");
    expect(html).not.toContain("Méthode");
    expect(html).not.toContain("section-figures");
    load(createProject("quarter-left"));
    expect(panel("balancing")).toContain("Méthode");
  });
});

describe("Rail", () => {
  it("8 onglets dans l'ordre, nom = libellé seul, onglet ouvert sélectionné", () => {
    load(createProject("quarter-left"));
    journeyStore.setState({ freePanel: "treads" });
    const html = rail();
    expect(html).toContain('<nav class="rail" aria-label="Sections du projet">');
    expect(html).toContain('role="tablist" aria-label="Sections" aria-orientation="vertical"');
    const list = tabs(html);
    expect(list.map((t) => /id="rail-tab-(\w+)"/.exec(t.open)![1])).toEqual([...SECTION_IDS]);
    expect(list.map((t) => accessibleText(t.inner))).toEqual([
      "Site",
      "Tracé",
      "Découpage",
      "Balancement",
      "Marches",
      "Structure",
      "Garde-corps",
      "Contexte",
    ]);
    for (const t of list) {
      expect(t.open).not.toContain("aria-label");
    }
    const selected = list.filter((t) => t.open.includes('aria-selected="true"'));
    expect(selected).toHaveLength(1);
    // `aria-controls` seulement vers un panneau présent dans le DOM (onglet ouvert).
    expect(list.filter((t) => t.open.includes('aria-controls="free-panel"'))).toEqual(selected);
    expect(selected[0]!.open).toContain('id="rail-tab-treads"');
    // Un seul arrêt de tabulation : l'onglet ouvert.
    expect(list.filter((t) => t.open.includes('tabindex="0"'))).toHaveLength(1);
    expect(selected[0]!.open).toContain('tabindex="0"');
    expect(rail("en")).toContain(">Context<");
  });

  it("◆ n masqué aux lecteurs d'écran, décrit à part", () => {
    load({ ...withStructure("steel-flat"), guards: defaultGuards() });
    const html = rail();
    const guards = tabs(html).find((t) => t.open.includes("rail-tab-guards"))!;
    const count = /◆ (\d+)/.exec(guards.inner);
    expect(count).not.toBeNull();
    expect(guards.inner).toMatch(/aria-hidden="true">◆ \d+<\/span>/);
    const describedBy = /aria-describedby="([^"]+)"/.exec(guards.open)![1]!;
    expect(html).toContain(
      `<span id="${describedBy}" class="visually-hidden">${count![1]} valeurs à valider</span>`,
    );
  });

  it("Balancement désactivé sans tournant", () => {
    load(createProject("straight"));
    const off = tabs(rail()).find((t) => t.open.includes("rail-tab-balancing"))!;
    expect(off.open).toContain('aria-disabled="true"');
    expect(off.open).toContain(
      'title="Balancement sans objet : le tracé n&#x27;a pas de tournant."',
    );
    load(createProject("quarter-left"));
    const on = tabs(rail()).find((t) => t.open.includes("rail-tab-balancing"))!;
    expect(on.open).not.toContain("aria-disabled");
  });
});

const withStructure = (kind: string): Project => ({
  ...initial,
  stair: { ...initial.stair, structure: { kind, params: {} } },
});

describe("clavier du rail (onglets, activation manuelle)", () => {
  const none = disabledSections(1);
  const straight = disabledSections(0);

  it("flèches dans les deux axes, Début / Fin, bouclage", () => {
    expect(railKeyTarget(0, "ArrowDown", none)).toBe(1);
    expect(railKeyTarget(0, "ArrowRight", none)).toBe(1);
    expect(railKeyTarget(0, "ArrowUp", none)).toBe(7);
    expect(railKeyTarget(0, "ArrowLeft", none)).toBe(7);
    expect(railKeyTarget(3, "Home", none)).toBe(0);
    expect(railKeyTarget(3, "End", none)).toBe(7);
    expect(railKeyTarget(3, "Enter", none)).toBeNull();
    expect(railKeyTarget(3, "a", none)).toBeNull();
  });

  it("Balancement sauté sans tournant", () => {
    expect(straight.has("balancing")).toBe(true);
    expect(none.size).toBe(0);
    expect(railKeyTarget(2, "ArrowDown", straight)).toBe(4);
    expect(railKeyTarget(4, "ArrowUp", straight)).toBe(2);
  });

  it("arrêt de tabulation : l'onglet ouvert, sinon le premier disponible", () => {
    expect(railTabStop(null, none)).toBe(0);
    expect(railTabStop("guards", none)).toBe(6);
    expect(railTabStop("balancing", straight)).toBe(0);
  });
});

describe("Échap (chaîne globale, components/escapeChain.ts)", () => {
  it("retour du focus au rail : sans effet hors navigateur", () => {
    expect(() => focusRailTab("site")).not.toThrow();
  });
});

describe("chiffres clés par section (lectures seulement)", () => {
  const fr = createTranslator("fr");

  it("chaque section a au moins un chiffre ; projet complet : aucun « – » hors structure", () => {
    const p = { ...createProject("quarter-left"), guards: defaultGuards() };
    const model = buildModel(p);
    for (const id of SECTION_IDS) {
      const figures = sectionFigures(
        id,
        { project: p, model, unit: "mm", structureMass: 1, treadMass: 1 },
        fr,
      );
      expect(figures.length, id).toBeGreaterThan(0);
      if (id !== "structure") {
        for (const f of figures) expect(f.value, `${id} ${f.id}`).not.toBe("–");
      }
    }
  });

  it("site : trémie rectangulaire, tracée, aucune", () => {
    const p = createProject("quarter-left");
    const src = { project: p, model: null, unit: "mm" as const, structureMass: undefined };
    const opening = (project: Project) =>
      sectionFigures("site", { ...src, project }, fr).find((f) => f.id === "opening")!.value;
    const o = p.site.opening;
    expect(o?.kind).toBe("rect");
    if (o?.kind === "rect") {
      expect(opening(p)).toBe(`${fr.num(o.sizeX)} × ${fr.num(o.sizeY)}`.replace(/,0/g, ""));
    }
    const { opening: _o, ...siteWithout } = p.site;
    expect(opening({ ...p, site: siteWithout })).toBe("aucune");
    const polygon: Project = {
      ...p,
      site: {
        ...p.site,
        opening: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 0, y: 1000 },
          ],
        },
      },
    };
    expect(opening(polygon)).toBe("tracée · 3 sommets");
    // Sans modèle : échappée inconnue.
    expect(sectionFigures("site", src, fr).find((f) => f.id === "headroom")!.value).toBe("–");
  });

  it("structure acier : masse (nomenclature), classe d'exécution, limons vérifiés", () => {
    load(withStructure("steel-flat"));
    const html = panel("structure");
    const cell = (id: string) =>
      new RegExp(`data-figure="${id}"[^>]*><dt>[^<]*</dt><dd>([^<]*)`).exec(html)?.[1];
    expect(cell("mass")).toMatch(/^\d[\d\s  ]*$/);
    expect(html).toMatch(
      /data-figure="mass"[^>]*><dt>masse de la structure<\/dt><dd>[^<]*<span class="section-figures__unit">kg<\/span>/,
    );
    expect(cell("executionClass")).toMatch(/^EXC[12]$/);
    expect(cell("precheck")).toMatch(/^\d+ \/ \d+$/);
  });

  it("garde-corps absents : « aucun garde-corps »", () => {
    const p = createProject("straight");
    const f = sectionFigures(
      "guards",
      { project: p, model: buildModel(p), unit: "mm", structureMass: undefined },
      fr,
    );
    expect(f).toEqual([{ id: "guards", value: "–", caption: "aucun garde-corps" }]);
  });
});
