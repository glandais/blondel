/**
 * Rendu de la barre du haut (vague 2, ADR-0009), de ses menus et des notifications, des
 * garde-corps et du calque de fond dans les deux langues (ADR-0007) : le français reste celui
 * des e2e, l'anglais ne laisse passer aucun libellé français de ces composants.
 */
import type { ComplianceReport, RuleResult, Severity } from "@blondel/core";
import { DEMO_PRESET_IDS } from "@blondel/core";
import { msg, translatorFor } from "@blondel/i18n";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listMessages } from "../i18n/text.js";
import { defaultGuards } from "../lib/guardsForm.js";
import { appStore, journeyStore } from "../store/appStore.js";
import { uiStore } from "../store/uiStore.js";
import { GuardsSection } from "./GuardsSection.js";
import { ControlBadge, badgeCounts } from "./topbar/ControlBadge.js";
import { MoreMenu } from "./topbar/MoreMenu.js";
import { Notices } from "./topbar/Notices.js";
import { ProjectMenu } from "./topbar/ProjectMenu.js";
import { TopBar } from "./topbar/TopBar.js";
import { UnderlayImport } from "./UnderlayImport.js";

const initial = appStore.getState().project;

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant des stores.
appStore.getInitialState = appStore.getState;
journeyStore.getInitialState = journeyStore.getState;
uiStore.getInitialState = uiStore.getState;

// Parcours libre par défaut (un projet remplacé ou une démo ouvrent le guidé) : chaque test
// part du libre, ceux du guidé le choisissent.
beforeEach(() => {
  journeyStore.setState({ journey: "free" });
});

afterEach(() => {
  appStore.getState().setLocale("fr");
  appStore.getState().replaceProject(initial);
  appStore.getState().clearNotice();
  appStore.setState({ autosaveFailed: false, rejectedAutosave: null });
  journeyStore.setState({ journey: "free" });
});

function render(locale: "fr" | "en", component: FunctionComponent): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(component));
}

const underlay: FunctionComponent = () => createElement(UnderlayImport, { stairBounds: null });
const projectMenuOpen: FunctionComponent = () => createElement(ProjectMenu, { initialOpen: true });
const moreMenuOpen: FunctionComponent = () => createElement(MoreMenu, { initialOpen: true });

const escape = (s: string): string => s.replace(/'/g, "&#x27;");

function withGuards(): void {
  appStore.getState().setField(["guards"], defaultGuards());
}

describe("TopBar", () => {
  it("français : libellés et noms accessibles", () => {
    const html = render("fr", TopBar);
    for (const text of [
      'aria-label="Barre d&#x27;outils"',
      ">Blondel<",
      "Importer",
      "Exporter",
      'aria-label="Annuler (Ctrl+Z)"',
      'aria-label="Rétablir (Ctrl+Maj+Z)"',
      ">Contrôle<",
      'aria-label="Parcours"',
      ">Guidé<",
      ">Libre<",
      'aria-label="Espace de travail"',
      ">Conception<",
      ">Fabrication<",
      'aria-label="Plus d&#x27;options"',
      "✓ Enregistré",
      "topbar__project",
    ]) {
      expect(html).toContain(text);
    }
    // Ni l'ancien « ▾ » des menus, ni une clé brute.
    expect(html).not.toContain("▾");
    expect(html).not.toMatch(/ui\.(topbar|toolbar|import|export)\./);
  });

  it("Fabrication : « Exporter » quitte la barre (sorties dans la colonne de droite)", () => {
    journeyStore.getState().setWorkspace("fabrication");
    try {
      const html = render("fr", TopBar);
      expect(html).not.toContain("Exporter");
      expect(html).toContain("Importer");
      expect(html).toContain(">Contrôle<");
    } finally {
      journeyStore.getState().setWorkspace("design");
    }
    expect(render("fr", TopBar)).toContain("Exporter");
  });

  it("anglais : libellés traduits, aucun libellé français", () => {
    const html = render("en", TopBar);
    for (const text of [
      'aria-label="Toolbar"',
      "Import",
      "Export",
      'aria-label="Undo (Ctrl+Z)"',
      'aria-label="Redo (Ctrl+Shift+Z)"',
      ">Check<",
      ">Guided<",
      ">Free<",
      ">Design<",
      ">Fabrication<",
      'aria-label="More options"',
      "✓ Saved",
    ]) {
      expect(html).toContain(text);
    }
    for (const text of [
      "Importer",
      "Exporter",
      "Annuler",
      "Rétablir",
      "Contrôle",
      "Conception",
      "Libre",
      "Guidé",
      "Enregistré",
      "Parcours",
    ]) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toMatch(/ui\.(topbar|toolbar|import|export)\./);
  });

  it("parcours libre : Guidé disponible, Libre choisi ; Conception choisie", () => {
    const html = render("fr", TopBar);
    expect(html).toMatch(/aria-checked="false"[^>]*>Guidé</);
    expect(html).not.toMatch(/disabled=""[^>]*>Guidé</);
    expect(html).toMatch(/aria-checked="true"[^>]*>Libre</);
    expect(html).toMatch(/aria-checked="true"[^>]*>Conception</);
    expect(html).toContain('class="seg seg--sm journey-switch"');
  });

  it("parcours guidé (maquette 1a) : grand segmenté, ni espace, ni contrôle, ni import / export", () => {
    journeyStore.setState({ journey: "guided" });
    try {
      const html = render("fr", TopBar);
      expect(html).toContain('aria-label="Barre d&#x27;outils"');
      expect(html).toContain("journey-switch journey-switch--guided");
      expect(html).toMatch(/aria-checked="true"[^>]*>Guidé</);
      expect(html).toMatch(/aria-checked="false"[^>]*>Libre</);
      for (const text of ['aria-label="Annuler (Ctrl+Z)"', 'aria-label="Plus d&#x27;options"']) {
        expect(html).toContain(text);
      }
      for (const text of [
        "Espace de travail",
        ">Conception<",
        ">Contrôle<",
        "Importer",
        "Exporter",
      ]) {
        expect(html).not.toContain(text);
      }
      const en = render("en", TopBar);
      expect(en).toMatch(/aria-checked="true"[^>]*>Guided</);
      expect(en).not.toContain("Guidé");
    } finally {
      journeyStore.setState({ journey: "free" });
    }
  });

  it("parcours guidé : marque, menu du projet et « Démo » gardés", () => {
    appStore.getState().loadDemo(DEMO_PRESET_IDS[0]!);
    expect(journeyStore.getState().journey).toBe("guided");
    const html = render("fr", TopBar);
    expect(html).toContain("topbar--guided");
    expect(html).toContain(">Blondel<");
    expect(html).toContain("topbar__project");
    expect(html).toContain(">Démo<");
  });

  it("étiquette « Démo » après le chargement d'une démo", () => {
    expect(render("fr", TopBar)).not.toContain(">Démo<");
    appStore.getState().loadDemo(DEMO_PRESET_IDS[0]!);
    expect(render("fr", TopBar)).toContain(">Démo<");
    expect(render("en", TopBar)).toContain(">Demo<");
  });

  it("autosauvegarde : badges suspendue / indisponible à la place de « ✓ Enregistré »", () => {
    appStore.setState({ autosaveFailed: true });
    let html = render("fr", TopBar);
    expect(html).toContain("Autosauvegarde indisponible");
    expect(html).not.toContain("Enregistré");
    appStore.setState({
      autosaveFailed: false,
      rejectedAutosave: { text: "{}", preserved: false, since: "startup" },
    });
    html = render("fr", TopBar);
    expect(html).toContain("Autosauvegarde suspendue");
    expect(render("en", TopBar)).not.toContain("Autosauvegarde");
  });
});

describe("ProjectMenu (ouvert)", () => {
  it("français : renommage, Nouveau, Ouvrir…, démos, préréglage, assistant", () => {
    const html = render("fr", projectMenuOpen);
    for (const text of [
      'role="dialog"',
      'aria-label="Menu du projet"',
      ">Projet<",
      ">Nouveau<",
      ">Ouvrir…<",
      ">Démos<",
      ">Préréglage<",
      ">Appliquer<",
      ">Assistant…<",
      'aria-expanded="true"',
    ]) {
      expect(html).toContain(text);
    }
  });

  it("anglais : aucun libellé français", () => {
    const html = render("en", projectMenuOpen);
    for (const text of ["Project menu", ">New<", ">Open…<", ">Demos<", ">Preset<", ">Apply<"]) {
      expect(html).toContain(text);
    }
    for (const text of ["Nouveau", "Ouvrir", "Démos", "Préréglage", "Appliquer", "Menu du"]) {
      expect(html).not.toContain(text);
    }
  });
});

describe("MoreMenu (ouvert)", () => {
  it("français : Affichage, Thème, Langue, Atelier…", () => {
    const html = render("fr", moreMenuOpen);
    for (const text of [
      'role="dialog"',
      ">Affichage<",
      ">Thème<",
      ">Système<",
      ">Langue<",
      ">Atelier…<",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("anglais : Display, Theme, Language, Workshop…", () => {
    const html = render("en", moreMenuOpen);
    for (const text of [">Display<", ">Theme<", ">System<", ">Language<", ">Workshop…<"]) {
      expect(html).toContain(text);
    }
    for (const text of ["Affichage", "Thème", "Atelier", "Plus d"]) {
      expect(html).not.toContain(text);
    }
  });
});

describe("badge « Contrôle »", () => {
  const result = (severity: Severity, status: RuleResult["status"] = "violation"): RuleResult =>
    ({ ruleId: `R_${severity}`, status, severity, declaredSeverity: severity }) as RuleResult;
  const report = (results: readonly RuleResult[]): ComplianceReport =>
    ({ results }) as unknown as ComplianceReport;

  it("sévérité la plus haute, compteurs par sévérité effective", () => {
    const tone = (r: ComplianceReport | undefined) => badgeCounts(r)?.tone ?? "none";
    expect(tone(undefined)).toBe("none");
    expect(tone(report([]))).toBe("ok");
    expect(tone(report([result("conseil", "ok")]))).toBe("ok");
    expect(tone(report([result("conseil", "non-evaluee")]))).toBe("ok");
    expect(tone(report([result("conseil")]))).toBe("conseil");
    expect(tone(report([result("conseil"), result("avertissement")]))).toBe("avertissement");
    const all = report([
      result("conseil"),
      result("conseil"),
      result("avertissement"),
      result("bloquant"),
    ]);
    expect(tone(all)).toBe("bloquant");
    expect(badgeCounts(all)?.counts).toMatchObject({ bloquant: 1, avertissement: 1, conseil: 2 });
  });

  it("nom accessible pluriel, traduit", () => {
    const fr = translatorFor("fr");
    const en = translatorFor("en");
    const summary = (b: number, w: number, a: number) =>
      msg("ui.topbar.control.summary", {
        blocking: msg("ui.topbar.control.blocking", { count: b }),
        warnings: msg("ui.topbar.control.warnings", { count: w }),
        advice: msg("ui.topbar.control.advice", { count: a }),
      });
    expect(fr.t(summary(0, 1, 2))).toBe("Contrôle : 0 bloquant, 1 avertissement, 2 conseils");
    expect(en.t(summary(1, 2, 1))).toBe("Check: 1 blocking issue, 2 warnings, 1 advice item");
  });

  it("sans modèle : badge neutre, nom accessible commençant par « Contrôle »", () => {
    const html = render("fr", ControlBadge);
    expect(html).toMatch(/class="btn btn-secondary control-badge"/);
    expect(html).toMatch(/data-severity="(none|ok|conseil|avertissement|bloquant)"/);
    expect(html).toMatch(/aria-label="Contrôle/);
    expect(render("en", ControlBadge)).toMatch(/aria-label="Check/);
  });

  it("sans modèle et sans calcul : « indisponible », pas « calcul en cours »", () => {
    const fr = translatorFor("fr");
    expect(fr.t("ui.topbar.control.unavailable")).not.toBe(fr.t("ui.topbar.control.pending"));
    expect(translatorFor("en").t("ui.topbar.control.unavailable")).toMatch(/^Check/);
  });
});

describe("Notices", () => {
  it("sans message : rien", () => {
    expect(render("fr", Notices)).toBe("");
  });

  it("notification traduite à l'affichage (changer de langue la retraduit)", () => {
    appStore.setState({
      notice: {
        kind: "info",
        msg: { key: "ui.export.downloaded", params: { count: 3 } },
      },
    });
    const fr = render("fr", Notices);
    expect(fr).toContain("3 fichiers téléchargés.");
    expect(fr).toContain('class="notice notice--info" role="status"');
    expect(render("en", Notices)).toContain("3 files downloaded.");
  });

  it("refus d'une saisie : motifs en `Message`, suivent un changement de langue", () => {
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
    const fr = render("fr", Notices);
    expect(fr).toContain('role="alert"');
    expect(fr).toContain("Recalage impossible");
    expect(fr).toContain(escape(translatorFor("fr").t(r.issues[0]!)));
    const en = render("en", Notices);
    expect(en).toContain("Realignment impossible");
    expect(en).toContain(escape(translatorFor("en").t(r.issues[0]!)));
    expect(en).not.toContain("Recalage");
  });

  it("autosauvegarde refusée : groupe d'actions", () => {
    appStore.setState({
      rejectedAutosave: { text: "{}", preserved: true, since: "startup" },
    });
    const fr = render("fr", Notices);
    expect(fr).toContain('role="group"');
    expect(fr).toContain('aria-label="Autosauvegarde refusée"');
    expect(fr).toContain("Télécharger le texte brut");
    expect(fr).toContain("Oublier cette sauvegarde");
    expect(render("en", Notices)).not.toContain("Autosauvegarde");
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
