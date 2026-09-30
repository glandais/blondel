/**
 * Structures et garde-corps sur un S / Z à poteaux (dette D4, LEDGER l. 288) : au-delà du
 * « sans exception », le comportement attendu est vérifié. Les plugins à limons reconstruisent
 * les volées avec un seul côté de jour (`legs.ts`) : sur un S / Z, erreur explicite, pièces de
 * base et garde-corps produits ; sur le U équivalent, modèle sans erreur.
 */
import { describe, expect, it } from "vitest";
import { fr, frList } from "../i18n.test-helpers.js";
import { buildModel } from "../pipeline/build.js";
import { ProjectSchema, type Project } from "../model/project.js";
import { createProject } from "../project/presets.js";
import { applyStructureChoice } from "../project/structureChoice.js";
import { newelRequiredStructures } from "./index.js";

const SZ_ERROR = /Escalier en S \/ Z \(tournants de sens opposés\) : limons non pris en charge/;

const withGuards = (p: Project): Project => ProjectSchema.parse({ ...p, guards: {} });

const count = (p: Project, category: string): number =>
  buildModel(p).parts.filter((x) => x.category === category).length;

describe("S / Z à poteaux : structures et garde-corps", () => {
  it.each(newelRequiredStructures())(
    "%s : poteaux posés, erreur explicite (pas « tracé inattendu »), marches et garde-corps produits",
    (kind) => {
      const { project } = applyStructureChoice(
        withGuards(createProject("two-quarters-s")),
        kind,
        {},
      );
      expect(project.stair.layout.turns.map((t) => t.inner.kind)).toEqual(["newel", "newel"]);
      const m = buildModel(project);
      expect(m.errors).toHaveLength(1);
      expect(m.errors[0]!.key).toBe("structure.common.legs.oppositeTurns");
      expect(fr(m.errors[0])).toMatch(SZ_ERROR);
      expect(fr(m.errors[0])).not.toMatch(/Tracé inattendu/);
      expect(m.parts.filter((x) => x.category === "tread")).toHaveLength(m.stepping.treads.length);
      // Garde-corps des deux côtés de jour (poteaux d'angle compris), sans erreur propre.
      expect(count(project, "handrail")).toBeGreaterThanOrEqual(3);
      expect(count(project, "baluster")).toBeGreaterThan(0);
    },
  );

  it.each(newelRequiredStructures())("%s : U à poteaux équivalent, sans erreur", (kind) => {
    const { project } = applyStructureChoice(withGuards(createProject("two-quarters-u")), kind, {});
    const errors = buildModel(project).errors.filter((e) => !/prédimensionnement/.test(fr(e)));
    expect(errors).toEqual([]);
  });

  it("steel-curved sur un S à jours en arc : même erreur explicite", () => {
    const base = withGuards(createProject("two-quarters-s"));
    const p = ProjectSchema.parse({
      ...base,
      stair: {
        ...base.stair,
        structure: { kind: "steel-curved", params: {} },
        layout: {
          ...base.stair.layout,
          turns: base.stair.layout.turns.map((t) => ({
            ...t,
            inner: { kind: "arc", radius: 200 },
          })),
        },
      },
    });
    const m = buildModel(p);
    expect(frList(m.errors)).toEqual([expect.stringMatching(SZ_ERROR)]);
    expect(count(p, "handrail")).toBeGreaterThan(0);
  });
});
