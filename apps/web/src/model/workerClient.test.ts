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
        if (options.answerError) {
          w.onmessage?.({ data: { id: req.id, type: "error", message: "clonage" } });
          return;
        }
        if (req.type === "pdf") {
          void runner.pdf(req).then((result) => {
            const res: WorkerResponse = { id: req.id, type: "pdf", result };
            w.onmessage?.({ data: structuredClone(res) });
          });
          return;
        }
        const res: WorkerResponse =
          req.type === "build"
            ? { id: req.id, type: "build", result: runner.build(req) }
            : req.type === "glb"
              ? { id: req.id, type: "glb", result: runner.glb(req) }
              : { id: req.id, type: "compare", result: runner.compare(req) };
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

  it("dossier PDF mis en page dans le worker (octets %PDF), repli identique sans worker", async () => {
    const w = fakeWorker();
    const exec = createJobExec(() => w);
    const project = parseProjectText(j4Text);
    const bytes = await exec.pdf(project);
    expect(w.received.map((r) => r.type)).toEqual(["pdf"]);
    expect(exec.usesWorker).toBe(true);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    const local = await createJobExec(() => null).pdf(project);
    expect(new TextDecoder().decode(local.subarray(0, 5))).toBe("%PDF-");
  }, 60_000);

  it("échec de l'export PDF : rejet avec le message, le worker reste utilisé", async () => {
    // Worker dont `exportPdf` lève : l'échec est celui de l'export, pas une panne du worker.
    const failing = createJobRunner({
      loadPdf: async () => () => {
        throw new Error("rendu impossible");
      },
    });
    const w = fakeWorker();
    w.postMessage = (message) => {
      const req = structuredClone(message);
      w.received.push(req);
      if (req.type !== "pdf") return;
      void failing
        .pdf(req)
        .then((result) =>
          w.onmessage?.({ data: structuredClone({ id: req.id, type: "pdf" as const, result }) }),
        );
    };
    const exec = createJobExec(() => w);
    await expect(exec.pdf(createProject("straight"))).rejects.toThrow("rendu impossible");
    expect(exec.usesWorker).toBe(true);
    expect(w.terminated).toBe(false);
  });
});

describe("export glTF par le worker de calcul", () => {
  it("dans le worker, repli identique sans worker", async () => {
    const w = fakeWorker();
    const exec = createJobExec(() => w);
    const project = parseProjectText(j4Text);
    const bytes = await exec.glb(project);
    expect(w.received.map((r) => r.type)).toEqual(["glb"]);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("glTF");
    const local = await createJobExec(() => null).glb(project);
    expect(local.byteLength).toBe(bytes.byteLength);
  }, 60_000);
});
