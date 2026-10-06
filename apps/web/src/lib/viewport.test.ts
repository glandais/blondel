/** Classes de largeur de la fenêtre (ADR-0009 point 3). */
import { describe, expect, it } from "vitest";
import {
  DRAWER_BREAKPOINT,
  DRAWER_QUERY,
  GUIDED_ONLY_BREAKPOINT,
  GUIDED_ONLY_QUERY,
  viewportClass,
  viewportClassOf,
} from "./viewport.js";

describe("classes de largeur", () => {
  it("seuils de l'ADR-0009 : 1 100 et 760 px", () => {
    expect(DRAWER_BREAKPOINT).toBe(1100);
    expect(GUIDED_ONLY_BREAKPOINT).toBe(760);
    expect(DRAWER_QUERY).toBe("(min-width: 1100px)");
    expect(GUIDED_ONLY_QUERY).toBe("(min-width: 760px)");
  });

  it("bornes incluses du côté large", () => {
    expect(viewportClass(1440)).toBe("wide");
    expect(viewportClass(1100)).toBe("wide");
    expect(viewportClass(1099)).toBe("medium");
    expect(viewportClass(1099.5)).toBe("medium");
    expect(viewportClass(760)).toBe("medium");
    expect(viewportClass(759)).toBe("narrow");
    expect(viewportClass(390)).toBe("narrow");
    expect(viewportClass(0)).toBe("narrow");
  });

  it("d'après les requêtes média : même classe que la largeur", () => {
    for (const w of [320, 390, 759, 760, 900, 1099, 1100, 1440, 2560]) {
      expect(viewportClassOf(w >= 1100, w >= 760)).toBe(viewportClass(w));
    }
  });
});
