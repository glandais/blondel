/**
 * Mode Fabrication (vague 4) : choix du contenu par onglet, groupes dépliés d'office, repères
 * distincts, état de la fiche de pièce ; rendu de la zone (onglets, bande de chiffres, liste par
 * famille, pièce choisie) en français et en anglais.
 */
import {
  buildModel,
  fastenerKindLabel,
  msg,
  parseProjectText,
  textMessage,
  type Fastener,
  type Model,
  type Part,
} from "@blondel/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import j5bText from "../../../../../examples/j5b-debillarde-soude.blondel.json?raw";
import { groupParts } from "../../lib/partGroups.js";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { EMPTY_MODEL_VIEW } from "../../store/modelStore.js";
import { FABRICATION_VIEWS, uiStore } from "../../store/uiStore.js";
import {
  FABRICATION_TAB_KEYS,
  FabricationArea,
  fabricationContent,
  fabricationView,
} from "./FabricationArea.js";
import { FastenersFields } from "../FastenersFields.js";
import { partSheetState } from "./PartSheet.js";
import { expandedGroups, markEntries } from "./PartsList.js";

// Rendu serveur : zustand lit `getInitialState()` ; le test rend l'état courant des stores.
for (const store of [appStore, modelService.store, journeyStore, uiStore]) {
  (store as { getInitialState: () => unknown }).getInitialState = store.getState;
}

const initialProject = appStore.getState().project;

function part(over: Partial<Part> & Pick<Part, "id" | "mark" | "category">): Part {
  return {
    name: textMessage(over.mark),
    material: "wood-oak",
    solid: { kind: "box" } as unknown as Part["solid"],
    quantities: {},
    ...over,
  } as Part;
}

describe("onglets et contenu", () => {
  it("onglets de Fabrication et libellés", () => {
    expect(FABRICATION_VIEWS.map(fabricationView)).toEqual(["flat", "bom", "compare", "validate"]);
    expect(Object.keys(FABRICATION_TAB_KEYS)).toEqual(["flat", "bom", "compare", "validate"]);
    expect(fabricationView("plan")).toBe("flat");
    expect(fabricationView("3d")).toBe("flat");
  });

  it("Pièces et Nomenclature attendent le modèle ; Comparer et À valider non", () => {
    const none = { hasModel: false, pending: false };
    const computing = { hasModel: false, pending: true };
    const ready = { hasModel: true, pending: false };
    expect(fabricationContent("flat", ready)).toBe("flat");
    expect(fabricationContent("bom", ready)).toBe("bom");
    expect(fabricationContent("flat", computing)).toBe("computing");
    expect(fabricationContent("bom", none)).toBe("noModel");
    for (const state of [none, computing, ready]) {
      expect(fabricationContent("compare", state)).toBe("compare");
      expect(fabricationContent("validate", state)).toBe("validate");
    }
  });
});

describe("liste des pièces", () => {
  const groups = groupParts([
    part({ id: "s1", mark: "LE1", category: "stringer" }),
    part({ id: "t1", mark: "M1", category: "tread" }),
    part({ id: "c1", mark: "CR1", category: "support" }),
    part({ id: "c2", mark: "CR1", category: "support" }),
    part({ id: "c3", mark: "CR2", category: "support" }),
  ]);

  it("le groupe de la pièce sélectionnée est déplié d'office, les autres repliés", () => {
    expect([...expandedGroups(groups, "treads", new Map(), false)]).toEqual(["treads"]);
    expect([...expandedGroups(groups, undefined, new Map(), false)]).toEqual([]);
  });

  it("le choix de l'utilisateur l'emporte (replier le groupe sélectionné, déplier un autre)", () => {
    const toggled = new Map([
      ["treads", false],
      ["supports", true],
    ] as const);
    expect([...expandedGroups(groups, "treads", toggled, false)]).toEqual(["supports"]);
  });

  it("groupe « Visserie » : déplié par l'utilisateur ou par un filtre, jamais d'office", () => {
    const listed = [...groups, { id: "fasteners" as const }];
    expect([...expandedGroups(listed, "treads", new Map(), false)]).toEqual(["treads"]);
    expect([...expandedGroups(listed, undefined, new Map([["fasteners", true]]), false)]).toEqual([
      "fasteners",
    ]);
    expect([...expandedGroups(listed, undefined, new Map(), true)]).toContain("fasteners");
  });

  it("avec un filtre, tous les groupes montrés sont dépliés", () => {
    const toggled = new Map([["stringers", false]] as const);
    expect([...expandedGroups(groups, undefined, toggled, true)]).toEqual([
      "stringers",
      "treads",
      "supports",
    ]);
  });

  it("repères distincts : première pièce et nombre de pièces", () => {
    const supports = groups.find((g) => g.id === "supports")!;
    expect(markEntries(supports).map((e) => [e.mark, e.first.id, e.count])).toEqual([
      ["CR1", "c1", 2],
      ["CR2", "c3", 1],
    ]);
  });

  it("fiche : invitation sans pièce, renvoi à la nomenclature sans développé", () => {
    expect(partSheetState(undefined)).toBe("choose");
    expect(partSheetState({})).toBe("noFlat");
    expect(partSheetState({ flat: {} as Part["flat"] })).toBe("flat");
  });
});

describe("FabricationArea (rendu)", () => {
  const project = parseProjectText(j5bText);
  const model = buildModel(project);

  beforeAll(() => {
    appStore.getState().replaceProject(project);
    modelService.store.setState((s) => ({
      model: { model, errors: [], timeMs: 5, mesh: null, project, pending: false },
      compare: s.compare,
    }));
    journeyStore.getState().setWorkspace("fabrication");
  });

  afterEach(() => {
    appStore.getState().setLocale("fr");
    appStore.getState().select(null);
  });

  afterAll(() => {
    journeyStore.getState().setWorkspace("design");
    appStore.getState().replaceProject(initialProject);
  });

  const render = (locale: "fr" | "en" = "fr"): string => {
    appStore.getState().setLocale(locale);
    return renderToStaticMarkup(createElement(FabricationArea));
  };

  it("onglets « Vues », bande de chiffres et panneau de l'onglet", () => {
    appStore.getState().setView("flat");
    const html = render();
    expect(html).toContain('class="workarea fab"');
    expect(html).toContain('role="tablist" aria-label="Vues"');
    const tabs = [...html.matchAll(/id="(tab-[\w-]+)"[^>]*role="tab"[^>]*>([^<]*)</g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(tabs).toEqual([
      ["tab-flat", "Pièces"],
      ["tab-bom", "Nomenclature"],
      ["tab-compare", "Comparer"],
      ["tab-validate", "À valider"],
    ]);
    expect(html).toContain('id="view-panel" role="tabpanel" aria-labelledby="tab-flat"');
    expect(html).toContain(`>${model.parts.length} pièces<`);
    expect(html).toMatch(/>\d[\d  ]* kg</);
    // ◆ hors du nom accessible du bouton (élément aria-hidden, TvMark), suivi du décompte ; le
    // titre (description accessible) ne contient pas non plus le glyphe.
    expect(html).toMatch(
      /<span class="tv-mark tv-mark--inherit" aria-hidden="true">◆<\/span> \d+ restantes?</,
    );
    const remainingButton = /<button[^>]*fab-figures__remaining[^>]*>/.exec(html)?.[0] ?? "";
    expect(remainingButton).toContain("title=");
    expect(remainingButton).not.toContain("◆");
    expect(html).toContain('placeholder="Filtrer : repère, matériau…"');
    expect(html).toContain(">Limons<");
    expect(html).toContain(">Marches<");
    expect(html).toContain("Choisissez une pièce dans la liste.");
    expect(html).not.toContain("fab-figures__pending");
    // Sans pièce : vue d'ensemble des tronçons et joints (limon débillardé soudé).
    expect(html).toContain('class="flat-view__joints"');
    expect(html).toContain('data-joint="J1"');
  });

  it("pièce choisie : groupe déplié, repère pressé, en-tête, DXF R12 et gabarit exporté", () => {
    appStore.getState().setView("flat");
    const ld = model.parts.find((p) => p.flat && p.id.startsWith("stringer-inner-curved"))!;
    appStore.getState().select({ location: { kind: "part", partId: ld.id } });
    const html = render();
    expect(html).toContain(`data-part="${ld.id}"`);
    expect(html).toContain(`<span class="fab-sheet__mark">${ld.mark}</span>`);
    expect(html).toContain("DXF R12");
    expect(html).toContain("Gabarit coté du développé");
    expect(html).toContain("<svg");
    expect(html).toMatch(/data-group="stringers"><button[^>]*aria-expanded="true"/);
    expect(html).toMatch(new RegExp(`aria-pressed="true"[^>]*><strong>${ld.mark}</strong>`));
    // Tronçons et joints du limon débillardé.
    expect(html).toContain("flat-view__joints");
  });

  it("pièce sans développé : renvoi à la nomenclature", () => {
    appStore.getState().setView("flat");
    const tread = model.parts.find((p) => !p.flat && p.category === "tread")!;
    appStore.getState().select({ location: { kind: "part", partId: tread.id } });
    const html = render();
    expect(html).toContain("Voir la nomenclature");
    expect(html).not.toContain("Gabarit coté du développé");
    expect(html).toMatch(/<button type="button" class="btn btn-secondary" disabled=""/);
  });

  it("Nomenclature et À valider", () => {
    appStore.getState().setView("bom");
    expect(render()).toContain('class="bom"');
    appStore.getState().setView("validate");
    const html = render();
    expect(html).toContain('aria-labelledby="tab-validate"');
    expect(html).toContain('class="fab-validate"');
  });

  it("anglais : aucun libellé français", () => {
    appStore.getState().setView("flat");
    const html = render("en");
    for (const text of ["Parts", "Bill of materials", "Compare", "To validate", "Strings"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('placeholder="Filter: mark, material…"');
    for (const text of ["Pièces", "Limons", "Filtrer", "restantes", "Choisissez"]) {
      expect(html).not.toContain(text);
    }
  });

  it("calcul en cours : message d'attente pour Pièces, Comparer toujours accessible", () => {
    modelService.store.setState((s) => ({
      model: { ...EMPTY_MODEL_VIEW, pending: true },
      compare: s.compare,
    }));
    try {
      appStore.getState().setView("flat");
      const html = render();
      expect(html).toContain("Calcul du modèle…");
      // La bande de chiffres annonce le calcul (comme la ligne de chiffres de la Conception).
      expect(html).toContain('<li class="fab-figures__pending" role="status">Calcul…</li>');
      appStore.getState().setView("compare");
      expect(render()).not.toContain("Calcul du modèle…");
    } finally {
      modelService.store.setState((s) => ({
        model: { model, errors: [], timeMs: 5, mesh: null, project, pending: false },
        compare: s.compare,
      }));
    }
  });
});

describe("visserie dans le mode Fabrication (QUESTIONS A27)", () => {
  const project = parseProjectText(j5bText);
  const base = buildModel(project);
  const fastener = (id: string, mark: string, partIds: readonly string[]): Fastener => ({
    id,
    mark,
    kind: "bolt",
    grade: "8.8",
    diameter: 12,
    length: 100,
    quantity: 4,
    joint: "plateFloor",
    name: fastenerKindLabel("bolt"),
    origin: msg("fastener.joint.plateFloor"),
    partIds,
    deduced: ["diameter", "quantity"],
  });
  /** Modèle réel complété d'une visserie de test (le calcul du cœur n'est pas requis). */
  const model: Model = {
    ...base,
    fasteners: [
      fastener("f1", "VS1", [base.parts[0]!.id]),
      fastener("f2", "VS2", [base.parts[1]!.id]),
    ],
  };
  const setModel = (m: Model): void =>
    modelService.store.setState((s) => ({
      model: { model: m, errors: [], timeMs: 5, mesh: null, project, pending: false },
      compare: s.compare,
    }));

  beforeAll(() => {
    appStore.getState().replaceProject(project);
    setModel(model);
    journeyStore.getState().setWorkspace("fabrication");
  });

  afterEach(() => {
    appStore.getState().setLocale("fr");
    appStore.getState().select(null);
  });

  afterAll(() => {
    journeyStore.getState().setWorkspace("design");
    appStore.getState().replaceProject(initialProject);
  });

  const render = (locale: "fr" | "en" = "fr"): string => {
    appStore.getState().setLocale(locale);
    return renderToStaticMarkup(createElement(FabricationArea));
  };

  it("liste des pièces : groupe « Visserie » en dernier, replié, repères en résumé", () => {
    appStore.getState().setView("flat");
    const html = render();
    const groups = [...html.matchAll(/data-group="([\w-]+)"/g)].map((m) => m[1]);
    expect(groups[groups.length - 1]).toBe("fasteners");
    expect(html).toMatch(/data-group="fasteners"><button[^>]*aria-expanded="false"/);
    expect(html).toContain(">Visserie<");
    expect(html).toContain("VS1 · VS2");
    expect(render("en")).toContain(">Fixings<");
  });

  it("réglages ◆ de la visserie : un groupe par assemblage présent, valeurs du profil", () => {
    const guided = renderToStaticMarkup(
      createElement(FastenersFields, { display: { kind: "guided", step: 7 } }),
    );
    expect(guided).toContain("<legend>Visserie</legend>");
    expect(guided).toContain('data-joint="plateFloor"');
    expect(guided).toContain("<legend>Platine sur sol</legend>");
    expect(guided).not.toContain('data-joint="handrailWall"');
    // Diamètre lu sur les perçages : pas de champ « Diamètre nominal », jeu de perçage proposé.
    expect(guided).not.toContain("Diamètre nominal");
    expect(guided).toContain("Jeu de perçage");
    expect(guided).toContain('data-param="workshop.fasteners.joints.plateFloor.length"');
    expect(guided).toContain("Cheville mécanique");
    expect(guided).toContain("◆");
    // Parcours libre : sous « Réglages d'atelier » ; étape 5 du guidé : absents.
    const free = renderToStaticMarkup(
      createElement(FastenersFields, { display: { kind: "free" } }),
    );
    expect(free).toContain("tiered__fold--workshop");
    const step5 = renderToStaticMarkup(
      createElement(FastenersFields, { display: { kind: "guided", step: 5 } }),
    );
    expect(step5).toBe("");
  });

  it("sans visserie : aucun groupe ni tableau", () => {
    setModel({ ...model, fasteners: [] });
    try {
      expect(
        renderToStaticMarkup(createElement(FastenersFields, { display: { kind: "all" } })),
      ).toBe("");
      appStore.getState().setView("flat");
      expect(render()).not.toContain('data-group="fasteners"');
      appStore.getState().setView("bom");
      expect(render()).not.toContain("bom__fasteners");
    } finally {
      setModel(model);
    }
  });

  it("nomenclature : tableau « Visserie » sous les pièces (repère, désignation, quantité)", () => {
    appStore.getState().setView("bom");
    const html = render();
    const table = html.slice(html.indexOf("bom__fasteners"));
    expect(table).toContain("Visserie : 2 repère(s)");
    expect(table).toContain(">VS1</button>");
    expect(table).toContain("<td>Boulon</td>");
    expect(table).toContain("<td>Platine sur sol</td>");
    expect(table).toContain(`<td>${base.parts[0]!.mark}</td>`);
    const en = render("en");
    expect(en.slice(en.indexOf("bom__fasteners"))).toContain("Fixings: 2 marks");
  });
});
