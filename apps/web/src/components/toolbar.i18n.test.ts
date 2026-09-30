/**
 * Rendu de la barre d'outils, de la barre d'état, du contrôle de conception, des garde-corps et
 * du calque de fond dans les deux langues (ADR-0007) : le français reste celui des e2e,
 * l'anglais ne laisse passer aucun libellé français de ces composants.
 */
import { withRuleOverride } from "@blondel/core";
import { msg, translatorFor } from "@blondel/i18n";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { listMessages } from "../i18n/text.js";
import { defaultGuards } from "../lib/guardsForm.js";
import { appStore } from "../store/appStore.js";
import { CompliancePanel } from "./CompliancePanel.js";
import { GuardsSection } from "./GuardsSection.js";
import { StatusBar } from "./StatusBar.js";
import { Toolbar } from "./Toolbar.js";
import { UnderlayImport } from "./UnderlayImport.js";

const initial = appStore.getState().project;

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant du store.
appStore.getInitialState = appStore.getState;

afterEach(() => {
  appStore.getState().setLocale("fr");
  appStore.getState().replaceProject(initial);
  appStore.getState().clearNotice();
});

function render(locale: "fr" | "en", component: FunctionComponent): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(component));
}

const underlay: FunctionComponent = () => createElement(UnderlayImport, { stairBounds: null });

function withGuards(): void {
  appStore.getState().setField(["guards"], defaultGuards());
}

describe("Toolbar", () => {
  it("français : libellés inchangés", () => {
    const html = render("fr", Toolbar);
    for (const text of [
      "Barre d&#x27;outils",
      "Assistant…",
      "Préréglage",
      "Appliquer",
      "Annuler (Ctrl+Z)",
      "Rétablir",
      "Importer ▾",
      "Exporter ▾",
      "Affichage",
      "Thème",
      "Système",
      "Atelier…",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("anglais : libellés traduits, aucun libellé français", () => {
    const html = render("en", Toolbar);
    for (const text of [
      "Toolbar",
      "Wizard…",
      "Preset",
      "Apply",
      "Undo (Ctrl+Z)",
      "Redo (Ctrl+Shift+Z)",
      "Import ▾",
      "Export ▾",
      "Display",
      "Theme",
      "System",
      "Workshop…",
    ]) {
      expect(html).toContain(text);
    }
    for (const text of ["Préréglage", "Appliquer", "Rétablir", "Importer", "Exporter", "Thème"]) {
      expect(html).not.toContain(text);
    }
  });

  it("notification traduite à l'affichage (changer de langue la retraduit)", () => {
    appStore.setState({
      notice: {
        kind: "info",
        msg: { key: "ui.export.downloaded", params: { count: 3 } },
      },
    });
    expect(render("fr", Toolbar)).toContain("3 fichiers téléchargés.");
    expect(render("en", Toolbar)).toContain("3 files downloaded.");
  });
});

describe("StatusBar", () => {
  it("français : grandeurs inchangées", () => {
    const html = render("fr", StatusBar);
    for (const text of ["Barre d&#x27;état", "2h + g", "Échappée min.", "Cœur", "Maillage"]) {
      expect(html).toContain(text);
    }
  });

  it("anglais : grandeurs traduites", () => {
    const html = render("en", StatusBar);
    for (const text of ["Status bar", "2R + G", "Min. headroom", "Core", "Mesh"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Échappée");
  });
});

describe("CompliancePanel", () => {
  it("français / anglais", () => {
    const fr = render("fr", CompliancePanel);
    expect(fr).toContain("Contrôle de conception");
    expect(fr).toContain("Non évaluées");
    expect(fr).toContain("il ne vaut pas attestation de conformité");
    const en = render("en", CompliancePanel);
    expect(en).toContain("Design check");
    expect(en).toContain("Not evaluated");
    expect(en).toContain("it is not a certificate of compliance");
    expect(en).not.toContain("Respectées");
  });

  it("surcharge : sévérité traduite (jamais la clé brute)", () => {
    appStore.getState().update((p) =>
      withRuleOverride(p, {
        ruleId: "BLONDEL",
        severity: "ignore",
        justification: "Essai",
      }),
    );
    const fr = render("fr", CompliancePanel);
    expect(fr).toContain("Surcharge : Ignorée — Essai");
    const en = render("en", CompliancePanel);
    expect(en).toContain("Override: Ignored — Essai");
    expect(en).not.toContain("ui.label");
  });
});

describe("GuardsSection", () => {
  it("français : libellés inchangés", () => {
    withGuards();
    const html = render("fr", GuardsSection);
    for (const text of [
      "Garde-corps et mains courantes",
      "Garde-corps de volée",
      "Côté jour",
      "Remplissage",
      "Valeur par défaut à valider",
      "Prolongement en bas",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("anglais : libellés traduits, aucun libellé français", () => {
    withGuards();
    const html = render("en", GuardsSection);
    for (const text of [
      "Guarding and handrails",
      "Flight guarding",
      "Well side",
      "Infill",
      "Default value to be validated",
      "Extension at the bottom",
    ]) {
      expect(html).toContain(text);
    }
    for (const text of ["Garde-corps", "Remplissage", "Hauteur", "Poteaux", "à valider"]) {
      expect(html).not.toContain(text);
    }
  });

  it("sans garde-corps : remarque traduite", () => {
    expect(render("en", GuardsSection)).toContain("No guarding described");
  });
});

describe("UnderlayImport", () => {
  it("français / anglais", () => {
    expect(render("fr", underlay)).toContain("Importer un plan DXF…");
    const en = render("en", underlay);
    expect(en).toContain("Background layer");
    expect(en).toContain("Import a DXF plan…");
    expect(en).not.toContain("Calque");
  });
});

describe("notification d'un refus (motifs en `Message`)", () => {
  it("suit un changement de langue après le refus", () => {
    const r = appStore.getState().setField(["site", "floorToFloor"], 2700.5);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    appStore.setState({
      notice: {
        kind: "error",
        msg: msg("ui.params.realign.failed", { issues: listMessages(r.issues)! }),
        details: r.issues,
      },
    });
    const escape = (s: string): string => s.replace(/'/g, "&#x27;");
    const fr = render("fr", Toolbar);
    expect(fr).toContain("Recalage impossible");
    expect(fr).toContain(escape(translatorFor("fr").t(r.issues[0]!)));
    const en = render("en", Toolbar);
    expect(en).toContain("Realignment impossible");
    expect(en).toContain(escape(translatorFor("en").t(r.issues[0]!)));
    expect(en).not.toContain("Recalage");
  });
});
