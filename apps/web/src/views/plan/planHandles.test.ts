import cage60Text from "../../../../../examples/cage-60.blondel.json?raw";
import {
  buildModel,
  createProject,
  parseProjectText,
  stairPivot,
  toLocal,
  type Project,
  type StairPlacement,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { handleKey } from "../../lib/planDrag.js";
import { ROTATE_HANDLE_OFFSET_PX } from "../../lib/planErgonomics.js";
import { placedFootprint, selectionHandles } from "./planHandles.js";

const cage60: Project = parseProjectText(cage60Text);
const model60 = buildModel(cage60);

describe("poignées de la sélection (positions lues dans le modèle)", () => {
  it("escalier : déplacement au centre de l'emprise, rotation à distance fixe à l'écran", () => {
    const spots = selectionHandles({ kind: "stair" }, model60, cage60, 2);
    expect(spots.map((s) => handleKey(s.handle))).toEqual(["move", "rotate"]);
    const pivot = stairPivot(cage60, model60.layout);
    expect(spots[0]!.at).toEqual(pivot);
    const rot = spots[1]!;
    expect(rot.from).toEqual(pivot);
    expect(Math.hypot(rot.at.x - pivot.x, rot.at.y - pivot.y)).toBeCloseTo(
      ROTATE_HANDLE_OFFSET_PX * 2,
      9,
    );
    // Rotation nulle : la poignée est « devant » l'escalier (axe y du site).
    expect(rot.at.x).toBeCloseTo(pivot.x, 9);
    expect(rot.at.y).toBeGreaterThan(pivot.y);
  });

  it("tronçon : fin au milieu de la ligne d'arrivée et quatre bords ; jonction : angle", () => {
    const s = model60.layout.sections![1]!;
    const spots = selectionHandles({ kind: "section", index: 1 }, model60, cage60, 2);
    expect(spots.map((x) => handleKey(x.handle))).toEqual([
      "sectionEnd:1",
      "width:1:start:left",
      "width:1:start:right",
      "width:1:end:left",
      "width:1:end:right",
    ]);
    expect(spots[0]!.at).toEqual({
      x: (s.end.left.x + s.end.right.x) / 2,
      y: (s.end.left.y + s.end.right.y) / 2,
    });
    expect(spots[4]!.at).toEqual(s.end.right);
    const j = selectionHandles({ kind: "junction", index: 0 }, model60, cage60, 2);
    expect(j.map((x) => handleKey(x.handle))).toEqual(["junctionAngle:0"]);
  });

  it("aucune poignée : pas de sélection, élément absent, élément du site, hélicoïdal", () => {
    expect(selectionHandles(null, model60, cage60, 2)).toEqual([]);
    expect(selectionHandles({ kind: "section", index: 9 }, model60, cage60, 2)).toEqual([]);
    expect(selectionHandles({ kind: "opening" }, model60, cage60, 2)).toEqual([]);
    const helical = createProject("helical");
    const mh = buildModel(helical);
    expect(selectionHandles({ kind: "junction", index: 0 }, mh, helical, 2)).toEqual([]);
    // Hélicoïdal calculé par le moteur de cage (F10, P2) : son tronçon à axe en arc n'a pas de
    // poignée de longueur ni de largeur (réglé dans le formulaire de l'hélicoïdal).
    expect(mh.layout.sections?.length).toBe(1);
    expect(selectionHandles({ kind: "section", index: 0 }, mh, helical, 2)).toEqual([]);
  });

  it("emprise reportée : chaque sommet au même point local du placement cible (propriété)", () => {
    const fp = model60.layout.footprint;
    const from = cage60.stair.placement;
    fc.assert(
      fc.property(
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: -360, max: 360 }),
        (x, y, rotation) => {
          const to: StairPlacement = { origin: { x, y }, rotation };
          const moved = placedFootprint(fp, from, to);
          return fp.every((p, i) => {
            const a = toLocal(moved[i]!, to);
            const b = toLocal(p, from);
            return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
          });
        },
      ),
      { numRuns: 50 },
    );
    // Translation pure : l'emprise est décalée du même vecteur.
    const to: StairPlacement = {
      origin: { x: from.origin.x + 250, y: from.origin.y - 120 },
      rotation: from.rotation,
    };
    placedFootprint(fp, from, to).forEach((q, i) => {
      expect(q.x).toBeCloseTo(fp[i]!.x + 250, 6);
      expect(q.y).toBeCloseTo(fp[i]!.y - 120, 6);
    });
  });

  it("emprise reportée : déplacement rigide (distances conservées, propriété)", () => {
    const fp = model60.layout.footprint;
    const from = cage60.stair.placement;
    fc.assert(
      fc.property(
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: -360, max: 360 }),
        (x, y, rotation) => {
          const to: StairPlacement = { origin: { x, y }, rotation };
          const moved = placedFootprint(fp, from, to);
          return fp.every((p, i) => {
            const q = fp[(i + 1) % fp.length]!;
            const a = moved[i]!;
            const b = moved[(i + 1) % fp.length]!;
            return (
              Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - Math.hypot(a.x - b.x, a.y - b.y)) < 1e-6
            );
          });
        },
      ),
      { numRuns: 50 },
    );
    expect(placedFootprint(fp, from, from)).toEqual(fp.map((p) => ({ x: p.x + 0, y: p.y + 0 })));
  });
});
