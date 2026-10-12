import cage60Text from "../../../../../examples/cage-60.blondel.json?raw";
import cageArcText from "../../../../../examples/cage-arc.blondel.json?raw";
import cagePalierText from "../../../../../examples/cage-palier-droit.blondel.json?raw";
import j3aText from "../../../../../examples/j3a-acceptance-01-bois.blondel.json?raw";
import { buildModel, parseProjectText, type Obstacle, type Vec2 } from "@blondel/core";
import { createTranslator } from "@blondel/i18n";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PlanSelection } from "../../store/planEditor.js";
import {
  junctionPolygon,
  obstacleShape,
  parsePlanSelection,
  planSelectionKey,
  sectionPathData,
} from "./planEditorGeometry.js";
import { selectable, selectionLabel } from "./selectable.js";

/** Tous les exemples du dépôt (texte brut). */
const EXAMPLES = import.meta.glob<string>("../../../../../examples/*.blondel.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

const model = (text: string) => buildModel(parseProjectText(text));
const round = (pts: readonly Vec2[]): [number, number][] =>
  pts.map((p) => [Math.round(p.x), Math.round(p.y)]);

const arbSelection: fc.Arbitrary<PlanSelection> = fc.oneof(
  fc.constant({ kind: "stair" } as const),
  fc.constant({ kind: "opening" } as const),
  fc.record({
    kind: fc.constantFrom(
      "section" as const,
      "junction" as const,
      "openingVertex" as const,
      "roomVertex" as const,
    ),
    index: fc.nat(1000),
  }),
  fc.record({
    kind: fc.constantFrom("wall" as const, "obstacle" as const),
    id: fc.string({ minLength: 1, maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant("wallEnd" as const),
    id: fc.string({ minLength: 1, maxLength: 8 }),
    end: fc.constantFrom("a" as const, "b" as const),
  }),
);

describe("clé data-plan-select", () => {
  it("aller-retour planSelectionKey → parsePlanSelection (propriété)", () => {
    fc.assert(
      fc.property(arbSelection, (sel) => {
        expect(parsePlanSelection(planSelectionKey(sel))).toEqual(sel);
      }),
    );
  });

  it("clés invalides refusées", () => {
    for (const k of [null, undefined, "", "section", "section:x", "wall:", "wallEnd:c:m1", "foo"]) {
      expect(parsePlanSelection(k)).toBeNull();
    }
    expect(parsePlanSelection("wallEnd:a:m:1")).toEqual({ kind: "wallEnd", id: "m:1", end: "a" });
  });
});

describe("formes lues dans le modèle", () => {
  it("cage-60 : jonction = arrivée du tronçon 1, coin extérieur, départ du tronçon 2", () => {
    const m = model(cage60Text);
    const pts = junctionPolygon(m.layout, 0)!;
    expect(round(pts)).toEqual([
      [0, 1650],
      [900, 1650],
      [900, 2170],
      [450, 2429],
    ]);
    expect(junctionPolygon(m.layout, 1)).toBeNull();
    expect(sectionPathData(m.layout.sections![0]!)).toBe("M0 0L0 1650L900 1650L900 0Z");
  });

  it("palier droit : rectangle entre les deux tronçons", () => {
    const m = model(cagePalierText);
    expect(round(junctionPolygon(m.layout, 0)!)).toEqual([
      [0, 1890],
      [900, 1890],
      [900, 2890],
      [0, 2890],
    ]);
  });

  it("quart tournant à volées (j3a) : carré d'angle", () => {
    const m = model(j3aText);
    expect(round(junctionPolygon(m.layout, 0)!)).toEqual([
      [0, 480],
      [800, 480],
      [800, 1280],
      [0, 1280],
    ]);
  });

  it("tronçon en arc : deux arcs concentriques, drapeau de balayage du sens trigonométrique", () => {
    const m = model(cageArcText);
    const s = m.layout.sections![0]!;
    expect(s.kind).toBe("arc");
    const d = sectionPathData(s);
    expect(d.match(/A/g)).toHaveLength(2);
    // Balayage positif : premier arc en sens 1, retour en sens 0.
    expect(d).toMatch(/^M0 0A1700 1700 0 0 1 /);
    expect(d).toMatch(/A2600 2600 0 0 0 900 0Z$/);
  });

  it("toute jonction de tout exemple a un contour d'au moins 3 sommets distincts", () => {
    const texts = Object.entries(EXAMPLES);
    // Exemples de cage (rayonnant : jour en arc ; trapèze : largeur variable) et à volées.
    expect(texts.length).toBeGreaterThanOrEqual(39);
    let junctions = 0;
    for (const [file, text] of texts) {
      const m = model(text);
      m.layout.turns.forEach((_, j) => {
        const pts = junctionPolygon(m.layout, j);
        expect(pts, `${file}, jonction ${j + 1}`).not.toBeNull();
        expect(pts!.length).toBeGreaterThanOrEqual(3);
        const keys = new Set(round(pts!).map((p) => p.join(",")));
        expect(keys.size, `${file}, jonction ${j + 1}`).toBe(pts!.length);
        junctions += 1;
      });
    }
    expect(junctions).toBeGreaterThan(0);
  });
});

describe("obstacles et attributs de sélection", () => {
  it("formes des obstacles", () => {
    const door: Obstacle = {
      kind: "door",
      id: "p1",
      a: { x: 0, y: 0 },
      b: { x: 800, y: 0 },
      hinge: "a",
      swing: "left",
    };
    const s = obstacleShape(door);
    expect(s.kind).toBe("bay");
    expect(s.kind === "bay" && s.swing !== undefined && s.swing.length > 3).toBe(true);
    expect(
      obstacleShape({ kind: "circularPost", id: "c", center: { x: 1, y: 2 }, radius: 50 }),
    ).toEqual({ kind: "circle", center: { x: 1, y: 2 }, radius: 50 });
    const zone = obstacleShape({
      kind: "zone",
      id: "z",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    });
    expect(zone.kind === "polygon" && zone.points.length).toBe(3);
  });

  it("libellés traduits, rôle et focus seulement dans l'outil de sélection", () => {
    const fr = createTranslator("fr");
    const en = createTranslator("en");
    expect(selectionLabel({ kind: "section", index: 0 }, fr)).toBe("Tronçon 1");
    expect(selectionLabel({ kind: "junction", index: 1 }, en)).toBe("Junction 2");
    expect(selectionLabel({ kind: "wallEnd", id: "m1", end: "b" }, fr)).toBe(
      "Extrémité B du mur m1",
    );
    const sel: PlanSelection = { kind: "section", index: 0 };
    const on = selectable(sel, { interactive: true, selectedKey: "section:0", tr: fr });
    expect(on).toMatchObject({
      "data-plan-select": "section:0",
      "data-selected": "true",
      role: "button",
      tabIndex: 0,
      "aria-label": "Tronçon 1",
      "aria-pressed": true,
    });
    const off = selectable(sel, { interactive: false, selectedKey: null, tr: fr });
    expect(off).toEqual({ "data-plan-select": "section:0" });
  });
});
