/**
 * Constats de conformité sur les exemples du dépôt (vérification adverse, dimension « règles ») :
 * exception du fût ≤ 400 mm (MC_DEUX_COTES), main courante côté extérieur d'un tournant d'1 UP
 * (MC_UP_ERP), surcharges de contrôles de plugins, bornes des constats « ok ».
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Model, RuleResult } from "../../model/derived.js";
import type { Project } from "../../model/project.js";
import { buildModel } from "../../pipeline/build.js";
import { parseProjectText } from "../../project/parse.js";
import { MC_CORE_DIAMETER_MAX } from "../formula-constants.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../examples");

type Json = Record<string, unknown>;

/** Exemple relu puis modifié (JSON sérialisé), reparsé par `parseProjectText`. */
function example(name: string, patch: (d: Json) => void = () => {}): Project {
  const d = JSON.parse(readFileSync(join(EXAMPLES_DIR, name), "utf8")) as Json;
  patch(d);
  return parseProjectText(JSON.stringify(d));
}

const obj = (d: Json, key: string): Json => d[key] as Json;
const results = (m: Model, id: string): RuleResult[] =>
  m.compliance.results.filter((r) => r.ruleId === id);
const statuses = (rs: readonly RuleResult[]): string[] => rs.map((r) => r.status);
const build = (p: Project): Model => buildModel(p, { memo: false });

const HELICAL = "j5a-helicoidal.blondel.json";
const J4 = "j4-acceptance-01-garde-corps.blondel.json";

function helical(contexts: string[], core?: { kind: string; radius: number }): Project {
  return example(HELICAL, (d) => {
    obj(d, "compliance")["contexts"] = contexts;
    d["guards"] = {};
    if (core) {
      const layout = obj(obj(d, "stair"), "layout");
      layout["core"] = core;
    }
  });
}

describe("MC_DEUX_COTES — exception ERP neuf, hélicoïdal à fût de diamètre ≤ 400 mm", () => {
  it("l'extrait de formule porte le seuil", () => {
    expect(MC_CORE_DIAMETER_MAX.value).toBe(400);
  });

  it("fût Ø 140 mm en ERP neuf : une seule main courante suffit", () => {
    const r = results(build(helical(["erp_neuf", "helicoidal"])), "MC_DEUX_COTES");
    expect(statuses(r)).toEqual(["ok"]);
    expect(r[0]!.min).toBe(1);
    expect(r[0]!.message).toContain("fût");
  });

  it("fût de diamètre 500 mm : deux mains courantes exigées", () => {
    const p = helical(["erp_neuf", "helicoidal"], { kind: "column", radius: 250 });
    const r = results(build(p), "MC_DEUX_COTES");
    expect(statuses(r)).toEqual(["violation"]);
    expect(r[0]!.min).toBe(2);
  });

  it("fût de diamètre 400 mm (borne incluse) : une seule main courante", () => {
    const p = helical(["erp_neuf", "helicoidal"], { kind: "column", radius: 200 });
    expect(statuses(results(build(p), "MC_DEUX_COTES"))).toEqual(["ok"]);
  });

  it("jour central (pas de fût) : pas d'exception", () => {
    const p = helical(["erp_neuf", "helicoidal"], { kind: "well", radius: 70 });
    const r = results(build(p), "MC_DEUX_COTES");
    expect(r.every((x) => x.min === 2)).toBe(true);
  });

  it("BHC parties communes : « quelle que soit sa conception », deux mains courantes", () => {
    const r = results(build(helical(["bhc_parties_communes"])), "MC_DEUX_COTES");
    expect(statuses(r)).toEqual(["violation"]);
    expect(r[0]!.min).toBe(2);
  });
});

describe("MC_UP_ERP — tournant d'1 UP : main courante côté extérieur (CO 56 §3)", () => {
  function j4(wallSides: string): Project {
    return example(J4, (d) => {
      obj(d, "compliance")["contexts"] = ["erp_securite"];
      const g = obj(d, "guards");
      obj(g, "flight")["outer"] = "wall";
      obj(g, "handrail")["wallSides"] = wallSides;
    });
  }

  it("seule la main courante du garde-corps côté jour : violation", () => {
    const r = results(build(j4("none")), "MC_UP_ERP");
    expect(statuses(r)).toContain("violation");
    expect(r.find((x) => x.status === "violation")!.message).toContain("côté extérieur");
  });

  it("main courante murale côté extérieur : conforme", () => {
    expect(statuses(results(build(j4("outer")), "MC_UP_ERP"))).toEqual(["ok"]);
  });

  it("escalier droit d'1 UP : une main courante, quel que soit le côté", () => {
    const p = example("straight.blondel.json", (d) => {
      obj(d, "compliance")["contexts"] = ["erp_securite"];
      d["guards"] = { flight: { outer: "wall" }, handrail: { wallSides: "none" } };
    });
    expect(statuses(results(build(p), "MC_UP_ERP"))).toEqual(["ok"]);
  });
});

describe("surcharges de contrôles hors table (plugins)", () => {
  it("appliquée à un contrôle de plugin : pas de note « règle inconnue »", () => {
    const p = example(HELICAL, (d) => {
      obj(d, "compliance")["overrides"] = [
        { ruleId: "FAB_FORMAT_TOLE", severity: "conseil", justification: "tôle sur mesure" },
        { ruleId: "INEXISTANTE", severity: "conseil", justification: "essai" },
      ];
    });
    const m = build(p);
    const fab = results(m, "FAB_FORMAT_TOLE");
    expect(fab.length).toBeGreaterThan(0);
    expect(fab.every((r) => r.severity === "conseil")).toBe(true);
    const notes = m.compliance.notes ?? [];
    expect(notes.some((n) => n.includes("FAB_FORMAT_TOLE"))).toBe(false);
    expect(notes).toContain("Surcharge ignorée : règle inconnue « INEXISTANTE ».");
  });

  it("justification vide sur un contrôle de plugin : signalée comme telle", () => {
    const p = example(HELICAL, (d) => {
      obj(d, "compliance")["overrides"] = [
        { ruleId: "FAB_FORMAT_TOLE", severity: "conseil", justification: "  " },
      ];
    });
    const notes = build(p).compliance.notes ?? [];
    expect(notes).toContain("Surcharge ignorée sur FAB_FORMAT_TOLE : justification vide.");
    expect(notes.some((n) => n.includes("règle inconnue"))).toBe(false);
  });
});

describe("constats « ok » : bornes affichées cohérentes avec la mesure", () => {
  it("GC_OBLIGATOIRE : chute > seuil protégée par un garde-corps → pas de borne max affichée", () => {
    const r = results(build(example(J4)), "GC_OBLIGATOIRE");
    expect(statuses(r)).toEqual(["ok"]);
    expect(r[0]!.measured ?? 0).toBeGreaterThan(1000);
    expect(r[0]!.max).toBeNull();
  });

  it("exemples du dépôt : aucun constat « ok » dont la mesure sort de ses bornes affichées", () => {
    for (const name of [J4, HELICAL, "j4-demi-tournant-acier-garde-corps.blondel.json"]) {
      for (const r of build(example(name)).compliance.results) {
        if (r.status !== "ok" || r.measured === undefined) continue;
        const where = `${name} ${r.ruleId}`;
        if (typeof r.max === "number") expect(r.measured, where).toBeLessThanOrEqual(r.max + 1e-6);
        if (typeof r.min === "number")
          expect(r.measured, where).toBeGreaterThanOrEqual(r.min - 1e-6);
      }
    }
  });

  it("LF_POSITION_DTU_LARGE sans incidence (aucune marche balancée) : ni mesure ni bornes", () => {
    const p = example("straight.blondel.json", (d) => {
      const stair = obj(d, "stair");
      obj(stair, "layout")["width"] = 1300;
      stair["walkline"] = { mode: "fromInner", distance: 650 };
    });
    const r = results(build(p), "LF_POSITION_DTU_LARGE");
    expect(statuses(r)).toEqual(["ok"]);
    expect(r[0]!.min).toBeNull();
    expect(r[0]!.max).toBeNull();
    expect(r[0]!.measured).toBeUndefined();
  });
});
