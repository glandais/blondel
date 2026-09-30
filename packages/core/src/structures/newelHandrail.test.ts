/**
 * QUESTIONS A3 (appliqué par défaut le 2026-09-30) : le poteau d'angle monte au-dessus de la
 * main courante du garde-corps qui le rejoint — hauteur = max(plus haut élément reçu +
 * dépassement du plugin, main courante + `newel.handrailOverrun`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { translatorFor } from "@blondel/i18n";
import { frList } from "../i18n.test-helpers.js";
import type { Model, Part } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel, clearModelCache } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import { newelTopWithHandrail } from "./newel.js";

/** Dépassement par défaut du poteau sur la main courante (`guards.posts.newelOverrun`). */
const NEWEL_HANDRAIL_OVERRUN_DEFAULT = 50;

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const load = (name: string): Project =>
  parseProjectText(readFileSync(resolve(EXAMPLES, name), "utf8"));

beforeEach(() => clearModelCache());

function postTop(m: Model, id: string): number {
  const p = m.parts.find((q) => q.id === id) as Part;
  expect(p.solid.kind).toBe("extrusion");
  return p.solid.kind === "extrusion" ? p.solid.frame.origin.z + p.solid.depth : Number.NaN;
}

/**
 * Plus haut point du dessus des mains courantes (axe + demi-section) dans l'emprise du poteau
 * (cercle circonscrit à sa section), segments échantillonnés au millimètre.
 */
function handrailTopOver(m: Model, post: Part): number {
  if (post.solid.kind !== "extrusion") return Number.NaN;
  const { origin: o, xAxis: X, yAxis: Y } = post.solid.frame;
  const pts = post.solid.profile.outer.map((q) => ({
    x: o.x + q.x * X.x + q.y * Y.x,
    y: o.y + q.x * X.y + q.y * Y.y,
  }));
  const c = {
    x: pts.reduce((s, q) => s + q.x, 0) / pts.length,
    y: pts.reduce((s, q) => s + q.y, 0) / pts.length,
  };
  const radius = Math.max(...pts.map((q) => Math.hypot(q.x - c.x, q.y - c.y)));
  let best = -Infinity;
  for (const h of m.parts) {
    if (h.category !== "handrail" || h.solid.kind !== "sweep") continue;
    const half = (h.stock?.thickness ?? 0) / 2;
    const path = h.solid.path;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (Math.hypot(x - c.x, y - c.y) <= radius - 1)
          best = Math.max(best, a.z + (b.z - a.z) * t + half);
      }
    }
  }
  return best;
}

describe("poteau d'angle et main courante (QUESTIONS A3)", () => {
  const withOverrun = (p: Project, overrun: number | "off"): Project => ({
    ...p,
    guards: { ...p.guards!, posts: { ...p.guards!.posts, newelOverrun: overrun } },
  });

  it("exemple bois avec garde-corps : le poteau dépasse la main courante de 50 mm", () => {
    const p = load("j4-acceptance-01-garde-corps.blondel.json");
    const m = buildModel(p);
    const post = m.parts.find((q) => q.category === "post" && q.id.startsWith("post-"))!;
    const top = postTop(m, post.id);
    const near = handrailTopOver(m, post);
    expect(Number.isFinite(near)).toBe(true);
    expect(top).toBeGreaterThanOrEqual(near + NEWEL_HANDRAIL_OVERRUN_DEFAULT - 1e-6);
    expect(
      frList(m.notes).some((n) => n.includes("au-dessus de la main courante du garde-corps")),
    ).toBe(true);
    const raised = m.notes!.find((n) => n.key === "structure.woodHoused.newelRaised")!;
    expect(translatorFor("en").t(raised)).toMatch(
      /^PT\d+: corner newel raised to \d+ mm, 50 mm above the guarding handrail \(guarding, posts: “corner newel overrun”\)\.$/,
    );
    // Masse et débit suivent la nouvelle hauteur.
    expect(post.stock!.length).toBeGreaterThan(1500);
    expect(post.quantities["mass_kg"]).toBeGreaterThan(0);
  });

  it("`off` rend l'ancien comportement ; sans garde-corps, rien ne change", () => {
    const p = load("j4-acceptance-01-garde-corps.blondel.json");
    const off = buildModel(withOverrun(p, "off"));
    const noGuards = buildModel({ ...p, guards: undefined });
    const id = off.parts.find((q) => q.category === "post" && q.id.startsWith("post-"))!.id;
    expect(postTop(off, id)).toBeCloseTo(postTop(noGuards, id), 9);
    const on = buildModel(withOverrun(p, 120));
    expect(postTop(on, id)).toBeGreaterThan(postTop(off, id));
  });

  it.each(["steel-flat", "steel-profile"])("structure acier (%s) : même règle", (kind) => {
    const p = load("j4-acceptance-01-garde-corps.blondel.json");
    const steel: Project = {
      ...p,
      stair: { ...p.stair, structure: { kind, params: {} } },
    };
    const m = buildModel(steel);
    const post = m.parts.find((q) => q.category === "post" && q.id.startsWith("post-"));
    // Pas de sortie silencieuse : le poteau d'angle acier doit exister.
    expect(post, kind).toBeDefined();
    expect(post!.material.startsWith("steel")).toBe(true);
    const near = handrailTopOver(m, post!);
    expect(Number.isFinite(near)).toBe(true);
    // Emprise prise au cercle circonscrit (majorante) : au plus quelques centimètres de trop.
    expect(postTop(m, post!.id)).toBeGreaterThanOrEqual(
      near + NEWEL_HANDRAIL_OVERRUN_DEFAULT - 1e-6,
    );
    expect(postTop(m, post!.id)).toBeLessThan(near + NEWEL_HANDRAIL_OVERRUN_DEFAULT + 30);
    const off = buildModel(withOverrun(steel, "off"));
    expect(postTop(off, post!.id)).toBeLessThan(postTop(m, post!.id));
  });

  it("newelTopWithHandrail : max(sommet, main courante + dépassement)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5000, noNaN: true }),
        fc.option(fc.double({ min: 0, max: 5000, noNaN: true }), { nil: undefined }),
        fc.integer({ min: 0, max: 300 }),
        (top, rail, overrun) => {
          const ctx =
            rail === undefined ? {} : { newelHandrailTops: [{ turn: 0, top: rail, overrun }] };
          const r = newelTopWithHandrail(top, ctx, 0);
          expect(r.top).toBe(Math.max(top, rail === undefined ? -Infinity : rail + overrun));
          expect(r.raisedBy).toBeCloseTo(r.top - top, 9);
          expect(newelTopWithHandrail(top, ctx, 1).top).toBe(top);
        },
      ),
    );
  });
});
