import type { PartCategory } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { TEMPLATE_FAMILIES, TEMPLATE_FAMILY_LABELS, templateFamily } from "./templateFamily.js";

const part = (id: string, category: PartCategory) => ({ id, category });

describe("familles de gabarits (QUESTIONS A20)", () => {
  it("limons et structure, marches, garde-corps", () => {
    expect(templateFamily(part("stringer-inner-1", "stringer"))).toBe("stringers");
    expect(templateFamily(part("newel-1", "post"))).toBe("stringers");
    expect(templateFamily(part("support-3", "support"))).toBe("stringers");
    expect(templateFamily(part("tread-5", "tread"))).toBe("treads");
    expect(templateFamily(part("riser-5", "riser"))).toBe("treads");
    expect(templateFamily(part("landing-1", "landing"))).toBe("treads");
    expect(templateFamily(part("guard-left-1-post-2", "post"))).toBe("guards");
    expect(templateFamily(part("guard-opening-1-panel-1", "infill"))).toBe("guards");
    expect(templateFamily(part("handrail-wall-left-1", "handrail"))).toBe("guards");
    expect(templateFamily(part("x", "baluster"))).toBe("guards");
    for (const f of TEMPLATE_FAMILIES) expect(TEMPLATE_FAMILY_LABELS[f]).toBeTruthy();
  });
});
