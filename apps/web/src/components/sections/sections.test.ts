/**
 * Sections de paramètres autonomes (ADR-0009) : répartition par niveau selon le mode
 * d'affichage (étape guidée, panneau libre, tout), en français et en anglais ; table des
 * composants et des titres ; clés du dictionnaire employées par les sections.
 */
import { buildModel, createProject, type Project } from "@blondel/core";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGuards } from "../../lib/guardsForm.js";
import { TIER_KEYS, tierEntry, type Display } from "../../lib/paramTiers.js";
import { SECTION_IDS } from "../../lib/sectionIds.js";
import { pendingValidationEntries, toValidateRows } from "../../lib/toValidate.js";
import { appStore, modelService } from "../../store/appStore.js";
import { SECTION_COMPONENTS, SECTION_TITLE_KEYS, type SectionProps } from "./index.js";
import {
  chooseOpeningKind,
  openingKindOf,
  openingMemoryFor,
  proposedRectOpening,
  removeWall,
  type OpeningMemory,
} from "./SiteSection.js";

const initial = appStore.getState().project;

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant des stores.
appStore.getInitialState = appStore.getState;
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
  load(initial);
});

function render(
  component: ComponentType<SectionProps>,
  display: Display,
  locale: "fr" | "en" = "fr",
): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(component, { display }));
}

/** Contenu du `<details>` replié d'une zone (« Plus de réglages » ou « Réglages d'atelier »). */
function fold(html: string, kind: "more" | "workshop"): string {
  const start = html.indexOf(`tiered__fold--${kind}`);
  if (start < 0) return "";
  const end = html.indexOf("</details>", start);
  return html.slice(start, end);
}

const withStructure = (kind: string): Project => ({
  ...initial,
  stair: { ...initial.stair, structure: { kind, params: {} } },
});

describe("table des sections", () => {
  it("composants et titres couvrent les huit sections", () => {
    expect(Object.keys(SECTION_COMPONENTS)).toEqual([...SECTION_IDS]);
    expect(Object.keys(SECTION_TITLE_KEYS)).toEqual([...SECTION_IDS]);
  });
});

describe("guidé, étape 3 (Découpage)", () => {
  const step3: Display = { kind: "guided", step: 3 };

  it("n, h et g visibles ; correction de la 1re hauteur sous « Plus de réglages »", () => {
    load(initial);
    const html = render(SECTION_COMPONENTS.stepping, step3);
    const main = html.slice(0, html.indexOf("<details"));
    for (const text of ["Nombre de hauteurs n", "Hauteur de marche cible", "Giron cible"]) {
      expect(main).toContain(text);
    }
    expect(main).not.toContain("Correction de la 1re hauteur");
    const more = fold(html, "more");
    expect(more).toContain("Plus de réglages");
    expect(more).toContain("Correction de la 1re hauteur");
    expect(fold(html, "workshop")).toBe("");
  });

  it("rien d'autre : les autres sections sont vides à l'étape 3", () => {
    load({ ...initial, guards: defaultGuards() });
    for (const id of SECTION_IDS) {
      if (id === "stepping") continue;
      expect(render(SECTION_COMPONENTS[id], step3), id).toBe("");
    }
  });

  it("anglais : zone repliée traduite", () => {
    load(initial);
    const html = render(SECTION_COMPONENTS.stepping, step3, "en");
    expect(html).toContain("More settings");
    expect(html).toContain("First rise correction");
    expect(html).not.toContain("Plus de réglages");
  });
});

describe("libre, garde-corps", () => {
  const free: Display = { kind: "free" };

  it("poteaux sous « Réglages d'atelier », avec compteur ◆", () => {
    load({ ...initial, guards: defaultGuards() });
    const html = render(SECTION_COMPONENTS.guards, free);
    const workshop = fold(html, "workshop");
    expect(workshop).toContain("Réglages d&#x27;atelier");
    expect(workshop).toContain("Poteaux");
    expect(workshop).toContain("Côté du poteau carré");
    // Atelier : axe, recul, poteaux (3), tolérance des murs = 6 valeurs ◆.
    expect(workshop).toContain("◆ 6");
    expect(workshop).toContain("6 valeurs à valider");
    const main = html.slice(0, html.indexOf("<details"));
    expect(main).not.toContain("Poteaux");
    expect(main).toContain("Garde-corps de volée");
    // Matériau ◆ visible, marqué à côté du champ (marque masquée aux lecteurs d'écran).
    expect(main).toContain("Matériau");
    expect(main).toMatch(/tiered__item--tv[\s\S]*aria-hidden="true">◆<\/span>/);
  });

  it("anglais", () => {
    load({ ...initial, guards: defaultGuards() });
    const html = render(SECTION_COMPONENTS.guards, free, "en");
    expect(fold(html, "workshop")).toContain("Workshop settings");
    expect(fold(html, "workshop")).toContain("6 values to be validated");
    expect(html).not.toContain("Réglages");
  });
});

describe("Marches : paramètres de la structure repris", () => {
  it("essence et rayon de nez pour une structure bois", () => {
    load(withStructure("wood-housed"));
    const free = render(SECTION_COMPONENTS.treads, { kind: "free" });
    expect(free).toContain("Essence");
    expect(free).toContain("Rayon d&#x27;arrondi du nez");
    // Ordre de la spécification : épaisseur de contremarche, essence, rayon de nez.
    expect(free.indexOf("Épaisseur de contremarche")).toBeLessThan(free.indexOf("Essence"));
    expect(free.indexOf("Essence")).toBeLessThan(free.indexOf("Rayon d&#x27;arrondi du nez"));
    const guided = render(SECTION_COMPONENTS.treads, { kind: "guided", step: 4 });
    const main = guided.slice(0, guided.indexOf("<details"));
    expect(main).toContain("Essence");
    expect(fold(guided, "more")).toContain("Rayon d&#x27;arrondi du nez");
    expect(render(SECTION_COMPONENTS.treads, { kind: "free" }, "en")).toContain("Timber species");
  });

  it("sans structure ou acier à marches bois : essence du projet, une seule fois", () => {
    for (const p of [initial, withStructure("steel-flat")]) {
      load(p);
      const free = render(SECTION_COMPONENTS.treads, { kind: "free" });
      expect(free.split(">Essence<").length - 1).toBe(1);
      expect(free).toContain('<option value="wood-oak" selected="">Chêne</option>');
      const guided = render(SECTION_COMPONENTS.treads, { kind: "guided", step: 4 });
      expect(guided.slice(0, guided.indexOf("<details"))).toContain(">Essence<");
    }
  });

  it("marches en tôle pliée : pas d'essence ; réglages de la tôle seulement dans ce cas", () => {
    const p = withStructure("steel-flat");
    load(p);
    expect(render(SECTION_COMPONENTS.structure, { kind: "all" })).not.toContain(
      "Marches en tôle pliée",
    );
    load({
      ...p,
      stair: {
        ...p.stair,
        structure: { kind: "steel-flat", params: { treadKind: "folded-steel" } },
      },
    });
    expect(render(SECTION_COMPONENTS.treads, { kind: "free" })).not.toContain(">Essence<");
    expect(render(SECTION_COMPONENTS.structure, { kind: "all" })).toContain(
      "Marches en tôle pliée",
    );
  });
});

describe("tout afficher (ancienne interface)", () => {
  it("aucune zone repliée ni marque ◆, mêmes libellés", () => {
    load({ ...withStructure("steel-flat"), guards: defaultGuards() });
    const html = SECTION_IDS.map((id) => render(SECTION_COMPONENTS[id], { kind: "all" })).join("");
    expect(html).not.toContain("tiered__");
    expect(html).not.toContain("Plus de réglages");
    for (const text of [
      "Hauteur à monter H",
      "Recaler volées et trémie",
      "Ajouter une volée",
      "Nombre de hauteurs n",
      "Correction de la 1re hauteur",
      "Méthode",
      "Épaisseur de marche",
      "Garde-corps de volée",
      "Côté du poteau carré",
      "Valeur par défaut à valider",
      "Profil",
    ]) {
      expect(html).toContain(text);
    }
  });
});

describe("valeurs ◆ validées", () => {
  it("l'aide « Valeur par défaut à valider » disparaît des panneaux Structure et Garde-corps", () => {
    load({ ...withStructure("steel-flat"), guards: defaultGuards() });
    const panels = (): string =>
      [SECTION_COMPONENTS.structure, SECTION_COMPONENTS.guards]
        .map((c) => render(c, { kind: "free" }))
        .join("");
    const hint = /Valeur par défaut à valider/g;
    expect((panels().match(hint) ?? []).length).toBeGreaterThan(1);
    const project = appStore.getState().project;
    const rows = toValidateRows(project, modelService.store.getState().model.model);
    expect(appStore.getState().setValuesValidated(pendingValidationEntries(rows), true).ok).toBe(
      true,
    );
    expect(panels()).not.toMatch(hint);
    // Annulation : les aides reviennent.
    appStore.getState().undo();
    expect((panels().match(hint) ?? []).length).toBeGreaterThan(1);
  });
});

describe("tous les modes", () => {
  it("aucune clé brute ni texte français en anglais ; étape 2 : forme et tournants", () => {
    load({ ...withStructure("steel-flat"), guards: defaultGuards() });
    const displays: Display[] = [
      { kind: "free" },
      ...([1, 2, 3, 4, 5, 6, 7] as const).map((step): Display => ({ kind: "guided", step })),
    ];
    for (const d of displays) {
      for (const id of SECTION_IDS) {
        const en = render(SECTION_COMPONENTS[id], d, "en");
        expect(en, `${id} ${JSON.stringify(d)}`).not.toMatch(/\b(ui|compliance)\.[a-z]+\.[\w.]+/);
        expect(en).not.toContain("Réglages");
      }
    }
    load(createProject("quarter-left"));
    const step2 = render(SECTION_COMPONENTS.layout, { kind: "guided", step: 2 });
    const main = step2.slice(0, step2.indexOf("<details"));
    // Guidé : cartes de forme (en tête) à la place de la liste « Type de tracé » ; le libre et
    // l'ancien rendu gardent la liste.
    expect(main.startsWith('<div class="choice-cards" role="group" aria-label="Forme"')).toBe(true);
    expect(main).not.toContain("Type de tracé");
    for (const d of [{ kind: "free" }, { kind: "all" }] as const) {
      const html = render(SECTION_COMPONENTS.layout, d);
      expect(html).toContain("Type de tracé");
      expect(html).not.toContain("choice-card");
    }
    expect(main).toContain("Tournant 1");
    expect(main).not.toContain("Ligne de foulée");
    expect(fold(step2, "more")).toContain("Recaler volées et trémie");
    const balancing = render(SECTION_COMPONENTS.balancing, { kind: "guided", step: 2 });
    expect(balancing.startsWith("<details")).toBe(true);
    expect(fold(balancing, "more")).toContain("Collet cible");
  });
});

describe("clés du dictionnaire employées par les sections", () => {
  it("toute clé littérale d'élément a une entrée", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      ...readdirSync(here)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => join(here, f)),
      join(here, "..", "HelicalEditor.tsx"),
    ];
    const unknown: string[] = [];
    let count = 0;
    for (const f of files) {
      const code = readFileSync(f, "utf8");
      // Clés du dictionnaire (les clés de traduction `ui.…` des listes de choix sont ignorées).
      for (const m of code.matchAll(/\bkey: "(?!ui\.)([^"]+)"/g)) {
        count++;
        if (tierEntry(m[1]!) === undefined) unknown.push(`${f}: ${m[1]}`);
      }
    }
    expect(count).toBeGreaterThan(30);
    expect(unknown).toEqual([]);
  });

  it("toute entrée `ui:` du dictionnaire est employée par une section", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const code = [
      ...readdirSync(here)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => join(here, f)),
      join(here, "..", "HelicalEditor.tsx"),
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const unused = TIER_KEYS.filter((k) => k.startsWith("ui:") && !code.includes(`key: "${k}"`));
    expect(unused).toEqual([]);
  });
});

describe("ordre des champs = spécification de contenu (§ 3)", () => {
  const free: Display = { kind: "free" };
  const inOrder = (html: string, labels: readonly string[]): void => {
    const at = labels.map((l) => html.indexOf(l));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  };

  it("Site : H, plancher haut, revêtements bas et haut, trémie, murs, calque de fond", () => {
    load(createProject("quarter-left"));
    inOrder(render(SECTION_COMPONENTS.site, free), [
      "Hauteur à monter",
      "Revêtement du sol bas",
      "Revêtement du sol haut",
      "Trémie",
      "site-section__walls",
      "site-section__underlay",
    ]);
  });

  it("Tracé : type, E, typologie, volées et tournants, ligne de foulée, recalage", () => {
    load(createProject("quarter-left"));
    inOrder(render(SECTION_COMPONENTS.layout, free), [
      "Type de tracé",
      "Emmarchement",
      "Typologie",
      "Volée 1",
      "Ligne de foulée",
    ]);
  });
});

describe("Site : trémie Rectangulaire | Tracée | Aucune, murs, calque de fond", () => {
  const free: Display = { kind: "free" };
  const site = (locale: "fr" | "en" = "fr") => render(SECTION_COMPONENTS.site, free, locale);
  const withSite = (p: Project, patch: Partial<Project["site"]>): Project => ({
    ...p,
    site: { ...p.site, ...patch },
  });

  it("segmenté radio à trois options, choix courant coché", () => {
    load(createProject("quarter-left"));
    const html = site();
    expect(html).toContain('role="radiogroup" aria-label="Trémie"');
    expect(html).not.toContain("Trémie dans le plancher haut");
    for (const label of ["Rectangulaire", "Tracée", "Aucune"]) {
      expect(html).toMatch(new RegExp(`role="radio"[^>]*>${label}</button>`));
    }
    expect(html).toMatch(/aria-checked="true"[^>]*>Rectangulaire</);
    expect(html).toContain("X (coin)");
    const en = site("en");
    expect(en).toContain('aria-label="Stairwell opening"');
    for (const label of ["Rectangular", "Drawn", "None"])
      expect(en).toContain(`>${label}</button>`);
  });

  it("Aucune puis Rectangulaire : retirée puis restaurée, chaque choix annulable", () => {
    load(createProject("quarter-left"));
    const memory: OpeningMemory = { rect: null, polygon: null };
    const before = appStore.getState().project.site.opening;
    expect(chooseOpeningKind("none", memory)).toBe(false);
    expect(appStore.getState().project.site.opening).toBeUndefined();
    expect(site()).toMatch(/aria-checked="true"[^>]*>Aucune</);
    expect(chooseOpeningKind("rect", memory)).toBe(false);
    expect(appStore.getState().project.site.opening).toEqual(before);
    appStore.getState().undo();
    expect(appStore.getState().project.site.opening).toBeUndefined();
    appStore.getState().undo();
    expect(appStore.getState().project.site.opening).toEqual(before);
  });

  it("Tracée : rectangle converti en polygone (une entrée d'historique), plan à montrer", () => {
    load(createProject("quarter-left"));
    const memory: OpeningMemory = { rect: null, polygon: null };
    const rect = appStore.getState().project.site.opening;
    expect(rect?.kind).toBe("rect");
    expect(chooseOpeningKind("polygon", memory)).toBe(true);
    const o = appStore.getState().project.site.opening;
    expect(o?.kind).toBe("polygon");
    if (o?.kind === "polygon") expect(o.points).toHaveLength(4);
    // Déjà tracée : rien à faire.
    expect(chooseOpeningKind("polygon", memory)).toBe(false);
    const html = site();
    expect(html).toContain("Trémie polygonale (4 sommets).");
    expect(html).toContain("Modifier sur le plan");
    expect(html).not.toContain("X (coin)");
    expect(site("en")).toContain("Polygonal stairwell opening (4 vertices).");
    // Retour au rectangle : le dernier rectangle revient.
    chooseOpeningKind("rect", memory);
    expect(appStore.getState().project.site.opening).toEqual(rect);
    appStore.getState().undo();
    appStore.getState().undo();
    expect(appStore.getState().project.site.opening).toEqual(rect);
  });

  it("mémoire des trémies hors du panneau : gardée pour le projet ouvert, vidée au suivant", () => {
    const m = openingMemoryFor(41);
    m.rect = proposedRectOpening(createProject("quarter-left"));
    // Panneau refermé puis rouvert (nouveau rendu de la section) : même mémoire.
    expect(openingMemoryFor(41)).toBe(m);
    expect(openingMemoryFor(41).rect).not.toBeNull();
    // Autre projet chargé : mémoire neuve.
    expect(openingMemoryFor(42)).toEqual({ rect: null, polygon: null });
  });

  it("Rectangulaire sans trémie mémorisée : proposition du cœur ou carré de côté E", () => {
    const p = createProject("quarter-left");
    const { opening: _o, ...siteWithout } = p.site;
    const bare: Project = { ...p, site: siteWithout };
    load(bare);
    chooseOpeningKind("rect", { rect: null, polygon: null });
    expect(appStore.getState().project.site.opening).toEqual(proposedRectOpening(bare));
    expect(openingKindOf(appStore.getState().project.site.opening)).toBe("rect");
  });

  it("murs : liste, suppression annulable, lien vers le plan", () => {
    const p = withSite(createProject("quarter-left"), {
      walls: [
        {
          id: "wall-1",
          a: { x: 0, y: 0 },
          b: { x: 3000, y: 0 },
          thickness: 200,
          loadBearing: false,
        },
        {
          id: "wall-2",
          a: { x: 0, y: 0 },
          b: { x: 0, y: 2500 },
          thickness: 160,
          loadBearing: true,
        },
      ],
    });
    load(p);
    const html = site();
    expect(html).toContain("<legend>Murs (2)</legend>");
    expect(html).toMatch(/wall-1 : 3\s000 mm, ép\. 200 mm/);
    expect(html).toContain('aria-label="Supprimer le mur wall-2"');
    expect(html).toContain("Modifier sur le plan");
    const en = site("en");
    expect(en).toContain("Walls (2)");
    expect(en).toContain('aria-label="Delete wall wall-2"');
    expect(en).toContain("Edit on the plan");
    removeWall("wall-1");
    expect(appStore.getState().project.site.walls.map((w) => w.id)).toEqual(["wall-2"]);
    expect(site()).toContain("<legend>Murs (1)</legend>");
    appStore.getState().undo();
    expect(appStore.getState().project.site.walls).toHaveLength(2);
    load(withSite(p, { walls: [] }));
    expect(site()).toContain("Aucun mur");
  });

  it("calque de fond : état et import DXF / image", () => {
    load(createProject("quarter-left"));
    const html = site();
    expect(html).toContain("<legend>Calque de fond</legend>");
    expect(html).toContain("Aucun calque");
    expect(html).toContain("Importer un plan DXF…");
    expect(html).toContain("Importer une image…");
    expect(html).toContain('aria-label="Plan DXF à importer"');
    const en = site("en");
    expect(en).toContain("Background layer");
    expect(en).toContain("Import a DXF plan…");
    expect(en).not.toContain("Calque");
  });
});
