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
