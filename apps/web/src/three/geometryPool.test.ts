import { describe, expect, it } from "vitest";
import { GeometryPool, createGeometryPool, geometryKey } from "./geometryPool.js";

class Fake {
  disposed = 0;
  dispose(): void {
    this.disposed++;
  }
}

const mesh = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  indices: new Uint32Array(0),
};

describe("géométries partagées par empreinte", () => {
  it("une géométrie par empreinte, réutilisée", () => {
    let created = 0;
    const pool = new GeometryPool(() => {
      created++;
      return new Fake();
    });
    const a = pool.get("a", mesh);
    expect(pool.get("a", mesh)).toBe(a);
    pool.get("b", mesh);
    expect(created).toBe(2);
  });

  it("retain libère exactement les géométries plus affichées ; disposeAll libère tout", () => {
    const pool = new GeometryPool(() => new Fake());
    const a = pool.get("a", mesh);
    const b = pool.get("b", mesh);
    expect(pool.retain(["a"])).toBe(1);
    expect(a.disposed).toBe(0);
    expect(b.disposed).toBe(1);
    expect(pool.size).toBe(1);
    pool.disposeAll();
    expect(a.disposed).toBe(1);
    expect(pool.size).toBe(0);
  });

  it("clé : empreinte et sens du fil ; UV projetées selon le fil", () => {
    expect(geometryKey("s", undefined)).toBe("s");
    expect(geometryKey("s", { x: 1, y: 0, z: 0 })).not.toBe(geometryKey("s", { x: 0, y: 1, z: 0 }));
    const box = {
      positions: new Float32Array([0, 0, 0, 1000, 0, 0, 0, 100, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const pool = createGeometryPool();
    const g = pool.get("k", box, { x: 1, y: 0, z: 0 });
    const uv = g.getAttribute("uv");
    expect(uv.count).toBe(3);
    expect(uv.getX(1)).toBeCloseTo(1, 6);
    pool.disposeAll();
  });
});
