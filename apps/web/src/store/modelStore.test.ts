import { translatorFor } from "@blondel/i18n";
import { textMessage } from "@blondel/i18n";
import { createProject, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import type { ModelSnapshot } from "../model/snapshot.js";
import type { JobExec } from "../model/workerClient.js";
import { createModelService, EMPTY_MODEL_VIEW } from "./modelStore.js";

function fakeExec(): JobExec & { resolve: () => void; builds: Project[] } {
  const queue: { p: Project; resolve: (s: ModelSnapshot) => void }[] = [];
  const builds: Project[] = [];
  return {
    builds,
    usesWorker: true,
    build(p) {
      builds.push(p);
      return new Promise((resolve) => queue.push({ p, resolve }));
    },
    compare: () => ({ rows: [], timeMs: 1 }),
    pdf: () => Promise.resolve(new Uint8Array()),
    glb: () => Promise.resolve(new Uint8Array()),
    resolve() {
      const q = queue.shift();
      q?.resolve({
        model: null,
        errors: [textMessage(q.p.name)],
        timeMs: 2,
        mesh: null,
      });
    },
    dispose() {},
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const FR = translatorFor("fr");

describe("modèle calculé hors du fil principal", () => {
  it("garde le dernier modèle affiché pendant le calcul et publie le projet d'origine", async () => {
    const exec = fakeExec();
    const svc = createModelService({ exec, variantsOf: () => [] });
    expect(svc.store.getState().model).toBe(EMPTY_MODEL_VIEW);
    const a = { ...createProject("straight"), name: "A" };
    const b = { ...createProject("straight"), name: "B" };
    svc.request(a);
    expect(svc.store.getState().model.pending).toBe(true);
    exec.resolve();
    await flush();
    let m = svc.store.getState().model;
    expect(m.errors.map((e) => FR.t(e))).toEqual(["A"]);
    expect(m.project).toBe(a);
    expect(m.pending).toBe(false);
    svc.request(b);
    m = svc.store.getState().model;
    expect(m.pending).toBe(true);
    expect(m.project).toBe(a); // ancien modèle toujours affiché
    exec.resolve();
    await flush();
    m = svc.store.getState().model;
    expect(m.project).toBe(b);
    expect(m.timeMs).toBe(2);
    expect(m.pending).toBe(false);
  });

  it("comparaison à la demande, mise en cache par projet", () => {
    const exec = fakeExec();
    let asked = 0;
    const svc = createModelService({
      exec,
      variantsOf: () => {
        asked++;
        return [];
      },
    });
    const p = createProject("straight");
    svc.requestCompare(p);
    svc.requestCompare(p);
    expect(asked).toBe(1);
    expect(svc.store.getState().compare.project).toBe(p);
    expect(svc.store.getState().compare.outcome?.timeMs).toBe(1);
  });

  it("échec de la comparaison : message publié (pas un tableau vide muet)", () => {
    const exec = fakeExec();
    const svc = createModelService({
      exec: {
        ...exec,
        compare: () => {
          throw new Error("panne");
        },
      },
      variantsOf: () => [],
    });
    svc.requestCompare(createProject("straight"));
    const outcome = svc.store.getState().compare.outcome;
    expect(outcome?.rows).toEqual([]);
    expect(FR.t(outcome!.error!)).toMatch(/panne/);
  });
});
