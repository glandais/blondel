import { textMessage, translatorFor } from "@blondel/i18n";
import type { Frame3, Part } from "@blondel/core";
import { meshPart } from "@blondel/geometry";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readGlb } from "../testing/glb-reader.js";
import { sampleParts, sampleProject, woodStringerPart } from "../testing/fixtures.js";
import {
  GL_UNSIGNED_INT,
  GL_UNSIGNED_SHORT,
  GLB_CHUNK_BIN,
  GLB_CHUNK_JSON,
  GLB_MAGIC,
  buildGltf,
  exportGlb,
  packGlb,
} from "./glb.js";
import { hexToLinear, srgbToLinear } from "./materials.js";

const frameAt = (x: number, y: number, z: number): Frame3 => ({
  origin: { x, y, z },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
});

/** Pavé extrudé de `w × d × h` mm au point (x, y, z). */
function boxPart(
  i: number,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
): Part {
  const outer = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  return {
    id: `box-${i}`,
    mark: `B${i}`,
    category: "tread",
    name: textMessage(`Pavé ${i}`),
    material: i % 2 === 0 ? "wood-oak" : "steel-painted",
    solid: { kind: "extrusion", frame: frameAt(x, y, z), profile: { outer, holes: [] }, depth: h },
    quantities: { volume: (w * d * h) / 1e9 },
  };
}

/** Positions monde (mm, Z vers le haut) reconstruites à partir du nœud et de l'accesseur. */
function worldPositions(
  read: ReturnType<typeof readGlb>,
  nodeIndex: number,
): { x: number; y: number; z: number }[] {
  const node = read.doc.nodes[nodeIndex]!;
  const prim = read.doc.meshes![node.mesh!]!.primitives[0]!;
  const p = read.accessorData[prim.attributes.POSITION]!;
  const t = node.translation ?? [0, 0, 0];
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const gx = p[i]! + t[0]!;
    const gy = p[i + 1]! + t[1]!;
    const gz = p[i + 2]! + t[2]!;
    out.push({ x: gx * 1000, y: -gz * 1000, z: gy * 1000 });
  }
  return out;
}

describe("exportGlb", () => {
  const project = sampleProject();
  const parts = [...sampleParts(), woodStringerPart()];
  const bytes = exportGlb({ parts }, { project });
  const read = readGlb(bytes);

  it("conteneur : en-tête, blocs JSON puis BIN alignés sur 4 octets", () => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(GLB_MAGIC);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("glTF");
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(bytes.length);
    const jsonLen = dv.getUint32(12, true);
    expect(jsonLen % 4).toBe(0);
    expect(dv.getUint32(16, true)).toBe(GLB_CHUNK_JSON);
    expect(dv.getUint32(20 + jsonLen + 4, true)).toBe(GLB_CHUNK_BIN);
    expect(bytes.length % 4).toBe(0);
    for (const v of read.doc.bufferViews!) expect(v.byteOffset % 4).toBe(0);
  });

  it("un nœud par pièce nommé par son repère, métadonnées en extras", () => {
    const root = read.doc.nodes[read.doc.scenes[0]!.nodes[0]!]!;
    expect(root.name).toBe(project.name);
    expect(root.children).toHaveLength(parts.length);
    const children = root.children!.map((i) => read.doc.nodes[i]!);
    expect(children.map((n) => n.name)).toEqual(parts.map((p) => p.mark));
    for (const [k, n] of children.entries()) {
      const p = parts[k]!;
      expect(n.extras).toMatchObject({
        id: p.id,
        mark: p.mark,
        category: p.category,
        name: translatorFor("fr").t(p.name),
        material: p.material,
      });
      expect(n.mesh).toBeDefined();
    }
    const tread = children.find((n) => n.extras?.["id"] === "tread-2")!;
    expect(tread.extras).toMatchObject({
      section: "40×300",
      stockMm: { length: 950, width: 300, thickness: 45 },
      quantities: { mass: 7.06 },
      flatThicknessMm: 40,
    });
  });

  it("matériaux PBR metallicRoughness : un par matériau utilisé, couleur linéaire", () => {
    const used = [...new Set(parts.map((p) => p.material))];
    expect(read.doc.materials!.map((m) => m.name).sort()).toEqual(used.sort());
    const oak = read.doc.materials!.find((m) => m.name === "wood-oak")!;
    const [r, g, b] = hexToLinear("#b8895a");
    expect(oak.pbrMetallicRoughness.baseColorFactor[0]).toBeCloseTo(r, 5);
    expect(oak.pbrMetallicRoughness.baseColorFactor[1]).toBeCloseTo(g, 5);
    expect(oak.pbrMetallicRoughness.baseColorFactor[2]).toBeCloseTo(b, 5);
    expect(oak.pbrMetallicRoughness.baseColorFactor[3]).toBe(1);
    expect(oak.pbrMetallicRoughness.metallicFactor).toBe(0);
    const steel = read.doc.materials!.find((m) => m.name === "steel-painted")!;
    expect(steel.pbrMetallicRoughness.metallicFactor).toBeGreaterThan(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0)).toBe(0);
  });

  it("relecture : mêmes triangles, sommets au mm près dans le repère d'origine", () => {
    const root = read.doc.nodes[0]!;
    root.children!.forEach((ni, k) => {
      const part = parts[k]!;
      const mesh = meshPart(part).mesh;
      const prim = read.doc.meshes![read.doc.nodes[ni]!.mesh!]!.primitives[0]!;
      const idx = read.accessorData[prim.indices]!;
      expect(Array.from(idx)).toEqual(Array.from(mesh.indices));
      expect(read.doc.accessors![prim.indices]!.componentType).toBe(GL_UNSIGNED_SHORT);
      const world = worldPositions(read, ni);
      expect(world).toHaveLength(mesh.positions.length / 3);
      world.forEach((p, i) => {
        expect(Math.abs(p.x - mesh.positions[3 * i]!)).toBeLessThan(1e-3);
        expect(Math.abs(p.y - mesh.positions[3 * i + 1]!)).toBeLessThan(1e-3);
        expect(Math.abs(p.z - mesh.positions[3 * i + 2]!)).toBeLessThan(1e-3);
      });
    });
  });

  it("pièce à 8 m de l'origine : sommets exacts au 1e-5 mm (repère local, pas de float32 monde)", () => {
    // Près de 8 000 mm, le float32 monde a un pas de 4,9e-4 mm (erreur jusqu'à 2,4e-4 mm).
    const x0 = 7999.8765;
    const y0 = -7999.4321;
    const z0 = 2999.1234;
    const box = boxPart(0, x0, y0, z0, 0.3, 0.2, 0.1);
    const r = readGlb(exportGlb({ parts: [box] }));
    const world = worldPositions(r, 1);
    const near = (v: number, targets: number[]): number =>
      Math.min(...targets.map((t) => Math.abs(v - t)));
    let worst = 0;
    for (const p of world) {
      worst = Math.max(
        worst,
        near(p.x, [x0, x0 + 0.3]),
        near(p.y, [y0, y0 + 0.2]),
        near(p.z, [z0, z0 + 0.1]),
      );
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("déterministe ; solide partagé = maillage partagé", () => {
    expect(exportGlb({ parts }, { project })).toEqual(bytes);
    const a = boxPart(0, 0, 0, 0, 100, 100, 10);
    const b = { ...a, id: "box-copy", mark: "B0" };
    const r = readGlb(exportGlb({ parts: [a, b] }));
    expect(r.doc.meshes).toHaveLength(1);
    expect(r.doc.nodes[1]!.mesh).toBe(r.doc.nodes[2]!.mesh);
  });

  it("même solide, matériaux différents : deux maillages, chacun avec son matériau", () => {
    const a = boxPart(0, 0, 0, 0, 100, 100, 10);
    const b: Part = { ...a, id: "box-steel", mark: "B9", material: "steel-painted" };
    const r = readGlb(exportGlb({ parts: [a, b] }));
    const matOf = (node: number): string =>
      r.doc.materials![r.doc.meshes![r.doc.nodes[node]!.mesh!]!.primitives[0]!.material]!.name;
    expect(matOf(1)).toBe("wood-oak");
    expect(matOf(2)).toBe("steel-painted");
  });

  it("pièce non maillable : nœud conservé sans maillage, erreur en extras", () => {
    const bad: Part = {
      ...boxPart(1, 0, 0, 0, 100, 100, 10),
      solid: { kind: "sweep", path: [{ x: 0, y: 0, z: 0 }], section: { outer: [], holes: [] } },
    };
    const r = readGlb(exportGlb({ parts: [bad, boxPart(2, 0, 0, 0, 10, 10, 10)] }));
    expect(r.doc.nodes[1]!.mesh).toBeUndefined();
    expect(typeof r.doc.nodes[1]!.extras?.["meshError"]).toBe("string");
    expect(r.doc.nodes[2]!.mesh).toBe(0);
  });

  it("modèle vide : GLB valide sans bloc BIN", () => {
    const empty = exportGlb({ parts: [] }, { title: "Vide" });
    const r = readGlb(empty);
    expect(r.doc.nodes).toEqual([{ name: "Vide" }]);
    expect(r.doc.buffers).toBeUndefined();
    expect(r.bin.length).toBe(0);
  });

  it("indices 32 bits au-delà de 65 535 sommets", () => {
    const n = 70_000;
    const positions = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) positions.set([i, i % 7, (i * 13) % 11], 3 * i);
    const normals = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) normals.set([0, 0, 1], 3 * i);
    const indices = Uint32Array.from([0, 1, n - 1]);
    // Document construit à la main sur le même format que `buildGltf`.
    const { doc } = buildGltf({ parts: [] });
    const bytes2 = packGlb(
      {
        ...doc,
        nodes: [{ name: "x", mesh: 0 }],
        scenes: [{ name: "x", nodes: [0] }],
        materials: [
          {
            name: "m",
            pbrMetallicRoughness: {
              baseColorFactor: [1, 1, 1, 1],
              metallicFactor: 0,
              roughnessFactor: 1,
            },
          },
        ],
        meshes: [
          {
            name: "x",
            primitives: [
              { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 },
            ],
          },
        ],
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: n,
            type: "VEC3",
            min: [0, 0, 0],
            max: [n - 1, 6, 10],
          },
          { bufferView: 1, componentType: 5126, count: n, type: "VEC3" },
          { bufferView: 2, componentType: GL_UNSIGNED_INT, count: 3, type: "SCALAR" },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 12 * n, target: 34962 },
          { buffer: 0, byteOffset: 12 * n, byteLength: 12 * n, target: 34962 },
          { buffer: 0, byteOffset: 24 * n, byteLength: 12, target: 34963 },
        ],
        buffers: [{ byteLength: 24 * n + 12 }],
      },
      (() => {
        const b = new Uint8Array(24 * n + 12);
        b.set(new Uint8Array(positions.buffer), 0);
        b.set(new Uint8Array(normals.buffer), 12 * n);
        b.set(new Uint8Array(indices.buffer), 24 * n);
        return b;
      })(),
    );
    expect(Array.from(readGlb(bytes2).accessorData[2]!)).toEqual([0, 1, n - 1]);
  });

  it("le validateur de test refuse un conteneur corrompu", () => {
    const bad = bytes.slice();
    new DataView(bad.buffer).setUint32(8, bad.length + 4, true);
    expect(() => readGlb(bad)).toThrow(/longueur/);
    const bad2 = bytes.slice();
    new DataView(bad2.buffer).setUint32(0, 0, true);
    expect(() => readGlb(bad2)).toThrow(/signature/);
  });

  it("propriété : pavés quelconques, relus au dixième de mm, boîtes englobantes exactes", () => {
    const coord = fc.double({ min: -8000, max: 8000, noNaN: true });
    const size = fc.double({ min: 1, max: 3000, noNaN: true });
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(coord, coord, fc.double({ min: 0, max: 4000, noNaN: true }), size, size, size),
          {
            minLength: 1,
            maxLength: 6,
          },
        ),
        (boxes) => {
          const ps = boxes.map(([x, y, z, w, d, h], i) => boxPart(i, x, y, z, w, d, h));
          const r = readGlb(exportGlb({ parts: ps }));
          expect(r.doc.nodes[0]!.children).toHaveLength(ps.length);
          ps.forEach((p, k) => {
            const [x, y, z, w, d, h] = boxes[k]!;
            const pts = worldPositions(r, r.doc.nodes[0]!.children![k]!);
            const tol = 0.1 + 1e-6 * 8000;
            expect(Math.min(...pts.map((q) => q.x))).toBeCloseTo(x, 0);
            expect(Math.abs(Math.max(...pts.map((q) => q.x)) - (x + w))).toBeLessThan(tol);
            expect(Math.abs(Math.max(...pts.map((q) => q.y)) - (y + d))).toBeLessThan(tol);
            expect(Math.abs(Math.min(...pts.map((q) => q.z)) - z)).toBeLessThan(tol);
            expect(Math.abs(Math.max(...pts.map((q) => q.z)) - (z + h))).toBeLessThan(tol);
            expect(p.mark).toBe(r.doc.nodes[r.doc.nodes[0]!.children![k]!]!.name);
          });
        },
      ),
      { numRuns: 40 },
    );
  });

  it("composantes (`componentOf`, couches empilées) hors de la scène, pièce finie présente", () => {
    const beam = { ...boxPart(0, 0, 0, 0, 100, 100, 80), id: "beam", mark: "LC1" };
    const layer = (k: number): Part => ({
      ...boxPart(k, 0, 0, (k - 1) * 40, 100, 100, 40),
      id: `beam-layer-${k}`,
      mark: `LC1-${k}`,
      componentOf: "beam",
    });
    for (const locale of ["fr", "en"] as const) {
      const { doc } = buildGltf({ parts: [beam, layer(1), layer(2)] }, { locale });
      const names = doc.nodes.slice(1).map((n) => n.name);
      expect(names).toEqual(["LC1"]);
      expect(doc.nodes[0]!.children).toHaveLength(1);
    }
    // Filtre de l'appelant appliqué en plus : jamais de composante.
    const { doc } = buildGltf(
      { parts: [beam, layer(1)] },
      { filter: (p) => p.mark.startsWith("LC1") },
    );
    expect(doc.nodes.slice(1).map((n) => n.name)).toEqual(["LC1"]);
  });

  it("composantes imbriquées (A36 (9)) : ni couche ni planche dans la scène, LC1 seule", () => {
    const beam = { ...boxPart(0, 0, 0, 0, 100, 100, 80), id: "beam", mark: "LC1" };
    const layer: Part = {
      ...boxPart(1, 0, 0, 0, 100, 100, 40),
      id: "beam-layer-1",
      mark: "LC1-1",
      componentOf: "beam",
    };
    const board = (j: number): Part => ({
      ...boxPart(1 + j, (j - 1) * 50, 0, 0, 50, 100, 40),
      id: `beam-layer-1-${j}`,
      mark: `LC1-1.${j}`,
      componentOf: "beam-layer-1",
    });
    const tread = { ...boxPart(9, 0, 200, 0, 100, 100, 40), id: "t1", mark: "M1" };
    const { doc } = buildGltf({ parts: [beam, layer, board(1), board(2), tread] });
    expect(doc.nodes.slice(1).map((n) => n.name)).toEqual(["LC1", "M1"]);
  });
});
