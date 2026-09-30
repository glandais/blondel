/**
 * Rendu du panneau de paramètres et de l'assistant dans les deux langues (ADR-0007) : le
 * français reste celui des e2e, l'anglais ne laisse passer aucun libellé français du lot.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { switchLayoutKind } from "../lib/layoutKind.js";
import { appStore } from "../store/appStore.js";
import { AssistantDialog } from "./AssistantDialog.js";
import { ParamsPanel } from "./ParamsPanel.js";

const initial = appStore.getState().project;

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant du store.
appStore.getInitialState = appStore.getState;

afterEach(() => {
  appStore.getState().setAssistantOpen(false);
  appStore.getState().setLocale("fr");
  appStore.getState().replaceProject(initial);
});

function panel(locale: "fr" | "en", helical = false): string {
  appStore.getState().setLocale(locale);
  if (helical) appStore.getState().update((p) => switchLayoutKind(p, "helical").project);
  return renderToStaticMarkup(createElement(ParamsPanel));
}

function assistant(locale: "fr" | "en"): string {
  appStore.getState().setLocale(locale);
  appStore.getState().setAssistantOpen(true);
  return renderToStaticMarkup(createElement(AssistantDialog));
}

describe("ParamsPanel", () => {
  it("français : libellés inchangés", () => {
    const html = panel("fr");
    for (const text of [
      "Hauteur à monter H",
      "Recaler volées et trémie",
      "Ajouter une volée",
      "Contexte de contrôle",
      "Aucune (marches, contremarches, paliers)",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("anglais : libellés traduits", () => {
    const html = panel("en");
    for (const text of [
      "Total rise H",
      "Realign flights and opening",
      "Add a flight",
      "Design check context",
      "None (treads, risers, landings)",
    ]) {
      expect(html).toContain(text);
    }
    for (const text of ["Hauteur à monter", "Recaler", "Ajouter une volée", "Balancement"]) {
      expect(html).not.toContain(text);
    }
  });

  it("hélicoïdal : formulaire traduit", () => {
    expect(panel("fr", true)).toContain("Sens de rotation en montant");
    const html = panel("en", true);
    expect(html).toContain("Direction of rotation going up");
    expect(html).toContain("Stair width E = R_e − r: ");
    expect(html).not.toContain("Rayon extérieur");
  });
});

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
    // Aucune clé brute (clé absente du dictionnaire) dans les deux rendus anglais.
    expect(en).not.toMatch(/\b(ui|compliance|assistant)\.[a-z]+\.[\w.]+/);
    expect(panel("en")).not.toMatch(/\b(ui|compliance|assistant)\.[a-z]+\.[\w.]+/);
    expect(panel("en", true)).not.toMatch(/\b(ui|compliance|assistant)\.[a-z]+\.[\w.]+/);
  });
});
