/**
 * Chaîne d'Échap (ADR-0009) : saisie / menu → panneau non épinglé → tiroir → sélection → panneau
 * épinglé, une seule action par appui ; filtre des raccourcis F et ← →.
 */
import { describe, expect, it } from "vitest";
import { escapeAction, plainShortcut, type EscapeInput, type EscapeTarget } from "./escapeChain.js";

const el = (tagName: string, inModal = false, editable = false): EscapeTarget => ({
  tagName,
  isContentEditable: editable,
  closest: () => (inModal ? {} : null),
});

const base: EscapeInput = {
  key: "Escape",
  defaultPrevented: false,
  target: el("BUTTON"),
  assistantOpen: false,
  panelOpen: false,
  panelPinned: false,
  drawerOpen: false,
  hasSelection: false,
};
const esc = (extra: Partial<EscapeInput>) => escapeAction({ ...base, ...extra });

describe("ordre d'Échap", () => {
  it("panneau non épinglé avant la sélection", () => {
    expect(esc({ panelOpen: true, panelPinned: false, hasSelection: true })).toBe("closePanel");
    expect(esc({ panelOpen: true, panelPinned: false })).toBe("closePanel");
  });

  it("sélection avant le panneau épinglé", () => {
    expect(esc({ panelOpen: true, panelPinned: true, hasSelection: true })).toBe("clearSelection");
    expect(esc({ hasSelection: true })).toBe("clearSelection");
  });

  it("panneau épinglé en dernier ; rien à faire sinon", () => {
    expect(esc({ panelOpen: true, panelPinned: true })).toBe("closePanel");
    expect(esc({})).toBeNull();
    // Épinglé mais fermé : l'épingle seule ne compte pas.
    expect(esc({ panelPinned: true })).toBeNull();
  });

  it("enchaînement : trois appuis, trois actions, puis plus rien", () => {
    let state = { panelOpen: true, panelPinned: false, hasSelection: true };
    const seen: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const a = esc(state);
      seen.push(a);
      if (a === "closePanel") state = { ...state, panelOpen: false };
      if (a === "clearSelection") state = { ...state, hasSelection: false };
    }
    expect(seen).toEqual(["closePanel", "clearSelection", null]);
  });

  it("tiroir de l'inspecteur : après le panneau non épinglé, avant la sélection", () => {
    expect(esc({ panelOpen: true, drawerOpen: true, hasSelection: true })).toBe("closePanel");
    expect(esc({ drawerOpen: true, hasSelection: true })).toBe("closeDrawer");
    expect(esc({ drawerOpen: true })).toBe("closeDrawer");
    expect(esc({ panelOpen: true, panelPinned: true, drawerOpen: true })).toBe("closeDrawer");
    // Tiroir, sélection, panneau épinglé : quatre appuis, dans l'ordre de la chaîne.
    let state = {
      panelOpen: true,
      panelPinned: true,
      drawerOpen: true,
      hasSelection: true,
    };
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const a = esc(state);
      seen.push(a);
      if (a === "closePanel") state = { ...state, panelOpen: false };
      if (a === "closeDrawer") state = { ...state, drawerOpen: false };
      if (a === "clearSelection") state = { ...state, hasSelection: false };
    }
    expect(seen).toEqual(["closeDrawer", "clearSelection", "closePanel", null]);
  });

  it("tiroir : ignoré dans une saisie ou si l'événement est déjà traité", () => {
    expect(esc({ drawerOpen: true, target: el("INPUT") })).toBeNull();
    expect(esc({ drawerOpen: true, defaultPrevented: true })).toBeNull();
  });

  it("depuis le document (aucune cible)", () => {
    expect(esc({ target: null, hasSelection: true })).toBe("clearSelection");
  });

  it("ignoré : autre touche, déjà traité (menu, éditeur), saisie, modale, assistant", () => {
    const all = { panelOpen: true, hasSelection: true };
    expect(esc({ ...all, key: "Enter" })).toBeNull();
    expect(esc({ ...all, defaultPrevented: true })).toBeNull();
    for (const tag of ["INPUT", "textarea", "SELECT"]) {
      expect(esc({ ...all, target: el(tag) })).toBeNull();
    }
    expect(esc({ ...all, target: el("DIV", false, true) })).toBeNull();
    expect(esc({ ...all, target: el("BUTTON", true) })).toBeNull();
    expect(esc({ ...all, assistantOpen: true })).toBeNull();
  });
});

describe("raccourcis F et flèches", () => {
  const key = {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target: el("DIV"),
  };

  it("sans modificateur, hors saisie et hors fenêtre modale", () => {
    expect(plainShortcut(key, false)).toBe(true);
    expect(plainShortcut({ ...key, target: null }, false)).toBe(true);
  });

  it("refusé : modificateur, saisie, modale, assistant, déjà traité", () => {
    expect(plainShortcut({ ...key, ctrlKey: true }, false)).toBe(false);
    expect(plainShortcut({ ...key, metaKey: true }, false)).toBe(false);
    expect(plainShortcut({ ...key, altKey: true }, false)).toBe(false);
    expect(plainShortcut({ ...key, target: el("INPUT") }, false)).toBe(false);
    expect(plainShortcut({ ...key, target: el("DIV", false, true) }, false)).toBe(false);
    expect(plainShortcut({ ...key, target: el("DIV", true) }, false)).toBe(false);
    expect(plainShortcut({ ...key, defaultPrevented: true }, false)).toBe(false);
    expect(plainShortcut(key, true)).toBe(false);
  });
});
