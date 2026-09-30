import { describe, expect, it } from "vitest";
import { computeHeadroom } from "../headroom/headroom.js";
import { computeLayout } from "../layout/layout.js";
import { computeStepping } from "../stepping/stepping.js";
import type { Project } from "../model/project.js";
import { defaultOpening } from "./defaultOpening.js";
import { createProject, PRESET_HEADROOM_MIN } from "./presets.js";
import { createHelicalProject } from "./presetHelical.js";

const withoutOpening = (p: Project): Project => {
  const { opening: _, ...site } = p.site;
  return { ...p, site };
};

describe("defaultOpening (trémie proposée à l'ajout, QUESTIONS D6)", () => {
  it("escalier à volées : trémie du préréglage, échappée respectée", () => {
    const preset = createProject("quarter-left");
    const opening = defaultOpening(withoutOpening(preset));
    expect(opening).toEqual(preset.site.opening);
    const p = { ...preset, site: { ...preset.site, opening: opening! } };
    const layout = computeLayout(p);
    const h = computeHeadroom(p.site, layout, computeStepping(p, layout));
    expect(h).not.toBeNull();
    if (h?.walkline) expect(h.walkline.min).toBeGreaterThanOrEqual(PRESET_HEADROOM_MIN - 1e-6);
  });

  it("hélicoïdal : trémie circulaire du préréglage (R_e + jeu)", () => {
    const preset = createHelicalProject();
    expect(defaultOpening(withoutOpening(preset))).toEqual(preset.site.opening);
  });

  it("dalle haute sans besoin de trémie ou tracé impossible : null, sans exception", () => {
    const p = createProject("straight");
    expect(defaultOpening({ ...p, site: { ...p.site, floorToFloor: 100 } })).toBeNull();
  });
});
