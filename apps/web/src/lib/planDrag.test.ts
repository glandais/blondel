import cage60Text from "../../../../examples/cage-60.blondel.json?raw";
import {
  buildModel,
  createProject,
  junctionFrame,
  parseProjectText,
  stairPivot,
  stairSnapTargets,
  type CageLayoutSpec,
  type Model,
  type Project,
  type Vec2,
} from "@blondel/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { selectionHandles } from "../views/plan/planHandles.js";
import {
  beginDrag,
  dragStep,
  editableCage,
  handleKey,
  handleValue,
  nudgeHandle,
  rotateStairBy,
  snapAngleFrom,
  type PlanHandle,
  type SiteHandle,
} from "./planDrag.js";
import { ANGLE_SNAP_DEG } from "./planErgonomics.js";

const cage60: Project = parseProjectText(cage60Text);
const model60: Model = buildModel(cage60);

function cageOf(p: Project): CageLayoutSpec {
  const c = editableCage(p);
  if (!c) throw new Error("tracé non éditable");
  return c;
}

const lengthOf = (p: Project, i: number): number => {
  const axis = cageOf(p).sections[i]!.axis;
  if (axis.kind !== "straight" || axis.length === "auto") throw new Error("axe");
  return axis.length;
};

/** Position d'une poignée de la sélection, lue comme l'éditeur (`selectionHandles`). */
function spot(p: Project, m: Model, h: Exclude<PlanHandle, SiteHandle>): Vec2 {
  const sel =
    h.kind === "move" || h.kind === "rotate"
      ? ({ kind: "stair" } as const)
      : h.kind === "sectionEnd" || h.kind === "width"
        ? ({ kind: "section", index: h.section } as const)
        : ({ kind: "junction", index: h.junction } as const);
  const s = selectionHandles(sel, m, p, 2).find((x) => handleKey(x.handle) === handleKey(h));
  if (!s) throw new Error(`poignée ${handleKey(h)} absente`);
  return s.at;
}

const FREE = { free: true, snapRadius: 0 } as const;

describe("contrôleurs de glisser : début, pas, retour au départ", () => {
  const handles: Exclude<PlanHandle, SiteHandle>[] = [
    { kind: "move" },
    { kind: "rotate" },
    { kind: "sectionEnd", section: 0 },
    { kind: "sectionEnd", section: 1 },
    { kind: "width", section: 0, end: "end", edge: "right" },
    { kind: "width", section: 1, end: "start", edge: "left" },
    { kind: "junctionAngle", junction: 0 },
  ];
  for (const h of handles) {
    it(`${handleKey(h)} : pointeur au point de prise → projet du début (même objet)`, () => {
      const at = spot(cage60, model60, h);
      const g = beginDrag(h, cage60, model60, at, at, 1);
      expect(g.key).toBe(`plan-drag:${handleKey(h)}:1`);
      const r = dragStep(g, at, FREE);
      expect(r.error).toBeUndefined();
      expect(r.project).toBe(cage60);
    });
  }

  it("déplacement : l'origine suit le pointeur au mm (propriété), sans accroche avec Maj", () => {
    const at = spot(cage60, model60, { kind: "move" });
    const g = beginDrag({ kind: "move" }, cage60, model60, at, at, 1);
    fc.assert(
      fc.property(
        fc.integer({ min: -3000, max: 3000 }),
        fc.integer({ min: -3000, max: 3000 }),
        (dx, dy) => {
          const r = dragStep(g, { x: at.x + dx, y: at.y + dy }, FREE);
          const o = r.project!.stair.placement.origin;
          return (
            o.x === cage60.stair.placement.origin.x + dx &&
            o.y === cage60.stair.placement.origin.y + dy
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it("déplacement : accroche à une arrivée sur la trémie, repère de la cible", () => {
    // Escalier tourné à la rotation d'une cible d'arrivée : le glisser (rotation inchangée) peut
    // l'atteindre.
    const first = stairSnapTargets(cage60, model60).find((t) => t.kind === "arrival");
    expect(first, "cible d'arrivée").toBeDefined();
    if (!first || first.kind !== "arrival") return;
    const p: Project = {
      ...cage60,
      stair: {
        ...cage60.stair,
        placement: { ...cage60.stair.placement, rotation: first.placement.rotation },
      },
    };
    const m = buildModel(p);
    const target = stairSnapTargets(p, m).find(
      (t) => t.kind === "arrival" && t.placement.rotation === first.placement.rotation,
    );
    if (!target || target.kind !== "arrival") throw new Error("cible d'arrivée");
    const at = spot(p, m, { kind: "move" });
    const g = beginDrag({ kind: "move" }, p, m, at, at, 1);
    const o = p.stair.placement.origin;
    const pointer = {
      x: at.x + target.placement.origin.x - o.x + 7,
      y: at.y + target.placement.origin.y - o.y - 5,
    };
    const snapped = dragStep(g, pointer, { free: false, snapRadius: 50 });
    expect(snapped.snap?.kind).toBe("placement");
    if (snapped.snap?.kind !== "placement") return;
    expect(snapped.project!.stair.placement).toEqual({
      origin: snapped.snap.placement.origin,
      rotation: snapped.snap.placement.rotation,
    });
    const free = dragStep(g, pointer, FREE);
    expect(free.snap).toBeNull();
    expect(free.project!.stair.placement.origin).toEqual({
      x: target.placement.origin.x + 7,
      y: target.placement.origin.y - 5,
    });
  });

  it("rotation : accroche de 15°, pivot immobile ; Maj : au degré (propriété)", () => {
    const h: PlanHandle = { kind: "rotate" };
    const at = spot(cage60, model60, h);
    const g = beginDrag(h, cage60, model60, at, at, 1);
    const pivot = stairPivot(cage60, model60.layout);
    fc.assert(
      fc.property(fc.double({ min: -170, max: 170, noNaN: true }), fc.boolean(), (deg, free) => {
        const a = (deg * Math.PI) / 180;
        const v = { x: at.x - pivot.x, y: at.y - pivot.y };
        const pointer = {
          x: pivot.x + v.x * Math.cos(a) - v.y * Math.sin(a),
          y: pivot.y + v.x * Math.sin(a) + v.y * Math.cos(a),
        };
        const r = dragStep(g, pointer, { free, snapRadius: 0 });
        const p = r.project!;
        const rot = p.stair.placement.rotation;
        const expected = free ? Math.round(deg) : Math.round(deg / ANGLE_SNAP_DEG) * ANGLE_SNAP_DEG;
        if (Math.abs(rot - expected) > 1e-9) return false;
        // Pivot (centre local de l'emprise) placé au même point, à l'arrondi de l'origine près.
        const moved = stairPivot(cage60, model60.layout, p.stair.placement);
        return Math.hypot(moved.x - pivot.x, moved.y - pivot.y) < 1;
      }),
      { numRuns: 80 },
    );
  });

  it("rotation d'un angle quelconque : pas de saut au premier pixel, multiples atteints", () => {
    const tilted = rotateStairBy(cage60, model60, cage60, 37).project!;
    expect(tilted.stair.placement.rotation).toBe(37);
    const m = buildModel(tilted);
    const h: PlanHandle = { kind: "rotate" };
    const at = spot(tilted, m, h);
    const pivot = stairPivot(tilted, m.layout);
    const g = beginDrag(h, tilted, m, at, at, 1);
    const turn = (deg: number): Vec2 => {
      const a = (deg * Math.PI) / 180;
      const v = { x: at.x - pivot.x, y: at.y - pivot.y };
      return {
        x: pivot.x + v.x * Math.cos(a) - v.y * Math.sin(a),
        y: pivot.y + v.x * Math.sin(a) + v.y * Math.cos(a),
      };
    };
    const snap = { free: false, snapRadius: 0 } as const;
    // Tremblement : le projet de départ (même objet), pas 30° ni 45°.
    expect(dragStep(g, turn(0.4), snap).project).toBe(tilted);
    expect(dragStep(g, turn(-1.5), snap).project).toBe(tilted);
    // Près d'un multiple du pas : l'angle « rond » ; ailleurs, départ + k · 15°.
    expect(dragStep(g, turn(52), snap).project!.stair.placement.rotation).toBe(90);
    expect(dragStep(g, turn(15), snap).project!.stair.placement.rotation).toBe(52);
  });

  it("accroche angulaire : multiple du pas ou départ décalé du pas, le plus proche", () => {
    expect(snapAngleFrom(37.4, 37, 15)).toBe(37);
    expect(snapAngleFrom(44, 37, 15)).toBe(45);
    expect(snapAngleFrom(53, 37, 15)).toBe(52);
    expect(snapAngleFrom(89, 37, 15)).toBe(90);
    // Départ multiple du pas : accroche absolue seule.
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.integer({ min: -12, max: 12 }),
        (raw, k) => snapAngleFrom(raw, k * 15, 15) === Math.round(raw / 15) * 15 + 0,
      ),
    );
    // Résultat : un multiple du pas, ou le départ décalé d'un multiple (au degré).
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.integer({ min: -179, max: 179 }),
        (raw, start) => {
          const a = snapAngleFrom(raw, start, 15);
          return a % 15 === 0 || (a - start) % 15 === 0;
        },
      ),
    );
  });

  it("fin de tronçon : longueur suivie au mm (Maj), accroche par girons entiers sinon", () => {
    const h: PlanHandle = { kind: "sectionEnd", section: 0 };
    const at = spot(cage60, model60, h);
    const s = model60.layout.sections![0]!;
    const span = { x: s.start.right.x - s.start.left.x, y: s.start.right.y - s.start.left.y };
    const n = Math.hypot(span.x, span.y);
    const u = { x: -span.y / n, y: span.x / n };
    const g = beginDrag(h, cage60, model60, at, at, 1);
    const len0 = lengthOf(cage60, 0);
    const targets = g.targets.flatMap((t) => (t.kind === "sectionLength" ? [t] : []));
    expect(targets.length).toBeGreaterThan(1);
    for (const d of [-230, 37, 410]) {
      const pointer = { x: at.x + u.x * d, y: at.y + u.y * d };
      expect(lengthOf(dragStep(g, pointer, FREE).project!, 0)).toBe(len0 + d);
      const snapped = dragStep(g, pointer, { free: false, snapRadius: 10_000 });
      expect(snapped.snap?.kind).toBe("length");
      if (snapped.snap?.kind !== "length") continue;
      expect(lengthOf(snapped.project!, 0)).toBe(Math.round(snapped.snap.length));
      expect(snapped.snap.goings).toBeGreaterThan(0);
      // Cible retenue : la plus proche de la longueur visée par le pointeur (len0 + d).
      const gap = Math.abs(snapped.snap.length - (len0 + d));
      for (const t of targets) expect(gap).toBeLessThanOrEqual(Math.abs(t.length - (len0 + d)));
    }
    // Hors du rayon de toute cible : aucune accroche, longueur suivie comme avec Maj.
    const far = targets
      .flatMap((t) => [t.length - len0 - 37, t.length - len0 + 37])
      .map(Math.round)
      .find((d) => targets.every((t) => Math.abs(t.length - (len0 + d)) > 5) && len0 + d > 0);
    expect(far).toBeDefined();
    const pointer = { x: at.x + u.x * far!, y: at.y + u.y * far! };
    const loose = dragStep(g, pointer, { free: false, snapRadius: 1 });
    expect(loose.snap).toBeNull();
    expect(lengthOf(loose.project!, 0)).toBe(len0 + far!);
  });

  it("bord d'arrivée : une largeur de fin apparaît (trapèze), ou refus du bord fixe", () => {
    const results = (["left", "right"] as const).map((edge) => {
      const h: PlanHandle = { kind: "width", section: 0, end: "end", edge };
      const at = spot(cage60, model60, h);
      const line = model60.layout.sections![0]!.end;
      const d = { x: line.right.x - line.left.x, y: line.right.y - line.left.y };
      const k = (edge === "right" ? 150 : -150) / Math.hypot(d.x, d.y);
      const g = beginDrag(h, cage60, model60, at, at, 1);
      return dragStep(g, { x: at.x + d.x * k, y: at.y + d.y * k }, FREE);
    });
    const ok = results.filter((r) => r.project);
    expect(ok.length).toBeGreaterThan(0);
    for (const r of ok) {
      const sec = cageOf(r.project!).sections[0]!;
      expect(sec.width).toBe(900);
      expect(sec.widthEnd).toBeGreaterThan(900);
    }
    for (const r of results) if (r.error) expect(r.error.key).toBe("layout.edit.fixedEdge");
  });

  it("angle de jonction : accroche de 15°, Maj au degré ; passer par 0° ne perd pas le mode", () => {
    const h: PlanHandle = { kind: "junctionAngle", junction: 0 };
    const at = spot(cage60, model60, h);
    const frame = junctionFrame(model60.layout, 0)!;
    const g = beginDrag(h, cage60, model60, at, at, 1);
    const r = Math.hypot(at.x - frame.pivot.x, at.y - frame.pivot.y);
    const toward = (deg: number): Vec2 => {
      const a = (deg * Math.PI) / 180;
      const d = frame.incoming;
      return {
        x: frame.pivot.x + r * (d.x * Math.cos(a) - d.y * Math.sin(a)),
        y: frame.pivot.y + r * (d.x * Math.sin(a) + d.y * Math.cos(a)),
      };
    };
    const angleOf = (p: Project): number => cageOf(p).junctions[0]!.angle;
    expect(angleOf(dragStep(g, toward(47), FREE).project!)).toBe(47);
    // Jonction à 47° : la prise de la poignée ne la ramène pas à 45°.
    const at47 = dragStep(g, toward(47), FREE).project!;
    const m47 = buildModel(at47);
    const a47 = spot(at47, m47, h);
    const g47 = beginDrag(h, at47, m47, a47, a47, 2);
    expect(dragStep(g47, a47, { free: false, snapRadius: 0 }).project).toBe(at47);
    expect(
      dragStep(g47, { x: a47.x + 0.5, y: a47.y }, { free: false, snapRadius: 0 }).project,
    ).toBe(at47);
    const snapped = dragStep(g, toward(47), { free: false, snapRadius: 0 });
    expect(angleOf(snapped.project!)).toBe(45);
    expect(snapped.snap).toEqual({ kind: "angle", angle: 45 });
    const zero = dragStep(g, toward(2), { free: false, snapRadius: 0 }).project!;
    expect(cageOf(zero).junctions[0]!.mode).toBe("landing");
    const back = dragStep(g, toward(75), { free: false, snapRadius: 0 }).project!;
    expect(angleOf(back)).toBe(75);
    expect(cageOf(back).junctions[0]!.mode).toBe(cageOf(cage60).junctions[0]!.mode);
  });

  it("rayon du raccord du jour en arc : suit le pointeur ; refus sans arc", () => {
    const layout = cage60.stair.layout as CageLayoutSpec;
    const arc: Project = {
      ...cage60,
      stair: {
        ...cage60.stair,
        layout: {
          ...layout,
          junctions: [{ ...layout.junctions[0]!, well: { kind: "arc" as const, radius: 200 } }],
        },
      },
    };
    const m = buildModel(arc);
    const h: PlanHandle = { kind: "wellRadius", junction: 0 };
    const at = spot(arc, m, h);
    const d = junctionFrame(m.layout, 0)!.incoming;
    const g = beginDrag(h, arc, m, at, at, 1);
    expect(dragStep(g, at, FREE).project).toBe(arc);
    const r = dragStep(g, { x: at.x - d.x * 60, y: at.y - d.y * 60 }, FREE).project!;
    expect(cageOf(r).junctions[0]!.well).toEqual({ kind: "arc", radius: 260 });
    expect(handleValue(r, h, 1e5)?.now).toBe(260);
    // Sans raccord en arc : pas de poignée, et le mutateur refuse.
    expect(
      selectionHandles({ kind: "junction", index: 0 }, model60, cage60, 2).some(
        (s) => s.handle.kind === "wellRadius",
      ),
    ).toBe(false);
    const refused = dragStep(beginDrag(h, cage60, model60, at, at, 2), at, FREE);
    expect(refused.error?.key).toBe("layout.edit.wellNotArc");
  });

  it("tracé à volées : la longueur glissée garde les volées", () => {
    const p = createProject("quarter-left");
    const m = buildModel(p);
    const h: PlanHandle = { kind: "sectionEnd", section: 1 };
    const at = spot(p, m, h);
    const g = beginDrag(h, p, m, at, at, 1);
    const s = m.layout.sections![1]!;
    const span = { x: s.start.right.x - s.start.left.x, y: s.start.right.y - s.start.left.y };
    const n = Math.hypot(span.x, span.y);
    const r = dragStep(g, { x: at.x - (span.y / n) * 200, y: at.y + (span.x / n) * 200 }, FREE);
    // Tracé à volées : `kind` absent ou « flights » (schéma rétrocompatible).
    expect(r.project!.stair.layout.kind ?? "flights").toBe("flights");
    expect(lengthOf(r.project!, 1)).toBe(lengthOf(p, 1) + 200);
  });
});

describe("clavier des poignées", () => {
  const nudge = (h: PlanHandle, dir: 1 | -1, large = false, axis: "x" | "y" = "x") =>
    nudgeHandle(cage60, model60, cage60, h, dir, large, axis);

  it("déplacement : 10 mm, 100 mm avec Maj, axe des flèches", () => {
    const o = cage60.stair.placement.origin;
    expect(nudge({ kind: "move" }, 1).project!.stair.placement.origin).toEqual({
      x: o.x + 10,
      y: o.y,
    });
    expect(nudge({ kind: "move" }, -1, true, "y").project!.stair.placement.origin).toEqual({
      x: o.x,
      y: o.y - 100,
    });
  });

  it("rotation : 1°, 15° avec Maj ; R = rotateStairBy(±15°)", () => {
    expect(nudge({ kind: "rotate" }, 1).project!.stair.placement.rotation).toBe(1);
    expect(nudge({ kind: "rotate" }, -1, true).project!.stair.placement.rotation).toBe(-15);
    const r = rotateStairBy(cage60, model60, cage60, 15).project!;
    expect(r.stair.placement.rotation).toBe(15);
    const before = stairPivot(cage60, model60.layout);
    const after = stairPivot(cage60, model60.layout, r.stair.placement);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
  });

  it("longueur, largeur de fin, angle : pas de 10 mm ou 1°", () => {
    expect(lengthOf(nudge({ kind: "sectionEnd", section: 0 }, 1).project!, 0)).toBe(
      lengthOf(cage60, 0) + 10,
    );
    const w = nudge({ kind: "width", section: 0, end: "end", edge: "right" }, 1, true).project!;
    expect(cageOf(w).sections[0]!.widthEnd).toBe(1000);
    expect(cageOf(w).sections[0]!.width).toBe(900);
    const a = nudge({ kind: "junctionAngle", junction: 0 }, -1).project!;
    expect(cageOf(a).junctions[0]!.angle).toBe(59);
  });

  it("valeurs des curseurs lues dans le projet ; hélicoïdal : refus typé", () => {
    expect(handleValue(cage60, { kind: "junctionAngle", junction: 0 }, 1e5)).toMatchObject({
      unit: "deg",
      now: 60,
    });
    expect(handleValue(cage60, { kind: "sectionEnd", section: 1 }, 1e5)).toMatchObject({
      unit: "mm",
      now: 1650,
    });
    expect(handleValue(cage60, { kind: "junctionAngle", junction: 3 }, 1e5)).toBeNull();
    const helical = createProject("helical");
    const mh = buildModel(helical);
    const r = nudgeHandle(helical, mh, helical, { kind: "sectionEnd", section: 0 }, 1, false);
    expect(r.error?.key).toBe("ui.plan.editor.handle.noValue");
  });
});
