/**
 * Dessin de plan indépendant du format : ce qu'il faut tracer (en mm, repère monde), sans
 * décider comment. `renderPlanSvg` et `exportPlanDxf` en sont deux rendus : une seule
 * implémentation de la cotation (ADR-0005).
 */
import {
  curveLength,
  curvePointAt,
  curveTangentAt,
  vec2,
  type Layout,
  type LayoutSection,
  type Mm,
  type Model,
  type Project,
  type Severity,
  type TreadKind,
  type Vec2,
} from "@blondel/core";
import {
  drawingThousands,
  locateViolations,
  modelOpening,
  violationSummary,
  worstSeverity,
} from "../annotations.js";
import { formatIn } from "../format.js";
import type { MessageKey } from "@blondel/i18n";
import { translatorOf, type LocaleOption, type Translator } from "../i18n.js";
import { bandContour, curvePath, pathExtentPoints, polygonPath, type PlanPath } from "../path.js";
import {
  helicalCartouche,
  helicalLabelPoint,
  helicalLandingPath,
  helicalTreadPath,
} from "./helical.js";

/**
 * Libellé clair de la méthode d'une zone balancée (`Stepping.balancedZones[].method` :
 * `M3-quintic`, `M1`…), le même que dans le panneau Balancement et l'inspecteur (spécification
 * de contenu § 4, « M3 · courbe continue (quintique) ») ; identifiant brut si la méthode est
 * inconnue (stratégie tierce).
 */
const ZONE_METHOD_LABELS: Readonly<Record<string, MessageKey>> = {
  M0: "balancing.method.M0",
  M1: "balancing.method.M1",
  M2: "balancing.method.M2",
  M3: "balancing.method.M3",
  "M3-cubic": "stepping.method.m3Cubic",
  "M3-quintic": "stepping.method.m3Quintic",
  M6: "balancing.method.M6",
};

/** Fonction d'un élément de dessin (calque DXF, groupe SVG). */
export type PlanLayer = "CONTOUR" | "MARCHES" | "NEZ" | "FOULEE" | "TREMIE" | "COTES" | "TEXTE";

/**
 * `radius` : rayon extérieur R_e d'un hélicoïdal (de l'axe au bord extérieur), ou rayon d'un
 * tronçon à axe en arc d'une cage (mesuré sur le bord d'ancrage). `section` : longueur de la
 * partie droite d'un tronçon de cage, mesurée sur le bord d'ancrage (F11) ; `landing` :
 * profondeur d'un palier droit de cage (ADR-0010, sous-lot 2e).
 */
export type DimensionRole =
  "width" | "leg" | "run" | "going" | "height" | "radius" | "section" | "landing";

/**
 * Cote linéaire alignée : points mesurés `a` et `b`, ligne de cote décalée de `offset` selon
 * la normale unitaire `normal`. La valeur affichée est la distance réelle |ab|.
 */
export interface Dimension {
  readonly role: DimensionRole;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly normal: Vec2;
  readonly offset: Mm;
  /**
   * Valeur cotée : distance a → b, sauf le giron d'une marche dansante (escalier sans marche
   * droite, décision F10 (9)), mesuré sur la ligne de foulée (arc) et coté sur la corde a → b.
   */
  readonly value: Mm;
  readonly text: string;
}

export interface PlanTread {
  readonly number: number;
  readonly kind: TreadKind;
  readonly surface: PlanPath;
  /** Position du numéro (milieu de la marche, côté mur de la ligne de foulée). */
  readonly label: Vec2;
  readonly severity?: Severity;
}

export interface PlanNosing {
  readonly index: number;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly balanced: boolean;
  readonly severity?: Severity;
}

/**
 * Annotation ponctuelle du plan coté d'une cage (ADR-0010, sous-lot 2e) : angle d'une jonction,
 * balayage d'un axe en arc, raccord côté jour (rayon, pan coupé) ou côté mur (rayon du congé).
 * Texte horizontal centré sur `at`, calque des cotes.
 */
export interface PlanLabel {
  readonly kind: "junctionAngle" | "sweep" | "wellJoint" | "wallJoint";
  readonly at: Vec2;
  readonly text: string;
}

export interface PlanDrawing {
  /** Contour de l'escalier (jour, arrivée, mur, départ), arcs exacts. */
  readonly contour: PlanPath;
  readonly treads: readonly PlanTread[];
  /** Palier d'arrivée d'un hélicoïdal (secteur à arcs exacts) ; absent sinon. */
  readonly landing?: PlanPath;
  readonly nosings: readonly PlanNosing[];
  /** Ligne de foulée complète, cercle de départ, flèche de montée (triangle fermé). */
  readonly walkline: PlanPath;
  readonly walklineStart: { readonly center: Vec2; readonly radius: Mm };
  readonly arrow: PlanPath;
  readonly opening?: PlanPath;
  readonly dimensions: readonly Dimension[];
  /** Annotations ponctuelles d'une cage saisie (`Layout.cage`) ; absentes sinon. */
  readonly labels?: readonly PlanLabel[];
  readonly markers: readonly {
    readonly at: Vec2;
    readonly radius: Mm;
    readonly severity: Severity;
  }[];
  /** Lignes du cartouche (hauteur, 2h + g, reculement…). */
  readonly cartouche: readonly string[];
  /** Emprise (mm) de tout le dessin, cotes comprises, cartouche exclu. */
  readonly bounds: { readonly min: Vec2; readonly max: Vec2 };
  /** Hauteur de texte de référence (mm) choisie pour ce dessin. */
  readonly textHeight: Mm;
}

export interface PlanDrawingOptions extends LocaleOption {
  /**
   * Projet source, en repli : la trémie est lue dans `Model.upperFloor` (pipeline) ; le projet
   * ne sert qu'à un modèle construit hors pipeline, qui ne la porte pas.
   */
  readonly project?: Project;
  /** Distance entre l'élément coté et la ligne de cote (mm). Défaut : 3 × hauteur de texte. */
  readonly dimensionOffset?: Mm;
  /** Hauteur de texte (mm). Défaut : proportionnelle à l'emmarchement, bornée à [40 ; 100]. */
  readonly textHeight?: Mm;
  /** Décimales des cotes (défaut 0 : cotes d'implantation au mm, ADR-0003). */
  readonly decimals?: number;
}

const fmt = (tx: Translator, v: number, decimals: number): string =>
  formatIn(tx, v, { decimals, thousands: drawingThousands(tx), trimZeros: false });

/** Normale unitaire vers l'extérieur du mur (côté opposé au jour) pour une tangente donnée. */
function outwardFromOuter(tangent: Vec2, innerSide: "left" | "right"): Vec2 {
  return innerSide === "left" ? vec2.perpRight(tangent) : vec2.perpLeft(tangent);
}

function dimension(
  tx: Translator,
  role: DimensionRole,
  a: Vec2,
  b: Vec2,
  normal: Vec2,
  offset: Mm,
  decimals: number,
  label?: MessageKey,
  /** Valeur cotée quand elle diffère de la distance a → b (giron d'une dansante, sur Γ). */
  measured?: Mm,
): Dimension {
  const value = measured ?? vec2.distance(a, b);
  const shown = fmt(tx, value, decimals);
  return {
    role,
    a,
    b,
    normal,
    offset,
    value,
    text: label === undefined ? shown : tx.t(label, { value: shown }),
  };
}

/** Ligne de synthèse du contrôle de conception (cartouches du plan et de l'élévation). */
export function complianceSummaryLine(tx: Translator, model: Pick<Model, "compliance">): string {
  const s = violationSummary(model.compliance);
  return tx.t("drawing.common.complianceSummary", {
    blocking: String(s.bloquant),
    warning: String(s.avertissement),
    advice: String(s.conseil),
  });
}

/** Construit le dessin de plan d'un modèle. */
export function buildPlanDrawing(model: Model, options: PlanDrawingOptions = {}): PlanDrawing {
  const tx = translatorOf(options);
  const { layout, stepping } = model;
  const helical = layout.helical;
  const decimals = options.decimals ?? 0;
  const first = stepping.nosings[0];
  // Emmarchement E : largeur de la ligne de départ (entre bords). Le nez 0 ne convient pas :
  // balancé (zone « libre » d'un quart tournant bas, CHALLENGE G3), |q₀r₀| dépasse E.
  const departInner = curvePointAt(layout.inner, 0);
  const departOuter = curvePointAt(layout.outer, 0);
  const width = vec2.distance(departInner, departOuter);
  const textHeight = options.textHeight ?? Math.min(100, Math.max(40, width / 15));
  const dimOffset = options.dimensionOffset ?? 3 * textHeight;
  const violations = locateViolations(model.compliance);

  const contour = bandContour(layout.inner, layout.outer);

  // Marches : surface de marche visible, numéro au milieu côté mur. Hélicoïdal : secteurs à arcs
  // exacts, numéros sur un anneau par tour (les tours se recouvrent en plan).
  const nosingByIndex = new Map(stepping.nosings.map((n) => [n.index, n]));
  const treads: PlanTread[] = stepping.treads.map((t) => {
    const n0 = nosingByIndex.get(t.number - 1);
    const n1 = nosingByIndex.get(t.number);
    let label: Vec2;
    if (helical && n0 && n1) {
      label = helicalLabelPoint(helical, t.number);
    } else if (n0 && n1) {
      const m0 = vec2.lerp(n0.p, n0.r, 0.5);
      const m1 = vec2.lerp(n1.p, n1.r, 0.5);
      label = vec2.lerp(m0, m1, 0.5);
    } else {
      const pts = t.walkingSurface;
      label = pts.reduce((acc, p) => vec2.add(acc, vec2.scale(p, 1 / pts.length)), vec2.ZERO);
    }
    const severity = violations.treads.get(t.number);
    return {
      number: t.number,
      kind: t.kind,
      surface:
        helical && n0 && n1 ? helicalTreadPath(helical, t.number) : polygonPath(t.walkingSurface),
      label,
      ...(severity !== undefined ? { severity } : {}),
    };
  });

  const nosings: PlanNosing[] = stepping.nosings.map((n) => {
    const severity = violations.nosings.get(n.index);
    return {
      index: n.index,
      a: n.q,
      b: n.r,
      balanced: n.balanced,
      ...(severity !== undefined ? { severity } : {}),
    };
  });

  // Ligne de foulée : cercle au départ, flèche de montée à l'arrivée.
  const walkline = curvePath(layout.walkline);
  const L = curveLength(layout.walkline);
  const start = curvePointAt(layout.walkline, 0);
  const end = curvePointAt(layout.walkline, L);
  const tEnd = curveTangentAt(layout.walkline, L);
  // Modèle partiel (`Model.errors`) : giron éventuellement non fini, la flèche reste dessinée.
  const going = Number.isFinite(stepping.going) ? stepping.going : 0;
  const arrowLen = Math.min(Math.max(going * 0.6, 2 * textHeight), 250);
  const back = vec2.addScaled(end, tEnd, -arrowLen);
  const side = vec2.scale(vec2.perpLeft(tEnd), arrowLen / 3);
  const arrow = polygonPath([end, vec2.add(back, side), vec2.sub(back, side)]);

  const opening = modelOpening(model, options.project);
  const landing = helical ? helicalLandingPath(helical) : undefined;

  // ---------------------------------------------------------------- cotes
  const dims: Dimension[] = [];
  if (width > 0 && !(layout.cage === true && layout.sections !== undefined)) {
    const t0 = curveTangentAt(layout.walkline, 0);
    dims.push(
      dimension(tx, "width", departInner, departOuter, vec2.scale(t0, -1), dimOffset, decimals),
    );
  }
  // Cage saisie (ADR-0010) : cotes par tronçon (longueur de partie droite, largeurs, rayon et
  // balayage d'un axe en arc, angles des jonctions, palier droit, raccords).
  const cage = layout.cage === true && layout.sections !== undefined ? layout.sections : undefined;
  const labels: PlanLabel[] = [];
  if (cage) {
    const c = cageAnnotations(tx, layout, cage, dimOffset, textHeight, decimals);
    dims.push(...c.dims);
    labels.push(...c.labels);
  }
  // Longueurs de volées : tronçons droits du bord extérieur (mesure de `LegSchema.length`).
  for (const seg of cage ? [] : layout.outer.segments) {
    if (seg.kind !== "line") continue;
    const len = vec2.distance(seg.a, seg.b);
    if (len < 1) continue;
    const t = vec2.normalize(vec2.sub(seg.b, seg.a));
    dims.push(
      dimension(
        tx,
        "leg",
        seg.a,
        seg.b,
        outwardFromOuter(t, layout.innerSide),
        dimOffset,
        decimals,
      ),
    );
  }
  const last = stepping.nosings[stepping.nosings.length - 1];
  if (helical) {
    // Rayon extérieur R_e, sur le rayon de départ, au-delà de la cote d'emmarchement.
    const t0 = curveTangentAt(layout.walkline, 0);
    dims.push(
      dimension(
        tx,
        "radius",
        helical.center,
        departOuter,
        vec2.scale(t0, -1),
        2 * dimOffset + textHeight,
        decimals,
        "drawing.dimension.radius",
      ),
    );
  }
  if (
    first &&
    last &&
    layout.turns.length === 0 &&
    last !== first &&
    !helical &&
    !cage?.some((s) => s.kind === "arc")
  ) {
    // Droit : reculement coté côté jour, du premier au dernier nez. Cage à axe en arc : pas de
    // corde entre nez (le reculement du cartouche est celui de la ligne de foulée).
    const t = vec2.normalize(vec2.sub(last.q, first.q));
    const inward = vec2.scale(outwardFromOuter(t, layout.innerSide), -1);
    const run = dimension(tx, "run", first.q, last.q, inward, dimOffset, decimals);
    // Reculement égal à la longueur de volée : une seule cote (celle de la volée).
    if (
      !dims.some(
        (d) => (d.role === "leg" || d.role === "section") && Math.abs(d.value - run.value) < 0.5,
      )
    )
      dims.push(run);
  }
  // Giron sur la ligne de foulée : première marche droite entre deux nez non balancés. Sans
  // aucune marche droite (hélicoïdal, cage en arc seul), première marche dansante (plus petit
  // numéro : un ordre et non un minimum, stable face au bruit), décision F10 (9) : la ligne de
  // cote est la corde n0.p → n1.p, la valeur cotée est le giron de la marche mesuré sur la
  // ligne de foulée (longueur d'arc, `Tread.going`).
  const goingDim = (n0: Vec2, n1: Vec2, measured?: Mm): Dimension => {
    const t = vec2.normalize(vec2.sub(n1, n0));
    const inward = vec2.scale(outwardFromOuter(t, layout.innerSide), -1);
    const off = Math.min(layout.walklineOffset / 2, dimOffset);
    return dimension(
      tx,
      "going",
      n0,
      n1,
      inward,
      off,
      Math.max(decimals, 1),
      "drawing.dimension.going",
      measured,
    );
  };
  let goingPlaced = false;
  for (let k = 0; k + 1 < stepping.nosings.length; k++) {
    const n0 = stepping.nosings[k]!;
    const n1 = stepping.nosings[k + 1]!;
    const tread = stepping.treads.find((t) => t.number === n1.index);
    if (n0.balanced || n1.balanced || tread?.kind !== "straight") continue;
    dims.push(goingDim(n0.p, n1.p));
    goingPlaced = true;
    break;
  }
  if (!goingPlaced && !stepping.treads.some((t) => t.kind === "straight")) {
    for (let k = 0; k + 1 < stepping.nosings.length; k++) {
      const n0 = stepping.nosings[k]!;
      const n1 = stepping.nosings[k + 1]!;
      const tread = stepping.treads.find((t) => t.number === n1.index);
      if (tread?.kind !== "winder") continue;
      dims.push(goingDim(n0.p, n1.p, tread.going));
      break;
    }
  }

  const markers = violations.points.map((p) => ({
    at: p.at,
    radius: textHeight,
    severity: p.severity,
  }));

  // ---------------------------------------------------------------- cartouche
  const H = stepping.rises.reduce((a, b) => a + b, 0);
  const n = stepping.riserCount;
  const v = (x: number, d: number): { value: string } => ({ value: fmt(tx, x, d) });
  const cartouche: string[] = [
    tx.t("drawing.plan.totalRise", v(H, 0)),
    tx.t("drawing.plan.rises", { count: n, ...v(stepping.rise, 1) }),
  ];
  const r0 = stepping.rises[0];
  if (r0 !== undefined && Math.abs(r0 - stepping.rise) > 0.05) {
    cartouche.push(tx.t("drawing.plan.firstRise", v(r0, 1)));
  }
  cartouche.push(
    tx.t("drawing.plan.going", v(stepping.going, 1)),
    tx.t("drawing.plan.blondel", v(stepping.blondel, 1)),
    tx.t("drawing.plan.run", v(stepping.run, 0)),
    widthLine(tx, layout, width, v),
  );
  if (helical) cartouche.push(...helicalCartouche(helical, tx));
  if (model.headroom) cartouche.push(tx.t("drawing.plan.headroom", v(model.headroom.min, 0)));
  cartouche.push(complianceSummaryLine(tx, model));
  if (stepping.balancedZones.length > 0) {
    const zones = stepping.balancedZones
      .map((z) =>
        tx.t("drawing.plan.balancingZone", {
          method: Object.hasOwn(ZONE_METHOD_LABELS, z.method)
            ? tx.t(ZONE_METHOD_LABELS[z.method]!)
            : z.method,
          from: String(z.from),
          to: String(z.to),
        }),
      )
      .join(" ; ");
    cartouche.push(tx.t("drawing.plan.balancing", { zones }));
  }

  // ---------------------------------------------------------------- emprise
  const pts: Vec2[] = [...pathExtentPoints(contour), ...pathExtentPoints(walkline)];
  for (const t of treads) pts.push(...pathExtentPoints(t.surface));
  if (landing) pts.push(...pathExtentPoints(landing));
  if (opening) pts.push(...opening);
  for (const d of dims) {
    const o = vec2.scale(d.normal, d.offset + 1.5 * textHeight);
    pts.push(vec2.add(d.a, o), vec2.add(d.b, o));
  }
  for (const l of labels) {
    const half = { x: (l.text.length * textHeight) / 2, y: textHeight };
    pts.push(vec2.sub(l.at, half), vec2.add(l.at, half));
  }
  for (const m of markers) {
    pts.push(
      vec2.sub(m.at, { x: m.radius, y: m.radius }),
      vec2.add(m.at, { x: m.radius, y: m.radius }),
    );
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const bounds = {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };

  return {
    contour,
    treads,
    ...(landing ? { landing } : {}),
    nosings,
    walkline,
    walklineStart: { center: start, radius: textHeight / 2 },
    arrow,
    ...(opening ? { opening: polygonPath(opening) } : {}),
    dimensions: dims,
    ...(cage ? { labels } : {}),
    markers,
    cartouche,
    bounds,
    textHeight,
  };
}

/**
 * Ligne « Emmarchement » du cartouche : E de la ligne de départ ; cage saisie de largeur
 * variable : plus petite et plus grande largeur des tronçons.
 */
function widthLine(
  tx: Translator,
  layout: Layout,
  width: Mm,
  v: (x: number, d: number) => { value: string },
): string {
  const sections = layout.cage === true ? (layout.sections ?? []) : [];
  const widths = sections.flatMap((s) => [s.widthStart, s.widthEnd]);
  if (widths.length > 0) {
    const min = Math.min(...widths);
    const max = Math.max(...widths);
    if (max - min >= 0.5) {
      return tx.t("drawing.plan.widthRange", { min: v(min, 0).value, max: v(max, 0).value });
    }
  }
  return tx.t("drawing.plan.width", v(width, 0));
}

/** Milieu d'une ligne transversale de tronçon. */
const midOf = (l: LayoutSection["start"]): Vec2 => vec2.lerp(l.left, l.right, 0.5);

/**
 * Direction de montée (unitaire) d'un tronçon droit : perpendiculaire à ses lignes de départ et
 * d'arrivée (parallèles, F11), orientée du départ vers l'arrivée.
 */
function sectionDirection(s: LayoutSection): Vec2 {
  const across = vec2.sub(s.start.right, s.start.left);
  let u = vec2.normalize(vec2.perpLeft(across));
  if (vec2.dot(u, vec2.sub(midOf(s.end), midOf(s.start))) < 0) u = vec2.scale(u, -1);
  return u;
}

/**
 * Normale unitaire d'une ligne transversale `from`, orientée vers la ligne `to` (palier droit
 * derrière un tronçon en arc : ligne radiale d'arrivée).
 */
function lineNormalToward(from: LayoutSection["start"], to: LayoutSection["start"]): Vec2 {
  let u = vec2.normalize(vec2.perpLeft(vec2.sub(from.right, from.left)));
  if (vec2.dot(u, vec2.sub(midOf(to), midOf(from))) < 0) u = vec2.scale(u, -1);
  return u;
}

/** Normale unitaire vers l'extérieur du bord `side` d'un tronçon de direction `u`. */
const sideNormal = (u: Vec2, side: "left" | "right"): Vec2 =>
  side === "left" ? vec2.perpLeft(u) : vec2.perpRight(u);

const otherSide = (side: "left" | "right"): "left" | "right" =>
  side === "left" ? "right" : "left";

/**
 * Cotes et annotations d'une cage saisie (ADR-0010, sous-lot 2e), lues dans `Layout.sections`
 * et `Layout.turns` :
 * - longueur de la partie droite de chaque tronçon droit, distance entre ses lignes de départ et
 *   d'arrivée (parallèles), qui est la longueur mesurée sur le bord d'ancrage (F11), cotée du
 *   côté opposé au jour (côté mur) ;
 * - largeur de départ du premier tronçon, puis chaque largeur qui change (début d'un tronçon de
 *   largeur différente, fin d'un trapèze) ;
 * - axe en arc : rayon (du centre au bord d'ancrage) et balayage ;
 * - jonction tournante : angle (valeur absolue, sens lu sur le dessin) au coin du jour, raccord
 *   côté jour (rayon, pan coupé) et côté mur (rayon du congé) ;
 * - palier droit : profondeur (distance entre l'arrivée du tronçon entrant et le départ du
 *   tronçon sortant), du même côté que les longueurs.
 */
function cageAnnotations(
  tx: Translator,
  layout: Layout,
  sections: readonly LayoutSection[],
  dimOffset: Mm,
  textHeight: Mm,
  decimals: number,
): { dims: Dimension[]; labels: PlanLabel[] } {
  const dims: Dimension[] = [];
  const labels: PlanLabel[] = [];
  const near = textHeight;
  const deg = (rad: number): string =>
    formatIn(tx, Math.abs((rad * 180) / Math.PI), {
      decimals: 1,
      thousands: drawingThousands(tx),
      trimZeros: true,
    });
  const mmText = (x: number): string => fmt(tx, x, decimals);
  /** Côté coté (longueurs, paliers) : opposé au jour de la jonction voisine. */
  const dimSide = (s: LayoutSection): "left" | "right" => {
    const well = s.startWellSide ?? s.endWellSide;
    return well !== undefined ? otherSide(well) : otherSide(layout.innerSide);
  };
  /** Cote de la distance entre deux lignes transversales parallèles, côté `side`. */
  const between = (
    role: DimensionRole,
    from: LayoutSection["start"],
    to: LayoutSection["start"],
    u: Vec2,
    side: "left" | "right",
  ): Dimension | null => {
    const length = vec2.dot(vec2.sub(to.left, from.left), u);
    if (!(length >= 1)) return null;
    const a = from[side];
    const b = vec2.addScaled(a, u, length);
    const normal = sideNormal(u, side);
    // Bord évasé (trapèze) : la ligne de cote passe au-delà du coin le plus saillant.
    const reach = Math.max(0, vec2.dot(vec2.sub(to[side], a), normal));
    return dimension(tx, role, a, b, normal, dimOffset + reach, decimals);
  };

  sections.forEach((s, i) => {
    const prev = sections[i - 1];
    if (s.kind === "straight") {
      const u = sectionDirection(s);
      const d = between("section", s.start, s.end, u, dimSide(s));
      if (d) dims.push(d);
      const changes = prev === undefined || Math.abs(s.widthStart - prev.widthEnd) >= 0.5;
      if (changes && s.widthStart > 0) {
        dims.push(
          dimension(
            tx,
            "width",
            s.start.left,
            s.start.right,
            vec2.scale(u, -1),
            i === 0 ? dimOffset : near,
            decimals,
          ),
        );
      }
      if (Math.abs(s.widthEnd - s.widthStart) >= 0.5 && s.widthEnd > 0) {
        dims.push(
          dimension(
            tx,
            "width",
            s.end.left,
            s.end.right,
            u,
            i === sections.length - 1 ? dimOffset : near,
            decimals,
          ),
        );
      }
    } else if (s.arc) {
      const { center, radius, sweep } = s.arc;
      const dir0 = vec2.normalize(vec2.sub(midOf(s.start), center));
      const onAnchor = vec2.addScaled(center, dir0, radius);
      dims.push(
        dimension(
          tx,
          "radius",
          center,
          onAnchor,
          vec2.perpLeft(dir0),
          0,
          decimals,
          "drawing.dimension.radius",
        ),
      );
      // Même règle qu'un tronçon droit : largeur de départ, puis largeur qui change.
      const changes = prev === undefined || Math.abs(s.widthStart - prev.widthEnd) >= 0.5;
      if (changes && s.widthStart > 0) {
        const tangent = vec2.scale(vec2.perpLeft(dir0), Math.sign(sweep) || 1);
        dims.push(
          dimension(
            tx,
            "width",
            s.start.left,
            s.start.right,
            vec2.scale(tangent, -1),
            i === 0 ? dimOffset : near,
            decimals,
          ),
        );
      }
      labels.push({
        kind: "sweep",
        at: vec2.addScaled(center, vec2.rotate(dir0, sweep / 2), radius),
        text: tx.t("drawing.plan.sweep", { value: deg(sweep) }),
      });
    }
  });

  for (const z of layout.turns) {
    const before = sections[z.index];
    const after = sections[z.index + 1];
    if (z.angle === 0) {
      // Palier droit : profondeur entre l'arrivée du tronçon entrant et le départ du sortant,
      // mesurée perpendiculairement à la ligne d'arrivée (tronçon entrant en arc : ligne radiale,
      // comme `lineGap` de la fiche de pose).
      if (before && after) {
        const u =
          before.kind === "straight"
            ? sectionDirection(before)
            : lineNormalToward(before.end, after.start);
        const d = between(
          "landing",
          before.end,
          after.start,
          u,
          dimSide(before.kind === "straight" ? before : after),
        );
        if (d) dims.push(d);
      }
      continue;
    }
    // Côté du vide au coin du jour : du coin extérieur vers le coin intérieur, prolongé.
    const away = vec2.normalize(vec2.sub(z.innerCorner, z.outerCorner));
    const angle = z.angle ?? (z.direction === "left" ? Math.PI / 2 : -Math.PI / 2);
    labels.push({
      kind: "junctionAngle",
      at: vec2.addScaled(z.innerCorner, away, 1.5 * textHeight),
      text: tx.t("drawing.plan.junctionAngle", { value: deg(angle) }),
    });
    const well = z.well;
    if (well?.kind === "arc") {
      labels.push({
        kind: "wellJoint",
        at: vec2.addScaled(z.innerCorner, away, 4 * textHeight),
        text: tx.t("drawing.dimension.radius", { value: mmText(well.radius) }),
      });
    } else if (well?.kind === "chamfer") {
      labels.push({
        kind: "wellJoint",
        at: vec2.addScaled(z.innerCorner, away, 4 * textHeight),
        text: tx.t("drawing.plan.chamfer", {
          setbackIn: mmText(well.setbackIn),
          setbackOut: mmText(well.setbackOut),
        }),
      });
    }
    const wall = z.wall;
    if (wall?.kind === "arc") {
      // Congé côté mur : le coin W (`outerCorner`) est virtuel ; l'étiquette va au milieu de
      // l'arc du congé, à R / cos(|angle| / 2) − R de W vers le jour (bissectrice approchée par
      // la direction W → coin du jour), décalée vers W pour rester hors des marches.
      const toArc = wall.radius / Math.cos(Math.abs(angle) / 2) - wall.radius;
      labels.push({
        kind: "wallJoint",
        at: vec2.addScaled(z.outerCorner, away, toArc - 1.5 * textHeight),
        text: tx.t("drawing.dimension.radius", { value: mmText(wall.radius) }),
      });
    }
  }
  return { dims, labels };
}

/** Géométrie d'une cote : ligne de cote, lignes d'attache, position et angle du texte. */
export interface DimensionGeometry {
  readonly line: readonly [Vec2, Vec2];
  readonly extensions: readonly (readonly [Vec2, Vec2])[];
  /** Traits obliques (convention architecture) aux deux extrémités. */
  readonly ticks: readonly (readonly [Vec2, Vec2])[];
  readonly textAt: Vec2;
  /** Angle du texte (rad, sens trigonométrique), ramené dans ]−90° ; 90°] pour la lisibilité. */
  readonly textAngle: number;
}

export function dimensionGeometry(d: Dimension, textHeight: Mm): DimensionGeometry {
  const o = vec2.scale(d.normal, d.offset);
  const a1 = vec2.add(d.a, o);
  const b1 = vec2.add(d.b, o);
  const gap = textHeight * 0.3;
  const over = textHeight * 0.4;
  const ext = (p: Vec2): readonly [Vec2, Vec2] => [
    vec2.addScaled(p, d.normal, Math.sign(d.offset) * gap),
    vec2.addScaled(p, d.normal, d.offset + Math.sign(d.offset) * over),
  ];
  // Cote nulle (modèle partiel) : direction quelconque perpendiculaire à la normale.
  const u = d.value > 1e-9 ? vec2.normalize(vec2.sub(d.b, d.a)) : vec2.perpRight(d.normal);
  const tickDir = vec2.scale(vec2.normalize(vec2.add(u, d.normal)), textHeight * 0.35);
  const tick = (p: Vec2): readonly [Vec2, Vec2] => [vec2.sub(p, tickDir), vec2.add(p, tickDir)];
  let angle = Math.atan2(u.y, u.x);
  if (angle > Math.PI / 2 + 1e-9) angle -= Math.PI;
  else if (angle <= -Math.PI / 2 + 1e-9) angle += Math.PI;
  // Texte centré (horizontalement et verticalement) du côté extérieur de la ligne de cote.
  const textAt = vec2.addScaled(
    vec2.lerp(a1, b1, 0.5),
    d.normal,
    Math.sign(d.offset || 1) * textHeight * 0.8,
  );
  return {
    line: [a1, b1],
    extensions: d.offset === 0 ? [] : [ext(d.a), ext(d.b)],
    ticks: [tick(a1), tick(b1)],
    textAt,
    textAngle: angle,
  };
}
