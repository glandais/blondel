/**
 * Client du worker de calcul : routage des réponses, clonage réel des messages
 * (`structuredClone`, comme `postMessage`), repli sur le fil principal.
 */
import { clearModelCache, createProject, parseProjectText } from "@blondel/core";
import { describe, expect, it } from "vitest";
import j4Text from "../../../../examples/j4-acceptance-01-garde-corps.blondel.json?raw";
import { createJobRunner } from "./handler.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";
import { createJobExec, type WorkerLike } from "./workerClient.js";

/** Faux worker : exécute le traitement du worker de façon asynchrone, messages clonés. */
function fakeWorker(options: { fail?: boolean; answerError?: boolean; unreadable?: boolean } = {}) {
  const runner = createJobRunner();
  const w: WorkerLike & { received: WorkerRequest[]; terminated: boolean } = {
    received: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      const req = structuredClone(message);
      w.received.push(req);
      setTimeout(() => {
        if (options.fail) {
          w.onerror?.(new Error("chargement du module impossible"));
          return;
        }
        if (options.unreadable) {
          w.onmessageerror?.(new Error("désérialisation impossible"));
          return;
        }
        let res: WorkerResponse;
        if (options.answerError) res = { id: req.id, type: "error", message: "clonage" };
        else if (req.type === "build")
          res = { id: req.id, type: "build", result: runner.build(req) };
        else res = { id: req.id, type: "compare", result: runner.compare(req) };
        w.onmessage?.({ data: structuredClone(res) });
      }, 0);
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w;
}

describe("client du worker de calcul", () => {
  it("modèle et maillage calculés dans le worker, messages clonables (garde-corps compris)", async () => {
    clearModelCache();
    const w = fakeWorker();
    const exec = createJobExec(() => w);
    const project = parseProjectText(j4Text);
    const snap = await exec.build(project);
    expect(exec.usesWorker).toBe(true);
    expect(w.received).toHaveLength(1);
    expect(snap.model?.errors).toEqual([]);
    expect(snap.mesh?.parts.length).toBe(snap.model?.parts.length);
    // Mains courantes balayées et remplissages maillés sans erreur.
    const handrails = snap.mesh!.parts.filter((p) => p.mesh.category === "handrail");
    expect(handrails.length).toBeGreaterThan(0);
    for (const p of snap.mesh!.parts) {
      expect(p.mesh.error, p.mesh.partId).toBeUndefined();
      expect(p.mesh.mesh.indices.length, p.mesh.partId).toBeGreaterThan(0);
    }
  });

  it("appels simultanés routés par identifiant", async () => {
    const w = fakeWorker();
    const exec = createJobExec(() => w);
    const [a, b] = await Promise.all([
      exec.build(createProject("straight")),
      exec.build(createProject("quarter-left")),
    ]);
    expect(a.model?.layout.turns ?? []).toHaveLength(0);
    expect(b.model?.stepping.balancedZones.length).toBeGreaterThan(0);
  });

  it("sans Worker : calcul sur le fil principal (synchrone)", () => {
    const exec = createJobExec(() => null);
    const r = exec.build(createProject("straight"));
    expect(r instanceof Promise).toBe(false);
    expect(exec.usesWorker).toBe(false);
    expect((r as Awaited<typeof r>).model).not.toBeNull();
  });

  it("worker en panne ou réponse « error » : repli sur le fil principal, définitif", async () => {
    const broken = fakeWorker({ fail: true });
    const exec = createJobExec(() => broken);
    const r = await exec.build(createProject("straight"));
    expect(r.model).not.toBeNull();
    expect(broken.terminated).toBe(true);
    expect(exec.usesWorker).toBe(false);
    const again = exec.build(createProject("straight"));
    expect(again instanceof Promise).toBe(false);

    const erring = fakeWorker({ answerError: true });
    const exec2 = createJobExec(() => erring);
    const r2 = await exec2.build(createProject("straight"));
    expect(r2.model).not.toBeNull();
    expect(exec2.usesWorker).toBe(false);

    const throwing = createJobExec(() => {
      throw new Error("Worker interdit");
    });
    expect(throwing.build(createProject("straight")) instanceof Promise).toBe(false);
  });

  it("réponse illisible (messageerror) : repli sur le fil principal, jamais d'attente sans fin", async () => {
    const w = fakeWorker({ unreadable: true });
    const exec = createJobExec(() => w);
    const r = await exec.build(createProject("straight"));
    expect(r.model).not.toBeNull();
    expect(exec.usesWorker).toBe(false);
    expect(w.terminated).toBe(true);
  });
});
