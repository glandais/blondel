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
import { appStore, modelService } from "../../store/appStore.js";
import { SECTION_COMPONENTS, SECTION_TITLE_KEYS, type SectionProps } from "./index.js";

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
    expect(main).toContain("Type de tracé");
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
    // Murs (liste par côté) et calque de fond de la section Site : reportés à la vague 2
    // (panneau libre Site, avec le plan Site et le menu Importer).
    const deferred = new Set(["ui:site.walls", "ui:site.underlay"]);
    const unused = TIER_KEYS.filter(
      (k) => k.startsWith("ui:") && !deferred.has(k) && !code.includes(`key: "${k}"`),
    );
    expect(unused).toEqual([]);
  });
});
