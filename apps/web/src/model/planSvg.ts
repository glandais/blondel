/**
 * Rendus SVG de `@blondel/exports` (`renderPlanSvg`, `renderElevationSvg`) pour l'écran : une
 * seule implémentation de la cotation, partagée par l'écran et les exports (ADR-0005). Cette
 * couche capture une exception éventuelle pour l'afficher au lieu de faire planter la vue.
 */
import type { Model, Project } from "@blondel/core";
import { renderElevationSvg, renderPlanSvg } from "@blondel/exports";
import { errorMessage, type Locale, type Message } from "@blondel/i18n";

/**
 * SVG rendu, ou motif de l'échec (`Message` d'une exception métier des exports, sinon texte brut
 * de l'exception), traduit à l'affichage.
 */
export type SvgRenderResult = { readonly svg: string } | { readonly error: Message };

/**
 * Options communes de l'écran : fond transparent (thème de la page), titre du projet, langue
 * d'affichage (textes et nombres du SVG, comme l'export dans cette langue).
 */
export interface ScreenSvgOptions {
  readonly project: Project;
  readonly theme: "light" | "dark";
  readonly locale: Locale;
}

/** Rend un SVG ou le message d'erreur du rendu ; ne lève jamais. */
export function renderWith(render: () => string): SvgRenderResult {
  try {
    return { svg: render() };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export function renderPlanForScreen(model: Model, o: ScreenSvgOptions): SvgRenderResult {
  return renderWith(() =>
    renderPlanSvg(model, {
      project: o.project,
      theme: o.theme,
      background: false,
      title: o.project.name,
      locale: o.locale,
    }),
  );
}

export function renderElevationForScreen(model: Model, o: ScreenSvgOptions): SvgRenderResult {
  return renderWith(() =>
    renderElevationSvg(model, {
      project: o.project,
      theme: o.theme,
      background: false,
      title: o.project.name,
      locale: o.locale,
    }),
  );
}

/**
 * Demi-largeur de la cible de clic posée sur le nez d'arrivée (px du dessin) : la ligne de nez du
 * plan fait 1 px et le point de l'élévation 2,2 px de rayon, trop fins pour un clic sûr. Choix de
 * présentation, sans valeur métier.
 */
export const NOSING_TARGET_HALF_WIDTH_PX = 6;

const escapeAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Valeur numérique d'un attribut d'une balise (`undefined` si absente ou non numérique). */
/** Coordonnée d'affichage arrondie au centième (attribut SVG compact). */
const round2 = (v: number): number => Math.round(v * 100) / 100;

function numAttr(tag: string, name: string): number | undefined {
  const m = new RegExp(`\\s${name}="(-?[\\d.]+)"`).exec(tag);
  if (!m) return undefined;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Cible de clic du nez d'arrivée (QUESTIONS A28), posée par l'interface sur un SVG des exports
 * (rendu par défaut inchangé, instantanés compris) : un élément transparent, plus large que la
 * ligne de nez du plan (`<line data-nosing="k">`, entourée d'un rectangle de demi-largeur
 * `NOSING_TARGET_HALF_WIDTH_PX`, prolongé d'autant aux deux bouts) ou que le point de
 * l'élévation (`<circle data-nosing="k">`, disque), ajouté en dernier (au-dessus des marches et
 * des contours) avec `data-nosing-target="k"`, focalisable (rôle bouton, nom `label`). Un
 * polygone rempli plutôt qu'une ligne à trait épais : la boîte englobante d'une ligne verticale
 * ou horizontale est vide, et le navigateur (comme Playwright) la tient pour invisible. SVG
 * inchangé sans nez `k` ou sans rendu ; ne lève jamais.
 */
export function withNosingTarget(
  result: SvgRenderResult,
  index: number | null,
  label: string,
): SvgRenderResult {
  if (!("svg" in result) || index === null) return result;
  const svg = result.svg;
  const tag = new RegExp(`<(line|circle)\\b[^>]*\\sdata-nosing="${index}"[^>]*/>`).exec(svg);
  const end = svg.lastIndexOf("</svg>");
  if (!tag || end < 0) return result;
  const common = `class="nosing-target" data-nosing-target="${index}" tabindex="0" role="button" aria-label="${escapeAttr(label)}"`;
  let target: string;
  if (tag[1] === "line") {
    const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((a) => numAttr(tag[0], a));
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
      return result;
    }
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!(length > 0)) return result;
    const h = NOSING_TARGET_HALF_WIDTH_PX;
    // Direction de la ligne (d) et normale (n), en unités du dessin.
    const dx = ((x2 - x1) / length) * h;
    const dy = ((y2 - y1) / length) * h;
    const corners = [
      [x1 - dx - dy, y1 - dy + dx],
      [x2 + dx - dy, y2 + dy + dx],
      [x2 + dx + dy, y2 + dy - dx],
      [x1 - dx + dy, y1 - dy - dx],
    ];
    const points = corners.map(([x, y]) => `${round2(x!)},${round2(y!)}`).join(" ");
    target = `<polygon points="${points}" fill="transparent" stroke="none" pointer-events="all" ${common}/>`;
  } else {
    const [cx, cy] = ["cx", "cy"].map((a) => numAttr(tag[0], a));
    if (cx === undefined || cy === undefined) return result;
    target = `<circle cx="${cx}" cy="${cy}" r="${NOSING_TARGET_HALF_WIDTH_PX + 2}" fill="transparent" stroke="none" pointer-events="all" ${common}/>`;
  }
  return { svg: `${svg.slice(0, end)}${target}${svg.slice(end)}` };
}
