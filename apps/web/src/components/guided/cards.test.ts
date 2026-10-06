/**
 * Cartes de choix du parcours guidé (maquette 1a) : forme (étape 2), structure par famille
 * (étape 5), type de remplissage (étape 6), en français et en anglais (rendu serveur). Les
 * cartes ne remplacent la liste que dans le guidé : le parcours libre et l'ancien rendu (`all`)
 * gardent leurs listes.
 */
import { buildModel, createProject, type Project } from "@blondel/core";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { defaultGuards } from "../../lib/guardsForm.js";
import { presetProject } from "../../lib/layoutKind.js";
import type { Display } from "../../lib/paramTiers.js";
import { appStore, modelService } from "../../store/appStore.js";
import { SECTION_COMPONENTS, type SectionProps } from "../sections/index.js";
import { ChoiceCards } from "../ui/ChoiceCards.js";

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

interface Card {
  readonly label: string;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly describedBy: string | undefined;
  readonly open: string;
}

/** Cartes (boutons `.choice-card`) d'un rendu : nom accessible, état pressé, indisponibilité. */
function cards(html: string): Card[] {
  return [...html.matchAll(/<button([^>]*class="choice-card"[^>]*)>/g)].map((m) => {
    const open = m[1]!;
    return {
      label: /aria-label="([^"]*)"/.exec(open)?.[1] ?? "",
      pressed: open.includes('aria-pressed="true"'),
      disabled: open.includes('aria-disabled="true"'),
      describedBy: /aria-describedby="([^"]*)"/.exec(open)?.[1],
      open,
    };
  });
}

/** Groupes nommés (`role="group"`) d'un rendu. */
function groups(html: string): string[] {
  return [...html.matchAll(/role="group" aria-label="([^"]*)"/g)].map((m) => m[1]!);
}

const unescape = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const step = (n: 2 | 5 | 6): Display => ({ kind: "guided", step: n });
const FREE: Display = { kind: "free" };
const ALL: Display = { kind: "all" };

const withStructure = (p: Project, kind: string): Project => ({
  ...p,
  stair: { ...p.stair, structure: { kind, params: {} } },
});

describe("ChoiceCards", () => {
  it("groupe nommé, boutons aria-pressed, carte indisponible liée à sa raison", () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceCards<"a" | "b" | "c">, {
        label: "Choix",
        cards: [
          { value: "a", label: "A", caption: "première" },
          { value: "b", label: "B", disabled: true, reason: "Impossible ici" },
          { value: "c", label: "C", title: "Nom complet" },
        ],
        isPressed: (v) => v === "a",
        onChoose: () => undefined,
        columns: 4,
      }),
    );
    expect(groups(html)).toEqual(["Choix"]);
    expect(html).toContain("--choice-columns:4");
    const [a, b, c] = cards(html);
    expect(a).toMatchObject({ label: "A", pressed: true, disabled: false });
    expect(b).toMatchObject({ label: "B", pressed: false, disabled: true });
    // Carte indisponible : focalisable (pas d'attribut disabled), raison écrite et liée.
    expect(b!.open).not.toMatch(/\sdisabled=/);
    const reasonId = b!.describedBy!;
    expect(html).toContain(`id="${reasonId}">Impossible ici<`);
    // Légende liée en description, nom complet en infobulle.
    expect(html).toContain(`id="${a!.describedBy}">première<`);
    expect(c!.open).toContain('title="Nom complet"');
    expect(c!.describedBy).toBeUndefined();
  });
});

describe("étape 2 : cartes de forme", () => {
  it("7 cartes dans le groupe « Forme », pressée selon le projet", () => {
    load(createProject("straight"));
    const html = render(SECTION_COMPONENTS.layout, step(2));
    expect(groups(html)).toContain("Forme");
    const c = cards(html);
    expect(c.map((x) => x.label)).toEqual([
      "Droit",
      "¼ gauche",
      "¼ droite",
      "U",
      "S",
      "½ tournant",
      "Hélicoïdal",
    ]);
    expect(c.filter((x) => x.pressed).map((x) => x.label)).toEqual(["Droit"]);
    // Nom complet du préréglage en infobulle.
    expect(c[0]!.open).toContain('title="Escalier droit"');
    // Cartes en tête, à la place de la liste Volées | Hélicoïdal.
    expect(html).not.toContain("Type de tracé");
    expect(html.indexOf("choice-card")).toBeLessThan(html.indexOf("Emmarchement"));

    load(createProject("quarter-left"));
    const q = cards(render(SECTION_COMPONENTS.layout, step(2)));
    expect(q.filter((x) => x.pressed).map((x) => x.label)).toEqual(["¼ gauche"]);
    load(createProject("two-quarters-u"));
    const u = cards(render(SECTION_COMPONENTS.layout, step(2)));
    expect(u.filter((x) => x.pressed).map((x) => x.label)).toEqual(["U", "½ tournant"]);
  });

  it("anglais", () => {
    load(createProject("quarter-right"));
    const html = render(SECTION_COMPONENTS.layout, step(2), "en");
    expect(groups(html)).toContain("Shape");
    const c = cards(html);
    expect(c.map((x) => x.label)).toEqual([
      "Straight",
      "¼ left",
      "¼ right",
      "U",
      "S",
      "Half-turn",
      "Spiral",
    ]);
    expect(c.filter((x) => x.pressed).map((x) => x.label)).toEqual(["¼ right"]);
  });

  it("libre et ancien rendu : liste Type de tracé, pas de cartes", () => {
    load(createProject("quarter-left"));
    for (const d of [FREE, ALL]) {
      const html = render(SECTION_COMPONENTS.layout, d);
      expect(html).toContain("Type de tracé");
      expect(cards(html)).toEqual([]);
    }
  });
});

describe("étape 5 : cartes de structure par famille", () => {
  it("« Aucune structure », puis Bois, Métal, Mixte ; structure courante pressée", () => {
    load(withStructure(createProject("quarter-left"), "steel-flat"));
    const html = render(SECTION_COMPONENTS.structure, step(5));
    const g = groups(html);
    expect(g[0]).toBe("Structure");
    expect(g[1]).toBe("Aucune structure");
    const families = g.slice(2);
    expect(families.length).toBeGreaterThan(0);
    expect(["Bois", "Métal", "Mixte"].filter((f) => families.includes(f))).toEqual(families);
    const c = cards(html);
    expect(c[0]!.label).toBe("Aucune structure");
    expect(c.filter((x) => x.pressed)).toHaveLength(1);
    const pressed = c.find((x) => x.pressed)!;
    expect(pressed.open).toContain('data-value="steel-flat"');
    // Tracé à volées : seule la structure hélicoïdale est grisée.
    const off = c.filter((x) => x.disabled);
    expect(off.map((x) => /data-value="([^"]*)"/.exec(x.open)?.[1])).toEqual(["helical-core"]);
    expect(html).toContain("Pour les hélicoïdaux seulement");
    // Liste de l'ancien choix remplacée par les cartes.
    expect(html).not.toContain("Aucune (marches, contremarches, paliers)");
  });

  it("hélicoïdal : structures à volées grisées, avec leur raison liée", () => {
    load(presetProject("helical"));
    const html = render(SECTION_COMPONENTS.structure, step(5));
    const c = cards(html);
    const housed = c.find((x) => x.open.includes('data-value="wood-housed"'))!;
    expect(housed.disabled).toBe(true);
    expect(housed.pressed).toBe(false);
    const reasonId = housed.describedBy!.split(" ").at(-1)!;
    expect(unescape(html)).toContain(`id="${reasonId}">Pour les escaliers à volées seulement<`);
    const core = c.find((x) => x.open.includes('data-value="helical-core"'))!;
    expect(core).toMatchObject({ pressed: true, disabled: false });
  });

  it("anglais", () => {
    load(presetProject("helical"));
    const html = render(SECTION_COMPONENTS.structure, step(5), "en");
    expect(groups(html).slice(0, 2)).toEqual(["Structure", "No structure"]);
    expect(html).toContain("For flight stairs only");
    expect(html).not.toContain("Aucune");
  });

  it("libre : liste Structure, pas de cartes", () => {
    load(withStructure(createProject("quarter-left"), "steel-flat"));
    const html = render(SECTION_COMPONENTS.structure, FREE);
    expect(html).toContain("Aucune (marches, contremarches, paliers)");
    expect(cards(html)).toEqual([]);
  });
});

describe("étape 6 : cartes du type de remplissage", () => {
  it("6 cartes, la pressée selon le projet", () => {
    load({ ...createProject("quarter-left"), guards: defaultGuards() });
    const html = render(SECTION_COMPONENTS.guards, step(6));
    expect(groups(html)).toContain("Type de remplissage");
    const c = cards(html);
    expect(c.map((x) => x.label)).toEqual([
      "Barreaudage vertical (balustres)",
      "Lisses",
      "Câbles tendus",
      "Verre",
      "Tôle perforée",
      "Panneau plein",
    ]);
    const kind = defaultGuards().infill.kind;
    expect(c.filter((x) => x.pressed).map((x) => /data-value="([^"]*)"/.exec(x.open)?.[1])).toEqual(
      [kind],
    );
  });

  it("anglais", () => {
    load({ ...createProject("quarter-left"), guards: defaultGuards() });
    const html = render(SECTION_COMPONENTS.guards, step(6), "en");
    expect(groups(html)).toContain("Infill type");
    expect(cards(html).map((x) => x.label)).toContain("Perforated plate");
  });

  it("libre : liste Type, pas de cartes", () => {
    load({ ...createProject("quarter-left"), guards: defaultGuards() });
    const html = render(SECTION_COMPONENTS.guards, FREE);
    expect(cards(html)).toEqual([]);
    expect(html).toContain("Barreaudage vertical (balustres)</option>");
  });
});
