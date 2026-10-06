/**
 * Cibles de clic des SVG exportés affichés (plan coté, élévation) : la cible du nez d'arrivée
 * (`data-nosing-target`, QUESTIONS A28) l'emporte sur la marche qu'elle recouvre ; surlignage
 * de la marche et du nez sélectionnés.
 */
import { describe, expect, it } from "vitest";
import { highlightCss, svgHit, type HitElement } from "./ExportedSvg.js";

/** Élément factice : attributs portés par lui-même ou ses ancêtres. */
function element(attrs: Readonly<Record<string, string>>): HitElement {
  return {
    closest: (selector: string) => {
      const name = /^\[([\w-]+)\]$/.exec(selector)?.[1];
      if (name === undefined || attrs[name] === undefined) return null;
      return { getAttribute: (n: string) => attrs[n] ?? null };
    },
  };
}

describe("cible d'un clic dans le dessin", () => {
  it("nez d'arrivée, marche, vide", () => {
    expect(svgHit(element({ "data-nosing-target": "14" }))).toEqual({ kind: "nosing", index: 14 });
    expect(svgHit(element({ "data-tread": "3" }))).toEqual({ kind: "tread", number: 3 });
    expect(svgHit(element({}))).toBeNull();
    expect(svgHit(null)).toBeNull();
  });

  it("la cible du nez l'emporte sur une marche ancêtre ; attributs invalides ignorés", () => {
    expect(svgHit(element({ "data-nosing-target": "14", "data-tread": "14" }))).toEqual({
      kind: "nosing",
      index: 14,
    });
    expect(svgHit(element({ "data-nosing-target": "x", "data-tread": "2" }))).toEqual({
      kind: "tread",
      number: 2,
    });
    // Le point de nez exporté (`data-nosing`, sans cible) n'est pas sélectionnable.
    expect(svgHit(element({ "data-nosing": "14" }))).toBeNull();
  });
});

describe("surlignage de la sélection", () => {
  it("rien sans sélection", () => {
    expect(highlightCss()).toBe("");
  });

  it("marche : forme remplie et contour de sélection", () => {
    const css = highlightCss(3);
    expect(css).toContain('polygon[data-tread="3"]');
    expect(css).toContain("var(--selected)");
    expect(css).not.toContain("data-nosing");
  });

  it("nez : ligne du plan et point de l'élévation en teinte de sélection", () => {
    const css = highlightCss(undefined, 14);
    expect(css).toContain('line[data-nosing="14"] { stroke: var(--selected)');
    expect(css).toContain('circle[data-nosing="14"] { fill: var(--selected)');
    expect(css).not.toContain("data-tread");
  });
});
