/**
 * Rendus SVG de `@blondel/exports` (`renderPlanSvg`, `renderElevationSvg`) pour l'écran : une
 * seule implémentation de la cotation, partagée par l'écran et les exports (ADR-0005). Cette
 * couche capture une exception éventuelle pour l'afficher au lieu de faire planter la vue.
 */
import type { Model, Project } from "@blondel/core";
import { renderElevationSvg, renderPlanSvg } from "@blondel/exports";

export type SvgRenderResult = { readonly svg: string } | { readonly error: string };

/** Options communes de l'écran : fond transparent (thème de la page), titre du projet. */
export interface ScreenSvgOptions {
  readonly project: Project;
  readonly theme: "light" | "dark";
}

/** Rend un SVG ou le message d'erreur du rendu ; ne lève jamais. */
export function renderWith(render: () => string): SvgRenderResult {
  try {
    return { svg: render() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function renderPlanForScreen(model: Model, o: ScreenSvgOptions): SvgRenderResult {
  return renderWith(() =>
    renderPlanSvg(model, {
      project: o.project,
      theme: o.theme,
      background: false,
      title: o.project.name,
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
    }),
  );
}
