import { msg } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import type { Part } from "../model/derived.js";
import { DEFAULT_WORKSHOP_PROFILE } from "../workshop/profile.js";
import { MarkRegistry, panelMember, type PartFactoryContext } from "./parts.js";

const common = (id: string) => ({
  id,
  prefix: "PV",
  category: "infill" as const,
  name: msg("part.glassPanel.name"),
  material: "glass" as const,
});

describe("repères des panneaux (QUESTIONS D1 et A1)", () => {
  it("un trapèze ne partage pas le repère ni la masse d'un rectangle de même hauteur maximale", () => {
    const ctx: PartFactoryContext = {
      marks: new MarkRegistry(DEFAULT_WORKSHOP_PROFILE.identicalPartTolerance),
      profile: DEFAULT_WORKSHOP_PROFILE,
    };
    const bottom = [
      { x: 0, y: 0, z: 0 },
      { x: 500, y: 0, z: 0 },
      { x: 1000, y: 0, z: 0 },
    ];
    const normals = bottom.map(() => ({ x: 0, y: 1 }));
    const rect0 = panelMember(
      ctx,
      common("a"),
      bottom,
      bottom.map((p) => ({ ...p, z: 900 })),
      normals,
      10,
    );
    // Même longueur, même hauteur maximale, même pente du bas : dessus rehaussé d'un côté.
    const raised0 = panelMember(
      ctx,
      common("b"),
      bottom,
      [
        { x: 0, y: 0, z: 800 },
        { x: 500, y: 0, z: 900 },
        { x: 1000, y: 0, z: 900 },
      ],
      normals,
      10,
    );
    const same0 = panelMember(
      ctx,
      common("c"),
      bottom,
      bottom.map((p) => ({ ...p, z: 900 })),
      normals,
      10,
    );
    // Repères attribués une fois toutes les pièces connues (G2b).
    const [rect, raised, same] = ctx.marks.apply([rect0, raised0, same0]) as [Part, Part, Part];
    expect(rect.mark).toBe("PV1");
    expect(raised.mark).not.toBe(rect.mark);
    expect(raised.quantities["mass_kg"]).toBeLessThan(rect.quantities["mass_kg"]!);
    expect(same.mark).toBe(rect.mark);
    expect(same.quantities).toEqual(rect.quantities);
  });
});
