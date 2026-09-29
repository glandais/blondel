import { createProject, type AssistantInput } from "@blondel/core";
import { describe, expect, it, vi } from "vitest";
import { runAssistantJob, type AssistantOutcome } from "./assistantJob.js";
import { AssistantCancelled, startAssistant, type AssistantWorkerLike } from "./assistantClient.js";

const site = createProject("straight").site;
const input: AssistantInput = {
  site: { ...site, opening: { kind: "rect", x: 0, y: 0, sizeX: 2800, sizeY: 900 } },
  preferences: { typologies: ["quarter"] },
  limits: { timeBudgetMs: Number.POSITIVE_INFINITY },
};

const EMPTY: AssistantOutcome = {
  result: {
    candidates: [],
    diagnostics: ["vide"],
    rejections: [],
    stats: { enumerated: 0, built: 0, elapsedMs: 0, stopped: false, truncated: false },
  },
  sketches: {},
  timeMs: 0,
};

function fakeWorker(): AssistantWorkerLike & { posted: unknown[]; terminated: boolean } {
  const w = {
    posted: [] as unknown[],
    terminated: false,
    onmessage: null as AssistantWorkerLike["onmessage"],
    onerror: null as AssistantWorkerLike["onerror"],
    postMessage(m: unknown) {
      this.posted.push(m);
    },
    terminate() {
      this.terminated = true;
    },
  };
  return w;
}

describe("calcul de l'assistant", () => {
  it("rend des candidats avec leur croquis, clonables", () => {
    const o = runAssistantJob(input);
    expect(o.result.candidates.length).toBeGreaterThan(0);
    for (const c of o.result.candidates) expect(o.sketches[c.id]).toBeDefined();
    expect(() => structuredClone(o)).not.toThrow();
  });

  it("ne lève jamais : erreur rendue en diagnostic", () => {
    const o = runAssistantJob({ site: null } as unknown as AssistantInput);
    expect(o.result.candidates).toEqual([]);
    expect(o.result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("client de l'assistant", () => {
  it("worker : envoie l'entrée, résout avec la réponse et termine le worker", async () => {
    const w = fakeWorker();
    const run = startAssistant(input, { factory: () => w });
    expect(run.usesWorker).toBe(true);
    expect(w.posted).toEqual([{ input }]);
    w.onmessage?.({ data: { outcome: EMPTY } });
    await expect(run.promise).resolves.toBe(EMPTY);
    expect(w.terminated).toBe(true);
  });

  it("annulation : worker terminé, promesse rejetée, réponse tardive ignorée", async () => {
    const w = fakeWorker();
    const run = startAssistant(input, { factory: () => w });
    run.cancel();
    expect(w.terminated).toBe(true);
    await expect(run.promise).rejects.toBeInstanceOf(AssistantCancelled);
    w.onmessage?.({ data: { outcome: EMPTY } });
  });

  it("erreur du worker : repli sur le fil principal", async () => {
    const w = fakeWorker();
    const local = vi.fn(() => EMPTY);
    const run = startAssistant(input, { factory: () => w, local });
    w.onerror?.(new Error("chargement impossible"));
    await expect(run.promise).resolves.toBe(EMPTY);
    expect(local).toHaveBeenCalledWith(input);
  });

  it("sans worker : fil principal, annulation qui écarte le résultat", async () => {
    const local = vi.fn(() => EMPTY);
    const a = startAssistant(input, { factory: () => null, local });
    expect(a.usesWorker).toBe(false);
    await expect(a.promise).resolves.toBe(EMPTY);
    const b = startAssistant(input, { factory: () => null, local });
    b.cancel();
    await expect(b.promise).rejects.toBeInstanceOf(AssistantCancelled);
  });

  it("réponse d'erreur du worker : promesse rejetée avec le message", async () => {
    const w = fakeWorker();
    const run = startAssistant(input, { factory: () => w });
    w.onmessage?.({ data: { error: "boum" } });
    await expect(run.promise).rejects.toThrow("boum");
  });
});
