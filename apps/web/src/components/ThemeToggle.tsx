/**
 * Thème clair / sombre / système : attribut `data-theme` sur `<html>`, choix mémorisé dans le
 * navigateur (préférence locale, sans conséquence si le stockage est indisponible).
 */
import { useEffect, useId, useState } from "react";
import { useT } from "../i18n/useT.js";
import { appStore, useApp } from "../store/appStore.js";
import type { ThemeChoice } from "../store/projectStore.js";

const KEY = "blondel.theme";

function readTheme(): ThemeChoice {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const darkQuery = (): MediaQueryList | undefined =>
  typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;

/** Thème effectivement affiché (le choix « système » suit la préférence du navigateur). */
export function useResolvedTheme(): "light" | "dark" {
  const choice = useApp((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);
  useEffect(() => {
    const q = darkQuery();
    if (!q) return;
    const on = () => setSystemDark(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

export function ThemeToggle() {
  const t = useT();
  const theme = useApp((s) => s.theme);
  const id = useId();
  useEffect(() => {
    appStore.getState().setTheme(readTheme());
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      globalThis.localStorage?.setItem(KEY, theme);
    } catch {
      // Stockage indisponible : le choix vaut pour la session.
    }
  }, [theme]);
  return (
    <>
      <label htmlFor={id}>{t.t("ui.theme.label")}</label>
      <select
        id={id}
        value={theme}
        onChange={(e) => appStore.getState().setTheme(e.target.value as ThemeChoice)}
      >
        <option value="system">{t.t("ui.theme.system")}</option>
        <option value="light">{t.t("ui.theme.light")}</option>
        <option value="dark">{t.t("ui.theme.dark")}</option>
      </select>
    </>
  );
}
