/**
 * Assistant d'initialisation (CHALLENGE G8) : cas d'acceptation n° 1 de bout en bout, trémie
 * trop petite, préférences, annulation et budget de temps.
 */
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geom2d/polygon.js";
import { openingPolygon } from "../headroom/headroom.js";
import { ProjectSchema } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { serializeProject } from "../project/serialize.js";
import { applyStructureChoice } from "../project/structureChoice.js";
import { inscribedCircle, proposeDesigns } from "./propose.js";
import type { AssistantInput, AssistantResult } from "./types.js";

/** Cas d'acceptation n° 1 (prompt 2 §6, CHALLENGE P1) : H 2 700, trémie 2 800 × 900, dalle 200. */
const ACCEPTANCE_SITE = {
  floorToFloor: 2700,
  upperSlabThickness: 200,
  opening: { kind: "rect", x: 0, y: 0, sizeX: 2800, sizeY: 900 },
} as const;

/** Budget du cas d'acceptation (G8) ; ×3 hors `PERF_STRICT=1` comme `pipeline/perf.test.ts`. */
const BUDGET_MS = 2000;
const FACTOR = process.env["PERF_STRICT"] === "1" ? 1 : 3;

let acceptance: AssistantResult | null = null;
function acceptanceResult(): AssistantResult {
  acceptance ??= proposeUntimed({ site: ACCEPTANCE_SITE });
  return acceptance;
}

/**
 * Appel sans budget de temps (constructions toujours bornées par `maxBuilds`) : les tests
 * fonctionnels ne doivent pas dépendre de la charge de la machine (le budget de temps rend le
 * résultat partiel, signalé par `stats.truncated`). Les tests de budget appellent
 * `proposeDesigns` directement.
 */
function proposeUntimed(input: AssistantInput): AssistantResult {
  return proposeDesigns({
    ...input,
    limits: { timeBudgetMs: Number.POSITIVE_INFINITY, ...input.limits },
  });
}

function expectNoBlocking(result: AssistantResult): void {
  for (const c of result.candidates.flatMap((h) => [h, ...h.variants])) {
    const model = buildModel(c.project, { memo: false });
    expect(model.errors, c.label).toEqual([]);
    expect(model.compliance.summary.bloquant, c.label).toBe(0);
  }
}

describe("cas d'acceptation n° 1 (H 2 700, trémie 2 800 × 900, dalle 200)", () => {
  it("un quart tournant sans bloquant est proposé en tête", () => {
    const r = acceptanceResult();
    expect(r.candidates.length).toBeGreaterThan(0);
    const head = r.candidates[0]!;
    expect(["quarter", "quarter-landing"]).toContain(head.typology);
    // Au moins un quart tournant balancé figure dans la liste.
    expect(r.candidates.some((c) => c.typology === "quarter")).toBe(true);
    expectNoBlocking(r);
    // Classement par score croissant.
    const totals = r.candidates.map((c) => c.score.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it("escalier droit : rejeté pour l'échappée dès que g > 240 ; à g = 240, marge nulle et classé après", () => {
    // Justification : avec une dalle de 200 mm, TREMIE_LONGUEUR donne (1 900 + 200)·g/h = 2 800 mm
    // pour g = 240 et h = 180 : la volée droite passe **exactement** à l'échappée minimale, au
    // giron minimal G_MIN_LOGEMENT (module 600). Tout giron plus grand est rejeté.
    const r = acceptanceResult();
    const straightHeadroom = r.rejections.find(
      (t) => t.typology === "straight" && t.reason === "headroom",
    );
    expect(straightHeadroom?.count).toBeGreaterThan(0);
    const straight = r.candidates.filter((c) => c.typology === "straight");
    for (const c of straight) {
      expect(c.summary.going).toBeCloseTo(240, 6);
      expect(c.summary.headroomMargin!).toBeGreaterThanOrEqual(-1e-6);
      expect(c.summary.headroomMargin!).toBeLessThan(1);
      expect(c.score.total).toBeGreaterThan(r.candidates[0]!.score.total);
    }
  });

  it("avec une dalle de 250 mm, l'escalier droit est rejeté pour l'échappée (CHALLENGE-panel G8)", () => {
    const r = proposeUntimed({ site: { ...ACCEPTANCE_SITE, upperSlabThickness: 250 } });
    expect(r.candidates.some((c) => c.typology === "straight")).toBe(false);
    expect(
      r.diagnostics.some((d) => /^Escalier droit : rejeté — échappée insuffisante/.test(d)),
    ).toBe(true);
    expect(r.candidates[0]?.typology).toMatch(/^quarter/);
  });

  it("limons à la française : emprise hors tout E + 2 × 45 mm dans les 900 mm, poteau d'angle", () => {
    const r = proposeUntimed({
      site: ACCEPTANCE_SITE,
      preferences: { structure: { kind: "wood-housed" }, typologies: ["quarter"] },
    });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.project.stair.structure.kind).toBe("wood-housed");
      expect(c.summary.grossWidth).toBe(c.summary.width + 90);
      expect(c.summary.grossWidth).toBeLessThanOrEqual(900);
      for (const t of c.project.stair.layout.turns) expect(t.inner.kind).toBe("newel");
    }
    expectNoBlocking(r);
  });

  it("limons en profilés : poteau élargi des profilés (décision A13) sur chaque proposition", () => {
    const r = proposeUntimed({
      site: ACCEPTANCE_SITE,
      preferences: { structure: { kind: "steel-profile" }, typologies: ["quarter"] },
    });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.project.stair.structure.kind).toBe("steel-profile");
      for (const t of c.project.stair.layout.turns) {
        expect(t.inner.kind).toBe("newel");
        if (t.inner.kind === "newel") expect(t.inner.offset ?? 0).toBeGreaterThan(0);
      }
      // Même poteau que le choix de structure dans l'interface (idempotent).
      expect(
        applyStructureChoice(c.project, "steel-profile", c.project.stair.structure.params).notes,
      ).toEqual([]);
    }
  });

  it("budget : ≤ 2 s (appelable dans le Web Worker)", () => {
    const t0 = performance.now();
    const r = proposeDesigns({ site: ACCEPTANCE_SITE });
    const elapsed = performance.now() - t0;
    console.info(
      `assistant, cas d'acceptation n° 1 : ${elapsed.toFixed(0)} ms, ${r.stats.enumerated} variantes, ${r.stats.built} modèles`,
    );
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS * FACTOR);
    // Machine chargée (suite complète en parallèle) : le budget de temps peut tronquer
    // l'énumération, ce qui est signalé ; exigé seulement en mesure stricte.
    if (FACTOR === 1) expect(r.stats.truncated).toBe(false);
  });

  it("déterministe, projets canoniques et relisibles", () => {
    const a = acceptanceResult();
    const b = proposeUntimed({ site: ACCEPTANCE_SITE });
    expect(b.candidates.map((c) => c.id)).toEqual(a.candidates.map((c) => c.id));
    for (const c of a.candidates) {
      expect(ProjectSchema.parse(c.project)).toEqual(c.project);
      expect(parseProjectText(serializeProject(c.project))).toEqual(c.project);
    }
    // Pas deux fois la même variante (même tracé, même placement, même n).
    const keys = a.candidates.map((c) =>
      JSON.stringify([c.project.stair.layout, c.project.stair.placement, c.summary.riserCount]),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("score détaillé et affichable", () => {
    const c = acceptanceResult().candidates[0]!;
    expect(c.score.terms.map((t) => t.id)).toEqual([
      "blondel",
      "collet",
      "headroom",
      "headroomMargin",
      "winders",
      "regularity",
      "warnings",
    ]);
    const sum = c.score.terms.reduce((acc, t) => acc + t.penalty, 0);
    expect(c.score.total).toBeCloseTo(sum, 9);
    expect(c.summary.blondel).toBeCloseTo(2 * c.summary.rise + c.summary.going, 6);
  });
});

describe("trémie trop petite", () => {
  it("aucune proposition et diagnostic lisible", () => {
    const r = proposeUntimed({
      site: {
        floorToFloor: 2700,
        upperSlabThickness: 200,
        opening: { kind: "rect", x: 0, y: 0, sizeX: 1200, sizeY: 700 },
      },
    });
    expect(r.candidates).toEqual([]);
    expect(r.diagnostics[0]).toMatch(/^Aucune proposition sans bloquant pour ce site\./);
    expect(r.diagnostics[0]).toMatch(/trémie est trop petite/);
    expect(r.diagnostics[0]).toMatch(/TREMIE_LONGUEUR/);
    expect(r.diagnostics.some((d) => /^Hélicoïdal à gauche : rejeté/.test(d))).toBe(true);
  });

  it("trop étroite pour l'emmarchement : diagnostic de largeur", () => {
    const r = proposeUntimed({
      site: {
        floorToFloor: 2700,
        upperSlabThickness: 200,
        opening: { kind: "rect", x: 0, y: 0, sizeX: 700, sizeY: 600 },
      },
    });
    expect(r.candidates).toEqual([]);
    expect(r.diagnostics[0]).toMatch(/largeur hors tout/);
    expect(r.diagnostics[0]).toMatch(/LARGEUR_MIN_LOGEMENT/);
  });
});

describe("préférences, annulation, données invalides", () => {
  it("sens et emmarchement imposés", () => {
    const r = proposeUntimed({
      site: ACCEPTANCE_SITE,
      preferences: { direction: "right", width: 850 },
    });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.direction === null || c.direction === "right").toBe(true);
      expect(c.project.stair.layout.width).toBe(850);
    }
  });

  it("typologies restreintes", () => {
    const r = proposeUntimed({
      site: ACCEPTANCE_SITE,
      preferences: { typologies: ["quarter-landing"] },
    });
    expect(r.candidates.every((c) => c.typology === "quarter-landing")).toBe(true);
  });

  it("annulation immédiate : résultat vide, signalé", () => {
    const r = proposeUntimed({ site: ACCEPTANCE_SITE, shouldStop: () => true });
    expect(r.stats.stopped).toBe(true);
    expect(r.candidates).toEqual([]);
    expect(r.diagnostics).toContain("Recherche interrompue : résultat partiel.");
  });

  it("annulation en cours de construction : résultat partiel sans bloquant", () => {
    let calls = 0;
    const input: AssistantInput = {
      site: ACCEPTANCE_SITE,
      shouldStop: () => ++calls > 400,
    };
    const r = proposeUntimed(input);
    expect(r.stats.stopped).toBe(true);
    expectNoBlocking(r);
  });

  it("budget de constructions : résultat tronqué signalé", () => {
    const r = proposeUntimed({ site: ACCEPTANCE_SITE, limits: { maxBuilds: 3 } });
    expect(r.stats.built).toBeLessThanOrEqual(3);
    expect(r.stats.truncated).toBe(true);
    expect(r.rejections.some((t) => t.reason === "budget")).toBe(true);
  });

  it("données invalides et structure inconnue : diagnostic, aucune exception", () => {
    const bad = proposeUntimed({ site: { floorToFloor: -1, upperSlabThickness: 200 } });
    expect(bad.candidates).toEqual([]);
    expect(bad.diagnostics[0]).toMatch(/données du site invalides/);
    const unknown = proposeUntimed({
      site: ACCEPTANCE_SITE,
      preferences: { structure: { kind: "inconnue" } },
    });
    expect(unknown.candidates).toEqual([]);
    expect(unknown.diagnostics[0]).toMatch(/Structure « inconnue » inconnue/);
  });

  it("sans trémie : escaliers placés à l'origine, sans contrainte d'échappée", () => {
    const r = proposeUntimed({
      site: { floorToFloor: 2700, upperSlabThickness: 200 },
      preferences: { typologies: ["straight", "quarter"] },
    });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) expect(c.project.stair.placement.origin).toEqual({ x: 0, y: 0 });
  });

  it("grande trémie carrée : hélicoïdal proposé, contenu dans la trémie", () => {
    const opening = { kind: "rect", x: 0, y: 0, sizeX: 2400, sizeY: 2400 } as const;
    const r = proposeUntimed({
      site: { floorToFloor: 2700, upperSlabThickness: 200, opening },
      preferences: { typologies: ["helical"] },
    });
    expect(r.candidates.length).toBeGreaterThan(0);
    const poly = openingPolygon(opening)!;
    for (const c of r.candidates) {
      expect(c.typology).toBe("helical");
      const model = buildModel(c.project, { memo: false });
      expect(model.compliance.summary.bloquant).toBe(0);
      for (const p of model.layout.footprint) {
        expect(pointInPolygon(p, poly, 0.5)).not.toBe("outside");
      }
    }
  });
});

describe("relecture adverse : régressions", () => {
  it("réglages invalides : diagnostic, aucune exception ni boucle infinie", () => {
    const cases: [AssistantInput, RegExp][] = [
      [{ site: ACCEPTANCE_SITE, limits: { goingStep: 0 } }, /limits\.goingStep/],
      [{ site: ACCEPTANCE_SITE, limits: { maxCandidates: -1 } }, /limits\.maxCandidates/],
      [{ site: ACCEPTANCE_SITE, limits: { perGroupLimit: 0 } }, /limits\.perGroupLimit/],
      [{ site: ACCEPTANCE_SITE, preferences: { width: 850.5 } }, /preferences\.width/],
      [{ site: ACCEPTANCE_SITE, preferences: { width: Number.NaN } }, /preferences\.width/],
      [{ site: ACCEPTANCE_SITE, weights: { blondel: Number.NaN } }, /weights\.blondel/],
      [{ site: ACCEPTANCE_SITE, weights: { winders: -1 } }, /weights\.winders/],
    ];
    for (const [input, re] of cases) {
      const r = proposeUntimed(input);
      expect(r.candidates).toEqual([]);
      expect(r.diagnostics[0]).toMatch(/^Aucune proposition : /);
      expect(r.diagnostics[0]).toMatch(re);
    }
  });

  it("on ne débouche pas dans un mur : arrivée dégagée sur la profondeur E", () => {
    // Mur au nu du côté x = 0 de la trémie : au-delà de ce côté, pas de plancher.
    const wall = {
      id: "W",
      a: { x: -100, y: -3000 },
      b: { x: -100, y: 4000 },
      thickness: 200,
      loadBearing: true,
    };
    const site = { ...ACCEPTANCE_SITE, walls: [wall] };
    const arrivesOnWallSide = (r: AssistantResult): boolean =>
      r.candidates.some((c) => {
        const model = buildModel(c.project, { memo: false });
        const last = model.stepping.nosings[model.stepping.nosings.length - 1]!;
        return Math.abs(last.q.x) < 1e-3 && Math.abs(last.r.x) < 1e-3;
      });
    const wallRejections = (r: AssistantResult): number =>
      r.rejections.filter((t) => t.reason === "walls").reduce((acc, t) => acc + t.count, 0);
    // Sans dégagement (comportement d'avant la relecture) : arrivée contre le mur.
    const before = proposeUntimed({ site, limits: { arrivalClearance: 0 } });
    expect(arrivesOnWallSide(before)).toBe(true);
    const r = proposeUntimed({ site });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(arrivesOnWallSide(r)).toBe(false);
    expect(wallRejections(r)).toBeGreaterThan(wallRejections(before));
  });

  it("site coûteux (H 6 000) : budget tenu dans l'énumération, pas de faux « trémie trop petite »", () => {
    const t0 = performance.now();
    const r = proposeDesigns({
      site: {
        floorToFloor: 6000,
        upperSlabThickness: 200,
        opening: { kind: "rect", x: 0, y: 0, sizeX: 3000, sizeY: 3000 },
      },
    });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS * FACTOR);
    expect(r.stats.truncated).toBe(true);
    expect(r.diagnostics.some((d) => /Budget de temps de l'énumération atteint/.test(d))).toBe(
      true,
    );
    expect(r.diagnostics.some((d) => /trémie est trop petite/.test(d))).toBe(false);
  });

  it("grande trémie entre trois murs (bois_dtu) : l'énumération n'épuise pas le budget des modèles", () => {
    // Avant la relecture : 1,8 s d'énumération, 0 modèle construit, et le diagnostic concluait
    // à tort à une trémie trop petite pour l'échappée (4 000 × 3 000 mm !).
    const w = (id: string, ax: number, ay: number, bx: number, by: number) => ({
      id,
      a: { x: ax, y: ay },
      b: { x: bx, y: by },
      thickness: 200,
      loadBearing: true,
    });
    const r = proposeDesigns({
      site: {
        floorToFloor: 3000,
        upperSlabThickness: 200,
        opening: { kind: "rect", x: 0, y: 0, sizeX: 4000, sizeY: 3000 },
        walls: [
          w("a", -100, -3000, -100, 6000),
          w("b", -3000, 3100, 6000, 3100),
          w("c", 4100, -3000, 4100, 6000),
        ],
      },
      compliance: { contexts: ["bois_dtu"] },
    });
    // Même sous charge, l'énumération (≤ 80 % du budget) laisse le temps de construire.
    expect(r.stats.built).toBeGreaterThan(0);
    expect(r.diagnostics.some((d) => /trémie est trop petite/.test(d))).toBe(false);
    expectNoBlocking(r);
  });

  it("structure incompatible (débillardé sur jour vif) : le diagnostic ne met pas en cause la trémie", () => {
    const r = proposeUntimed({
      site: ACCEPTANCE_SITE,
      preferences: { structure: { kind: "steel-curved" } },
    });
    expect(r.candidates).toEqual([]);
    expect(r.diagnostics[0]).not.toMatch(/trémie est trop petite/);
    expect(r.diagnostics[0]).toMatch(/structure visée ou par le contrôle de conception/);
    // Motif principal par typologie : l'erreur de génération, pas l'échappée des calages écartés.
    expect(
      r.diagnostics.some((d) => /^Quart tournant à gauche : rejeté — erreur de génération/.test(d)),
    ).toBe(true);
  });

  it("trémie assez longue mais bords courts murés : pas de « trémie trop petite pour l'échappée »", () => {
    const wall = (id: string, x: number) => ({
      id,
      a: { x, y: -3000 },
      b: { x, y: 4000 },
      thickness: 200,
      loadBearing: true,
    });
    const r = proposeUntimed({
      site: {
        floorToFloor: 2700,
        upperSlabThickness: 200,
        opening: { kind: "rect", x: 0, y: 0, sizeX: 3000, sizeY: 850 },
        walls: [wall("O", -100), wall("E", 3100)],
      },
    });
    expect(r.candidates).toEqual([]);
    // TREMIE_LONGUEUR demande 2 800 mm, le côté en fait 3 000 : la taille n'est pas en cause.
    expect(r.diagnostics[0]).not.toMatch(/trop petite/);
    expect(r.diagnostics[0]).toMatch(/échappée et les murs/);
  });

  it("emmarchement imposé trop large : le diagnostic cite l'emmarchement demandé", () => {
    const r = proposeUntimed({ site: ACCEPTANCE_SITE, preferences: { width: 3000 } });
    expect(r.candidates).toEqual([]);
    expect(r.diagnostics[0]).toMatch(/E ≥ 3000 mm, emmarchement demandé/);
  });

  it("trémie en L : l'axe de l'hélicoïdal n'est pas posé hors de la trémie", () => {
    const L = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 600 },
      { x: 600, y: 600 },
      { x: 600, y: 3000 },
      { x: 0, y: 3000 },
    ];
    // Moyenne des sommets (1 200, 1 200) : dans l'angle rentrant, hors de la trémie.
    expect(inscribedCircle(L).radius).toBe(0);
    const square = openingPolygon({ kind: "rect", x: 0, y: 0, sizeX: 2000, sizeY: 1000 })!;
    expect(inscribedCircle(square)).toEqual({ center: { x: 1000, y: 500 }, radius: 500 });
  });
});

describe("diversité des propositions (constat en ligne : H 2 700, trémie 1 100 × 3 150)", () => {
  const SITE = {
    floorToFloor: 2700,
    upperSlabThickness: 200,
    opening: { kind: "rect", x: 0, y: 0, sizeX: 1100, sizeY: 3150 },
  } as const;
  let cached: AssistantResult | null = null;
  const result = (): AssistantResult => (cached ??= proposeUntimed({ site: SITE }));

  it("une seule proposition par typologie × position du tournant, les autres en variantes", () => {
    const r = result();
    // Avant : les six premières étaient toutes « quart tournant avec palier, tournant bas ».
    const shapes = r.candidates.map((c) => c.shape);
    expect(new Set(shapes).size).toBe(shapes.length);
    expect(new Set(r.candidates.slice(0, 6).map((c) => c.typology)).size).toBeGreaterThan(2);
    const totals = r.candidates.map((c) => c.score.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    const head = r.candidates[0]!;
    expect(head.shape).toBe("quarter-landing|bas");
    // Variantes de sens et de E sous le meilleur, triées, même forme.
    expect(head.variants.length).toBeGreaterThan(0);
    expect(head.variants.some((v) => v.direction !== head.direction)).toBe(true);
    let prev = head.score.total;
    for (const v of head.variants) {
      expect(v.shape).toBe(head.shape);
      expect(v.score.total).toBeGreaterThanOrEqual(prev);
      prev = v.score.total;
    }
    // Aucune variante en double avec la liste principale.
    const ids = r.candidates.flatMap((c) => [c.id, ...c.variants.map((v) => v.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("« montrer toutes les variantes » : liste à plat, mêmes candidats, triés", () => {
    const grouped = result();
    const flat = proposeUntimed({ site: SITE, limits: { showAllVariants: true } });
    const all = grouped.candidates.flatMap((c) => [c, ...c.variants]).map((c) => c.id);
    expect(flat.candidates.map((c) => c.id).sort()).toEqual([...all].sort());
    expect(flat.candidates.every((c) => c.variants.length === 0)).toBe(true);
    const totals = flat.candidates.map((c) => c.score.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it("perShapeLimit = 2 : au plus deux par forme en tête", () => {
    const r = proposeUntimed({ site: SITE, limits: { perShapeLimit: 2 } });
    const count = new Map<string, number>();
    for (const c of r.candidates) count.set(c.shape, (count.get(c.shape) ?? 0) + 1);
    expect(Math.max(...count.values())).toBe(2);
  });

  it("marge d'échappée nulle : pénalisée au score, pas rejetée", () => {
    const r = result();
    const straight = r.candidates.find((c) => c.typology === "straight")!;
    expect(straight.summary.headroomMargin!).toBeLessThan(1);
    const t = straight.score.terms.find((x) => x.id === "headroomMargin")!;
    expect(t.value).toBeCloseTo(50 - straight.summary.headroomMargin!, 6);
    expect(t.penalty).toBeCloseTo(t.value * 0.2, 9);
    // Réglage : marge visée nulle → terme nul ; poids nul → terme nul.
    const zero = proposeUntimed({ site: SITE, limits: { headroomMarginTarget: 0 } });
    const s0 = zero.candidates.find((c) => c.typology === "straight")!;
    expect(s0.score.terms.find((x) => x.id === "headroomMargin")!.penalty).toBe(0);
    expect(s0.score.total).toBeLessThan(straight.score.total);
  });

  it("réglage présent mais undefined : valeur par défaut (relecture adverse)", () => {
    // Avant : `{ perShapeLimit: undefined }` écrasait le défaut → liste vide et diagnostic
    // trompeur ; `headroomMarginTarget` ou un poids `undefined` → scores NaN.
    const ref = result().candidates.map((c) => [c.id, c.score.total]);
    for (const extra of [
      { limits: { perShapeLimit: undefined, maxCandidates: undefined } },
      { limits: { headroomMarginTarget: undefined, showAllVariants: undefined } },
      { weights: { headroomMargin: undefined } },
    ]) {
      const r = proposeUntimed({ site: SITE, ...extra });
      expect(r.candidates.map((c) => [c.id, c.score.total])).toEqual(ref);
    }
  });

  it("réglages de sélection invalides : diagnostic, pas d'exception", () => {
    for (const limits of [
      { perShapeLimit: 0 },
      { perShapeLimit: 1.5 },
      { headroomMarginTarget: -1 },
      { showAllVariants: "oui" as unknown as boolean },
    ]) {
      const r = proposeDesigns({ site: SITE, limits });
      expect(r.candidates).toEqual([]);
      expect(r.diagnostics[0]).toMatch(/^Aucune proposition : limits\./);
    }
  });

  it("maxCandidates = 0 : liste vide par réglage, pas « aucune proposition sans bloquant » (QUESTIONS D1)", () => {
    const r = proposeUntimed({ site: SITE, limits: { maxCandidates: 0 } });
    expect(r.candidates).toEqual([]);
    expect(r.diagnostics[0]).toMatch(/^Liste vide : \d+ proposition\(s\) sans bloquant/);
    expect(r.diagnostics[0]).toContain("réglé à 0");
    expect(r.diagnostics.some((d) => d.startsWith("Aucune proposition sans bloquant"))).toBe(false);
  });
});
