/**
 * Archive ZIP minimale, sans dépendance : méthode 0 (« stockée », pas de compression), noms
 * en UTF-8 (bit 11), sans ZIP64 (< 4 Gio, < 65 535 entrées). Suffisante pour regrouper les
 * DXF de pièces (texte de quelques dizaines de Kio) ; lisible par tous les outils (APPNOTE
 * 6.3.x). Déterministe : date fixe par défaut (1980-01-01 00:00, heure locale DOS).
 */

export interface ZipEntry {
  readonly name: string;
  /** Texte (encodé en UTF-8) ou octets. */
  readonly data: string | Uint8Array;
}

export interface ZipOptions {
  /** Date de modification écrite pour chaque entrée (défaut : 1980-01-01 00:00). */
  readonly date?: Date;
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (polynôme 0xEDB88320) d'une suite d'octets. */
export function crc32(bytes: Uint8Array): number {
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date | undefined): { time: number; date: number } {
  if (d === undefined) return { time: 0, date: (0 << 9) | (1 << 5) | 1 };
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Archive ZIP (octets) des entrées données ; noms uniques exigés. */
export function createZip(entries: readonly ZipEntry[], options: ZipOptions = {}): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(options.date);
  const seen = new Set<string>();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  if (entries.length > 0xffff) {
    throw new RangeError(`Trop d'entrées pour une archive ZIP sans ZIP64 : ${entries.length}`);
  }
  for (const e of entries) {
    if (e.name === "" || seen.has(e.name)) {
      throw new RangeError(`Nom d'entrée ZIP vide ou en double : « ${e.name} »`);
    }
    // APPNOTE 4.4.17 : chemin relatif, séparateur « / », sans lecteur ; « .. » refusé
    // (extraction hors du dossier cible, « zip slip »).
    if (/^[/\\]|^[A-Za-z]:|\\/.test(e.name) || e.name.split("/").includes("..")) {
      throw new RangeError(`Nom d'entrée ZIP non portable : « ${e.name} »`);
    }
    seen.add(e.name);
    const name = enc.encode(e.name);
    const data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    if (data.length > 0xfffffffe || offset + 30 + name.length + data.length > 0xfffffffe) {
      throw new RangeError("Archive ZIP de plus de 4 Gio : ZIP64 non pris en charge");
    }

    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version nécessaire : 2.0
    lv.setUint16(6, 0x0800, true); // UTF-8
    lv.setUint16(8, 0, true); // stockée
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version de création
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    // extra, commentaire, disque, attributs internes / externes : 0
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let p = 0;
  for (const chunk of [...locals, ...centrals, end]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}
