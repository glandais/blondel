/**
 * Lecteur et validateur GLB minimal pour les tests (glTF 2.0 §4.4 et §3.6-3.7) : en-tête,
 * blocs JSON puis BIN alignés sur 4 octets, vues et accesseurs dans leurs bornes et alignés,
 * indices dans le nombre de sommets, `min` / `max` exacts, normales unitaires, références
 * valides, hiérarchie de nœuds en arbre. Lève une `Error` explicite à la première anomalie.
 */
import {
  GL_ELEMENT_ARRAY_BUFFER,
  GL_FLOAT,
  GL_UNSIGNED_INT,
  GL_UNSIGNED_SHORT,
  GLB_CHUNK_BIN,
  GLB_CHUNK_JSON,
  GLB_MAGIC,
  type GltfDocument,
} from "../gltf/glb.js";

export interface ReadGlb {
  readonly doc: GltfDocument;
  readonly bin: Uint8Array;
  /** Données de chaque accesseur (Float32Array, Uint16Array ou Uint32Array). */
  readonly accessorData: (Float32Array | Uint16Array | Uint32Array)[];
}

const COMPONENT_SIZE: Record<number, number> = {
  [GL_FLOAT]: 4,
  [GL_UNSIGNED_SHORT]: 2,
  [GL_UNSIGNED_INT]: 4,
};
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC3: 3 };

function fail(msg: string): never {
  throw new Error(`GLB invalide : ${msg}`);
}

export function readGlb(bytes: Uint8Array): ReadGlb {
  if (bytes.length < 20) fail("fichier trop court");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) fail("signature « glTF » absente");
  if (dv.getUint32(4, true) !== 2) fail("version de conteneur ≠ 2");
  if (dv.getUint32(8, true) !== bytes.length) fail("longueur d'en-tête ≠ taille du fichier");
  if (bytes.length % 4 !== 0) fail("taille non multiple de 4");
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== GLB_CHUNK_JSON) fail("premier bloc ≠ JSON");
  if (jsonLen % 4 !== 0) fail("bloc JSON non aligné");
  if (20 + jsonLen > bytes.length) fail("bloc JSON hors du fichier");
  const doc = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLen)),
  ) as GltfDocument;
  let bin: Uint8Array = new Uint8Array(0);
  const o = 20 + jsonLen;
  if (o < bytes.length) {
    const binLen = dv.getUint32(o, true);
    if (dv.getUint32(o + 4, true) !== GLB_CHUNK_BIN) fail("second bloc ≠ BIN");
    if (binLen % 4 !== 0) fail("bloc BIN non aligné");
    if (o + 8 + binLen !== bytes.length) fail("bloc BIN : longueur incohérente");
    bin = bytes.subarray(o + 8, o + 8 + binLen);
  }

  if (doc.asset?.version !== "2.0") fail("asset.version ≠ 2.0");
  const buffers = doc.buffers ?? [];
  if (buffers.length > 1) fail("plus d'un tampon");
  if (buffers.length === 1) {
    const bl = buffers[0]!.byteLength;
    if (bl > bin.length || bin.length - bl > 3) fail("buffers[0].byteLength ≠ bloc BIN");
  } else if (bin.length > 0) fail("bloc BIN sans tampon déclaré");

  const views = doc.bufferViews ?? [];
  for (const [i, v] of views.entries()) {
    if (v.buffer !== 0) fail(`bufferView ${i} : tampon inconnu`);
    if (v.byteOffset % 4 !== 0) fail(`bufferView ${i} non alignée sur 4 octets`);
    if (v.byteLength <= 0) fail(`bufferView ${i} vide`);
    if (v.byteOffset + v.byteLength > (buffers[0]?.byteLength ?? 0)) {
      fail(`bufferView ${i} hors du tampon`);
    }
  }

  const accessorData: (Float32Array | Uint16Array | Uint32Array)[] = [];
  for (const [i, a] of (doc.accessors ?? []).entries()) {
    const v = views[a.bufferView] ?? fail(`accesseur ${i} : vue inconnue`);
    const cs = COMPONENT_SIZE[a.componentType] ?? fail(`accesseur ${i} : type inconnu`);
    const nc = TYPE_COUNT[a.type] ?? fail(`accesseur ${i} : type ${a.type}`);
    const off = a.byteOffset ?? 0;
    if ((v.byteOffset + off) % cs !== 0) fail(`accesseur ${i} non aligné`);
    const len = a.count * nc * cs;
    if (a.count <= 0) fail(`accesseur ${i} vide`);
    if (off + len > v.byteLength) fail(`accesseur ${i} hors de sa vue`);
    const start = bin.byteOffset + v.byteOffset + off;
    // Copie (le bloc BIN du fichier n'a pas d'alignement garanti dans `bytes.buffer`).
    const raw = bin.buffer.slice(start, start + len);
    const data =
      a.componentType === GL_FLOAT
        ? new Float32Array(raw)
        : a.componentType === GL_UNSIGNED_SHORT
          ? new Uint16Array(raw)
          : new Uint32Array(raw);
    for (const x of data) if (!Number.isFinite(x)) fail(`accesseur ${i} : valeur non finie`);
    if (a.min !== undefined || a.max !== undefined) {
      for (let k = 0; k < nc; k++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = k; j < data.length; j += nc) {
          lo = Math.min(lo, data[j]!);
          hi = Math.max(hi, data[j]!);
        }
        if (a.min?.[k] !== lo || a.max?.[k] !== hi) fail(`accesseur ${i} : min / max inexacts`);
      }
    }
    accessorData.push(data);
  }

  const materials = doc.materials ?? [];
  for (const [mi, m] of (doc.meshes ?? []).entries()) {
    for (const p of m.primitives) {
      const pos = doc.accessors![p.attributes.POSITION] ?? fail(`maillage ${mi} : POSITION`);
      const nor = doc.accessors![p.attributes.NORMAL] ?? fail(`maillage ${mi} : NORMAL`);
      const idx = doc.accessors![p.indices] ?? fail(`maillage ${mi} : indices`);
      if (pos.type !== "VEC3" || pos.componentType !== GL_FLOAT) fail(`maillage ${mi} : POSITION`);
      if (pos.min === undefined || pos.max === undefined) fail(`maillage ${mi} : min/max absents`);
      if (nor.count !== pos.count) fail(`maillage ${mi} : normales ≠ sommets`);
      if (idx.type !== "SCALAR" || idx.count % 3 !== 0) fail(`maillage ${mi} : indices`);
      if (doc.bufferViews![idx.bufferView]!.target !== GL_ELEMENT_ARRAY_BUFFER) {
        fail(`maillage ${mi} : vue d'indices sans cible ELEMENT_ARRAY_BUFFER`);
      }
      for (const j of accessorData[p.indices]!) {
        if (j >= pos.count) fail(`maillage ${mi} : indice ${j} ≥ ${pos.count}`);
        // glTF 2.0 §3.7.2.1 : la valeur maximale du type (redémarrage de primitive) est interdite.
        const restart = idx.componentType === GL_UNSIGNED_SHORT ? 0xffff : 0xffffffff;
        if (j === restart) fail(`maillage ${mi} : indice ${j} réservé`);
      }
      const n = accessorData[p.attributes.NORMAL]!;
      for (let j = 0; j < n.length; j += 3) {
        const l = Math.hypot(n[j]!, n[j + 1]!, n[j + 2]!);
        if (Math.abs(l - 1) > 1e-3) fail(`maillage ${mi} : normale non unitaire`);
      }
      if (materials[p.material] === undefined) fail(`maillage ${mi} : matériau inconnu`);
    }
  }

  // Hiérarchie : chaque nœud a au plus un parent, les racines de scène n'en ont pas.
  const parent = new Map<number, number>();
  for (const [i, node] of doc.nodes.entries()) {
    if (node.mesh !== undefined && doc.meshes?.[node.mesh] === undefined) {
      fail(`nœud ${i} : maillage inconnu`);
    }
    for (const c of node.children ?? []) {
      if (doc.nodes[c] === undefined) fail(`nœud ${i} : enfant inconnu`);
      if (parent.has(c)) fail(`nœud ${c} : plusieurs parents`);
      parent.set(c, i);
    }
  }
  for (const s of doc.scenes) {
    for (const r of s.nodes) if (parent.has(r)) fail(`racine ${r} de scène avec parent`);
  }
  return { doc, bin, accessorData };
}
