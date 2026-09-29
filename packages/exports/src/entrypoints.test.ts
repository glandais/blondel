import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as main from "./index.js";
import * as pdf from "./pdf/index.js";

const SRC = dirname(fileURLToPath(import.meta.url));

/** Fichiers source (hors tests) importés, transitivement, depuis `entry`. */
function moduleGraph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = readFileSync(entry, "utf8");
  for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]+)\.js"/g)) {
    moduleGraph(join(dirname(entry), `${m[1]!}.ts`), seen);
  }
  return seen;
}

describe("points d'entrée", () => {
  it("le dossier PDF n'est exposé que par @blondel/exports/pdf", () => {
    expect(typeof pdf.exportPdf).toBe("function");
    expect("exportPdf" in main).toBe(false);
    expect("JsPdfCanvas" in main).toBe(false);
  });

  it("l'index principal n'importe jamais jsPDF, même indirectement", () => {
    const graph = moduleGraph(join(SRC, "index.ts"));
    expect(graph.size).toBeGreaterThan(5);
    for (const f of graph) expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+"jspdf"/);
    // Garde-fou du test lui-même : le point d'entrée PDF, lui, l'importe.
    const pdfGraph = [...moduleGraph(join(SRC, "pdf", "index.ts"))];
    expect(pdfGraph.some((f) => /from\s+"jspdf"/.test(readFileSync(f, "utf8")))).toBe(true);
    expect(readdirSync(join(SRC, "pdf"))).toContain("canvas.ts");
  });
});
