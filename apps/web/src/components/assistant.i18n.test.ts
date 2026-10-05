/**
 * Rendu de l'assistant d'initialisation dans les deux langues (ADR-0007) : le français reste
 * celui des e2e, l'anglais ne laisse passer aucun libellé français ni clé brute. (Repris de
 * l'ancien `paramsPanel.i18n.test.ts` ; le panneau de paramètres est couvert par
 * `free/free.test.ts`.)
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { appStore } from "../store/appStore.js";
import { AssistantDialog } from "./AssistantDialog.js";

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant du store.
appStore.getInitialState = appStore.getState;

afterEach(() => {
  appStore.getState().setAssistantOpen(false);
  appStore.getState().setLocale("fr");
});

function assistant(locale: "fr" | "en"): string {
  appStore.getState().setLocale(locale);
  appStore.getState().setAssistantOpen(true);
  return renderToStaticMarkup(createElement(AssistantDialog));
}

describe("AssistantDialog", () => {
  it("français et anglais", () => {
    const fr = assistant("fr");
    expect(fr).toContain("Assistant d&#x27;initialisation");
    expect(fr).toContain("Proposer");
    const en = assistant("en");
    expect(en).toContain("Set-up wizard");
    expect(en).toContain("Propose");
    expect(en).toContain("Fill in the site then “Propose”");
    expect(en).not.toContain("Proposer");
    expect(en).not.toContain("Trémie");
    // Aucune clé brute (clé absente du dictionnaire) dans le rendu anglais.
    expect(en).not.toMatch(/\b(ui|compliance|assistant)\.[a-z]+\.[\w.]+/);
  });
});
