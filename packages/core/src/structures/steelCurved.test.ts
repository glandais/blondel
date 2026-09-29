import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { lineSeg, arcSeg } from "../geom2d/segment.js";
import { makeCurve } from "../geom2d/curve.js";
import type { Model } from "../model/derived.js";
import type { InnerCorner, Project } from "../model/project.js";
import { ProjectSchema } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { resolveM3Variant } from "../stepping/stepping.js";
import { makeSteppingProject } from "../stepping/test-helpers.js";
import { WorkshopProfileSchema } from "../workshop/profile.js";
import { fmt } from "../rules/check.js";
import { isSimplePolygon } from "./geom.js";
import { QUANTITY_BUTT_WELD_MM, QUANTITY_WELD_MM } from "./steelCommon.js";
import {
  QUANTITY_ROLLED_LENGTH_MM,
  SteelCurvedParamsSchema,
  buildSteelCurved,
  type SteelCurvedResult,
} from "./steelCurved.js";
import { arcFiberLength, fiberDevelopment } from "./steelCurvedGeometry.js";
import "./index.js";

const fmtMm = (x: number): string => fmt(x, 0);

/** Quart tournant balancé à jour en arc (épure du critère n° 2), limon débillardé. */
function quarterArc(
  over: {
    radius?: number;
    legs?: readonly [number, number];
    direction?: "left" | "right";
    params?: Record<string, unknown>;
    workshop?: unknown;
    inner?: InnerCorner;
    windersPerSide?: number | "auto";
    variant?: "auto" | "cubic" | "quintic";
  } = {},
): Project {
  const legs = over.legs ?? [1800, 2830];
  const p = makeSteppingProject({
    width: 900,
    legs: [...legs],
    direction: over.direction ?? "left",
    inner: over.inner ?? { kind: "arc", radius: over.radius ?? 250 },
    floorToFloor: 2700,
    balancing: {
      windersPerSide: over.windersPerSide ?? "auto",
      variant: over.variant ?? "auto",
    },
    treads: { nosing: 10 },
    structure: { kind: "steel-curved", params: over.params ?? {} },
  });
  return over.workshop !== undefined
    ? { ...p, workshop: WorkshopProfileSchema.parse(over.workshop) }
    : p;
}

function run(project: Project): { m: Model; r: SteelCurvedResult } {
  const m = buildModel(project, { memo: false });
  const params = SteelCurvedParamsSchema.parse(project.stair.structure.params);
  const r = buildSteelCurved({ project, layout: m.layout, stepping: m.stepping }, params);
  return { m, r };
}

describe("développement des fibres (forme fermée par morceaux)", () => {
  it("arc : face côté marches r·θ, fibre neutre (r − e/2)·θ, face côté jour (r − e)·θ", () => {
    // Droite 300, quart d'arc de rayon 250 (jour à gauche : centre côté jour), droite 400.
    const r = 250;
    const curve = makeCurve([
      lineSeg({ x: 0, y: 0 }, { x: 0, y: 300 }),
      arcSeg({ x: -r, y: 300 }, r, 0, Math.PI / 2),
      lineSeg({ x: -r, y: 300 + r }, { x: -r - 400, y: 300 + r }),
    ]);
    const e = 8;
    const theta = Math.PI / 2;
    const steps = fiberDevelopment(curve, 0, "left");
    const neutral = fiberDevelopment(curve, e / 2, "left");
    const jour = fiberDevelopment(curve, e, "left");
    expect(steps.fiberLength).toBeCloseTo(700 + r * theta, 9);
    expect(neutral.fiberLength).toBeCloseTo(700 + (r - e / 2) * theta, 9);
    expect(jour.fiberLength).toBeCloseTo(700 + (r - e) * theta, 9);
    // Avec R = rayon de l'axe (fibre neutre) : fibre intérieure (R − e/2)·θ.
    const R = r - e / 2;
    const arcPiece = jour.pieces.find((p) => p.kind === "arc")!;
    expect(arcPiece.fiber1 - arcPiece.fiber0).toBeCloseTo(arcFiberLength(R, theta, e / 2), 9);
    expect(arcPiece.concave).toBe(true);
    // Jour à droite pour un arc qui tourne à gauche : centre côté marches, fibre plus longue.
    expect(fiberDevelopment(curve, e, "right").fiberLength).toBeCloseTo(700 + (r + e) * theta, 9);
    // Prolongement de pente 1 hors de C_i.
    expect(neutral.toFiber(-50)).toBe(-50);
    expect(neutral.toFiber(steps.faceLength + 30)).toBeCloseTo(neutral.fiberLength + 30, 9);
  });

  it("propriété : longueurs par morceaux, bijection σ ↔ σ_fibre croissante", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 160, max: 1500 }),
        fc.double({ min: 0.2, max: Math.PI, noNaN: true }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 4, max: 20 }),
        fc.constantFrom("left" as const, "right" as const),
        (l1, r, theta, l2, e, jour) => {
          const sweep = jour === "left" ? theta : -theta;
          // Arc tangent à la première droite (montée +y) et tournant vers le jour.
          const center = { x: jour === "left" ? -r : r, y: l1 };
          const start = jour === "left" ? 0 : Math.PI;
          const arc = arcSeg(center, r, start, sweep);
          const end = {
            x: center.x + r * Math.cos(start + sweep),
            y: center.y + r * Math.sin(start + sweep),
          };
          const tangent = {
            x: -Math.sin(start + sweep) * Math.sign(sweep),
            y: Math.cos(start + sweep) * Math.sign(sweep),
          };
          const segs = [
            ...(l1 > 0 ? [lineSeg({ x: 0, y: 0 }, { x: 0, y: l1 })] : []),
            arc,
            ...(l2 > 0
              ? [lineSeg(end, { x: end.x + tangent.x * l2, y: end.y + tangent.y * l2 })]
              : []),
          ];
          const curve = makeCurve(segs);
          const d = fiberDevelopment(curve, e / 2, jour);
          expect(d.fiberLength).toBeCloseTo(l1 + l2 + (r - e / 2) * theta, 6);
          let prev = -Infinity;
          for (let s = -10; s <= d.faceLength + 10; s += d.faceLength / 37) {
            const x = d.toFiber(s);
            expect(x).toBeGreaterThan(prev);
            prev = x;
            expect(d.toFace(x)).toBeCloseTo(s, 6);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("plugin steel-curved : limon débillardé soudé (jalon 5b)", () => {
  const { m, r } = run(quarterArc());
  const curved = r.curved!;

  it("variante M3 quintique par défaut pour le débillardé (décision Q7)", () => {
    expect(resolveM3Variant(quarterArc())).toBe("quintic");
    expect(m.stepping.balancedZones.every((z) => z.method === "M3-quintic")).toBe(true);
    const flat = quarterArc();
    const asFlat: Project = {
      ...flat,
      stair: { ...flat.stair, structure: { kind: "steel-flat", params: {} } },
    };
    expect(resolveM3Variant(asFlat)).toBe("cubic");
    expect(resolveM3Variant(quarterArc({ variant: "cubic" }))).toBe("cubic");
  });

  it("limon de jour continu : tronçons contigus du départ à l'arrivée, sans erreur", () => {
    expect(m.errors).toEqual([]);
    expect(curved).not.toBeNull();
    const segs = curved.segments;
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i + 1 < segs.length; i++) {
      expect(segs[i + 1]!.sigma0).toBeCloseTo(segs[i]!.sigma1, 9);
    }
    expect(segs[0]!.sigma0).toBeCloseTo(curved.development.uLo, 9);
    expect(segs[segs.length - 1]!.sigma1).toBeCloseTo(curved.development.uHi, 9);
    const ids = m.parts.filter((p) => p.id.startsWith("stringer-inner-curved-")).map((p) => p.id);
    expect(ids).toHaveLength(segs.length);
    // Limons muraux en plat droit (steel-flat), un par volée.
    expect(m.parts.filter((p) => p.id.startsWith("stringer-outer-"))).toHaveLength(2);
    for (const s of segs) expect(isSimplePolygon(s.part.flat!.outline.outer)).toBe(true);
  });

  it("rives z = F(σ) + d_h / − d_b, F passant par les nez (courbe M3 reconstituée)", () => {
    for (const z of curved.profile.zones) {
      expect(z.kind).toBe("m3");
      expect(z.variant).toBe("quintic");
      expect(z.residual).toBeLessThan(0.05);
    }
    for (const k of m.stepping.nosings) {
      expect(curved.profile.at(k.sigmaInner)).toBeCloseTo(k.z, 1);
    }
    const dev = curved.development;
    const dh = 50;
    for (const s of [100, 700, 900, 1500, 2500]) {
      const up = dev.upperRive.find((p) => Math.abs(p.x - s) < 3);
      if (up && up.y < m.stepping.nosings.at(-1)!.z + dh - 1) {
        expect(up.y).toBeCloseTo(curved.profile.at(up.x) + dh, 6);
      }
      const lo = dev.lowerRive.find((p) => Math.abs(p.x - s) < 3);
      if (lo) expect(lo.y).toBeCloseTo(curved.profile.at(lo.x) - curved.lowerOffset, 6);
    }
  });

  it("développé d'un tronçon d'arc : longueur roulée = (r_j − e/2)·θ en fibre neutre", () => {
    const e = curved.thickness;
    const rj = 250;
    let rolled = 0;
    for (const s of curved.segments) {
      for (const a of s.arcs) {
        const theta = (a.sigma1 - a.sigma0) / rj;
        expect(a.neutral1 - a.neutral0).toBeCloseTo((rj - e / 2) * theta, 6);
        expect(a.innerRadius).toBe(rj - e);
        expect(a.neutralRadius).toBe(rj - e / 2);
        rolled += a.neutral1 - a.neutral0;
      }
      const q = s.part.quantities[QUANTITY_ROLLED_LENGTH_MM]!;
      expect(q).toBeCloseTo(
        s.arcs.reduce((acc, a) => acc + a.neutral1 - a.neutral0, 0),
        6,
      );
    }
    // Arc complet : (r_j − e/2)·π/2 ; en fibre intérieure (côté jour) : (r_j − e)·π/2.
    expect(rolled).toBeCloseTo((rj - e / 2) * (Math.PI / 2), 6);
    const jourArc = curved.jourFace.pieces.find((p) => p.kind === "arc")!;
    expect(jourArc.fiber1 - jourArc.fiber0).toBeCloseTo((rj - e) * (Math.PI / 2), 9);
    // Développé : fibre neutre déclarée, largeur = étendue en x du contour.
    for (const s of curved.segments) {
      const f = s.part.flat!;
      expect(f.reference?.kind).toBe("neutral-fiber");
      const xs = f.outline.outer.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(s.neutral1 - s.neutral0, 6);
      expect(Math.min(...xs)).toBeCloseTo(0, 9);
    }
  });

  it("lignes de roulage (génératrices, rayon), traits de joint, reports des nez, repère", () => {
    const withArc = curved.segments.find((s) => s.arcs.length > 0)!;
    const lines = withArc.part.flat!.lines;
    const rolls = lines.filter((l) => l.kind === "roll");
    expect(rolls.length).toBeGreaterThan(2);
    for (const l of rolls) expect(l.a.x).toBeCloseTo(l.b.x, 9); // génératrices ⟂ σ
    expect(rolls[0]!.label).toMatch(/R int 242 mm/);
    expect(lines.some((l) => l.kind === "joint" && /bout à bout/.test(l.label ?? ""))).toBe(true);
    expect(lines.some((l) => l.kind === "mark" && /^N\d+$/.test(l.label ?? ""))).toBe(true);
    expect(lines.some((l) => l.kind === "text" && l.label === withArc.part.mark)).toBe(true);
    expect(withArc.part.solid.kind).toBe("ruled");
  });

  it("continuité des rives entre tronçons (développé et solide)", () => {
    const segs = curved.segments;
    for (let i = 0; i + 1 < segs.length; i++) {
      const a = segs[i]!;
      const b = segs[i + 1]!;
      const x = a.neutral1;
      const zs = (poly: readonly { x: number; y: number }[]) =>
        poly
          .filter((p) => Math.abs(p.x - x) < 1e-6)
          .map((p) => p.y)
          .sort((u, v) => u - v);
      const za = zs(a.outline);
      const zb = zs(b.outline);
      expect(za).toHaveLength(2);
      expect(zb).toHaveLength(2);
      expect(zb[0]!).toBeCloseTo(za[0]!, 6);
      expect(zb[1]!).toBeCloseTo(za[1]!, 6);
      const sa = a.part.solid;
      const sb = b.part.solid;
      if (sa.kind !== "ruled" || sb.kind !== "ruled") throw new Error("solide réglé attendu");
      const lastA = sa.b[sa.b.length - 1]!;
      const firstB = sb.b[0]!;
      expect(firstB.x).toBeCloseTo(lastA.x, 6);
      expect(firstB.y).toBeCloseTo(lastA.y, 6);
      expect(firstB.z).toBeCloseTo(lastA.z, 6);
      expect(sb.a[0]!.z).toBeCloseTo(sa.a[sa.a.length - 1]!.z, 6);
      // Cordon bout à bout = hauteur de la coupe au joint.
      expect(a.part.quantities[QUANTITY_BUTT_WELD_MM]).toBeCloseTo(za[1]! - za[0]!, 6);
    }
  });

  it("joints aux naissances décalés hors des supports ; soudures bout à bout ⇒ EXC2", () => {
    expect(curved.joints.length).toBeGreaterThan(0);
    for (const j of curved.joints) {
      expect(j.reason).toBe("naissance");
      expect(j.supportClearance).toBeGreaterThanOrEqual(20 - 1e-3);
      for (const s of curved.supports) {
        expect(j.sigma <= s.sigma0 - 20 + 1e-3 || j.sigma >= s.sigma1 + 20 - 1e-3).toBe(true);
      }
    }
    expect(r.executionClass).toBe("EXC2");
    expect(m.executionClass).toBe("EXC2");
    const exc = m.compliance.results.find((x) => x.ruleId === "EXC_CLASSE_EXECUTION")!;
    expect(exc.message).toMatch(/EXC2 \(soudures bout à bout/);
    const butt = m.parts.reduce((s, p) => s + (p.quantities[QUANTITY_BUTT_WELD_MM] ?? 0), 0);
    expect(butt).toBeCloseTo(curved.buttWeld, 6);
    expect(butt).toBeGreaterThan(0);
    expect(m.parts.reduce((s, p) => s + (p.quantities[QUANTITY_WELD_MM] ?? 0), 0)).toBeGreaterThan(
      butt,
    );
  });

  it("coupes de naissance décalées d'au moins δ dans la partie droite (supports à 2 × marge)", () => {
    // Régression : sur la partie droite haute, les supports sont espacés d'exactement
    // 2 × 20 mm ; au bruit numérique près (≈ 2e-6 mm) l'intervalle libre était sauté et la coupe
    // se repliait à 7,6 mm de la naissance arc → droite, sans signalement.
    const births = curved.naissances.map((b) => b.sigma);
    for (const j of curved.joints.filter((x) => x.reason === "naissance")) {
      expect(j.naissance).toBeDefined();
      expect(births.some((b) => Math.abs(b - j.naissance!) < 1e-9)).toBe(true);
      expect(j.onArc).toBe(false);
      expect(j.naissanceOffset!).toBeGreaterThanOrEqual(100 - 1e-6);
    }
    const joint = m.compliance.results.filter((x) => x.ruleId === "FAB_DEBILLARDE_JOINT");
    expect(joint.every((x) => x.status === "ok")).toBe(true);
    expect(joint.some((x) => /Décalage joint \/ naissance/.test(x.message))).toBe(true);
  });

  it("coupe repliée vers la naissance ou sur l'arc : signalée (remarque et avertissement)", () => {
    // Marge joint / support de 25 mm : zones interdites jointives sur la partie droite basse,
    // repli vers la naissance (36 mm < δ) ; 21 mm : repli sur l'arc pour la naissance haute.
    const { m: m2, r: r2 } = run(quarterArc({ params: { curved: { jointSupportMargin: 25 } } }));
    const c2 = r2.curved!;
    const short = c2.joints.filter(
      (j) => j.reason === "naissance" && (j.onArc || j.naissanceOffset! < 100 - 1e-6),
    );
    expect(short.length).toBeGreaterThan(0);
    expect(short.some((j) => !j.onArc)).toBe(true);
    const { m: m3, r: r3 } = run(quarterArc({ params: { curved: { jointSupportMargin: 21 } } }));
    const onArc = r3.curved!.joints.filter((j) => j.onArc);
    expect(onArc.length).toBeGreaterThan(0);
    expect(
      m3.compliance.results.some(
        (x) =>
          x.ruleId === "FAB_DEBILLARDE_JOINT" &&
          x.status === "violation" &&
          /sur l'arc/.test(x.message),
      ),
    ).toBe(true);
    for (const j of short) {
      expect(
        (m2.notes ?? []).some(
          (n) =>
            n.includes(`naissance σ = ${Math.round(j.naissance!)}`) &&
            /sur l'arc|seulement de la naissance/.test(n),
        ),
      ).toBe(true);
    }
    const bad = m2.compliance.results.filter(
      (x) => x.ruleId === "FAB_DEBILLARDE_JOINT" && x.status === "violation",
    );
    expect(bad.some((x) => /naissance/.test(x.message))).toBe(true);
    expect(bad.every((x) => x.severity === "avertissement")).toBe(true);
  });

  it("cassures de F aux nez (borne de zone libre) mesurées et affichées, pas seulement aux naissances", () => {
    // Régression : la zone [0 ; 7] est libre / libre (F droite), puis F suit les nez de la
    // partie droite : jarret de ≈ 12° au nez 7 sur la rive, absent des contrôles.
    const nos = m.stepping.nosings;
    const zone = curved.profile.zones[0]!;
    expect(zone.ends).toEqual(["free", "free"]);
    const b = zone.to;
    const before =
      (nos[b]!.z - nos[zone.from]!.z) / (nos[b]!.sigmaInner - nos[zone.from]!.sigmaInner);
    const after = (nos[b + 1]!.z - nos[b]!.z) / (nos[b + 1]!.sigmaInner - nos[b]!.sigmaInner);
    const expected = (Math.abs(Math.atan(before) - Math.atan(after)) * 180) / Math.PI;
    expect(expected).toBeGreaterThan(5);
    const kink = curved.nosingKinks.find((k) => k.nosing === b)!;
    expect(kink).toBeDefined();
    expect(kink.fibers[0]!.degrees).toBeCloseTo(expected, 1);
    // Hors zone : cassure au nez k ⇔ sécantes voisines différentes (F droite par morceaux) ;
    // partie droite haute (giron constant sur C_i) : aucune.
    const secant = (i: number) =>
      Math.atan((nos[i + 1]!.z - nos[i]!.z) / (nos[i + 1]!.sigmaInner - nos[i]!.sigmaInner));
    for (let k = b + 1; k + 1 < nos.length; k++) {
      const d = (Math.abs(secant(k) - secant(k - 1)) * 180) / Math.PI;
      const found = curved.nosingKinks.find((x) => x.nosing === k);
      if (d < 0.005) expect(found).toBeUndefined();
      else expect(found!.fibers[0]!.degrees).toBeCloseTo(d, 1);
    }
    expect(curved.nosingKinks.every((k) => k.nosing <= b + 1)).toBe(true);
    const msgs = m.compliance.results.filter(
      (x) =>
        x.ruleId === "FAB_DEBILLARDE_CASSURE_PENTE" && /Courbe des nez F au nez/.test(x.message),
    );
    expect(msgs.length).toBe(curved.nosingKinks.length);
    expect((m.notes ?? []).some((n) => /courbe des nez F présente des cassures/.test(n))).toBe(
      true,
    );
    // Seuil : le jarret au nez est en violation alors que les naissances (< 1°) passent.
    const { m: m2 } = run(quarterArc({ params: { curved: { maxSlopeBreak: 5 } } }));
    const res = m2.compliance.results.filter((x) => x.ruleId === "FAB_DEBILLARDE_CASSURE_PENTE");
    expect(res.some((x) => x.status === "violation" && /au nez 7/.test(x.message))).toBe(true);
    expect(res.filter((x) => /^Naissance/.test(x.message)).every((x) => x.status === "ok")).toBe(
      true,
    );
  });

  it("marches portées des deux côtés (supports tangents côté jour)", () => {
    const carried = m.compliance.results.filter((x) => x.ruleId === "FAB_MARCHE_PORTEE");
    expect(carried.length).toBe(m.stepping.treads.length);
    expect(carried.every((x) => x.status === "ok")).toBe(true);
    expect(curved.supports.length).toBe(m.stepping.treads.length);
    for (const s of curved.supports) expect(s.gap).toBeLessThan(10);
  });

  it("contrôles : roulage, format, largeur perpendiculaire, cassure de pente mesurée", () => {
    const ids = new Set(m.compliance.results.map((x) => x.ruleId));
    for (const id of [
      "FAB_DEBILLARDE_JOUR",
      "FAB_ROULAGE_RAYON_MIN",
      "FAB_ROULAGE_EPAISSEUR",
      "FAB_ROULAGE_LONGUEUR_ROULEAUX",
      "FAB_FORMAT_TOLE",
      "FAB_LIMON_LARGEUR_PERP_MIN",
      "FAB_DEBILLARDE_CASSURE_PENTE",
      "FAB_DEBILLARDE_JOINT",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    const breaks = m.compliance.results.filter(
      (x) => x.ruleId === "FAB_DEBILLARDE_CASSURE_PENTE" && /^Naissance/.test(x.message),
    );
    expect(breaks).toHaveLength(2);
    for (const b of breaks) {
      expect(b.status).toBe("ok");
      expect(b.measured).toBeGreaterThan(0);
      expect(b.message).toMatch(/fibre neutre .*face côté jour/);
    }
    // Cassure analytique sur une fibre décalée de d (F de classe C1 à la naissance) :
    // atan(F'·r/(r − d)) − atan(F').
    for (const sb of curved.slopeBreaks) {
      const [steps, neutral, jour] = sb.fibers;
      expect(steps!.degrees).toBeLessThan(0.1);
      expect(jour!.degrees).toBeGreaterThan(neutral!.degrees);
      const sl = steps!.after;
      const expected = (d: number) =>
        (Math.abs(Math.atan((sl * 250) / (250 - d)) - Math.atan(sl)) * 180) / Math.PI;
      expect(neutral!.degrees).toBeCloseTo(expected(4), 1);
      expect(jour!.degrees).toBeCloseTo(expected(8), 1);
    }
    expect(curved.minPerpendicularWidth).toBeGreaterThan(150);
  });

  it("seuil de cassure de pente facultatif : violation au-delà", () => {
    const { m: m2 } = run(quarterArc({ params: { curved: { maxSlopeBreak: 0.1 } } }));
    const breaks = m2.compliance.results.filter((x) => x.ruleId === "FAB_DEBILLARDE_CASSURE_PENTE");
    expect(breaks.some((x) => x.status === "violation")).toBe(true);
  });

  it("tronçon hors format de tôle : coupe au milieu de l'arc", () => {
    const { r: r2 } = run(
      quarterArc({ workshop: { metal: { sheetFormats: [{ length: 1000, width: 1000 }] } } }),
    );
    const c2 = r2.curved!;
    expect(c2.joints.some((j) => j.reason === "format")).toBe(true);
    expect(c2.segments.length).toBeGreaterThan(curved.segments.length);
    const formatCut = c2.joints.find((j) => j.reason === "format")!;
    for (const s of c2.supports) {
      expect(formatCut.sigma <= s.sigma0 || formatCut.sigma >= s.sigma1).toBe(true);
    }
  });

  it("miroir (jour à droite) : mêmes longueurs développées, développé retourné", () => {
    const { r: rr } = run(quarterArc({ direction: "right" }));
    const c = rr.curved!;
    expect(c.jour).toBe("right");
    expect(c.segments.map((s) => s.neutral1 - s.neutral0)).toEqual(
      curved.segments.map((s) => expect.closeTo(s.neutral1 - s.neutral0, 6)),
    );
    const f = c.segments[0]!.part.flat!;
    expect(f.reference?.description).toMatch(/x décroissants/);
  });
});

describe("préconditions (CHALLENGE G7)", () => {
  it("jour à poteau ou vif : erreur explicite, limon de jour non généré", () => {
    for (const inner of [{ kind: "newel", size: 100 }, { kind: "sharp" }] satisfies InnerCorner[]) {
      const { m, r } = run(quarterArc({ inner }));
      expect(r.curved).toBeNull();
      expect(m.errors.some((x) => /débillardé ⇒ jour en arc/.test(x))).toBe(true);
      expect(m.parts.some((p) => p.id.startsWith("stringer-inner-curved"))).toBe(false);
      const jour = m.compliance.results.filter((x) => x.ruleId === "FAB_DEBILLARDE_JOUR");
      expect(jour.some((x) => x.status === "violation")).toBe(true);
    }
  });

  it("rayon de roulage insuffisant : erreur explicite (profil d'atelier)", () => {
    const { m, r } = run(
      quarterArc({ workshop: { metal: { plateRolling: { minInnerRadius: 300 } } } }),
    );
    expect(r.curved).toBeNull();
    expect(m.errors.some((x) => /rayon mini de la rouleuse 300 mm/.test(x))).toBe(true);
    const radius = m.compliance.results.filter((x) => x.ruleId === "FAB_ROULAGE_RAYON_MIN");
    expect(radius.some((x) => x.status === "violation" && x.severity === "bloquant")).toBe(true);
  });

  it("escalier droit : pas de débillardé", () => {
    const p = ProjectSchema.parse({
      ...makeSteppingProject({ width: 900, legs: ["auto"], floorToFloor: 2600 }),
      stair: {
        ...makeSteppingProject({ width: 900, legs: ["auto"], floorToFloor: 2600 }).stair,
        structure: { kind: "steel-curved", params: {} },
      },
    });
    const { m, r } = run(p);
    expect(r.curved).toBeNull();
    expect(m.errors.some((x) => /sans tournant/.test(x))).toBe(true);
  });
});

/**
 * Générateur CONTRAINT : quart tournant (bas, médian, haut) ou U à jours en arc de rayon
 * ≥ rayon mini de roulage + e, H ∈ [2 200 ; 3 500], E ∈ [700 ; 1 200].
 */
const curvedStairArb = fc
  .record({
    H: fc.integer({ min: 2200, max: 3500 }),
    E: fc.integer({ min: 700, max: 1200 }),
    r: fc.integer({ min: 160, max: 600 }),
    typology: fc.constantFrom("low", "mid", "high", "u"),
    position: fc.double({ min: 0, max: 1, noNaN: true }),
    direction: fc.constantFrom("left" as const, "right" as const),
    goingDelta: fc.integer({ min: -10, max: 10 }),
  })
  .map((x) => {
    const n = Math.round(x.H / 175);
    const g = 630 - (2 * x.H) / n + x.goingDelta;
    const df = x.E / 2;
    const turns = x.typology === "u" ? 2 : 1;
    const total = Math.max(0, (n - 1) * g - turns * (Math.PI / 2) * (x.r + df));
    let straights: number[];
    if (turns === 1) {
      const p =
        x.typology === "low"
          ? 0.1 + 0.15 * x.position
          : x.typology === "high"
            ? 0.75 + 0.15 * x.position
            : 0.3 + 0.4 * x.position;
      straights = [p * total, (1 - p) * total];
    } else {
      const central = Math.min(total * 0.5, g * (1.2 + x.position));
      const rest = total - central;
      straights = [rest / 2, central, rest / 2];
    }
    const legs = straights.map((st, i) => {
      const adjacent = (i > 0 ? 1 : 0) + (i < turns ? 1 : 0);
      return Math.ceil(st + adjacent * (x.E + x.r));
    });
    return makeSteppingProject({
      width: x.E,
      legs,
      direction: x.direction,
      inner: { kind: "arc", radius: x.r },
      floorToFloor: x.H,
      stepping: { riserCount: n },
      structure: { kind: "steel-curved", params: {} },
    });
  });

describe("propriétés du limon débillardé (générateur contraint)", () => {
  it("F par les nez, tronçons contigus, rives continues, arcs en (r − e/2)·θ, EXC2 ⇔ joint", () => {
    fc.assert(
      fc.property(curvedStairArb, (project) => {
        const { m, r } = run(project);
        if (m.layout.turns.length === 0 || m.stepping.nosings.length < 2) return;
        const c = r.curved;
        expect(c, m.errors.join(" | ")).not.toBeNull();
        if (!c) return;
        for (const k of m.stepping.nosings) {
          expect(Math.abs(c.profile.at(k.sigmaInner) - k.z)).toBeLessThan(0.05);
        }
        const segs = c.segments;
        for (let i = 0; i + 1 < segs.length; i++) {
          const a = segs[i]!;
          const b = segs[i + 1]!;
          expect(b.sigma0).toBeCloseTo(a.sigma1, 9);
          const zs = (poly: readonly { x: number; y: number }[]) =>
            poly
              .filter((p) => Math.abs(p.x - a.neutral1) < 1e-6)
              .map((p) => p.y)
              .sort((u, v) => u - v);
          const za = zs(a.outline);
          const zb = zs(b.outline);
          expect(zb.length).toBe(za.length);
          za.forEach((z, q) => expect(zb[q]!).toBeCloseTo(z, 6));
        }
        for (const s of segs) {
          for (const a of s.arcs) {
            const theta = (a.sigma1 - a.sigma0) / a.faceRadius;
            expect(a.neutral1 - a.neutral0).toBeCloseTo(
              (a.faceRadius - c.thickness / 2) * theta,
              6,
            );
          }
        }
        expect(r.executionClass).toBe(c.joints.length > 0 ? "EXC2" : "EXC1");
        // Contours sans arête parasite (joint presque confondu avec un nœud des rives).
        for (const s of segs) {
          const o = s.outline;
          o.forEach((q, i) => {
            const nx = o[(i + 1) % o.length]!;
            expect(Math.hypot(nx.x - q.x, nx.y - q.y)).toBeGreaterThan(1e-3);
          });
        }
        // Coupe de naissance à moins de δ de la naissance (ou sur l'arc) : toujours signalée.
        for (const j of c.joints) {
          if (j.naissance === undefined) continue;
          if (!j.onArc && j.naissanceOffset! >= 100 - 1e-6) continue;
          const b = c.naissances.find((x) => Math.abs(x.sigma - j.naissance!) < 1e-9)!;
          if (b.before === "arc" && b.after === "arc") continue;
          expect(
            m.compliance.results.some(
              (x) =>
                x.ruleId === "FAB_DEBILLARDE_JOINT" &&
                x.status === "violation" &&
                x.message.includes(`naissance σ = ${fmtMm(j.naissance!)}`),
            ),
          ).toBe(true);
        }
        for (const sb of c.slopeBreaks) {
          const [, neutral, jour] = sb.fibers;
          expect(jour!.degrees).toBeGreaterThanOrEqual(neutral!.degrees - 1e-9);
        }
      }),
      { numRuns: 25 },
    );
  });
});
