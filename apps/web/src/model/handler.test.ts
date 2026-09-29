/**
 * Traitement des requêtes du worker (`handleWorkerRequest`) : chaque requête reçoit une réponse,
 * même quand `postMessage` échoue (sinon le client attendrait pour toujours), et conversion des
 * contenus PDF en octets (`toBytes`).
 */
import { createProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { createJobRunner, handleWorkerRequest, toBytes, type JobRunner } from "./handler.js";
import type { WorkerResponse } from "./protocol.js";

const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]);

function runnerWith(content: unknown): JobRunner {
  return createJobRunner({ loadPdf: async () => () => content as Uint8Array });
}

/** Réponses postées (attend la fin des traitements asynchrones). */
async function responses(
  runner: JobRunner,
  type: "build" | "pdf",
  post?: (m: WorkerResponse, t: Transferable[]) => void,
): Promise<{ message: WorkerResponse; transfer: Transferable[] }[]> {
  const out: { message: WorkerResponse; transfer: Transferable[] }[] = [];
  handleWorkerRequest(runner, { id: 7, type, project: createProject("straight") }, (m, t) => {
    out.push({ message: m, transfer: t });
    post?.(m, t);
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return out;
}

describe("traitement des requêtes du worker", () => {
  it("PDF : octets transférés (tampon listé), identifiant conservé", async () => {
    const out = await responses(runnerWith(pdfBytes), "pdf");
    expect(out).toHaveLength(1);
    const { message, transfer } = out[0]!;
    expect(message).toMatchObject({ id: 7, type: "pdf", result: { bytes: pdfBytes } });
    expect(transfer).toEqual([pdfBytes.buffer]);
  });

  it("PDF : échec de postMessage (tampon non transférable) → réponse « error », jamais d'attente infinie", async () => {
    let calls = 0;
    const out = await responses(runnerWith(new Uint8Array([1, 2, 3])), "pdf", (m) => {
      calls++;
      if (m.type === "pdf") throw new DOMException("non transférable", "DataCloneError");
    });
    expect(calls).toBe(2);
    expect(out.map((o) => o.message.type)).toEqual(["pdf", "error"]);
    expect(out[1]!.message).toMatchObject({ id: 7, message: "non transférable" });
  });

  it("modèle : échec de postMessage (sortie non clonable) → réponse « error »", async () => {
    const out = await responses(createJobRunner(), "build", (m) => {
      if (m.type === "build") throw new Error("clonage impossible");
    });
    expect(out.map((o) => o.message.type)).toEqual(["build", "error"]);
  });

  it("PDF rendu en Blob, texte ou tampon : octets équivalents", async () => {
    expect(await toBytes(new Blob([pdfBytes]))).toEqual(pdfBytes);
    expect(await toBytes(pdfBytes.buffer)).toEqual(pdfBytes);
    expect(await toBytes("%PDF-")).toEqual(pdfBytes);
    const out = await responses(runnerWith(new Blob([pdfBytes])), "pdf");
    expect(out[0]!.message).toMatchObject({ type: "pdf", result: { bytes: pdfBytes } });
    await expect(toBytes(42)).rejects.toThrow("Contenu PDF inattendu");
  });
});

describe("exports du worker : glTF et options du dossier PDF", () => {
  it("glTF : octets GLB transférés, en-tête « glTF » version 2", async () => {
    const out: { message: WorkerResponse; transfer: Transferable[] }[] = [];
    handleWorkerRequest(
      createJobRunner(),
      { id: 3, type: "glb", project: createProject("quarter-left") },
      (m, t) => out.push({ message: m, transfer: t }),
    );
    expect(out).toHaveLength(1);
    const { message, transfer } = out[0]!;
    expect(message.type).toBe("glb");
    if (message.type !== "glb" || !("bytes" in message.result)) throw new Error("glb attendu");
    const bytes = message.result.bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(bytes.byteLength);
    expect(transfer).toEqual([bytes.buffer]);
  });

  it("glTF : projet sans modèle → erreur rendue, jamais d'exception", () => {
    const p = createProject("straight");
    const bad = { ...p, site: { ...p.site, floorToFloor: 10 } };
    const r = createJobRunner().glb({ type: "glb", project: bad });
    expect("error" in r || "bytes" in r).toBe(true);
  });

  it("PDF : pages et format transmis à l'export", async () => {
    const seen: unknown[] = [];
    const runner = createJobRunner({
      loadPdf: async () => (_m, o) => {
        seen.push(o);
        return pdfBytes;
      },
    });
    const opts = { pages: { templates: false, toc: false }, format: "a3" as const };
    await runner.pdf({ type: "pdf", project: createProject("straight"), options: opts });
    expect(seen[0]).toMatchObject({ pages: opts.pages, format: "a3" });
    await runner.pdf({ type: "pdf", project: createProject("straight") });
    expect(seen[1]).not.toHaveProperty("pages");
    expect(seen[1]).not.toHaveProperty("format");
  });
});
