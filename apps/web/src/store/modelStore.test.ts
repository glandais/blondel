import { translatorFor } from "@blondel/i18n";
import { textMessage } from "@blondel/i18n";
import { createProject, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import type { ModelSnapshot } from "../model/snapshot.js";
import type { PreviewResult } from "../model/protocol.js";
import type { JobExec } from "../model/workerClient.js";
import { createModelService, EMPTY_MODEL_VIEW } from "./modelStore.js";

function fakeExec(): JobExec & {
  resolve: () => void;
  resolvePreview: () => void;
  builds: Project[];
  previews: Project[];
} {
  const queue: { p: Project; resolve: (s: ModelSnapshot) => void }[] = [];
  const previewQueue: { p: Project; resolve: (s: PreviewResult) => void }[] = [];
  const builds: Project[] = [];
  const previews: Project[] = [];
  return {
    builds,
    previews,
    usesWorker: true,
    build(p) {
      builds.push(p);
      return new Promise((resolve) => queue.push({ p, resolve }));
    },
    preview(p) {
      previews.push(p);
      return new Promise((resolve) => previewQueue.push({ p, resolve }));
    },
    resolvePreview() {
      const q = previewQueue.shift();
      q?.resolve({ siteFit: [], errors: [textMessage(q.p.name)], timeMs: 1 });
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

describe("glisser de l'éditeur de plan : aperçu pendant le geste, un modèle au relâchement", () => {
  const named = (name: string): Project => ({ ...createProject("straight"), name });
  const names = (ps: readonly Project[]) => ps.map((p) => p.name);

  it("preview : aperçus seulement pendant le geste (dernier reçu affiché), un seul modèle complet au relâchement", async () => {
    const exec = fakeExec();
    const svc = createModelService({ exec, variantsOf: () => [] });
    svc.request(named("A"));
    exec.resolve();
    await flush();
    svc.beginGesture("preview");
    expect(svc.store.getState().gesture).toBe("preview");
    for (const n of ["B", "C", "D"]) svc.request(named(n));
    // B en cours, C remplacé par D (jamais calculé), aucun modèle complet.
    expect(names(exec.previews)).toEqual(["B"]);
    expect(names(exec.builds)).toEqual(["A"]);
    exec.resolvePreview();
    await flush();
    // B obsolète, mais c'est le dernier reçu : affiché.
    expect(svc.store.getState().preview?.project.name).toBe("B");
    expect(names(exec.previews)).toEqual(["B", "D"]);
    exec.resolvePreview();
    await flush();
    expect(svc.store.getState().preview?.project.name).toBe("D");
    expect(svc.store.getState().model.project?.name).toBe("A");
    svc.endGesture();
    expect(svc.store.getState().gesture).toBeNull();
    expect(names(exec.builds)).toEqual(["A", "D"]);
    // L'aperçu reste affiché jusqu'au modèle complet.
    expect(svc.store.getState().preview?.project.name).toBe("D");
    exec.resolve();
    await flush();
    expect(svc.store.getState().model.project?.name).toBe("D");
    expect(svc.store.getState().preview).toBeNull();
    expect(svc.stats()).toEqual({ builds: 2, previews: 2, previewsPublished: 2 });
  });

  it("transform : aucun calcul pendant le geste, un modèle complet au relâchement", async () => {
    const exec = fakeExec();
    const svc = createModelService({ exec, variantsOf: () => [] });
    svc.request(named("A"));
    exec.resolve();
    await flush();
    svc.beginGesture("transform");
    for (const n of ["B", "C"]) svc.request(named(n));
    expect(exec.previews).toEqual([]);
    expect(names(exec.builds)).toEqual(["A"]);
    svc.endGesture();
    expect(names(exec.builds)).toEqual(["A", "C"]);
  });

  it("aperçu en cours au relâchement : abandonné (cancel) ; annulation au projet de départ : modèle en cache publié aussitôt", async () => {
    const exec = fakeExec();
    const svc = createModelService({ exec, variantsOf: () => [] });
    const a = named("A");
    svc.request(a);
    exec.resolve();
    await flush();
    svc.beginGesture("preview");
    svc.request(named("B"));
    svc.request(a); // Échap : retour au projet de départ
    svc.endGesture();
    exec.resolvePreview();
    await flush();
    expect(svc.store.getState().preview).toBeNull();
    // Le modèle de A était en cache : aucun nouveau calcul.
    expect(names(exec.builds)).toEqual(["A"]);
    expect(svc.store.getState().model.project).toBe(a);
  });

  it("aperçu publié hors geste (sans abandon du runner) : ignoré par le store", async () => {
    const exec = fakeExec();
    const svc = createModelService({ exec, variantsOf: () => [] });
    svc.beginGesture("preview");
    svc.request(named("B"));
    // Fin du geste sans passer par `endGesture` (donc sans `cancel`) : seule la garde de
    // `onResult` empêche l'aperçu d'être affiché.
    svc.store.setState({ gesture: null });
    exec.resolvePreview();
    await flush();
    expect(svc.stats().previewsPublished).toBe(1);
    expect(svc.store.getState().preview).toBeNull();
  });
});
