/**
 * Vue centrale du parcours libre en Conception (maquette 1b) : onglets Plan | 3D | Élévation,
 * boutons − + Recadrer, ligne de chiffres en français et en anglais (elle
 * remplace la barre d'état), logique pure du zoom des SVG exportés.
 */
import { buildModel } from "@blondel/core";
import { msg } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { EMPTY_MODEL_VIEW } from "../../store/modelStore.js";
import { sendViewCommand, uiStore } from "../../store/uiStore.js";
import { FigureLine } from "./FigureLine.js";
import { ViewArea, viewHandlesZoom } from "./ViewArea.js";
import { ZOOM_MAX, ZOOM_MIN, nextZoom } from "./ZoomableSvg.js";

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant des stores.
for (const store of [appStore, modelService.store, journeyStore, uiStore]) {
  (store as { getInitialState: () => unknown }).getInitialState = store.getState;
}

const initialProject = appStore.getState().project;

beforeAll(() => {
  // Aucun calcul pendant les rendus : état « calcul en cours » sans modèle par défaut.
  modelService.store.setState((s) => ({
    model: { ...EMPTY_MODEL_VIEW, pending: true },
    compare: s.compare,
  }));
});

afterEach(() => {
  appStore.getState().setLocale("fr");
  appStore.getState().replaceProject(initialProject);
  journeyStore.getState().setWorkspace("design");
  appStore.getState().setView("plan");
  appStore.getState().setPlanMode("drawing");
  modelService.store.setState((s) => ({
    model: { ...EMPTY_MODEL_VIEW, pending: true },
    compare: s.compare,
  }));
});

function render(component: () => unknown, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(component as () => null));
}

/** Onglets rendus : [id, sélectionné, libellé]. */
function tabs(html: string): [string, boolean, string][] {
  return [
    ...html.matchAll(
      /<button[^>]*id="(tab-[\w-]+)"[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>(.*?)<\/button>/g,
    ),
  ].map((m) => [m[1] as string, m[2] === "true", (m[3] as string).replace(/<[^>]+>/g, "")]);
}

describe("ViewArea : onglets et commandes de vue", () => {
  it("Conception : Plan | 3D | Élévation, zoom présent", () => {
    appStore.getState().setView("3d");
    const html = render(ViewArea);
    expect(html).toContain('class="workarea"');
    expect(html).toContain('aria-label="Vues de l&#x27;escalier"');
    expect(tabs(html)).toEqual([
      ["tab-plan", false, "Plan"],
      ["tab-3d", true, "3D"],
      ["tab-elevation", false, "Élévation"],
    ]);
    expect(html).toContain('role="tablist" aria-label="Vues"');
    expect(html).toContain('id="view-panel" role="tabpanel" aria-labelledby="tab-3d"');
    expect(html).toContain('class="view blueprint"');
    expect(html).toContain('aria-label="Zoom arrière"');
    expect(html).toContain('aria-label="Zoom avant"');
    expect(html).toContain("Recadrer");
    expect(html).toContain('class="figure-line"');
  });

  it("Conception seulement : aucun onglet de Fabrication (zone FabricationArea)", () => {
    const html = render(ViewArea);
    expect(tabs(html).map((t) => t[0])).toEqual(["tab-plan", "tab-3d", "tab-elevation"]);
    for (const text of ["Pièces", "Nomenclature", "Comparer", "À valider", "Développés"]) {
      expect(html).not.toContain(`>${text}<`);
    }
  });

  it("anglais : libellés traduits", () => {
    const html = render(ViewArea, "en");
    expect(tabs(html).map((t) => t[2])).toEqual(["Plan", "3D", "Elevation"]);
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain("Fit");
    expect(html).not.toContain("Recadrer");
  });

  it("zoom : plan (deux modes), 3D et élévation ; jamais désactivé en Conception", () => {
    expect(viewHandlesZoom("plan")).toBe(true);
    expect(viewHandlesZoom("3d")).toBe(true);
    expect(viewHandlesZoom("elevation")).toBe(true);
    expect(viewHandlesZoom("bom")).toBe(false);
    expect(viewHandlesZoom("flat")).toBe(false);
    for (const mode of ["drawing", "site"] as const) {
      appStore.getState().setPlanMode(mode);
      const html = render(ViewArea);
      expect(html).not.toContain("Zoom indisponible");
      expect(html).not.toMatch(/aria-label="Zoom avant"[^>]*disabled=""/);
    }
  });

  it("le cadre de la vue prend le focus (flèches de l'inspecteur Marche)", () => {
    expect(render(ViewArea)).toMatch(/id="view-panel"[^>]*tabindex="0"/);
  });

  it("la bascule d'espace ne touche ni projet, ni historique, ni sélection", () => {
    appStore.getState().setField(["site", "floorToFloor"], 2750);
    appStore.getState().select({ location: { kind: "tread", number: 3 } });
    const { project, history, selection } = appStore.getState();
    journeyStore.getState().setWorkspace("fabrication");
    journeyStore.getState().setWorkspace("design");
    expect(appStore.getState().project).toBe(project);
    expect(appStore.getState().history).toBe(history);
    expect(appStore.getState().selection).toBe(selection);
    appStore.getState().select(null);
  });
});

describe("FigureLine", () => {
  it("calcul en cours : « Calcul… », aucun temps", () => {
    const html = render(FigureLine);
    expect(html).toContain('aria-label="Chiffres clés"');
    expect(html).toContain('class="figure-line__pending" role="status">Calcul…');
    expect(html).not.toContain("figure-line__time");
  });

  it("modèle calculé : grandeurs, emmarchement, échappée et temps de calcul", () => {
    const project = appStore.getState().project;
    const model = buildModel(project);
    modelService.store.setState((s) => ({
      model: { model, errors: [], timeMs: 12.5, mesh: null, project, pending: false },
      compare: s.compare,
    }));
    const fr = render(FigureLine);
    for (const text of ["<dt>n</dt>", "<dt>h</dt>", "<dt>g</dt>", "2h + g", "<dt>E</dt>"]) {
      expect(fr).toContain(text);
    }
    expect(fr).toContain("<dt>Échappée</dt>");
    expect(fr).toContain("Échappée largeur");
    expect(fr).toContain(`<dd>${String(model.stepping?.riserCount)}</dd>`);
    // Détail cœur / maillage en texte (repli natif), pas seulement en info-bulle.
    expect(fr).toContain(
      '<details class="figure-line__time"><summary title="Calculé en 12,5 ms">' +
        '<span class="figure-line__time-long">Calculé en 12,5 ms</span>' +
        '<span class="figure-line__time-short">12,5 ms</span></summary>',
    );
    expect(fr).toMatch(/<li>Cœur : 12,5 ms — [^<]*<\/li><li>Maillage : – — /);
    expect(fr).not.toContain("figure-line__pending");
    // Chiffres en mm entiers avec l'unité (maquette 1b, ADR-0003 : arrondi à l'affichage).
    const rise = model.stepping!.rise;
    const riseText = `${Math.round(rise)} mm`;
    expect(fr).toContain(`<dt>h</dt><dd>${riseText}</dd>`);
    expect(fr).not.toMatch(/<dt>h<\/dt><dd>\d+,\d/);
    // Priorités : emmarchement et échappée sur la largeur d'abord, puis l'échappée ; les
    // secondaires sont repris dans le détail repliable.
    expect(fr).toMatch(/data-figure="width" data-tier="2"/);
    expect(fr).toMatch(/data-figure="headroomWidth" data-tier="2"/);
    expect(fr).toMatch(/data-figure="headroom" data-tier="3"/);
    expect(fr).toMatch(/data-figure="h" title=/);
    expect(fr).toContain('<dl class="figure-line__extra">');
    expect(fr.match(/<div data-figure="[^"]+" data-tier="[23]">/g)?.length).toBe(3);

    const en = render(FigureLine, "en");
    for (const text of ["2R + G", "<dt>W</dt>", "<dt>Headroom</dt>", "Computed in 12.5 ms"]) {
      expect(en).toContain(text);
    }
    expect(en).not.toContain("Échappée");
    expect(en).not.toContain("Calculé");
  });

  it("trémie couvrante : échappée « non limitée »", () => {
    const project = appStore.getState().project;
    const model = buildModel(project);
    modelService.store.setState((s) => ({
      model: {
        model: { ...model, headroomUnlimited: { walkline: true, width: true } },
        errors: [],
        timeMs: 3,
        mesh: null,
        project,
        pending: false,
      },
      compare: s.compare,
    }));
    const fr = render(FigureLine);
    // Sur la ligne et dans le détail repliable (chiffres secondaires).
    expect(fr.match(/<dd>non limitée<\/dd>/g)?.length).toBe(4);
    expect(render(FigureLine, "en").match(/<dd>unlimited<\/dd>/g)?.length).toBe(4);
  });

  it("erreurs : texte de l'erreur seule, sinon leur nombre", () => {
    const one = msg("ui.errors.fixRefused");
    modelService.store.setState((s) => ({
      model: { ...EMPTY_MODEL_VIEW, errors: [one], pending: false },
      compare: s.compare,
    }));
    const single = render(FigureLine);
    expect(single).toMatch(/class="figure-line__errors" role="status"[^>]*>[^<]+</);
    modelService.store.setState((s) => ({
      model: { ...EMPTY_MODEL_VIEW, errors: [one, one, one], pending: false },
      compare: s.compare,
    }));
    expect(render(FigureLine)).toContain("3 erreurs de génération");
    expect(render(FigureLine, "en")).toContain("3 generation errors");
  });
});

describe("zoom des SVG exportés", () => {
  it("un pas de 1,25, aller-retour exact, Recadrer revient à 1", () => {
    expect(nextZoom(1, "zoomIn")).toBe(1.25);
    expect(nextZoom(nextZoom(1, "zoomIn"), "zoomOut")).toBe(1);
    let s = 1;
    for (let i = 0; i < 5; i++) s = nextZoom(s, "zoomIn");
    for (let i = 0; i < 5; i++) s = nextZoom(s, "zoomOut");
    expect(s).toBe(1);
    expect(nextZoom(3.2, "fit")).toBe(1);
  });

  it("borné entre 0,5 et 8", () => {
    let s = 1;
    for (let i = 0; i < 40; i++) s = nextZoom(s, "zoomIn");
    expect(s).toBe(ZOOM_MAX);
    for (let i = 0; i < 80; i++) s = nextZoom(s, "zoomOut");
    expect(s).toBe(ZOOM_MIN);
  });

  it("commandes numérotées : deux commandes identiques restent distinctes", () => {
    const before = uiStore.getState().viewCommand?.seq ?? 0;
    sendViewCommand("zoomIn");
    sendViewCommand("zoomIn");
    expect(uiStore.getState().viewCommand).toEqual({ kind: "zoomIn", seq: before + 2 });
  });
});
