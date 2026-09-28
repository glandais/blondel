/**
 * Écrivain DXF ASCII R12 (AC1009) minimal, sans dépendance.
 *
 * Structure : HEADER ($ACADVER, $INSUNITS = 4 mm, $MEASUREMENT = 1, étendue), TABLES (LTYPE,
 * LAYER, STYLE), BLOCKS vide, ENTITIES, EOF. Entités : LINE, POLYLINE/VERTEX/SEQEND (les
 * LWPOLYLINE n'existent pas en R12), ARC, CIRCLE, TEXT.
 *
 * `$INSUNITS` et `$MEASUREMENT` n'appartiennent pas à la spécification R12 (apparus en R14 /
 * 2000) ; ils sont écrits pour les lecteurs récents qui les exploitent et ignorés des autres.
 * Textes : jeu ANSI_1252 déclaré, caractères non ASCII écrits en séquences `\U+XXXX`.
 */
import type { Mm, Vec2 } from "@blondel/core";
import { formatNum } from "../format.js";
import type { PathVertex } from "../path.js";
import type {
  DxfLayerDef,
  DxfLineType,
  DxfTextOptions,
  DxfWriter,
  DxfWriterOptions,
} from "./writer.js";

/** Nom de calque DXF valide (R12 : lettres, chiffres, $, -, _ ; 31 caractères). */
export function sanitizeLayerName(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9$_-]/g, "_")
    .slice(0, 31);
  return clean === "" ? "0" : clean;
}

/** Texte DXF sur une ligne, caractères non ASCII en `\U+XXXX`. */
export function encodeDxfText(value: string): string {
  let out = "";
  for (const ch of value.replace(/[\r\n]+/g, " ")) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp <= 0xffff) out += `\\U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    else out += "?";
  }
  return out;
}

const num = (v: number): string => formatNum(v, 6);

export class R12Writer implements DxfWriter {
  readonly version = "R12" as const;
  private readonly layers = new Map<string, DxfLayerDef>();
  private readonly entities: string[] = [];
  private readonly dash: readonly [Mm, Mm];
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  constructor(options: DxfWriterOptions = {}) {
    this.dash = options.dashPattern ?? [10, 5];
    this.layers.set("0", { name: "0", color: 7, lineType: "CONTINUOUS" });
  }

  private tag(code: number, value: string | number): void {
    this.entities.push(String(code), typeof value === "number" ? num(value) : value);
  }

  private extend(p: Vec2, r = 0): void {
    this.minX = Math.min(this.minX, p.x - r);
    this.minY = Math.min(this.minY, p.y - r);
    this.maxX = Math.max(this.maxX, p.x + r);
    this.maxY = Math.max(this.maxY, p.y + r);
  }

  private layerName(layer: string): string {
    const name = sanitizeLayerName(layer);
    if (!this.layers.has(name)) this.layers.set(name, { name, color: 7, lineType: "CONTINUOUS" });
    return name;
  }

  addLayer(layer: DxfLayerDef): void {
    const name = sanitizeLayerName(layer.name);
    this.layers.set(name, { ...layer, name });
  }

  line(a: Vec2, b: Vec2, layer: string): void {
    this.tag(0, "LINE");
    this.tag(8, this.layerName(layer));
    this.tag(10, a.x);
    this.tag(20, a.y);
    this.tag(30, 0);
    this.tag(11, b.x);
    this.tag(21, b.y);
    this.tag(31, 0);
    this.extend(a);
    this.extend(b);
  }

  polyline(vertices: readonly PathVertex[], closed: boolean, layer: string): void {
    if (vertices.length < 2) return;
    const name = this.layerName(layer);
    this.tag(0, "POLYLINE");
    this.tag(8, name);
    this.tag(66, 1);
    this.tag(10, 0);
    this.tag(20, 0);
    this.tag(30, 0);
    this.tag(70, closed ? 1 : 0);
    vertices.forEach((v, i) => {
      this.tag(0, "VERTEX");
      this.tag(8, name);
      this.tag(10, v.x);
      this.tag(20, v.y);
      this.tag(30, 0);
      const last = i === vertices.length - 1;
      if (v.bulge !== 0 && (closed || !last)) this.tag(42, v.bulge);
      this.extend(v);
    });
    this.tag(0, "SEQEND");
    this.tag(8, name);
  }

  arc(center: Vec2, radius: Mm, startDeg: number, endDeg: number, layer: string): void {
    this.tag(0, "ARC");
    this.tag(8, this.layerName(layer));
    this.tag(10, center.x);
    this.tag(20, center.y);
    this.tag(30, 0);
    this.tag(40, radius);
    this.tag(50, startDeg);
    this.tag(51, endDeg);
    this.extend(center, radius);
  }

  circle(center: Vec2, radius: Mm, layer: string): void {
    this.tag(0, "CIRCLE");
    this.tag(8, this.layerName(layer));
    this.tag(10, center.x);
    this.tag(20, center.y);
    this.tag(30, 0);
    this.tag(40, radius);
    this.extend(center, radius);
  }

  text(at: Vec2, height: Mm, value: string, layer: string, options: DxfTextOptions = {}): void {
    const h = options.align === "center" ? 1 : options.align === "right" ? 2 : 0;
    const v = options.middle === true ? 2 : 0;
    this.tag(0, "TEXT");
    this.tag(8, this.layerName(layer));
    this.tag(10, at.x);
    this.tag(20, at.y);
    this.tag(30, 0);
    this.tag(40, height);
    this.tag(1, encodeDxfText(value));
    if (options.rotationDeg !== undefined && options.rotationDeg !== 0) {
      this.tag(50, options.rotationDeg);
    }
    if (h !== 0 || v !== 0) {
      this.tag(72, h);
      this.tag(11, at.x);
      this.tag(21, at.y);
      this.tag(31, 0);
      this.tag(73, v);
    }
    this.extend(at, height);
  }

  private lineTypeTable(): string[] {
    const [d, g] = this.dash;
    const types: { name: DxfLineType; desc: string; pattern: number[] }[] = [
      { name: "CONTINUOUS", desc: "Solid line", pattern: [] },
      { name: "DASHED", desc: "Dashed __ __ __", pattern: [d, -g] },
      { name: "CENTER", desc: "Center ____ _ ____", pattern: [2 * d, -g / 2, d / 2, -g / 2] },
    ];
    const out = ["0", "TABLE", "2", "LTYPE", "70", String(types.length)];
    for (const t of types) {
      const total = t.pattern.reduce((a, b) => a + Math.abs(b), 0);
      out.push("0", "LTYPE", "2", t.name, "70", "0", "3", t.desc, "72", "65");
      out.push("73", String(t.pattern.length), "40", num(total));
      for (const e of t.pattern) out.push("49", num(e));
    }
    out.push("0", "ENDTAB");
    return out;
  }

  toString(): string {
    const hasExtents = Number.isFinite(this.minX);
    const ext = hasExtents
      ? { min: { x: this.minX, y: this.minY }, max: { x: this.maxX, y: this.maxY } }
      : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    // prettier-ignore
    const header = [
      "0", "SECTION", "2", "HEADER",
      "9", "$ACADVER", "1", "AC1009",
      "9", "$DWGCODEPAGE", "3", "ANSI_1252",
      "9", "$INSBASE", "10", "0", "20", "0", "30", "0",
      "9", "$EXTMIN", "10", num(ext.min.x), "20", num(ext.min.y), "30", "0",
      "9", "$EXTMAX", "10", num(ext.max.x), "20", num(ext.max.y), "30", "0",
      "9", "$LIMMIN", "10", num(ext.min.x), "20", num(ext.min.y),
      "9", "$LIMMAX", "10", num(ext.max.x), "20", num(ext.max.y),
      "9", "$LUNITS", "70", "2",
      "9", "$LUPREC", "70", "2",
      "9", "$INSUNITS", "70", "4",
      "9", "$MEASUREMENT", "70", "1",
      "0", "ENDSEC",
    ];
    const layers = [...this.layers.values()];
    const layerTable = ["0", "TABLE", "2", "LAYER", "70", String(layers.length)];
    for (const l of layers) {
      // prettier-ignore
      layerTable.push(
        "0", "LAYER", "2", l.name, "70", "0",
        "62", String(Math.max(1, Math.min(255, Math.round(l.color)))),
        "6", l.lineType ?? "CONTINUOUS",
      );
    }
    layerTable.push("0", "ENDTAB");
    // prettier-ignore
    const styleTable = [
      "0", "TABLE", "2", "STYLE", "70", "1",
      "0", "STYLE", "2", "STANDARD", "70", "0", "40", "0", "41", "1", "50", "0", "71", "0",
      "42", "2.5", "3", "txt", "4", "",
      "0", "ENDTAB",
    ];
    // prettier-ignore
    const all = [
      ...header,
      "0", "SECTION", "2", "TABLES",
      ...this.lineTypeTable(),
      ...layerTable,
      ...styleTable,
      "0", "ENDSEC",
      "0", "SECTION", "2", "BLOCKS", "0", "ENDSEC",
      "0", "SECTION", "2", "ENTITIES",
      ...this.entities,
      "0", "ENDSEC",
      "0", "EOF",
    ];
    // Codes de groupe alignés à droite sur 3 caractères (usage courant, plus lisible).
    const lines: string[] = [];
    for (let i = 0; i < all.length; i += 2) {
      lines.push(all[i]!.padStart(3, " "), all[i + 1]!);
    }
    return `${lines.join("\r\n")}\r\n`;
  }
}
