import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { crc32, createZip } from "./zip.js";

/** Lecteur ZIP minimal (méthode 0) indépendant de l'écrivain, pour les tests. */
function readZip(bytes: Uint8Array): { name: string; data: Uint8Array; flags: number }[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  const size = v.getUint32(eocd + 12, true);
  const start = v.getUint32(eocd + 16, true);
  expect(start + size).toBe(eocd);
  const dec = new TextDecoder("utf-8", { fatal: true });
  const out: { name: string; data: Uint8Array; flags: number }[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const flags = v.getUint16(p + 8, true);
    expect(v.getUint16(p + 10, true)).toBe(0);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true);
    const comment = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    const lname = v.getUint16(off + 26, true);
    const lextra = v.getUint16(off + 28, true);
    expect(dec.decode(bytes.subarray(off + 30, off + 30 + lname))).toBe(name);
    const data = bytes.subarray(off + 30 + lname + lextra, off + 30 + lname + lextra + csize);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data, flags });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

describe("createZip", () => {
  it("CRC-32 de référence", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("archive relue : noms UTF-8, contenus, déterministe", () => {
    const entries = [
      { name: "LI1.dxf", data: "0\nSECTION\n" },
      { name: "Marche é.dxf", data: new Uint8Array([1, 2, 3]) },
    ];
    const zip = createZip(entries);
    expect(createZip(entries)).toEqual(zip);
    const back = readZip(zip);
    expect(back.map((e) => e.name)).toEqual(["LI1.dxf", "Marche é.dxf"]);
    expect(new TextDecoder().decode(back[0]!.data)).toBe("0\nSECTION\n");
    expect([...back[1]!.data]).toEqual([1, 2, 3]);
    expect(back.every((e) => (e.flags & 0x0800) !== 0)).toBe(true);
  });

  it("archive vide valide ; noms en double refusés", () => {
    expect(readZip(createZip([]))).toEqual([]);
    expect(() =>
      createZip([
        { name: "a", data: "" },
        { name: "a", data: "" },
      ]),
    ).toThrow(RangeError);
  });

  it("noms non portables refusés (chemin absolu, lecteur, « .. », antislash)", () => {
    for (const name of ["/etc/passwd", "../x.dxf", "a/../../b", "C:x.dxf", "a\\b.dxf", "\\x"]) {
      expect(() => createZip([{ name, data: "" }]), name).toThrow(RangeError);
    }
    // Sous-dossier relatif et « .. » dans un nom de fichier : acceptés.
    expect(readZip(createZip([{ name: "dxf/a..b.dxf", data: "x" }]))[0]!.name).toBe("dxf/a..b.dxf");
  });

  it("propriété : aller-retour de contenus quelconques", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            name: fc
              .string({ minLength: 1, maxLength: 20 })
              .filter((n) => !/^[/\\]|^[A-Za-z]:|\\/.test(n) && !n.split("/").includes("..")),
            data: fc.uint8Array({ maxLength: 300 }),
          }),
          { selector: (e) => e.name, maxLength: 8 },
        ),
        (entries) => {
          const back = readZip(createZip(entries));
          expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
          back.forEach((e, i) => expect([...e.data]).toEqual([...entries[i]!.data]));
        },
      ),
      { numRuns: 50 },
    );
  });
});
