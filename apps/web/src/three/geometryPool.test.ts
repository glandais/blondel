import { describe, expect, it } from "vitest";
import { GeometryPool } from "./geometryPool.js";

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
});
