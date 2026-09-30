import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layoutArb, quarterArb, straightArb } from "../testing/arbitraries.js";
import {
  layoutModel,
  layoutProject,
  report,
  ruleResult,
  sampleProject,
  straightModel,
} from "../testing/fixtures.js";
import { LIGHT_THEME } from "./svg.js";
import { findAll, parseXml } from "../testing/xml.js";
import { ceilingIntervals, renderElevationSvg } from "./elevation.js";

describe("renderElevationSvg", () => {
  const project = sampleProject(); // trémie y ∈ [1 000 ; 3 600], dalle 200

  it("profil, nez, ligne de pente, plafond hors trémie", () => {
    const m = straightModel({ floorToFloor: 2700, riserCount: 15, going: 250, width: 900 });
    const root = parseXml(renderElevationSvg(m, { project }));
    const nosings = findAll(root, "circle").filter((c) => c.attrs["data-nosing"] !== undefined);
    expect(nosings).toHaveLength(15);
    expect(findAll(root, "path").some((p) => p.attrs.class === "slope")).toBe(true);
    const profile = findAll(root, "path").find((p) => p.attrs.class === "profile")!;
    // 2 points de sol + 2 par nez sauf le premier (1) + sol haut.
    expect(profile.attrs.d!.match(/[ML]/g)).toHaveLength(2 + 1 + 2 * 14 + 1);
    const ceilings = findAll(root, "rect").filter((r) => r.attrs.class === "ceiling");
    expect(ceilings).toHaveLength(2); // avant la trémie et plancher d'arrivée
    const texts = findAll(root, "text").map((t) => t.text);
    expect(texts).toContain("H = 2 700");
    expect(texts.filter((t) => t === "180,0")).toHaveLength(15);
  });

  it("marches ciblables (data-tread) et violation localisée en couleur", () => {
    const m = straightModel({
      results: [ruleResult("G_MIN", { kind: "tread", number: 4 }, "avertissement")],
    });
    const root = parseXml(renderElevationSvg(m));
    const treads = findAll(root, "path").filter((p) => p.attrs["data-tread"] !== undefined);
    expect(treads.map((t) => t.attrs["data-tread"])).toEqual(
      Array.from({ length: 14 }, (_, i) => String(i + 1)),
    );
    const t4 = treads.find((t) => t.attrs["data-tread"] === "4")!;
    expect(t4.attrs.stroke).toBe(LIGHT_THEME.warning);
    expect(t4.attrs["data-severity"]).toBe("avertissement");
    expect(treads.find((t) => t.attrs["data-tread"] === "5")!.attrs["data-severity"]).toBe(
      undefined,
    );
  });

  it("intervalles de plafond sur la ligne de foulée", () => {
    const m = straightModel({ floorToFloor: 2700, riserCount: 15, going: 250, width: 900 });
    const iv = ceilingIntervals(m, project, -500, 4000);
    expect(iv).toHaveLength(2);
    expect(iv[0]![0]).toBe(-500);
    expect(iv[0]![1]).toBeCloseTo(1000, 4);
    expect(iv[1]![0]).toBeCloseTo(3600, 4);
    expect(iv[1]![1]).toBe(4000);
    const noOpening = { ...project, site: { ...project.site, opening: undefined } };
    expect(ceilingIntervals(m, noOpening, 0, 100)).toEqual([]);
  });

  it("plafond lu dans Model.upperFloor, sans option project (QUESTIONS D5)", () => {
    const m = straightModel({ floorToFloor: 2700, riserCount: 15, going: 250, width: 900 });
    const upperFloor = {
      slabThickness: 200,
      opening: [
        { x: -1000, y: 1000 },
        { x: 2000, y: 1000 },
        { x: 2000, y: 3600 },
        { x: -1000, y: 3600 },
      ],
    };
    const withFloor = { ...m, upperFloor };
    const ceilingsOf = (svg: string) =>
      findAll(parseXml(svg), "rect").filter((r) => r.attrs.class === "ceiling");
    // Sans trémie dans le modèle ni projet : pas de plafond (comportement antérieur).
    expect(ceilingsOf(renderElevationSvg(m))).toHaveLength(0);
    expect(ceilingsOf(renderElevationSvg(withFloor))).toHaveLength(2);
    // Le modèle prime sur le projet ; le projet sert de repli.
    expect(renderElevationSvg(withFloor)).toBe(renderElevationSvg(withFloor, { project }));
    const iv = ceilingIntervals(withFloor, undefined, -500, 4000);
    expect(iv[0]![1]).toBeCloseTo(1000, 4);
    expect(ceilingIntervals({ ...m, upperFloor: { slabThickness: 200 } }, project, 0, 100)).toEqual(
      [],
    );
  });

  it("échappée mesurée et gabarit réglementaire lu dans le rapport", () => {
    const base = straightModel({ headroom: { min: 1850, at: { x: 450, y: 1000, z: 0 } } });
    const m = {
      ...base,
      compliance: report([
        ruleResult("ECHAPPEE_MIN_DTU", { kind: "stair" }, "bloquant", {
          min: 1900,
          measured: 1850,
        }),
        ruleResult("ECHAPPEE_RECO_PRIVATIF", { kind: "stair" }, "conseil", { min: 2100 }),
      ]),
    };
    const root = parseXml(renderElevationSvg(m, { project }));
    const gauge = findAll(root, "g").find((g) => g.attrs.class === "headroom-gauge")!;
    expect(findAll(gauge, "text")[0]!.attrs["data-value"]).toBe("1900");
    const hr = findAll(root, "g").find((g) => g.attrs.class === "headroom")!;
    // 1 850 < 1 900 exigés : échappée en rouge (bloquant).
    expect(hr.attrs.stroke).toBe(LIGHT_THEME.blocking);
    expect(findAll(hr, "text")[0]!.text).toBe("e = 1 850");
    // Échappée suffisante : couleur d'échappée, pas de rouge.
    const ok = { ...m, headroom: { min: 2000, at: { x: 450, y: 1000, z: 0 } } };
    const okHr = findAll(parseXml(renderElevationSvg(ok, { project })), "g").find(
      (g) => g.attrs.class === "headroom",
    )!;
    expect(okHr.attrs.stroke).toBe(LIGHT_THEME.headroom);
    // Sans règle d'échappée : pas de gabarit (aucune valeur en dur).
    const none = parseXml(renderElevationSvg(base, { project }));
    expect(findAll(none, "g").some((g) => g.attrs.class === "headroom-gauge")).toBe(false);
  });

  it("trémie dans le repère du site, escalier placé et tourné (computeLayout)", () => {
    // Rotation 90° : la montée (+Y local) va vers −X ; départ en x = 5 000.
    const p = layoutProject({
      width: 900,
      legs: [3500],
      origin: { x: 5000, y: 0 },
      rotation: 90,
      opening: { kind: "rect", x: 1400, y: 0, sizeX: 2600, sizeY: 900 },
    });
    const m = layoutModel(p, { riserCount: 15 });
    const iv = ceilingIntervals(m, p, -500, 4000);
    expect(iv).toHaveLength(2);
    expect(iv[0]![1]).toBeCloseTo(1000, 4);
    expect(iv[1]![0]).toBeCloseTo(3600, 4);
  });

  it("propriété : bien formé et sans NaN", () => {
    fc.assert(
      fc.property(fc.oneof(straightArb, quarterArb, layoutArb), (m) => {
        const svg = renderElevationSvg(m, { project, theme: "dark" });
        parseXml(svg);
        expect(/NaN|Infinity/.test(svg)).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});
