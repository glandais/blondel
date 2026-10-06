/**
 * Marque ◆ « à valider » (`TvMark`) : glyphe toujours masqué aux lecteurs d'écran, texte lu à sa
 * place (« à valider », « n valeurs à valider »), variante silencieuse, en français et en
 * anglais.
 */
import { translatorFor } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { appStore } from "../../store/appStore.js";
import { TvMark, tvMarkText, type TvMarkProps } from "./TvMark.js";

appStore.getInitialState = appStore.getState;

afterEach(() => appStore.getState().setLocale("fr"));

function render(props: TvMarkProps = {}, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(TvMark, props));
}

/** Texte hors des éléments aria-hidden (ce que lit un lecteur d'écran). */
const spoken = (html: string): string =>
  html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

describe("TvMark", () => {
  it("sans compte : glyphe masqué, « à valider » lu", () => {
    const html = render();
    expect(html).toBe(
      '<span class="tv-mark" aria-hidden="true">◆</span><span class="visually-hidden"> à valider</span>',
    );
    expect(spoken(html)).toBe("à valider");
  });

  it("avec un compte : « ◆3 » visible, « 3 valeurs à valider » lu (pluriel)", () => {
    expect(render({ count: 3 })).toContain('aria-hidden="true">◆3</span>');
    expect(spoken(render({ count: 3 }))).toBe("3 valeurs à valider");
    expect(spoken(render({ count: 1 }))).toBe("1 valeur à valider");
  });

  it("silencieux : glyphe seul, rien de lu ; ton hérité et classes ajoutées", () => {
    const html = render({ silent: true, tone: "inherit", className: "x" });
    expect(html).toBe('<span class="tv-mark tv-mark--inherit x" aria-hidden="true">◆</span>');
    expect(spoken(html)).toBe("");
  });

  it("anglais : texte lu traduit, jamais le glyphe", () => {
    expect(spoken(render({}, "en"))).toBe("to be validated");
    expect(spoken(render({ count: 2 }, "en"))).toBe("2 values to be validated");
    for (const locale of ["fr", "en"] as const) {
      const t = translatorFor(locale);
      expect(tvMarkText(t)).not.toContain("◆");
      expect(tvMarkText(t, 4)).not.toContain("◆");
    }
  });
});
