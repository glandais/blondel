/**
 * Localisation précise des constats (ADR-0009, inspecteurs 2a à 2c) : appui d'une marche sur un
 * limon (`part` + `treadNumber`, « LE1 · M6 ») et échappée rattachée au nez le plus proche
 * (`point` + `nosingIndex`).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "../model/project.js";
import { parseProjectText } from "../project/parse.js";
import { buildModel, clearModelCache, nearestNosing } from "./build.js";

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const load = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES, file), "utf8"));

beforeEach(() => clearModelCache());

describe("localisation des constats", () => {
  it("appui trop court : pièce porteuse et marche (démo débillardé)", () => {
    const m = buildModel(load("demo-quarter-curved.blondel.json"));
    const short = m.compliance.results.filter(
      (r) => r.ruleId === "FAB_SUPPORT_LONGUEUR_MIN" && r.status === "violation",
    );
    expect(short.length).toBeGreaterThan(0);
    for (const r of short) {
      const loc = r.location;
      expect(loc.kind).toBe("part");
      if (loc.kind !== "part") continue;
      expect(m.parts.some((p) => p.id === loc.partId)).toBe(true);
      expect(m.stepping.treads.some((t) => t.number === loc.treadNumber)).toBe(true);
    }
  });

  it("appuis par poteau ou limon (acier plat) : pièce existante et marche", () => {
    const m = buildModel(load("demo-half-turn-industrial.blondel.json"));
    const short = m.compliance.results.filter(
      (r) => r.ruleId === "FAB_SUPPORT_LONGUEUR_MIN" && r.status === "violation",
    );
    expect(short.length).toBeGreaterThan(0);
    for (const r of short) {
      const loc = r.location;
      if (loc.kind !== "part") throw new Error("localisation de pièce attendue");
      expect(m.parts.some((p) => p.id === loc.partId)).toBe(true);
      expect(loc.treadNumber).toBeGreaterThan(0);
    }
  });

  it("échappée : point critique et nez le plus proche", () => {
    const m = buildModel(load("demo-quarter-curved.blondel.json"));
    const r = m.compliance.results.find((x) => x.ruleId === "ECHAPPEE_RECO_PRIVATIF");
    expect(r?.location.kind).toBe("point");
    if (r?.location.kind !== "point") return;
    const k = r.location.nosingIndex;
    expect(k).toBe(m.headroom?.nosingIndex);
    expect(k).toBeDefined();
    expect(m.stepping.nosings[k!]).toBeDefined();
  });

  it("nearestNosing : abscisse la plus proche, aucun nez → vide", () => {
    const nosings = [{ s: 0 }, { s: 250 }, { s: 500 }] as unknown as Parameters<
      typeof nearestNosing
    >[0];
    expect(nearestNosing(nosings, 260)).toEqual({ nosingIndex: 1 });
    expect(nearestNosing(nosings, 9999)).toEqual({ nosingIndex: 2 });
    expect(nearestNosing([], 10)).toEqual({});
  });
});
