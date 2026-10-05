import fc from "fast-check";
import {
  buildModel,
  createProject,
  openingPolygon,
  pointInPolygon,
  proposeDesigns,
  type Project,
  type Vec2,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  assistantInput,
  candidateSketch,
  chosenProject,
  contextsFor,
  displayedCandidates,
  formFromProject,
  formOpening,
  openingSideLabel,
  openingWallLabel,
  summaryFacts,
  PRIMARY_USAGE_CONTEXTS,
  usageOf,
  variantCount,
  wallsAlongOpening,
  withUsage,
  type AssistantForm,
} from "./assistant.js";
import { translatorFor } from "@blondel/i18n";

const straight = createProject("straight");

/** Formulaire du critère n° 1 : H 2 700, dalle 200, trémie 2 800 × 900, bois, logement. */
function acceptanceForm(patch: Partial<AssistantForm> = {}): AssistantForm {
  return {
    ...formFromProject(straight),
    openingX: "0",
    openingY: "0",
    sizeX: "2800",
    sizeY: "900",
    ...patch,
  };
}

describe("formulaire de l'assistant", () => {
  it("reprend le site, les contextes et la structure du projet courant", () => {
    const f = formFromProject(straight);
    expect(f.floorToFloor).toBe(String(straight.site.floorToFloor));
    expect(f.upperSlabThickness).toBe(String(straight.site.upperSlabThickness));
    expect(f.openingMode).toBe("rect");
    expect(f.usage).toBe("house");
    expect(f.wood).toBe(true);
    expect(f.guards).toBe(true);
  });

  it("usage ↔ contextes : aller-retour", () => {
    for (const usage of ["house", "collective", "erp-new", "erp-existing", "other"] as const) {
      for (const wood of [true, false]) {
        for (const outdoor of [true, false]) {
          expect(usageOf(contextsFor(usage, wood, outdoor))).toEqual({ usage, wood, outdoor });
        }
      }
    }
    expect(contextsFor("erp-new", false, false)).toEqual(["erp_neuf", "erp_securite"]);
  });

  it("choix d'usage (section Contexte de contrôle) : autres contextes conservés", () => {
    const base = ["bois_dtu", "logement_interieur", "exterieur", "garde_corps_2024"];
    expect(withUsage(base, "erp-new")).toEqual([
      "bois_dtu",
      "exterieur",
      "garde_corps_2024",
      "erp_neuf",
      "erp_securite",
    ]);
    expect(withUsage(["bois_dtu", "erp_neuf", "erp_securite"], "other")).toEqual(["bois_dtu"]);
    for (const usage of ["house", "collective", "erp-new", "erp-existing", "other"] as const) {
      expect(usageOf(withUsage(base, usage)).usage).toBe(usage);
    }
    expect([...PRIMARY_USAGE_CONTEXTS].sort()).toEqual([
      "bhc_parties_communes",
      "erp_existant",
      "erp_neuf",
      "logement_interieur",
    ]);
  });

  it("construit l'entrée du cœur (préférences, contextes, sans fonction non clonable)", () => {
    const r = assistantInput(
      acceptanceForm({ structure: "wood-housed", typologies: ["quarter"], direction: "left" }),
      straight,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.site.opening).toEqual({ kind: "rect", x: 0, y: 0, sizeX: 2800, sizeY: 900 });
    expect(r.input.compliance?.contexts).toEqual(["bois_dtu", "logement_interieur"]);
    expect(r.input.preferences).toEqual({
      typologies: ["quarter"],
      direction: "left",
      structure: { kind: "wood-housed" },
    });
    expect(r.input.shouldStop).toBeUndefined();
    expect(() => structuredClone(r.input)).not.toThrow();
  });

  it("refuse des saisies invalides avec des messages lisibles", () => {
    const r = assistantInput(
      acceptanceForm({ floorToFloor: "", sizeX: "-3", width: "abc" }),
      straight,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Mêmes `Message` rendus dans l'une ou l'autre langue (ils suivent un changement de langue).
    const fr = r.errors.map((m) => translatorFor("fr").t(m)).join("\n");
    expect(fr).toMatch(/Hauteur à monter/);
    expect(fr).toMatch(/Dimensions de la trémie/);
    expect(fr).toMatch(/Emmarchement/);
    const en = r.errors.map((m) => translatorFor("en").t(m)).join("\n");
    expect(en).toMatch(/^Total rise H: positive whole millimetres expected\.$/m);
    expect(en).not.toMatch(/[àéèù]/);
  });

  it("relevé 4 côtés + 2 diagonales : trémie polygonale ; relevé incohérent refusé", () => {
    const d = String(Math.round(Math.hypot(2800, 900)));
    const ok = formOpening(
      acceptanceForm({
        openingMode: "survey",
        survey: { ab: "2800", bc: "900", cd: "2800", da: "900", ac: d, bd: d },
      }),
      straight,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.opening?.kind).toBe("polygon");
      const poly = openingPolygon(ok.opening)!;
      expect(poly).toHaveLength(4);
    }
    const bad = formOpening(
      acceptanceForm({
        openingMode: "survey",
        survey: { ab: "2800", bc: "900", cd: "2800", da: "900", ac: d, bd: "2500" },
      }),
      straight,
    );
    expect(bad.ok).toBe(false);
    const missing = formOpening(acceptanceForm({ openingMode: "survey" }), straight);
    expect(missing.ok).toBe(false);
  });

  it("garde le régime de garde-corps choisi dans le projet, pas les contextes de forme", () => {
    const current: Project = {
      ...straight,
      compliance: {
        ...straight.compliance,
        contexts: ["bois_dtu", "logement_interieur", "garde_corps_1988", "helicoidal"],
      },
    };
    const r = assistantInput(acceptanceForm({ usage: "collective" }), current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.compliance?.contexts).toEqual([
      "bois_dtu",
      "bhc_parties_communes",
      "garde_corps_1988",
    ]);
  });

  it("relevé : un point A illisible est refusé (pas d'origine 0 implicite)", () => {
    const d = String(Math.round(Math.hypot(2800, 900)));
    const r = formOpening(
      acceptanceForm({
        openingMode: "survey",
        openingX: "abc",
        survey: { ab: "2800", bc: "900", cd: "2800", da: "900", ac: d, bd: d },
      }),
      straight,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.key).toBe("ui.lib.assistant.error.pointA");
    expect(translatorFor("fr").t(r.error)).toBe("Position du point A invalide.");
  });

  it("sans trémie, des côtés cochés auparavant n'ajoutent ni mur ni erreur d'épaisseur", () => {
    const r = assistantInput(
      acceptanceForm({ openingMode: "none", wallSides: [0, 1], wallThickness: "" }),
      { ...straight, site: { ...straight.site, walls: [] } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.site.walls).toEqual([]);
  });

  it("sans trémie ; trémie du projet", () => {
    expect(formOpening(acceptanceForm({ openingMode: "none" }), straight)).toEqual({
      ok: true,
      opening: undefined,
    });
    expect(formOpening(acceptanceForm({ openingMode: "project" }), straight)).toEqual({
      ok: true,
      opening: straight.site.opening,
    });
  });
});

describe("murs le long de la trémie", () => {
  const rect: Vec2[] = [
    { x: 0, y: 0 },
    { x: 2800, y: 0 },
    { x: 2800, y: 900 },
    { x: 0, y: 900 },
  ];

  it("nomme les côtés d'un rectangle selon le plan", () => {
    expect(openingSideLabel(rect, 0, "fr")).toMatch(/^Côté b1 \(bas du plan\), 2\s?800 mm$/);
    expect(openingSideLabel(rect, 1, "fr")).toMatch(/droite du plan/);
    expect(openingSideLabel(rect, 2, "fr")).toMatch(/haut du plan/);
    expect(openingSideLabel(rect, 3, "fr")).toMatch(/gauche du plan/);
    expect(openingWallLabel(rect, 0, "fr")).toMatch(
      /^Mur le long du côté b1 \(bas du plan\), 2\s?800 mm$/,
    );
    // Anglais : mêmes désignations, séparateur de milliers de la langue.
    expect(openingSideLabel(rect, 0, "en")).toBe("Side b1 (bottom of the plan), 2,800 mm");
    expect(openingWallLabel(rect, 1, "en")).toBe("Wall along side b2 (right of the plan), 900 mm");
    const tri: Vec2[] = [rect[0]!, rect[1]!, rect[2]!];
    expect(openingSideLabel(tri, 2, "fr")).toMatch(/^Côté b3, /);
  });

  it("propriété : nu du mur sur le côté, corps hors de la trémie, identifiants libres", () => {
    const poly = fc
      .tuple(
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: -5000, max: 5000 }),
        fc.integer({ min: 600, max: 5000 }),
        fc.integer({ min: 600, max: 5000 }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
      )
      .map(([x, y, w, h, t]) => {
        const c = Math.cos(t);
        const s = Math.sin(t);
        const rot = (p: Vec2): Vec2 => ({ x: x + p.x * c - p.y * s, y: y + p.x * s + p.y * c });
        return [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ].map(rot);
      });
    fc.assert(
      fc.property(
        poly,
        fc.subarray([0, 1, 2, 3], { minLength: 1 }),
        fc.integer({ min: 50, max: 500 }),
        (pts, sides, t) => {
          const existing = [
            { id: "wall-1", a: pts[0]!, b: pts[1]!, thickness: 100, loadBearing: false },
          ];
          const walls = wallsAlongOpening(pts, sides, t, existing);
          expect(walls).toHaveLength(sides.length);
          const ids = new Set([...existing, ...walls].map((w) => w.id));
          expect(ids.size).toBe(walls.length + 1);
          walls.forEach((w, j) => {
            const i = [...sides].sort((a, b) => a - b)[j]!;
            const a = pts[i]!;
            const b = pts[(i + 1) % 4]!;
            const L = Math.hypot(b.x - a.x, b.y - a.y);
            // Axe à t/2 du côté, à l'extérieur (le milieu de l'axe hors de la trémie).
            const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
            const dist = Math.abs((b.x - a.x) * (a.y - mid.y) - (a.x - mid.x) * (b.y - a.y)) / L;
            expect(Math.abs(dist - t / 2)).toBeLessThan(0.2);
            expect(pointInPolygon(mid, pts)).toBe("outside");
            expect(w.thickness).toBe(t);
          });
        },
      ),
    );
  });
});

describe("de la proposition au projet", () => {
  // Cas du critère n° 1 (préférence limons à la française, quart tournant).
  const form = acceptanceForm({ structure: "wood-housed", typologies: ["quarter"] });
  const r = assistantInput(form, straight);
  if (!r.ok) throw new Error(r.errors.map((m) => translatorFor("fr").t(m)).join("\n"));
  const result = proposeDesigns({
    ...r.input,
    limits: { timeBudgetMs: Number.POSITIVE_INFINITY },
  });

  it("le projet retenu garde le nom courant, reçoit les garde-corps et reste sans bloquant", () => {
    expect(result.candidates.length).toBeGreaterThan(0);
    const c = result.candidates[0]!;
    const named: Project = { ...straight, name: "Maison Martin" };
    const p = chosenProject(c, named, { guards: true });
    expect(p.name).toBe("Maison Martin");
    expect(p.guards).toBeDefined();
    expect(p.stair.structure.kind).toBe("wood-housed");
    const m = buildModel(p);
    expect(m.errors).toEqual([]);
    expect(m.compliance.summary.bloquant).toBe(0);
    expect(m.parts.some((q) => q.category === "baluster")).toBe(true);
    const bare = chosenProject(c, named, { guards: false });
    expect(bare.guards).toBeUndefined();
  });

  it("croquis : emprise, nez et trémie, boîte englobante non vide, clonable", () => {
    const c = result.candidates[0]!;
    const sketch = candidateSketch(buildModel(c.project), c.project);
    expect(sketch.footprint.length).toBeGreaterThan(3);
    expect(sketch.nosings.length).toBe(c.summary.riserCount);
    expect(sketch.opening).toHaveLength(4);
    expect(sketch.box.w).toBeGreaterThan(0);
    expect(() => structuredClone(sketch)).not.toThrow();
  });

  it("cotes de la carte", () => {
    const facts = summaryFacts(result.candidates[0]!, "fr");
    expect(facts.map((f) => f.label)).toEqual([
      "Hauteurs n",
      "Hauteur h",
      "Giron g",
      "2h + g",
      "Emmarchement E",
      "Collet mini",
      "Échappée mini",
    ]);
    const en = summaryFacts(result.candidates[0]!, "en");
    expect(en.map((f) => f.label)).toContain("Min. headroom");
    expect(en.find((f) => f.label === "Going G")!.value).toMatch(/^\d+\.\d mm$/);
  });
});

describe("variantes de l'assistant", () => {
  it("« Montrer toutes les variantes » : limits.showAllVariants seulement si coché", () => {
    const off = assistantInput(acceptanceForm(), straight);
    const on = assistantInput(acceptanceForm({ showAllVariants: true }), straight);
    expect(off.ok && on.ok).toBe(true);
    if (!off.ok || !on.ok) return;
    expect(off.input.limits).toBeUndefined();
    expect(on.input.limits).toEqual({ showAllVariants: true });
    expect(formFromProject(straight).showAllVariants).toBe(false);
  });

  it("cartes affichées : chaque candidat puis ses variantes, sans doublon", () => {
    type C = { id: string; variants: C[] };
    const leaf = (id: string): C => ({ id, variants: [] });
    const list: C[] = [
      { id: "a", variants: [leaf("a2"), leaf("a3")] },
      { id: "b", variants: [] },
      { id: "c", variants: [leaf("a2"), leaf("c2")] },
    ];
    expect(displayedCandidates(list).map((c) => c.id)).toEqual(["a", "a2", "a3", "b", "c", "c2"]);
    expect(variantCount(list)).toBe(4);
  });

  it("cœur : variantes regroupées sous la meilleure carte de chaque forme ; à plat sur demande", () => {
    const grouped = assistantInput(acceptanceForm({ structure: "none" }), straight);
    const flat = assistantInput(
      acceptanceForm({ structure: "none", showAllVariants: true }),
      straight,
    );
    if (!grouped.ok || !flat.ok) throw new Error("entrée invalide");
    const g = proposeDesigns(grouped.input);
    const f = proposeDesigns(flat.input);
    expect(g.candidates.length).toBeGreaterThan(0);
    const shapes = g.candidates.map((c) => c.shape);
    expect(new Set(shapes).size).toBe(shapes.length);
    for (const c of g.candidates) {
      for (const v of c.variants) {
        expect(v.shape).toBe(c.shape);
        expect(v.score.total).toBeGreaterThanOrEqual(c.score.total);
      }
    }
    for (const c of f.candidates) expect(c.variants).toEqual([]);
    if (variantCount(g.candidates) > 0) {
      expect(f.candidates.length).toBeGreaterThan(g.candidates.length);
    }
  });
});
