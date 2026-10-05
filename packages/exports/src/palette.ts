/**
 * Palette fonctionnelle : SOURCE UNIQUE des couleurs porteuses de sens (sélection, sévérités du
 * contrôle de conception, exigence respectée, trémie), partagée par l'interface (variables CSS
 * `--fn-*` de `apps/web/src/palette.css`, en clair et en sombre), la vue 3D
 * (`apps/web/src/three/materials.ts`) et les SVG exportés (`svg/svg.ts`) : ADR-0009, point 10.
 *
 * Les documents d'atelier (SVG, PDF) restent toujours sur la palette claire ; la palette sombre
 * ne sert qu'à l'affichage à l'écran. Module sans DOM ni dépendance d'exécution.
 */
import type { Severity } from "@blondel/core";

/** Rôle d'une couleur fonctionnelle. */
export type FunctionalRole = "selection" | "blocking" | "warning" | "advice" | "ok" | "opening";

/** Couleurs fonctionnelles d'un thème (`#rrggbb` en minuscules). */
export type FunctionalColors = Readonly<Record<FunctionalRole, string>>;

/** Palette fonctionnelle : thème clair (référence, documents d'atelier) et thème sombre. */
export const FUNCTIONAL_COLORS: {
  readonly light: FunctionalColors;
  readonly dark: FunctionalColors;
} = Object.freeze({
  light: Object.freeze({
    selection: "#ff7a1a",
    blocking: "#b3261e",
    warning: "#9a6200",
    advice: "#416180",
    ok: "#2e7d32",
    opening: "#6e40c9",
  }),
  dark: Object.freeze({
    selection: "#ff9a4d",
    blocking: "#f28b82",
    warning: "#f0b85a",
    advice: "#94bce3",
    ok: "#81c995",
    opening: "#a58cf0",
  }),
});

/** Couleurs fonctionnelles du thème demandé. */
export function functionalColors(theme: "light" | "dark"): FunctionalColors {
  return theme === "dark" ? FUNCTIONAL_COLORS.dark : FUNCTIONAL_COLORS.light;
}

/** Rôle de couleur d'une sévérité du contrôle de conception. */
export function severityRole(s: Severity): "blocking" | "warning" | "advice" {
  return s === "bloquant" ? "blocking" : s === "avertissement" ? "warning" : "advice";
}
