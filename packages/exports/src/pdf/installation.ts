/**
 * Fiche de pose (CHALLENGE P7) : plan d'implantation à l'échelle (murs du relevé, trémie,
 * emprise, lignes de nez, ligne de départ et d'arrivée, cotes aux nus des murs), coordonnées
 * des points de traçage, diagonales de contrôle, hauteurs, puis épure des nez au sol en tableau.
 */
import type { Model, Project, Vec2 } from "@blondel/core";
import { installationSheet, type InstallationSheet } from "../installation.js";
import type { PathOp, PdfCanvas, Rgb } from "./canvas.js";
import { clipPath, type Rect } from "./clip.js";
import {
  ACCENT,
  GUIDE,
  INK,
  MUTED,
  RULE,
  fit,
  fr,
  line,
  tablePages,
  wrapText,
  type Frame,
  type PageDraft,
} from "./layout.js";

export interface InstallationPageInfo {
  readonly kind: "installation";
  readonly title: string;
  readonly scale?: number;
}

const WALL_FILL: Rgb = [208, 215, 222];
const OPENING: Rgb = [9, 105, 218];
const FOOTPRINT: Rgb = [246, 240, 230];

/** Marge autour de l'emprise dessinée (mm du site) : choix de mise en page. */
const VIEW_MARGIN = 300;

interface View {
  readonly n: number;
  readonly minX: number;
  readonly maxY: number;
  readonly ox: number;
  readonly oy: number;
  readonly rect: Rect;
}

const toPage = (v: View, p: Vec2): { x: number; y: number } => ({
  x: v.ox + (p.x - v.minX) / v.n,
  y: v.oy + (v.maxY - p.y) / v.n,
});

function polyOps(v: View, pts: readonly Vec2[], close: boolean): PathOp[] {
  const ops: PathOp[] = pts.map((p, i) => ({ op: i === 0 ? "M" : "L", ...toPage(v, p) }) as PathOp);
  if (close) ops.push({ op: "Z" });
  return ops;
}

function paint(
  c: PdfCanvas,
  v: View,
  ops: PathOp[],
  style: Parameters<PdfCanvas["path"]>[1],
): void {
  for (const piece of clipPath(ops, style, v.rect)) c.path(piece.ops, piece.style);
}

function chooseView(
  sheet: InstallationSheet,
  model: Model,
  area: Frame,
  scales: readonly number[],
): View | undefined {
  const pts: Vec2[] = [...model.layout.footprint, ...sheet.points.map((p) => p.at)];
  if (sheet.opening) pts.push(...sheet.opening.outline);
  for (const w of sheet.walls) if (w.onWall && w.distance >= 0) pts.push(w.foot);
  const fin = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (fin.length === 0) return undefined;
  const minX = Math.min(...fin.map((p) => p.x)) - VIEW_MARGIN;
  const maxX = Math.max(...fin.map((p) => p.x)) + VIEW_MARGIN;
  const minY = Math.min(...fin.map((p) => p.y)) - VIEW_MARGIN;
  const maxY = Math.max(...fin.map((p) => p.y)) + VIEW_MARGIN;
  const W = maxX - minX;
  const H = maxY - minY;
  const sorted = [...scales].filter((s) => s > 0).sort((a, b) => a - b);
  let n = sorted.find((s) => W / s <= area.w && H / s <= area.h);
  if (n === undefined) n = Math.ceil(Math.max(W / area.w, H / area.h));
  const w = W / n;
  const h = H / n;
  const ox = area.x + (area.w - w) / 2;
  const oy = area.y + (area.h - h) / 2;
  return { n, minX, maxY, ox, oy, rect: { x: ox, y: oy, w, h } };
}

function drawPlan(
  c: PdfCanvas,
  sheet: InstallationSheet,
  model: Model,
  project: Project | undefined,
  v: View,
): void {
  // Murs (bandes entre les deux nus).
  for (const w of project?.site.walls ?? []) {
    const d = { x: w.b.x - w.a.x, y: w.b.y - w.a.y };
    const l = Math.hypot(d.x, d.y);
    if (!(l > 0)) continue;
    const nx = (-d.y / l) * (w.thickness / 2);
    const ny = (d.x / l) * (w.thickness / 2);
    const band = [
      { x: w.a.x + nx, y: w.a.y + ny },
      { x: w.b.x + nx, y: w.b.y + ny },
      { x: w.b.x - nx, y: w.b.y - ny },
      { x: w.a.x - nx, y: w.a.y - ny },
    ];
    paint(c, v, polyOps(v, band, true), { fill: WALL_FILL, stroke: INK, lineWidth: 0.25 });
    const mid = toPage(v, { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
    if (
      mid.x >= v.rect.x &&
      mid.x <= v.rect.x + v.rect.w &&
      mid.y >= v.rect.y &&
      mid.y <= v.rect.y + v.rect.h
    ) {
      c.text(w.id, mid.x + 1, mid.y - 1, { size: 2.4, color: INK, bold: true });
    }
  }
  // Emprise et lignes de nez.
  if (model.layout.footprint.length >= 3) {
    paint(c, v, polyOps(v, model.layout.footprint, true), {
      fill: FOOTPRINT,
      stroke: MUTED,
      lineWidth: 0.2,
    });
  }
  for (const n of sheet.nosings)
    paint(c, v, polyOps(v, [n.q, n.r], false), { stroke: MUTED, lineWidth: 0.15 });
  // Trémie (contour pointillé).
  if (sheet.opening) {
    paint(c, v, polyOps(v, sheet.opening.outline, true), {
      stroke: OPENING,
      lineWidth: 0.3,
      dash: [2, 1],
    });
    // Numéros des bords (repris par les cotes « bord i » de la colonne de droite).
    const o = sheet.opening.outline;
    o.forEach((a, i) => {
      const b = o[(i + 1) % o.length]!;
      const m = toPage(v, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      if (
        m.x >= v.rect.x &&
        m.x <= v.rect.x + v.rect.w &&
        m.y >= v.rect.y &&
        m.y <= v.rect.y + v.rect.h
      ) {
        c.text(openingEdgeLabel(i), m.x + 0.6, m.y - 0.6, { size: 2.2, color: OPENING });
      }
    });
  }
  // Ligne de départ et d'arrivée (traçage au sol).
  const pt = (id: string): Vec2 | undefined => sheet.points.find((p) => p.id === id)?.at;
  const si = pt("start-inner");
  const so = pt("start-outer");
  const ei = pt("end-inner");
  const eo = pt("end-outer");
  if (si && so) paint(c, v, polyOps(v, [si, so], false), { stroke: ACCENT, lineWidth: 0.6 });
  if (ei && eo)
    paint(c, v, polyOps(v, [ei, eo], false), { stroke: ACCENT, lineWidth: 0.4, dash: [3, 1.5] });
  // Cotes d'implantation : chaque point de départ au nu du mur le plus proche.
  for (const id of ["start-inner", "start-outer"] as const) {
    const cands = sheet.walls.filter((w) => w.pointId === id && w.onWall && w.distance >= 0);
    const best = cands.sort((a, b) => a.distance - b.distance)[0];
    const p = pt(id);
    if (!best || !p || best.distance < 1) continue;
    const a = toPage(v, p);
    const b = toPage(v, best.foot);
    line(c, a.x, a.y, b.x, b.y, GUIDE, 0.2);
    for (const e of [a, b]) {
      line(c, e.x - 0.8, e.y - 0.8, e.x + 0.8, e.y + 0.8, GUIDE, 0.25);
    }
    c.text(fr(best.distance), (a.x + b.x) / 2 + 0.8, (a.y + b.y) / 2 - 0.8, {
      size: 2.4,
      color: GUIDE,
      bold: true,
    });
  }
  // Points numérotés.
  sheet.points.forEach((p, i) => {
    const q = toPage(v, p.at);
    c.path(
      [
        { op: "M", x: q.x - 0.7, y: q.y - 0.7 },
        { op: "L", x: q.x + 0.7, y: q.y - 0.7 },
        { op: "L", x: q.x + 0.7, y: q.y + 0.7 },
        { op: "L", x: q.x - 0.7, y: q.y + 0.7 },
        { op: "Z" },
      ],
      { fill: ACCENT },
    );
    c.text(String(i + 1), q.x + 1.2, q.y + 2.6, { size: 2.6, color: ACCENT, bold: true });
  });
}

/** Écart signé : « +10 », « −30 », « 0 ». */
const signed = (v: number): string => (v > 0 ? `+${fr(v)}` : fr(v));

/** Repère d'un bord de trémie (bord i : du sommet i au sommet i + 1 du contour). */
export const openingEdgeLabel = (edge: number): string => `b${edge + 1}`;

/** Lignes de texte de la colonne de droite. */
export function installationLines(
  sheet: InstallationSheet,
): { text: string; bold?: boolean; muted?: boolean }[] {
  const out: { text: string; bold?: boolean; muted?: boolean }[] = [];
  out.push({ text: "Points de traçage (repère du site, mm)", bold: true });
  sheet.points.forEach((p, i) =>
    out.push({ text: `${i + 1}. ${p.label} : X ${fr(p.at.x, 1)} ; Y ${fr(p.at.y, 1)}` }),
  );
  if (sheet.startWidth !== undefined)
    out.push({ text: `Largeur de la ligne de départ (1-2) : ${fr(sheet.startWidth, 1)} mm` });
  for (const d of sheet.diagonals)
    out.push({ text: `Diagonale ${d.from} → ${d.to} : ${fr(d.length, 1)} mm` });
  out.push({ text: "Cotes aux nus des murs (mm)", bold: true });
  if (!sheet.hasSite)
    out.push({ text: "Projet non fourni : murs et trémie inconnus.", muted: true });
  else if (sheet.wallIds.length === 0)
    out.push({ text: "Aucun mur saisi dans le relevé.", muted: true });
  sheet.points.forEach((p, i) => {
    const ws = sheet.walls.filter((w) => w.pointId === p.id);
    if (ws.length === 0) return;
    const parts = ws.map((w) => `${w.wallId} ${fr(w.distance)}${w.onWall ? "" : "*"}`);
    out.push({ text: `${i + 1}. ${parts.join(" ; ")}` });
  });
  if (sheet.walls.some((w) => !w.onWall))
    out.push({ text: "* pied de la perpendiculaire sur le prolongement du mur.", muted: true });
  if (sheet.opening) {
    out.push({ text: "Trémie : distance au bord le plus proche (mm)", bold: true });
    for (const o of sheet.opening.offsets) {
      const i = sheet.points.findIndex((p) => p.id === o.pointId);
      out.push({
        text: `${i + 1}. bord ${openingEdgeLabel(o.edge)} : ${fr(o.distance)}${o.inside ? " (à l'aplomb de la trémie)" : ""}`,
      });
    }
  }
  const h = sheet.heights;
  out.push({ text: "Hauteurs", bold: true });
  out.push({
    text: `Hauteur à monter H : ${fr(h.total, 1)} mm en ${h.count} hauteurs de ${fr(h.nominal, 2)} mm`,
  });
  if (h.first !== undefined)
    out.push({ text: `1re hauteur (sol fini → dessus de la 1re marche) : ${fr(h.first, 1)} mm` });
  if (h.firstTolerance) {
    out.push({
      text: `Tolérance de la 1re marche après pose (écart à la hauteur nominale) : ${signed(h.firstTolerance.min)} / ${signed(h.firstTolerance.max)} mm (${h.firstTolerance.source})`,
      muted: true,
    });
  }
  return out;
}

/** Pages de la fiche de pose : plan et implantation, puis épure des nez. */
export function installationPages(
  measure: Pick<PdfCanvas, "textWidth">,
  model: Model,
  project: Project | undefined,
  frame: Frame,
  scales: readonly number[],
): PageDraft<InstallationPageInfo>[] {
  const sheet = installationSheet(model, project);
  const planW = frame.w * 0.56;
  const area: Frame = { x: frame.x, y: frame.y + 4, w: planW - 4, h: frame.h - 4 };
  const view = chooseView(sheet, model, area, scales);
  const textX = frame.x + planW + 2;
  const textW = frame.w - planW - 2;
  const lines = installationLines(sheet).flatMap((l) =>
    wrapText(measure, l.text, 2.8, textW, l.bold).map((t) => ({ ...l, text: t })),
  );
  const pages: PageDraft<InstallationPageInfo>[] = [
    {
      info: {
        kind: "installation",
        title: "Fiche de pose — implantation",
        ...(view ? { scale: view.n } : {}),
      },
      draw(c, f) {
        c.text("Plan d'implantation (vue de dessus)", f.x, f.y + 2.5, { size: 3, color: MUTED });
        if (view) drawPlan(c, sheet, model, project, view);
        else
          c.text("Tracé indisponible (modèle partiel).", f.x, f.y + 10, { size: 3, color: MUTED });
        line(c, textX - 2, f.y, textX - 2, f.y + f.h, RULE);
        let y = f.y;
        for (const l of lines) {
          const step = l.bold ? 5 : 3.8;
          if (y + step > f.y + f.h) {
            c.text("… (suite : épure des nez)", textX, f.y + f.h, { size: 2.6, color: MUTED });
            break;
          }
          y += step;
          c.text(fit(c, l.text, 2.8, textW, l.bold), textX, y, {
            size: 2.8,
            color: l.muted ? MUTED : INK,
            ...(l.bold ? { bold: true } : {}),
          });
        }
        // Légende.
        const ly = f.y + f.h - 1;
        c.path(
          [
            { op: "M", x: f.x, y: ly },
            { op: "L", x: f.x + 6, y: ly },
          ],
          { stroke: ACCENT, lineWidth: 0.6 },
        );
        c.text("départ", f.x + 7, ly + 0.9, { size: 2.2, color: MUTED });
        c.path(
          [
            { op: "M", x: f.x + 20, y: ly },
            { op: "L", x: f.x + 26, y: ly },
          ],
          { stroke: OPENING, lineWidth: 0.3, dash: [2, 1] },
        );
        c.text("trémie", f.x + 27, ly + 0.9, { size: 2.2, color: MUTED });
        c.path(
          [
            { op: "M", x: f.x + 40, y: ly - 1 },
            { op: "L", x: f.x + 46, y: ly - 1 },
            { op: "L", x: f.x + 46, y: ly + 0.5 },
            { op: "L", x: f.x + 40, y: ly + 0.5 },
            { op: "Z" },
          ],
          { fill: WALL_FILL, stroke: INK, lineWidth: 0.2 },
        );
        c.text("mur (entre nus)", f.x + 47, ly + 0.9, { size: 2.2, color: MUTED });
      },
    },
  ];
  const rows = sheet.nosings.map((n) => ({
    cells: [
      String(n.index),
      fr(n.q.x, 1),
      fr(n.q.y, 1),
      fr(n.r.x, 1),
      fr(n.r.y, 1),
      fr(Math.hypot(n.r.x - n.q.x, n.r.y - n.q.y), 1),
      fr(n.z, 1),
    ],
  }));
  const table = tablePages(
    {
      columns: [
        { title: "Nez", weight: 8, align: "right" },
        { title: "Q x (jour)", weight: 16, align: "right" },
        { title: "Q y (jour)", weight: 16, align: "right" },
        { title: "R x (extérieur)", weight: 16, align: "right" },
        { title: "R y (extérieur)", weight: 16, align: "right" },
        { title: "Longueur QR", weight: 14, align: "right" },
        { title: "Altitude du nez", weight: 14, align: "right" },
      ],
      rows,
      empty: "Aucune ligne de nez (modèle partiel).",
      intro: [
        "Épure au sol : report des lignes de nez (Q côté jour, R côté extérieur) dans le repère du site, mm.",
        "Altitude : dessus de marche en sol fini, depuis le sol fini bas.",
      ],
    },
    frame,
  );
  table.forEach((draw, i) =>
    pages.push({
      info: {
        kind: "installation",
        title:
          table.length > 1
            ? `Fiche de pose — épure des nez (${i + 1}/${table.length})`
            : "Fiche de pose — épure des nez",
      },
      draw,
    }),
  );
  return pages;
}
