/**
 * Élévation développée le long de la ligne de foulée : abscisse = s (mm développés sur la
 * ligne de foulée), ordonnée = altitude z. Profil des marches, nez, ligne de pente, plafond
 * (sous-face du plancher haut hors trémie, sous-faces de l'escalier lui-même pour un hélicoïdal)
 * et échappée.
 */
import {
  curveLength,
  curvePointAt,
  curveTangentAt,
  pointInPolygon,
  projectOnCurve,
  vec2,
  type Mm,
  type Model,
  type Project,
  type Vec2,
} from "@blondel/core";
import {
  locateViolations,
  openingPolygon,
  requiredHeadroom,
  violationSummary,
} from "../annotations.js";
import { formatFr } from "../format.js";
import { dimensionGeometry, type Dimension } from "../plan/drawing.js";
import { renderCartouche } from "./plan.js";
import {
  el,
  n2,
  polylineData,
  resolvePxPerMm,
  resolveTheme,
  severityColor,
  svgDocument,
  text,
  toPx,
  type SvgScaleOptions,
  type ThemeOption,
  type Viewport,
} from "./svg.js";

export interface ElevationSvgOptions extends SvgScaleOptions {
  /** Projet source : épaisseur du plancher haut et trémie (plafond). */
  readonly project?: Project;
  readonly theme?: ThemeOption;
  readonly fontSize?: number;
  readonly background?: boolean;
  readonly title?: string;
  /** Hauteurs de marche affichées (défaut : vrai). */
  readonly riseLabels?: boolean;
  readonly cartouche?: boolean;
}

const fr = (v: number, d = 0): string => formatFr(v, { decimals: d, thousands: " " });

/** Point de la ligne de foulée prolongée par ses tangentes au-delà de [0, L]. */
function walklinePointExtended(model: Model, s: Mm, L: Mm): Vec2 {
  const w = model.layout.walkline;
  if (s < 0) return vec2.addScaled(curvePointAt(w, 0), curveTangentAt(w, 0), s);
  if (s > L) return vec2.addScaled(curvePointAt(w, L), curveTangentAt(w, L), s - L);
  return curvePointAt(w, s);
}

/** Intervalles d'abscisse (s) où la ligne de foulée passe sous le plancher haut (hors trémie). */
export function ceilingIntervals(
  model: Model,
  project: Project,
  s0: Mm,
  s1: Mm,
  step: Mm = 5,
): [Mm, Mm][] {
  const opening = openingPolygon(project);
  if (opening === undefined) return [];
  const L = curveLength(model.layout.walkline);
  const under = (s: Mm): boolean =>
    pointInPolygon(walklinePointExtended(model, s, L), opening) === "outside";
  // Transition affinée par dichotomie entre deux échantillons d'états différents.
  const edge = (a: Mm, b: Mm): Mm => {
    const ua = under(a);
    for (let i = 0; i < 40 && b - a > 1e-6; i++) {
      const m = (a + b) / 2;
      if (under(m) === ua) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const out: [Mm, Mm][] = [];
  const count = Math.max(1, Math.ceil((s1 - s0) / step));
  let startS: Mm | undefined = under(s0) ? s0 : undefined;
  let prev = s0;
  for (let i = 1; i <= count; i++) {
    const s = s0 + ((s1 - s0) * i) / count;
    const u = under(s);
    if (u && startS === undefined) startS = edge(prev, s);
    else if (!u && startS !== undefined) {
      out.push([startS, edge(prev, s)]);
      startS = undefined;
    }
    prev = s;
  }
  if (startS !== undefined) out.push([startS, s1]);
  return out;
}

/** Portion de plafond formée par une pièce de l'escalier au-dessus de la ligne de foulée. */
export interface SoffitInterval {
  /** Abscisses (s) de début et de fin sur la ligne de foulée. */
  readonly a: Mm;
  readonly b: Mm;
  /** Altitude de la sous-face et du dessus de la pièce. */
  readonly bottom: Mm;
  readonly top: Mm;
  /** Numéro de marche ; absent : palier d'arrivée. */
  readonly tread?: number;
}

/**
 * Sous-faces de l'escalier au-dessus de la ligne de foulée (auto-recouvrement d'un hélicoïdal,
 * `Stepping.soffits`, CHALLENGE G4) : pour chaque sous-face, intervalles d'abscisse où la ligne
 * de foulée passe sous la pièce, limités aux points situés **avant** la pièce dans la montée
 * (s < `sStart`, même convention que le calcul d'échappée). Dessus : dessus de la marche, ou
 * niveau du plancher haut pour le palier d'arrivée.
 */
export function soffitIntervals(model: Model, s0: Mm, s1: Mm, step: Mm = 5): SoffitInterval[] {
  const soffits = model.stepping.soffits ?? [];
  if (soffits.length === 0 || !(s1 > s0)) return [];
  const L = curveLength(model.layout.walkline);
  const H = model.stepping.rises.reduce((x, y) => x + y, 0);
  const count = Math.max(1, Math.ceil((s1 - s0) / step));
  const samples = Array.from({ length: count + 1 }, (_, i) => s0 + ((s1 - s0) * i) / count);
  const points = samples.map((s) => walklinePointExtended(model, s, L));
  const out: SoffitInterval[] = [];
  for (const f of soffits) {
    const top = f.tread !== undefined ? (model.stepping.treads[f.tread - 1]?.z ?? f.z) : H;
    // Boîte englobante de la pièce : écarte vite les points qui en sont loin.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of f.outline) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    const under = (s: Mm, p: Vec2): boolean =>
      s < f.sStart &&
      p.x >= minX &&
      p.x <= maxX &&
      p.y >= minY &&
      p.y <= maxY &&
      pointInPolygon(p, f.outline) !== "outside";
    const edge = (a: Mm, b: Mm, ua: boolean): Mm => {
      for (let i = 0; i < 40 && b - a > 1e-6; i++) {
        const m = (a + b) / 2;
        if (under(m, walklinePointExtended(model, m, L)) === ua) a = m;
        else b = m;
      }
      return (a + b) / 2;
    };
    let start: Mm | undefined = under(samples[0]!, points[0]!) ? samples[0]! : undefined;
    let prevU = start !== undefined;
    for (let i = 1; i < samples.length; i++) {
      const u = under(samples[i]!, points[i]!);
      if (u && !prevU) start = edge(samples[i - 1]!, samples[i]!, false);
      else if (!u && prevU && start !== undefined) {
        const end = edge(samples[i - 1]!, samples[i]!, true);
        if (end - start > 1e-6) out.push({ a: start, b: end, bottom: f.z, top, ...tread(f.tread) });
        start = undefined;
      }
      prevU = u;
    }
    if (start !== undefined && s1 - start > 1e-6) {
      out.push({ a: start, b: s1, bottom: f.z, top, ...tread(f.tread) });
    }
  }
  return out;
}

function tread(n: number | undefined): { tread?: number } {
  return n === undefined ? {} : { tread: n };
}

/** Altitude de la ligne de pente (interpolation linéaire entre nez) à l'abscisse s. */
function slopeZ(pts: readonly Vec2[], s: Mm): Mm {
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (s <= first.x) {
    const nx = pts[1] ?? last;
    const k = nx.x !== first.x ? (nx.y - first.y) / (nx.x - first.x) : 0;
    return first.y + k * (s - first.x);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (s <= b.x) return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (s - a.x)) / (b.x - a.x);
  }
  const pv = pts[pts.length - 2] ?? first;
  const k = last.x !== pv.x ? (last.y - pv.y) / (last.x - pv.x) : 0;
  return last.y + k * (s - last.x);
}

export function renderElevationSvg(model: Model, options: ElevationSvgOptions = {}): string {
  const { stepping } = model;
  const k = resolvePxPerMm(options);
  const theme = resolveTheme(options.theme);
  const fontSize = options.fontSize ?? 12;
  const margin = options.margin ?? 16;
  const th = fontSize / k; // hauteur de texte en mm du dessin
  const nosings = [...stepping.nosings].sort((a, b) => a.s - b.s);
  const H = stepping.rises.reduce((a, b) => a + b, 0);
  const pts: Vec2[] = nosings.map((n) => ({ x: n.s, y: n.z }));
  const sFirst = nosings[0]?.s ?? 0;
  const sLast = nosings[nosings.length - 1]?.s ?? 0;
  // Modèle partiel (`Model.errors`) : giron éventuellement non fini.
  const ext = Math.max(Number.isFinite(stepping.going) ? stepping.going : 0, 4 * th);
  const sMin = sFirst - ext;
  const sMax = sLast + ext;

  // Profil en escalier : sol bas, contremarche, marche, … , sol haut.
  const profile: Vec2[] = [
    { x: sMin, y: 0 },
    { x: sFirst, y: 0 },
  ];
  let zPrev = 0;
  for (const n of nosings) {
    if (profile.length > 2) profile.push({ x: n.s, y: zPrev });
    profile.push({ x: n.s, y: n.z });
    zPrev = n.z;
  }
  profile.push({ x: sMax, y: zPrev });

  // Plafond : sous-face du plancher haut hors trémie.
  const slab = options.project?.site.upperSlabThickness;
  const ceilings =
    options.project && slab !== undefined
      ? ceilingIntervals(model, options.project, sMin, sMax)
      : [];
  const zCeil = H - (slab ?? 0);
  // Plafond formé par l'escalier lui-même (hélicoïdal : tour supérieur, palier d'arrivée).
  const soffits = soffitIntervals(model, sMin, sMax);

  // Échappée : mesurée (modèle) et gabarit réglementaire (règles applicables).
  const required = requiredHeadroom(model.compliance);
  let measured: { s: Mm; z0: Mm; min: Mm } | undefined;
  if (model.headroom && pts.length > 0) {
    const s = projectOnCurve(
      { x: model.headroom.at.x, y: model.headroom.at.y },
      model.layout.walkline,
    ).s;
    measured = { s, z0: slopeZ(pts, s), min: model.headroom.min };
  }

  const dims: Dimension[] = [];
  const dim = (
    a: Vec2,
    b: Vec2,
    normal: Vec2,
    offset: Mm,
    label: string,
    role: Dimension["role"],
  ) => dims.push({ role, a, b, normal, offset, value: vec2.distance(a, b), text: label });
  if (H > 0) {
    dim(
      { x: sFirst, y: 0 },
      { x: sFirst, y: H },
      { x: -1, y: 0 },
      ext + 2 * th,
      `H = ${fr(H)}`,
      "height",
    );
  }
  if (sLast > sFirst) {
    dim(
      { x: sFirst, y: 0 },
      { x: sLast, y: 0 },
      { x: 0, y: -1 },
      3 * th,
      fr(sLast - sFirst),
      "run",
    );
  }

  // Emprise (repère s, z).
  const measuredTop = measured ? measured.z0 + measured.min : H;
  const gaugeTop = required !== undefined ? Math.max(...pts.map((p) => p.y + required)) : H;
  const min = { x: sMin - ext - 4 * th, y: -5 * th };
  const max = { x: sMax + 4 * th, y: Math.max(H, measuredTop, gaugeTop) + 2 * th };
  const vp: Viewport = { k, minX: min.x, maxY: max.y, margin };
  const wDraw = (max.x - min.x) * k + 2 * margin;
  const hDraw = (max.y - min.y) * k + 2 * margin;

  const body: string[] = [];
  const font = { "font-family": theme.fontFamily, "font-size": fontSize };

  // Plafond et sol haut (hachure simple : aplat).
  for (const [a, b] of ceilings) {
    const p = toPx(vp, { x: a, y: H });
    const q = toPx(vp, { x: b, y: zCeil });
    body.push(
      el("rect", {
        class: "ceiling",
        x: p.x,
        y: p.y,
        width: q.x - p.x,
        height: q.y - p.y,
        fill: theme.ceiling,
        "fill-opacity": 0.6,
        stroke: theme.edge,
        "stroke-width": 0.8,
      }),
    );
  }

  // Sous-faces de l'escalier (auto-recouvrement) : même aplat que le plafond.
  for (const f of soffits) {
    const p = toPx(vp, { x: f.a, y: f.top });
    const q = toPx(vp, { x: f.b, y: f.bottom });
    body.push(
      el("rect", {
        class: "soffit",
        x: p.x,
        y: p.y,
        width: q.x - p.x,
        height: q.y - p.y,
        fill: theme.ceiling,
        "fill-opacity": 0.6,
        stroke: theme.edge,
        "stroke-width": 0.8,
        "data-tread": f.tread,
        "data-kind": f.tread === undefined ? "landing" : "tread",
      }),
    );
  }

  // Profil des marches.
  body.push(
    el("path", {
      class: "profile",
      d: polylineData(vp, profile),
      fill: "none",
      stroke: theme.edge,
      "stroke-width": 1.8,
      "stroke-linejoin": "miter",
    }),
  );

  // Ligne de pente (par les nez) et gabarit d'échappée.
  if (pts.length > 1) {
    body.push(
      el("path", {
        class: "slope",
        d: polylineData(vp, pts),
        fill: "none",
        stroke: theme.walkline,
        "stroke-width": 1.2,
        "stroke-dasharray": "10 3 2 3",
      }),
    );
  }
  if (required !== undefined && pts.length > 1) {
    const gauge = pts.map((p) => ({ x: p.x, y: p.y + required }));
    const lbl = toPx(vp, gauge[0]!);
    body.push(
      el("g", { class: "headroom-gauge" }, [
        el("path", {
          d: polylineData(vp, gauge),
          fill: "none",
          stroke: theme.headroom,
          "stroke-width": 1.2,
          "stroke-dasharray": "6 4",
        }),
        text(
          {
            x: lbl.x,
            y: lbl.y - fontSize * 0.6,
            ...font,
            fill: theme.headroom,
            "data-value": n2(required),
          },
          `Échappée exigée ${fr(required)} mm`,
        ),
      ]),
    );
  }
  if (measured) {
    const a = toPx(vp, { x: measured.s, y: measured.z0 });
    const b = toPx(vp, { x: measured.s, y: measured.z0 + measured.min });
    const bad = required !== undefined && measured.min < required;
    const color = bad ? severityColor(theme, "bloquant") : theme.headroom;
    body.push(
      el("g", { class: "headroom", stroke: color, "stroke-width": 1.5 }, [
        el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y }),
        el("line", { x1: b.x - 5, y1: b.y, x2: b.x + 5, y2: b.y }),
        text(
          {
            x: b.x + 6,
            y: (a.y + b.y) / 2,
            ...font,
            fill: color,
            stroke: "none",
            "data-value": n2(measured.min),
          },
          `e = ${fr(measured.min)}`,
        ),
      ]),
    );
  }

  // Marches (dessus) : cibles `data-tread` pour l'interface (même convention que le plan),
  // colorées en cas de violation localisée sur la marche.
  const treadViolations = locateViolations(model.compliance).treads;
  const byIndex = new Map(nosings.map((n) => [n.index, n]));
  body.push(
    el(
      "g",
      { class: "treads", fill: "none", "pointer-events": "stroke" },
      stepping.treads.flatMap((t) => {
        const n0 = byIndex.get(t.number - 1);
        const n1 = byIndex.get(t.number);
        if (!n0 || !n1) return [];
        const sev = treadViolations.get(t.number);
        return [
          el("path", {
            d: polylineData(vp, [
              { x: n0.s, y: n0.z },
              { x: n1.s, y: n0.z },
            ]),
            stroke: sev !== undefined ? severityColor(theme, sev) : theme.edge,
            "stroke-opacity": sev !== undefined ? undefined : 0,
            "stroke-width": sev !== undefined ? 3 : 6,
            "data-tread": t.number,
            "data-kind": t.kind,
            "data-severity": sev,
          }),
        ];
      }),
    ),
  );

  // Nez.
  body.push(
    el(
      "g",
      { class: "nosings", fill: theme.edge },
      nosings.map((n) => {
        const p = toPx(vp, { x: n.s, y: n.z });
        return el("circle", { cx: p.x, cy: p.y, r: 2.2, "data-nosing": n.index });
      }),
    ),
  );

  // Hauteurs de marche.
  if (options.riseLabels !== false) {
    const labels: string[] = [];
    let z0 = 0;
    for (const n of nosings) {
      const p = toPx(vp, { x: n.s, y: (z0 + n.z) / 2 });
      // À droite de la contremarche, sous la marche : hors de la ligne de pente.
      labels.push(text({ x: p.x + 4, y: p.y }, fr(n.z - z0, 1)));
      z0 = n.z;
    }
    body.push(
      el(
        "g",
        {
          class: "rises",
          "font-family": theme.fontFamily,
          "font-size": fontSize * 0.75,
          "text-anchor": "start",
          "dominant-baseline": "central",
          fill: theme.mutedText,
        },
        labels,
      ),
    );
  }

  // Cotes.
  body.push(
    el(
      "g",
      { class: "dimensions", stroke: theme.dimension, "stroke-width": 0.8, fill: "none" },
      dims.map((d) => {
        const g = dimensionGeometry(d, th);
        const p = toPx(vp, g.textAt);
        const deg = (-g.textAngle * 180) / Math.PI;
        return el("g", {}, [
          el("path", {
            d: [g.line, ...g.extensions, ...g.ticks].map((s) => polylineData(vp, s)).join(""),
          }),
          text(
            {
              x: p.x,
              y: p.y,
              transform: `rotate(${n2(deg)} ${n2(p.x)} ${n2(p.y)})`,
              ...font,
              "text-anchor": "middle",
              "dominant-baseline": "central",
              fill: theme.text,
              stroke: "none",
              "data-value": n2(d.value),
            },
            d.text,
          ),
        ]);
      }),
    ),
  );

  // Cartouche.
  let width = wDraw;
  let height = hDraw;
  let cartouche = "";
  if (options.cartouche !== false) {
    const slopeDeg = (Math.atan2(stepping.rise, stepping.going) * 180) / Math.PI;
    const s = violationSummary(model.compliance);
    const lines = [
      `Élévation développée sur la ligne de foulée`,
      `H = ${fr(H)} mm — ${stepping.riserCount} × h = ${fr(stepping.rise, 1)} mm — g = ${fr(stepping.going, 1)} mm`,
      `2h + g = ${fr(stepping.blondel, 1)} mm — pente ${fr(slopeDeg, 1)}°`,
      ...(measured ? [`Échappée minimale mesurée : ${fr(measured.min)} mm`] : []),
      ...(required !== undefined ? [`Échappée exigée (règles actives) : ${fr(required)} mm`] : []),
      ...(slab !== undefined ? [`Plancher haut : ${fr(slab)} mm`] : []),
      ...(soffits.length > 0
        ? ["Plafond : sous-faces de l'escalier au-dessus de la ligne de foulée (auto-recouvrement)"]
        : []),
      `Contrôle de conception : ${s.bloquant} bloquant(s), ${s.avertissement} avertissement(s), ${s.conseil} conseil(s)`,
    ];
    const longest = Math.max(...lines.map((l) => l.length));
    const cw = Math.max(wDraw - 2 * margin, longest * fontSize * 0.55 + fontSize * 1.2);
    const c = renderCartouche(lines, margin, hDraw, cw, theme, fontSize);
    cartouche = c.svg;
    height = hDraw + c.height + margin;
    width = Math.max(wDraw, cw + 2 * margin);
  }
  const all: string[] = [];
  if (options.background !== false) {
    all.push(
      el("rect", { class: "background", x: 0, y: 0, width, height, fill: theme.background }),
    );
  }
  all.push(el("g", { class: "elevation" }, body), cartouche);
  const physical =
    options.scale !== undefined
      ? { w: width / k / options.scale, h: height / k / options.scale }
      : undefined;
  return svgDocument(width, height, all, {
    ...(physical ? { physicalMm: physical } : {}),
    title: options.title ?? "Élévation développée",
    className: "blondel-elevation",
  });
}
