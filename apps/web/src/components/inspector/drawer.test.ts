/**
 * Inspecteur en tiroir (fenêtre de 760 à 1 099 px, ADR-0009 point 3), en rendu serveur : croix
 * « Fermer l'inspecteur » nommée, tiroir fermé inerte (hors de l'arbre d'accessibilité), rien de
 * plus en colonne (grand écran) ni dans la liste du contrôle du guidé.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { appStore, journeyStore, modelService } from "../../store/appStore.js";
import { uiStore } from "../../store/uiStore.js";
import { Inspector, type InspectorProps } from "./Inspector.js";

// Rendu serveur : zustand lit `getInitialState()` ; le test rend l'état courant des stores.
for (const store of [appStore, modelService.store, journeyStore, uiStore]) {
  (store as { getInitialState: () => unknown }).getInitialState = store.getState;
}

afterEach(() => {
  appStore.getState().setLocale("fr");
});

function render(props: InspectorProps, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(Inspector, { drawer: props.drawer }));
}

/** Balise ouvrante de l'inspecteur. */
const asideTag = (html: string): string => html.match(/<aside[^>]*>/)?.[0] ?? "";

describe("inspecteur en tiroir", () => {
  it("colonne (grand écran) : ni croix, ni marque de tiroir, ni inert", () => {
    const html = render({});
    expect(asideTag(html)).toContain('class="inspector"');
    expect(asideTag(html)).not.toContain("data-drawer");
    expect(asideTag(html)).not.toContain("inert");
    expect(html).not.toContain("inspector__drawer-close");
  });

  it("tiroir ouvert : croix « Fermer l'inspecteur » (icône seule, nom accessible)", () => {
    const html = render({ drawer: "open" });
    expect(asideTag(html)).toContain('data-drawer="open"');
    expect(asideTag(html)).not.toContain("inert");
    expect(html).toMatch(
      /<div class="inspector__drawer-bar"><button type="button" class="btn btn-ghost btn-icon inspector__drawer-close" aria-label="Fermer l&#x27;inspecteur" title="Fermer l&#x27;inspecteur"><svg[^>]*aria-hidden="true"/,
    );
    expect(render({ drawer: "open" }, "en")).toContain('aria-label="Close the inspector"');
  });

  it("tiroir fermé : inerte, sans croix", () => {
    const html = render({ drawer: "closed" });
    expect(asideTag(html)).toContain('data-drawer="closed"');
    expect(asideTag(html)).toMatch(/inert=""/);
    expect(html).not.toContain("inspector__drawer-close");
  });
});
