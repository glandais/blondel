/**
 * Inspecteur « Pièce » (maquette 2b) : valeurs lues dans le modèle, actions désactivées sans
 * développé, réglages d'atelier filtrés par famille de pièces (structure, et garde-corps par
 * catégorie de pièce) (avec la valeur retenue d'un
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
import { translatorFor } from "@blondel/i18n";
import { defaultGuards } from "../../lib/guardsForm.js";
import { toValidateRows, validationEntry } from "../../lib/toValidate.js";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { uiStore } from "../../store/uiStore.js";
import { PartInspector } from "./PartInspector.js";
import { PartLinkList } from "./PartLinkList.js";

const initial = appStore.getState().project;
const FR = translatorFor("fr");

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

  it("anglais : « Flat pattern » pour le limon acier, « Development » pour le limon bois", () => {
    const steel = load(steelFlat()).parts.find((p) => p.category === "stringer" && p.flat)!;
    const steelHtml = render(steel.id, "en");
    expect(button(steelHtml, "Flat pattern")).toContain(`Show the flat pattern of ${steel.mark}`);
    expect(button(steelHtml, "Development")).toBe("");
    const wood = load({
      ...createProject("straight"),
      stair: {
        ...createProject("straight").stair,
        structure: { kind: "wood-housed", params: {} },
      },
    }).parts.find((p) => p.category === "stringer" && p.flat)!;
    expect(wood).toBeDefined();
    const woodHtml = render(wood.id, "en");
    expect(button(woodHtml, "Development")).toContain(`Show the development of ${wood.mark}`);
    expect(button(woodHtml, "DXF R12")).toContain(
      `Download the development of ${wood.mark} as DXF R12`,
    );
    expect(button(woodHtml, "Flat pattern")).toBe("");
    // Français identique : « Développé » dans les deux cas.
    expect(button(render(wood.id), "Développé")).toContain(
      `Afficher le développé de ${wood.mark} (Fabrication)`,
    );
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

/** Projet droit avec les garde-corps par défaut du cœur. */
const withGuards = (): Project => ({ ...createProject("straight"), guards: defaultGuards() });

describe("inspecteur Pièce : pièces de garde-corps (réglages de la section Garde-corps)", () => {
  it("poteau : côté, entraxe, poteau d'angle, implantation ; ◆ sans glyphe dans les noms", () => {
    const model = load(withGuards());
    const post = model.parts.find((p) => p.family === "guards" && p.category === "post")!;
    expect(post).toBeDefined();
    const html = render(post.id);
    const text = decode(html);
    expect(text).toContain("Pièce · garde-corps");
    expect(text).toContain("Réglages d'atelier");
    expect(text).toContain("communs aux poteaux de garde-corps");
    for (const key of [
      "ui.guards.posts.size",
      "ui.guards.posts.maxSpacing",
      "ui.guards.posts.cornerAngle",
      "ui.guards.flight.edgeOffset",
      "ui.guards.opening.setback",
    ] as const) {
      expect(text).toContain(FR.t(key));
    }
    expect(html).toContain('data-setting="guards.posts.size"');
    expect(text).toContain("Tous les réglages dans Garde-corps");
    // Valeurs ◆ : glyphe masqué, suivi du texte lu « à valider ».
    expect(html).toContain(
      '<span class="tv-mark tiered__mark" aria-hidden="true">◆</span><span class="visually-hidden"> à valider</span>',
    );
    expect(html).not.toMatch(/(aria-label|title)="[^"]*◆/);
    noRawKeys(html);
    noRawKeys(render(post.id, "en"));
  });

  it("main courante et balustre : champs de leur catégorie ; ◆ retirée une fois validée", () => {
    const model = load(withGuards());
    const handrail = model.parts.find((p) => p.family === "guards" && p.category === "handrail")!;
    const hr = decode(render(handrail.id));
    expect(hr).toContain("communs aux mains courantes");
    expect(hr).toContain(FR.t("ui.guards.handrail.wallClearance"));
    expect(hr).not.toContain(FR.t("ui.guards.posts.size"));
    const baluster = model.parts.find((p) => p.family === "guards" && p.category === "baluster")!;
    const bal = decode(render(baluster.id));
    expect(bal).toContain("communs au remplissage");
    expect(bal).toContain(FR.t("ui.guards.infill.balusterSpacing"));
    expect(bal).toContain(FR.t("ui.guards.infill.balusterSection"));
    // Entraxe des balustres : valeur ◆ ; validée, plus de marque ; annulée, elle revient.
    const marks = (): number => (render(baluster.id).match(/tiered__item--tv/g) ?? []).length;
    const before = marks();
    expect(before).toBeGreaterThan(0);
    const entries = toValidateRows(appStore.getState().project, model)
      .filter((r) => r.key.startsWith("guards.infill."))
      .map(validationEntry)
      .filter((e) => e !== null);
    expect(appStore.getState().setValuesValidated(entries, true).ok).toBe(true);
    expect(marks()).toBe(0);
    appStore.getState().undo();
    expect(marks()).toBe(before);
  });

  it("modification d'un réglage : même chemin du projet que la section, annulable", () => {
    load(withGuards());
    const size = appStore.getState().project.guards!.posts.size;
    expect(appStore.getState().setField(["guards", "posts", "size"], size + 10).ok).toBe(true);
    expect(appStore.getState().project.guards!.posts.size).toBe(size + 10);
    appStore.getState().undo();
    expect(appStore.getState().project.guards!.posts.size).toBe(size);
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

describe("inspecteur Pièce : pièces composées et placages (QUESTIONS A33 (e), A34 (e))", () => {
  /** Poutre finie et deux couches composantes fabriquées à la main ; une marche en placage. */
  function composed(): Model {
    return load(steelFlat(), (m) => {
      const stringer = m.parts.find((p) => p.category === "stringer")!;
      const { stock: _stock, ...finished } = stringer;
      const layer = (k: number): Part => ({
        ...stringer,
        id: `layer-${k}`,
        mark: `${stringer.mark}-${k}`,
        name: textMessage(`Couche ${k}`),
        componentOf: stringer.id,
        stock: { length: 1000, width: 200, thickness: 40 },
      });
      const tread = m.parts.find((p) => p.category === "tread")!;
      const veneer: Part = {
        ...tread,
        stock: { length: 1000, width: 300, thickness: 3, supply: "veneer" },
      };
      return {
        ...m,
        parts: m.parts
          .map((p) => (p.id === stringer.id ? finished : p.id === tread.id ? veneer : p))
          .concat([layer(1), layer(2)]),
      };
    });
  }

  it("composante : lien « Couche de … » vers la pièce finie, isolement de la pièce finie", () => {
    const model = composed();
    const finished = model.parts.find((p) => p.id === "layer-1")!.componentOf!;
    const mark = model.parts.find((p) => p.id === finished)!.mark;
    const html = render("layer-1");
    expect(button(html, `Couche de ${mark}`)).toContain("part-insp__assembly");
    uiStore.setState({ isolatedPartId: finished });
    expect(button(render("layer-1"), "Tout réafficher")).toContain('aria-pressed="true"');
    expect(button(render("layer-1", "en"), `Layer of ${mark}`)).not.toBe("");
    noRawKeys(html);
  });

  it("pièce finie : nombre de couches, débit « voir les couches », sans masse propre", () => {
    const model = composed();
    const finished = model.parts.find((p) => p.id === "layer-1")!.componentOf!;
    const v = values(render(finished));
    expect(v["layers"]).toEqual(["Couches", "2"]);
    expect(v["stock"]).toEqual(["Débit", "voir les couches"]);
    expect(values(render(finished, "en"))["stock"]).toEqual(["Cutting", "see the layers"]);
  });

  it("débit en placage signalé", () => {
    const model = composed();
    const tread = model.parts.find((p) => p.stock?.supply === "veneer")!;
    expect(values(render(tread.id))["stock"]).toEqual(["Débit", "placage acheté à l'épaisseur"]);
    expect(values(render(tread.id, "en"))["stock"]).toEqual([
      "Cutting",
      "veneer bought to thickness",
    ]);
  });
});
