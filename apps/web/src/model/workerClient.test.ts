/**
 * Client du worker de calcul : routage des réponses, clonage réel des messages
 * (`structuredClone`, comme `postMessage`), repli sur le fil principal.
 */
import { translatorFor } from "@blondel/i18n";
import { clearModelCache, createProject, parseProjectText } from "@blondel/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import j4Text from "../../../../examples/j4-acceptance-01-garde-corps.blondel.json?raw";
import { createJobRunner } from "./handler.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";
import {
  DEFAULT_WATCHDOG_MS,
  WatchdogTimeoutError,
  createJobExec,
  type WorkerLike,
} from "./workerClient.js";

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

describe("chien de garde du calcul (QUESTIONS A21)", () => {
  /** Worker piloté à la main : répond seulement sur `answer()`, ou jamais. */
  function manualWorker() {
    const runner = createJobRunner();
    const w: WorkerLike & {
      received: WorkerRequest[];
      terminated: boolean;
      answer: () => void;
      answerPdf: () => void;
    } = {
      received: [],
      terminated: false,
      onmessage: null,
      onerror: null,
      postMessage(message) {
        w.received.push(structuredClone(message));
      },
      terminate() {
        w.terminated = true;
      },
      answer() {
        for (const req of w.received.splice(0)) {
          if (req.type !== "build") continue;
          w.onmessage?.({ data: { id: req.id, type: "build", result: runner.build(req) } });
        }
      },
      answerPdf() {
        const i = w.received.findIndex((r) => r.type === "pdf");
        if (i < 0) return;
        const [req] = w.received.splice(i, 1);
        w.onmessage?.({ data: { id: req!.id, type: "pdf", result: { bytes: new Uint8Array(1) } } });
      },
    };
    return w;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("délai dépassé : worker terminé, recréé, demande relancée et servie", async () => {
    vi.useFakeTimers();
    const workers: ReturnType<typeof manualWorker>[] = [];
    const exec = createJobExec(() => {
      const w = manualWorker();
      workers.push(w);
      return w;
    });
    const p = exec.build(createProject("straight")) as Promise<unknown>;
    expect(workers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_WATCHDOG_MS - 1);
    expect(workers[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.received.map((r) => r.type)).toEqual(["build"]);
    // Réponse tardive de l'ancien worker : ignorée ; le nouveau répond.
    workers[1]!.answer();
    const snap = (await p) as { model: unknown };
    expect(snap.model).not.toBeNull();
    expect(exec.restarts).toBe(1);
    expect(exec.usesWorker).toBe(true);
  });

  it("délai dépassé après relance : rejet explicite, jamais de repli sur le fil principal", async () => {
    vi.useFakeTimers();
    let created = 0;
    let fallbackUsed = false;
    const exec = createJobExec(
      () => {
        created++;
        return manualWorker();
      },
      {
        watchdogMs: 1000,
        watchdogRetries: 1,
        fallback: () => {
          fallbackUsed = true;
          return createJobRunner();
        },
      },
    );
    const p = exec.build(createProject("straight")) as Promise<unknown>;
    const settled = p.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const err = await settled;
    expect(err).toBeInstanceOf(WatchdogTimeoutError);
    expect((err as Error).message).toContain("aucune réponse en 1 s");
    expect(translatorFor("en").t((err as WatchdogTimeoutError).msg)).toContain(
      "no response within 1 s",
    );
    expect(created).toBe(2);
    expect(fallbackUsed).toBe(false);
    // Le worker reste utilisé pour les demandes suivantes (un nouveau est créé à la demande).
    expect(exec.usesWorker).toBe(true);
    void exec.build(createProject("straight"));
    expect(created).toBe(3);
  });

  it("autres demandes en cours renvoyées au nouveau worker ; exports non surveillés", async () => {
    vi.useFakeTimers();
    const workers: ReturnType<typeof manualWorker>[] = [];
    const exec = createJobExec(
      () => {
        const w = manualWorker();
        workers.push(w);
        return w;
      },
      { watchdogMs: 500 },
    );
    // Calcul bloqué en tête, puis un export PDF derrière lui.
    void exec.build(createProject("straight"));
    void exec.pdf(createProject("straight")).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(500);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.received.map((r) => r.type)).toEqual(["build", "pdf"]);
  });

  it("export PDF seul : pas de chien de garde", async () => {
    vi.useFakeTimers();
    let created = 0;
    const exec = createJobExec(
      () => {
        created++;
        return manualWorker();
      },
      { watchdogMs: 500 },
    );
    void exec.pdf(createProject("straight")).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(created).toBe(1);
  });

  it("calcul en file derrière un export long : le délai court depuis la fin de l'export", async () => {
    // Revue adverse : le délai était armé à l'envoi ; un calcul demandé pendant un export PDF
    // de plus de 20 s (le worker traite ses messages dans l'ordre) faisait tuer le worker,
    // recommencer l'export, puis rejeter le calcul sans qu'il ait jamais commencé.
    vi.useFakeTimers();
    const workers: ReturnType<typeof manualWorker>[] = [];
    const exec = createJobExec(
      () => {
        const w = manualWorker();
        workers.push(w);
        return w;
      },
      { watchdogMs: 500 },
    );
    const pdf = exec.pdf(createProject("straight"));
    const build = exec.build(createProject("straight")) as Promise<{ model: unknown }>;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(workers).toHaveLength(1);
    expect(exec.restarts).toBe(0);
    workers[0]!.answerPdf();
    expect((await pdf).byteLength).toBe(1);
    // Le calcul a maintenant la tête de file : son délai court à partir d'ici.
    await vi.advanceTimersByTimeAsync(499);
    expect(workers).toHaveLength(1);
    workers[0]!.answer();
    expect((await build).model).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exec.restarts).toBe(0);
  });

  it("calcul en file derrière un export, puis bloqué : worker remplacé après le délai", async () => {
    vi.useFakeTimers();
    const workers: ReturnType<typeof manualWorker>[] = [];
    const exec = createJobExec(
      () => {
        const w = manualWorker();
        workers.push(w);
        return w;
      },
      { watchdogMs: 500 },
    );
    void exec.pdf(createProject("straight"));
    void exec.build(createProject("straight"));
    await vi.advanceTimersByTimeAsync(2_000);
    workers[0]!.answerPdf();
    await vi.advanceTimersByTimeAsync(499);
    expect(workers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.received.map((r) => r.type)).toEqual(["build"]);
  });

  it("délai nul : chien de garde désactivé", async () => {
    vi.useFakeTimers();
    let created = 0;
    const exec = createJobExec(
      () => {
        created++;
        return manualWorker();
      },
      { watchdogMs: 0 },
    );
    void exec.build(createProject("straight"));
    await vi.advanceTimersByTimeAsync(10 * DEFAULT_WATCHDOG_MS);
    expect(created).toBe(1);
    expect(exec.restarts).toBe(0);
  });
});
