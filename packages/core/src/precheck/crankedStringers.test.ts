/**
 * Repli du prédimensionnement (`precheckModel`) sur un limon coudé fait de tronçons (chantier
 * bent-stringer K2c, CK12) : composantes ignorées, poutre = pièce finie lue sur sa poutre
 * équivalente (`Part.beamChord`), même convention que la barre droite appliquée à la corde.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Part } from "../model/derived.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import "../structures/index.js";
import { precheckModel, precheckStringers } from "./stringers.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const load = (file: string): Project =>
  parseProjectText(readFileSync(resolve(EXAMPLES_DIR, file), "utf8"));
const withLine = (p: Project, stringerLine: "chord" | "nosing"): Project => ({
  ...p,
  stair: {
    ...p.stair,
    structure: { ...p.stair.structure, params: { ...p.stair.structure.params, stringerLine } },
  },
});

describe("prédimensionnement de repli d'un limon coudé en tronçons (CK12)", () => {
  const project = withLine(load("j3c-acceptance-01-upn.blondel.json"), "nosing");
  const model = buildModel(project, { memo: false });
  const stringers = model.parts.filter((p) => p.category === "stringer");
  const finished = stringers.filter((p) => p.beamChord !== undefined);

  it("j3c : une poutre par pièce finie, composantes ignorées", () => {
    expect(finished).toHaveLength(4);
    const beams = precheckModel(project, model).beams;
    expect(beams.map((b) => b.partId).sort()).toEqual(finished.map((p) => p.id).sort());
    expect(stringers.filter((p) => p.componentOf !== undefined)).toHaveLength(13);
  });

  it("longueur de poutre = rive haute de la barre droite de la même face (mêmes coupes d'extrémité)", () => {
    // Référence indépendante : la barre droite de `chord` est lue sur son développé (rive haute
    // y = h entre les coupes d'aplomb) ; le limon coudé a les mêmes abscisses d'âme aux
    // extrémités (CK5, UPN : shift = 0) et la même corde des nez, donc la même poutre
    // équivalente.
    const chordProject = withLine(load("j3c-acceptance-01-upn.blondel.json"), "chord");
    const chordModel = buildModel(chordProject, { memo: false });
    const ref = new Map(
      precheckModel(chordProject, chordModel).beams.map((b) => [b.partId, b.result.length]),
    );
    for (const p of finished) {
      const single = precheckStringers(project, model.stepping, [p]).beams[0]!;
      expect(ref.has(p.id), p.mark).toBe(true);
      expect(single.result.length, p.mark).toBeCloseTo(ref.get(p.id)!, 6);
    }
  });

  it("poutre équivalente d'une barre droite : même résultat que son développé", () => {
    const chordProject = withLine(load("j3c-acceptance-01-upn.blondel.json"), "chord");
    const chordModel = buildModel(chordProject, { memo: false });
    const ref = precheckModel(chordProject, chordModel).beams;
    // Barre droite UPN (shift = 0) : rive haute = Δu / cos α de la corde de la face, Δu lu sur
    // le développé (étendue de la rive haute y = h, × cos α de la barre).
    const synthetic: Part[] = chordModel.parts.map((p) => {
      if (p.category !== "stringer" || !p.flat) return p;
      const h = Math.max(...p.flat.outline.outer.map((q) => q.y));
      const top = p.flat.outline.outer.filter((q) => Math.abs(q.y - h) < 1e-6).map((q) => q.x);
      const along = Math.max(...top) - Math.min(...top);
      // Pente de la barre : relue sur le solide extrudé (axe = zAxis du repère).
      if (p.solid.kind !== "extrusion") return p;
      const ax = p.solid.frame.zAxis;
      const slope = Math.abs(ax.z) / Math.hypot(ax.x, ax.y);
      const cosA = Math.cos(Math.atan(slope));
      const { flat: _flat, ...rest } = p;
      void _flat;
      return { ...rest, beamChord: { span: along * cosA, slope } };
    });
    const got = precheckStringers(chordProject, chordModel.stepping, synthetic).beams;
    expect(got.map((b) => b.partId)).toEqual(ref.map((b) => b.partId));
    got.forEach((b, i) => expect(b.result.length).toBeCloseTo(ref[i]!.result.length, 6));
  });
});
