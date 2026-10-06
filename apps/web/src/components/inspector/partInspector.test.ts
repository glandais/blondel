/**
 * Inspecteur « Pièce » (maquette 2b) : valeurs lues dans le modèle, actions désactivées sans
 * développé, réglages d'atelier filtrés par famille de pièces (avec la valeur retenue d'un
 * paramètre auto, marque ◆ des seules valeurs non validées), pièces assemblées, mention, en
 * français et en anglais (aucune clé brute).
 * Rendu serveur, modèle calculé ici sans le worker ; assemblages et valeurs auto fabriqués à la
 * main (le cœur peut ne pas encore les exposer).
 */
import {
  buildModel,
  createProject,
  textMessage,
  type Model,
  type Part,
  type Project,
} from "@blondel/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { toValidateRows, validationEntry } from "../../lib/toValidate.js";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { uiStore } from "../../store/uiStore.js";
import { PartInspector } from "./PartInspector.js";
import { PartLinkList } from "./PartLinkList.js";

const initial = appStore.getState().project;

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant des stores.
appStore.getInitialState = appStore.getState;
modelService.store.getInitialState = modelService.store.getState;
journeyStore.getInitialState = journeyStore.getState;
uiStore.getInitialState = uiStore.getState;

/** Projet courant et son modèle (calculé ici, sans le worker), éventuellement retouché. */
function load(p: Project, patch: (m: Model) => Model = (m) => m): Model {
  appStore.getState().replaceProject(p);
  const project = appStore.getState().project;
  const model = patch(buildModel(project));
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project, pending: false },
  }));
  return model;
}

afterEach(() => {
  appStore.getState().select(null);
  appStore.getState().setLocale("fr");
  uiStore.setState({ isolatedPartId: null });
  load(initial);
});

function render(partId: string, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(PartInspector, { partId }));
}

const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s/gu, " ");

/** Lignes du tableau des valeurs : identifiant → [libellé, valeur]. */
function values(html: string): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  const re = /data-value="(\w+)"><td>(.*?)<\/td><td>(.*?)<\/td>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    out[m[1]!] = [decode(m[2]!), decode(m[3]!)];
  }
  return out;
}

/** Bouton dont le texte contient `label` (balise ouvrante incluse). */
function button(html: string, label: string): string {
  const buttons = html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
  return buttons.find((b) => decode(b).includes(label)) ?? "";
}

const steelFlat = (): Project => ({
  ...createProject("straight"),
  stair: {
    ...createProject("straight").stair,
    structure: { kind: "steel-flat", params: {} },
  },
});

const noRawKeys = (html: string): void => {
  expect(html).not.toMatch(/ui\.partInspector\.|ui\.sections\.|ui\.compliance\./);
};

describe("inspecteur Pièce : limon acier (développé, réglages des limons)", () => {
  it("français : en-tête, valeurs, actions actives, réglages d'atelier, mention", () => {
    const model = load(steelFlat());
    const stringer = model.parts.find((p) => p.category === "stringer" && p.flat)!;
    expect(stringer).toBeDefined();
    const html = render(stringer.id);
    const text = decode(html);
    expect(text).toContain("Pièce · structure");
    expect(html).toContain(`<h3 class="insp-title">${stringer.mark}</h3>`);
    const same = model.parts.filter((p) => p.mark === stringer.mark).length;
    expect(text).toContain(`× ${same}`);
    const v = values(html);
    expect(Object.keys(v)[0]).toBe("material");
    expect(v["material"]![0]).toBe("Matériau");
    expect(v["length"]![0]).toBe("Longueur développée");
    expect(v["length"]![1]).toMatch(/^[\d  ]+ mm$/u);
    if (stringer.quantities["mass_kg"] !== undefined) {
      expect(v["mass"]![1]).toMatch(/ kg$/);
    }
    expect(button(html, "Développé")).not.toContain("disabled");
    expect(button(html, "DXF R12")).not.toContain("disabled");
    expect(button(html, "Isoler en 3D")).toContain('aria-pressed="false"');
    // Réglages des limons du plugin, et lien vers la section Structure.
    expect(text).toContain("Réglages d'atelier");
    expect(text).toContain("communs aux limons");
    expect(text).toContain("Tous les réglages dans Structure");
    expect(html).toContain("auto-int");
    // Mention en pied, en dernier.
    expect(html.trimEnd().endsWith("</p></div>")).toBe(true);
    expect(text).toContain(
      "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
    );
    noRawKeys(html);
  });

  it("valeur retenue d'un paramètre auto (Model.autoValues) affichée en regard d'« Auto »", () => {
    const model = load(steelFlat(), (m) => ({
      ...m,
      autoValues: { "stair.structure.params.lowerOffset": 275 },
    }));
    const stringer = model.parts.find((p) => p.category === "stringer")!;
    expect(decode(render(stringer.id))).toContain("275 mm");
  });

  it("marque ◆ seulement pour une valeur non validée (validation annulable)", () => {
    const model = load(steelFlat());
    const support = model.parts.find((p) => p.category === "support")!;
    const marks = (): number => (render(support.id).match(/tiered__item--tv/g) ?? []).length;
    const before = marks();
    expect(before).toBeGreaterThan(0);
    const entries = toValidateRows(appStore.getState().project, model)
      .filter((r) => r.key.startsWith("stair.structure.params.supports."))
      .map(validationEntry)
      .filter((e) => e !== null);
    expect(appStore.getState().setValuesValidated(entries, true).ok).toBe(true);
    expect(marks()).toBe(0);
    appStore.getState().undo();
    expect(marks()).toBe(before);
  });

  it("pièce isolée : « Tout réafficher »", () => {
    const model = load(steelFlat());
    const stringer = model.parts.find((p) => p.category === "stringer")!;
    uiStore.setState({ isolatedPartId: stringer.id });
    const html = render(stringer.id);
    expect(button(html, "Tout réafficher")).toContain('aria-pressed="true"');
  });

  it("anglais : aucune clé brute, libellés traduits", () => {
    const model = load(steelFlat());
    const stringer = model.parts.find((p) => p.category === "stringer")!;
    const html = render(stringer.id, "en");
    const text = decode(html);
    expect(text).toContain("Part · structure");
    expect(text).toContain("Workshop settings");
    expect(text).toContain("shared by the strings");
    expect(text).toContain("Isolate in 3D");
    expect(values(html)["material"]![0]).toBe("Material");
    noRawKeys(html);
  });
});

describe("inspecteur Pièce : marche bois sans structure", () => {
  it("sans développé : Développé et DXF désactivés avec explication, aucun réglage repris", () => {
    const model = load(createProject("straight"));
    const tread = model.parts.find((p) => p.category === "tread" && p.flat === undefined)!;
    expect(tread).toBeDefined();
    const html = render(tread.id);
    const text = decode(html);
    expect(text).toContain("Pièce · marches");
    const flat = button(html, "Développé");
    expect(flat).toContain("disabled");
    expect(decode(flat)).toContain("Cette pièce n'a pas de développé à plat.");
    expect(button(html, "DXF R12")).toContain("disabled");
    expect(text).not.toContain("Réglages d'atelier");
    expect(values(html)["welds"]).toBeUndefined();
    noRawKeys(html);
    noRawKeys(render(tread.id, "en"));
  });

  it("pièce absente du modèle : rien", () => {
    load(createProject("straight"));
    expect(render("piece-inconnue")).toBe("");
  });
});

describe("pièces assemblées et liens", () => {
  const fake = (id: string, extra: Partial<Part> = {}): Part => ({
    id,
    mark: id.toUpperCase(),
    category: "support",
    family: "structure",
    name: textMessage(`Pièce ${id}`),
    material: "steel-raw",
    solid: { kind: "sweep", path: [], section: { outer: [], holes: [] } },
    quantities: { weld_mm: 2100, mass_kg: 66.12 },
    ...extra,
  });

  it("« Assemblée avec » liste les pièces de assembledWith ; valeurs absentes sans ligne", () => {
    load(createProject("straight"), (m) => ({
      ...m,
      parts: [
        fake("le1", {
          category: "stringer",
          section: textMessage("Plat 250 × 8"),
          assembledWith: ["cr1", "pf1"],
        }),
        fake("cr1", { section: textMessage("L 40×40×4") }),
        fake("pf1", { category: "fixing" }),
        fake("autre"),
      ],
    }));
    const html = render("le1");
    const text = decode(html);
    const v = values(html);
    expect(v["section"]).toEqual(["Section", "Plat 250 × 8"]);
    expect(v["mass"]).toEqual(["Masse", "66,1 kg"]);
    expect(v["welds"]).toEqual(["Soudures", "2,1 m"]);
    expect(v["length"]).toBeUndefined();
    expect(text).toContain("Assemblée avec");
    expect(html).toContain('data-part="cr1"');
    expect(html).toContain('data-part="pf1"');
    expect(html).not.toContain('data-part="autre"');
    expect(text).toContain("L 40×40×4");
  });

  it("PartLinkList : liste vide → rien ; ligne = repère, nom, section", () => {
    expect(renderToStaticMarkup(createElement(PartLinkList, { title: "T", parts: [] }))).toBe("");
    const html = renderToStaticMarkup(
      createElement(PartLinkList, {
        title: "Assemblée avec",
        parts: [fake("pf1", { section: textMessage("200 × 150") })],
      }),
    );
    expect(html).toContain('class="insp-section-title"');
    expect(html).toContain('<button type="button" class="insp-link" data-part="pf1"><b>PF1</b>');
    expect(html).toContain('<span class="insp-link__detail">200 × 150</span>');
  });
});
