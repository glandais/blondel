/**
 * Champ « Auto | Imposer » (AutoIntField) : rendu des deux modes, Auto impossible, et anglais
 * sans texte français (rendu serveur, comme `paramsPanel.i18n.test.ts`).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { appStore } from "../store/appStore.js";
import { AutoIntField, type AutoIntFieldProps } from "./fields.js";

// Rendu serveur : zustand lit `getInitialState()` ; le test rend l'état courant du store.
appStore.getInitialState = appStore.getState;

afterEach(() => appStore.getState().setLocale("fr"));

const ok = () => ({ ok: true }) as const;

function render(props: Partial<AutoIntFieldProps>, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(
    createElement(AutoIntField, {
      label: "Volée 1 (bord extérieur)",
      value: "auto",
      fallback: 2700,
      onCommit: ok,
      ...props,
    }),
  );
}

/** Boutons du segmenté, dans l'ordre : [Auto, Imposer]. */
function pressed(html: string): string[] {
  return [...html.matchAll(/<button[^>]*class="seg-opt"[^>]*aria-pressed="(true|false)"/g)].map(
    (m) => m[1]!,
  );
}

describe("AutoIntField", () => {
  it("mode Auto : Auto enfoncé, valeur calculée affichée, aucun champ de saisie", () => {
    const html = render({ computed: 2700 });
    expect(pressed(html)).toEqual(["true", "false"]);
    expect(html).toContain('aria-label="Volée 1 (bord extérieur) : automatique"');
    expect(html).toMatch(/>Auto</);
    expect(html).toMatch(/>Imposer</);
    expect(html).toMatch(/>2\s700 mm</);
    expect(html).toMatch(/aria-label="Volée 1 \(bord extérieur\) : imposer 2\s700 mm"/);
    expect(html).not.toContain("<input");
    expect(html).toContain('role="group"');
  });

  it("sans valeur calculée : libellé neutre, jamais la valeur de repli", () => {
    const html = render({ fallback: 1 });
    expect(html).toMatch(/>calculé</);
    expect(html).not.toMatch(/>\s*1(\s*mm)?\s*</);
    expect(html).not.toContain("imposer 1");
    // Valeur calculée non finie : traitée comme absente.
    expect(render({ computed: Number.NaN, fallback: 7 })).toMatch(/>calculé</);
  });

  it("texte Auto fourni par l'appelant ; unité vide", () => {
    const text = render({ computed: 15, autoText: "15 hauteurs calculées" });
    expect(text).toContain(">15 hauteurs calculées<");
    // Le nom accessible garde la valeur seule.
    expect(text).toContain("imposer 15");
    // Sans valeur calculée, le texte de l'appelant n'est pas affiché.
    expect(render({ autoText: "15 hauteurs calculées" })).not.toContain("15 hauteurs");
    const html = render({ unit: "", computed: 15 });
    expect(html).toMatch(/>15</);
  });

  it("mode imposé : champ nommé par le libellé, Imposer enfoncé, aide de retour à Auto", () => {
    const html = render({ value: 1800, hint: "Aide existante." });
    expect(pressed(html)).toEqual(["false", "true"]);
    const input = /<input[^>]*id="([^"]+)"[^>]*>/.exec(html);
    expect(input).not.toBeNull();
    expect(input![0]).toContain('value="1800"');
    expect(html).toContain(`<label for="${input![1]}">Volée 1 (bord extérieur)</label>`);
    expect(html).toContain(
      "Aide existante. Valeur imposée : cliquez sur Auto pour revenir au calcul de Blondel.",
    );
  });

  it("Auto impossible : bouton Auto désactivé, explication en titre et en aide", () => {
    const html = render({ value: 1800, autoAllowed: false, autoHint: "Une volée au moins." });
    const auto = /<button[^>]*aria-label="[^"]*automatique"[^>]*>/.exec(html)![0];
    expect(auto).toContain("disabled");
    expect(auto).toContain('title="Une volée au moins."');
    expect(html).toContain("Une volée au moins.");
    expect(html).not.toContain("revenir au calcul");
  });

  it("anglais : aucun texte français", () => {
    for (const props of [{}, { computed: 2700 }, { value: 1800 }]) {
      const html = render({ label: "Flight 1", ...props }, "en");
      expect(html).toMatch(/>Auto</);
      expect(html).toMatch(/>Set</);
      expect(html).toContain("Flight 1: automatic");
      expect(html).not.toMatch(/automatique|Imposer|Valeur|imposer|cliquez|calculé/);
    }
    expect(render({ label: "Flight 1", value: 1800 }, "en")).toContain("click Auto");
  });
});
