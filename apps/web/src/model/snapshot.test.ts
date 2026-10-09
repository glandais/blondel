/**
 * Pièces de la scène 3D (`sceneParts`) : les composantes (`Part.componentOf`, couches d'une
 * poutre en couches empilées, QUESTIONS A33 (e)) ne sont ni maillées ni dessinées ; la pièce
 * finie l'est. Sans composante, le tableau du modèle est rendu tel quel (identité gardée).
 */
import { buildModel, createProject, type Model, type Part } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { createMeshCache } from "./meshCache.js";
import { computeSnapshot, sceneParts } from "./snapshot.js";

describe("sceneParts", () => {
  const model = buildModel(createProject("straight"));

  it("sans composante : même tableau", () => {
    expect(sceneParts(model.parts)).toBe(model.parts);
  });

  it("composantes exclues, pièce finie et autres pièces gardées", () => {
    const host = model.parts[0]!;
    const layers: Part[] = [1, 2].map((k) => ({
      ...host,
      id: `${host.id}-layer-${k}`,
      mark: `${host.mark}-${k}`,
      componentOf: host.id,
    }));
    const parts = [...model.parts, ...layers];
    const shown = sceneParts(parts);
    expect(shown.map((p) => p.id)).toEqual(model.parts.map((p) => p.id));
  });

  it("composantes imbriquées (A36 (9)) : ni couche composée ni planche, la pièce racine seule", () => {
    const host = model.parts[0]!;
    const layer: Part = { ...host, id: "layer-1", mark: "X-1", componentOf: host.id };
    const boards: Part[] = [1, 2].map((j) => ({
      ...host,
      id: `layer-1-${j}`,
      mark: `X-1.${j}`,
      componentOf: "layer-1",
    }));
    const shown = sceneParts([...model.parts, layer, ...boards]);
    expect(shown.map((p) => p.id)).toEqual(model.parts.map((p) => p.id));
  });

  it("instantané : aucun maillage de composante", () => {
    const host = model.parts[0]!;
    const layer: Part = { ...host, id: "layer-1", mark: "X-1", componentOf: host.id };
    const withLayer: Model = { ...model, parts: [...model.parts, layer] };
    const snap = computeSnapshot(createProject("straight"), createMeshCache(), () => withLayer);
    expect(snap.mesh?.parts.map((p) => p.mesh.partId)).toEqual(model.parts.map((p) => p.id));
  });
});
