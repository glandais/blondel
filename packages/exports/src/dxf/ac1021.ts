/**
 * Écriture DXF AC1021 (AutoCAD 2007) par `@tarikjabiri/dxf` (MIT), derrière l'interface
 * `DxfWriter`. Polylignes en LWPOLYLINE (renflements conservés), textes en UTF-8 (AC1021).
 */
import {
  DxfWriter as TjDxfWriter,
  LWPolylineFlags,
  LineTypes,
  TextHorizontalAlignment,
  TextVerticalAlignment,
  Units,
  point3d,
  type TextOptions,
} from "@tarikjabiri/dxf";
import type { Mm, Vec2 } from "@blondel/core";
import type { PathVertex } from "../path.js";
import { sanitizeLayerName } from "./r12.js";
import type {
  DxfLayerDef,
  DxfLineType,
  DxfTextOptions,
  DxfWriter,
  DxfWriterOptions,
} from "./writer.js";

export class Ac1021Writer implements DxfWriter {
  readonly version = "AC1021" as const;
  private readonly doc = new TjDxfWriter();
  private readonly known = new Set<string>(["0"]);

  constructor(options: DxfWriterOptions = {}) {
    const [d, g] = options.dashPattern ?? [10, 5];
    this.doc.setUnits(Units.Millimeters);
    this.doc.addLType("DASHED", "Dashed __ __ __", [d, -g]);
    this.doc.addLType("CENTER", "Center ____ _ ____", [2 * d, -g / 2, d / 2, -g / 2]);
  }

  private lineTypeName(t: DxfLineType | undefined): string {
    return t === undefined || t === "CONTINUOUS" ? LineTypes.Continuous : t;
  }

  private layerName(layer: string): string {
    const name = sanitizeLayerName(layer);
    if (!this.known.has(name)) {
      this.doc.addLayer(name, 7, LineTypes.Continuous);
      this.known.add(name);
    }
    return name;
  }

  addLayer(layer: DxfLayerDef): void {
    const name = sanitizeLayerName(layer.name);
    if (this.known.has(name)) return;
    const color = Math.max(1, Math.min(255, Math.round(layer.color)));
    this.doc.addLayer(name, color, this.lineTypeName(layer.lineType));
    this.known.add(name);
  }

  line(a: Vec2, b: Vec2, layer: string): void {
    this.doc.addLine(point3d(a.x, a.y, 0), point3d(b.x, b.y, 0), {
      layerName: this.layerName(layer),
    });
  }

  polyline(vertices: readonly PathVertex[], closed: boolean, layer: string): void {
    if (vertices.length < 2) return;
    this.doc.addLWPolyline(
      vertices.map((v, i) => {
        const last = i === vertices.length - 1;
        const bulge = v.bulge !== 0 && (closed || !last) ? v.bulge : undefined;
        return bulge !== undefined
          ? { point: { x: v.x, y: v.y }, bulge }
          : { point: { x: v.x, y: v.y } };
      }),
      {
        flags: closed ? LWPolylineFlags.Closed : LWPolylineFlags.None,
        layerName: this.layerName(layer),
      },
    );
  }

  arc(center: Vec2, radius: Mm, startDeg: number, endDeg: number, layer: string): void {
    this.doc.addArc(point3d(center.x, center.y, 0), radius, startDeg, endDeg, {
      layerName: this.layerName(layer),
    });
  }

  circle(center: Vec2, radius: Mm, layer: string): void {
    this.doc.addCircle(point3d(center.x, center.y, 0), radius, {
      layerName: this.layerName(layer),
    });
  }

  text(at: Vec2, height: Mm, value: string, layer: string, options: DxfTextOptions = {}): void {
    const p = point3d(at.x, at.y, 0);
    const opts: TextOptions = { layerName: this.layerName(layer) };
    if (options.rotationDeg !== undefined && options.rotationDeg !== 0) {
      opts.rotation = options.rotationDeg;
    }
    const h =
      options.align === "center"
        ? TextHorizontalAlignment.Center
        : options.align === "right"
          ? TextHorizontalAlignment.Right
          : TextHorizontalAlignment.Left;
    const v =
      options.middle === true ? TextVerticalAlignment.Middle : TextVerticalAlignment.BaseLine;
    if (h !== TextHorizontalAlignment.Left || v !== TextVerticalAlignment.BaseLine) {
      opts.horizontalAlignment = h;
      opts.verticalAlignment = v;
      opts.secondAlignmentPoint = p;
    }
    this.doc.addText(p, height, value.replace(/[\r\n]+/g, " "), opts);
  }

  toString(): string {
    return this.doc.stringify();
  }
}
