/**
 * Inspecteur « Règle » (maquette 2c) en rendu serveur : sévérité, titre court, constat, jauge,
 * « Où » cliquable, « Pour corriger », provenance et référence, surcharge (justification
 * obligatoire), règle disparue, en français et en anglais, sans clé brute.
 */
import {
  buildModel,
  createProject,
  ProjectSchema,
  RULES,
  ruleTitle,
  textMessage,
  withRuleOverride,
  type Model,
  type Part,
  type Project,
  type RuleResult,
} from "@blondel/core";
import { msg, translatorFor } from "@blondel/i18n";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { appStore, journeyStore, modelService, workshopStore } from "../../store/appStore.js";
import type { Selection } from "../../store/projectStore.js";
import { uiStore } from "../../store/uiStore.js";
import {
  CANTILEVER_RULES,
  CONFIDENCE_EXPLAINED_KEYS,
  NATURE_EXPLAINED_KEYS,
  RuleInspector,
} from "./RuleInspector.js";
import { OverrideEditor } from "./RuleResults.js";

const initial = appStore.getState().project;

appStore.getInitialState = appStore.getState;
modelService.store.getInitialState = modelService.store.getState;
journeyStore.getInitialState = journeyStore.getState;
uiStore.getInitialState = uiStore.getState;
workshopStore.getInitialState = workshopStore.getState;

/** Projet courant et son modèle (calculé ici, sans le worker). */
function load(p: Project): Model {
  appStore.getState().replaceProject(p);
  const project = appStore.getState().project;
  const model = buildModel(project);
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project, pending: false },
  }));
  return model;
}

/** Modèle affiché fabriqué à la main : résultats et pièces remplacés. */
function withModel(results: readonly RuleResult[], parts?: readonly Part[]): void {
  const m = modelService.store.getState().model.model!;
  modelService.store.setState((s) => ({
    model: {
      ...s.model,
      model: { ...m, parts: parts ?? m.parts, compliance: { ...m.compliance, results } },
    },
  }));
}

afterEach(() => {
  appStore.getState().select(null);
  appStore.getState().setLocale("fr");
  load(initial);
});

function render(selection: Selection, locale: "fr" | "en" = "fr"): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(RuleInspector, { selection }));
}

const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');

/** Texte visible (balises retirées, entités décodées). */
const text = (html: string): string => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

const FR = translatorFor("fr");

function result(partial: Partial<RuleResult>): RuleResult {
  return {
    ruleId: "FAB_SUPPORT_LONGUEUR_MIN",
    status: "violation",
    severity: "avertissement",
    declaredSeverity: "avertissement",
    location: { kind: "stair" },
    nature: "metier",
    confidence: "faible",
    source: "Pratique d'atelier",
    secondarySource: false,
    message: textMessage("Appui trop court sous la marche 6."),
    ...partial,
  };
}

const selectionOf = (r: RuleResult): Selection => ({ location: r.location, ruleId: r.ruleId });

const violationsOf = (m: Model) => m.compliance.results.filter((r) => r.status === "violation");

/** Aucune clé de dictionnaire restée brute. */
const RAW_KEY = /\b(ui|rules|compliance)\.[a-zA-Z_]+\.[a-zA-Z_.]+/;

describe("inspecteur Règle : contenu", () => {
  it("français : sévérité, titre court, constat, provenance, référence et mention", () => {
    const m = load(createProject("helical"));
    const r = violationsOf(m).find((v) => v.severity === "avertissement")!;
    const html = render(selectionOf(r));
    expect(html).toContain('class="insp-template rule-insp"');
    expect(html).toContain(`data-rule="${r.ruleId}"`);
    expect(html).toMatch(/class="insp-eyebrow rule-insp__status" data-status="violation"/);
    expect(text(html)).toContain("Avertissement");
    expect(html).toContain('<h3 class="insp-title insp-title--rule">');
    expect(text(html)).toContain(FR.t(ruleTitle(r.ruleId)));
    expect(text(html)).toContain(FR.t(r.message));
    for (const label of ["Nature", "Fiabilité", "Source", "Référence"]) {
      expect(text(html)).toContain(label);
    }
    expect(html).toContain(`<code class="rule-insp__ref">${r.ruleId}</code>`);
    // Formulaire de surcharge ouvert d'emblée (maquette 2c), « Ignorer » dans le segmenté.
    expect(text(html)).toContain("Surcharger la règle");
    expect(text(html)).toContain("Ignorer");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(text(html)).toContain(
      "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
    );
    // Mention en dernier.
    expect(html.trimEnd()).toMatch(/<p class="inspector-disclaimer">[^<]*<\/p><\/div>$/);
    expect(text(html)).not.toMatch(RAW_KEY);
  });

  it("anglais : libellés traduits, aucune clé brute ni libellé français", () => {
    const m = load(createProject("helical"));
    const r = violationsOf(m)[0]!;
    const html = render(selectionOf(r), "en");
    const visible = text(html);
    for (const label of ["Nature", "Reliability", "Source", "Reference", "Where"]) {
      expect(visible).toContain(label);
    }
    expect(visible).toContain("Override the rule");
    expect(visible).toContain("it is not a certificate of compliance");
    expect(visible).not.toMatch(RAW_KEY);
    for (const fr of ["Fiabilité", "Référence", "Où", "Pour corriger", "Surcharger"]) {
      expect(visible, fr).not.toContain(fr);
    }
  });

  it("provenance : nature et fiabilité avec leur explication, une clé par valeur de rules.yaml", () => {
    expect(Object.keys(NATURE_EXPLAINED_KEYS).sort()).toEqual(
      [...new Set(RULES.map((r) => r.nature))].sort(),
    );
    expect(Object.keys(CONFIDENCE_EXPLAINED_KEYS).sort()).toEqual(
      [...new Set(RULES.map((r) => r.confiance))].sort(),
    );
    const m = load(createProject("helical"));
    const r = violationsOf(m)[0]!;
    const fr = text(render(selectionOf(r)));
    expect(fr).toContain(FR.t(NATURE_EXPLAINED_KEYS[r.nature]!));
    expect(fr).toContain(FR.t(CONFIDENCE_EXPLAINED_KEYS[r.confidence]!));
    expect(FR.t("ui.ruleInspector.nature.reglementaire")).toMatch(
      /^Réglementaire : imposé par un texte officiel/,
    );
    const en = text(render(selectionOf(r), "en"));
    expect(en).toContain(translatorFor("en").t(NATURE_EXPLAINED_KEYS[r.nature]!));
  });

  it("source citée dans la langue de l'interface (QUESTIONS A26 (b))", () => {
    load(createProject("straight"));
    // Règle de la table : source_en en anglais, source française inchangée.
    const def = RULES.find((d) => d.id === "G_MIN_DTU")!;
    const table = result({ ruleId: def.id, source: def.source });
    // Contrôle hors table : message traduisible, français = `source`.
    const plugin = result({
      source: "Profil d'atelier Blondel (valeur par défaut à valider, LEDGER §2)",
      sourceMessage: msg("compliance.source.workshopDefault"),
    });
    withModel([table, plugin]);
    expect(text(render(selectionOf(table)))).toContain(def.source);
    expect(text(render(selectionOf(table), "en"))).toContain(def.source_en);
    expect(text(render(selectionOf(plugin)))).toContain(plugin.source);
    const en = text(render(selectionOf(plugin), "en"));
    expect(en).toContain("Blondel workshop profile (default value to be validated, LEDGER §2)");
    expect(en).not.toContain("Profil d'atelier");
  });

  it("règle respectée et règle non évaluée : surtitre du statut", () => {
    load(createProject("straight"));
    const ok = result({ status: "ok", ruleId: "G_MIN_DTU" });
    const na = result({ status: "non-evaluee", ruleId: "ECHAPPEE_MIN_DTU" });
    withModel([ok, na]);
    expect(text(render(selectionOf(ok)))).toContain("Respectée");
    expect(render(selectionOf(ok))).toContain('data-status="ok"');
    expect(text(render(selectionOf(na)))).toContain("Non évaluée");
  });

  it("règle disparue après un recalcul : phrase courte et « Retour au projet »", () => {
    load(createProject("straight"));
    const html = render({ location: { kind: "stair" }, ruleId: "REGLE_FANTOME" });
    expect(html).toContain("rule-insp--missing");
    expect(text(html)).toContain("Retour au projet");
    expect(text(html)).toContain("Contrôle de conception indicatif");
  });

  it("sévérité déclarée et motif de déclassement s'il y a lieu", () => {
    load(createProject("straight"));
    const r = result({
      severity: "conseil",
      declaredSeverity: "bloquant",
      downgradeReason: textMessage("Profil souple"),
      secondarySource: true,
    });
    withModel([r]);
    const visible = text(render(selectionOf(r)));
    expect(visible).toContain("Sévérité déclarée Bloquant");
    expect(visible).toContain("Déclassement Profil souple");
    expect(visible).toContain("Pratique d'atelier · source secondaire");
  });
});

describe("jauge mesuré / attendu", () => {
  it("maquette 2c : mesuré 37,2, attendu ≥ 50 : barre à 62 %, repère à 83,3 %", () => {
    load(createProject("straight"));
    const r = result({ measured: 37.2, min: 50, max: null, unit: "mm" });
    withModel([r]);
    const html = render(selectionOf(r));
    expect(html).toContain('class="rule-gauge"');
    expect(decode(html)).toMatch(/Mesuré <b>37,2 mm<\/b>/);
    expect(text(html)).toContain("attendu ≥ 50 mm");
    expect(html).toContain('style="width:62.0%"');
    expect(html).toContain('style="left:83.3%"');
    expect(html).toMatch(/role="img" aria-label="Mesuré 37,2 mm, attendu ≥ 50 mm"/);
  });

  it("sans mesure : pas de jauge ; mesure sans borne : valeur seule", () => {
    load(createProject("straight"));
    const none = result({});
    const only = result({ ruleId: "RECULEMENT", measured: 2500, unit: "mm" });
    withModel([none, only]);
    expect(render(selectionOf(none))).not.toContain("rule-gauge");
    const html = render(selectionOf(only));
    expect(html).toContain("rule-gauge");
    expect(html).not.toContain("rule-gauge__bar");
    expect(html).not.toContain("attendu");
  });
});

describe("« Où » : étiquettes cliquables", () => {
  it("pièce : la pièce, la marche liée et les pièces assemblées, en boutons", () => {
    const m = load(createProject("straight"));
    const tread = m.parts.find((p) => p.treadNumber === 3)!;
    const other = m.parts.find((p) => p.treadNumber === undefined)!;
    const parts = m.parts.map((p) =>
      p.id === other.id
        ? { ...p, assembledWith: [tread.id] }
        : p.id === tread.id
          ? { ...p, assembledWith: [other.id] }
          : p,
    );
    const r = result({ location: { kind: "part", partId: other.id } });
    withModel([r], parts);
    const html = render(selectionOf(r));
    const tags = [
      ...html.matchAll(
        /<button type="button" class="tag tag-outline rule-insp__tag">(.*?)<\/button>/g,
      ),
    ].map((x) => decode(x[1]!));
    expect(tags).toEqual([`${other.mark} ${FR.t(other.name)}`, "Marche 3"]);
  });

  it("marche et nez : un bouton ; escalier et point : étiquette non cliquable", () => {
    load(createProject("straight"));
    const t = result({ location: { kind: "tread", number: 4 } });
    const n = result({ ruleId: "G_MIN_DTU", location: { kind: "nosing", index: 2 } });
    const s = result({ ruleId: "BLONDEL_DTU" });
    withModel([t, n, s]);
    expect(render(selectionOf(t))).toMatch(/rule-insp__tag">Marche 4<\/button>/);
    expect(render(selectionOf(n))).toMatch(/rule-insp__tag">Nez 2<\/button>/);
    const stair = render(selectionOf(s));
    expect(stair).not.toContain('rule-insp__tag"');
    expect(stair).toContain('<span class="tag tag-neutral">Escalier</span>');
  });
});

describe("« Pour corriger »", () => {
  it("section du panneau libre ; corrections du cœur qui visent la règle, annulables", () => {
    const p = ProjectSchema.parse({
      ...createProject("quarter-left", { openingClearance: 0 }),
      guards: {},
    });
    const m = load(p);
    const r = m.compliance.results.find((x) => x.ruleId === "GC_CONFLIT_DALLE")!;
    expect(r).toBeDefined();
    const html = render(selectionOf(r));
    expect(text(html)).toContain("Pour corriger");
    expect(text(html)).toContain("Ouvrir Garde-corps");
    expect(html).toContain('data-section="guards"');
    // Contrat du cœur (`FixSuggestion.ruleIds`) : la correction n'apparaît qu'une fois rattachée.
    if (html.includes('data-fix="opening-clearance"')) {
      expect(text(html)).toContain("Élargir la trémie de 100 mm le long de l'escalier");
      expect(text(html)).toContain("annulable");
    }
  });

  it("ni correction ni section : bloc masqué", () => {
    load(createProject("straight"));
    const r = result({ ruleId: "ANGLE_ECHELLE_MARCHES" });
    withModel([r]);
    expect(render(selectionOf(r))).not.toContain("rule-insp__fixes");
  });

  it("porte-à-faux hélicoïdal : justification saisie sur place (paramètre de Structure)", () => {
    const m = load(createProject("helical"));
    const r = m.compliance.results.find((x) => x.ruleId === "HELICOIDAL_PORTE_A_FAUX");
    if (!r) return;
    expect(text(render(selectionOf(r)))).toContain("Justification du porte-à-faux");
  });

  it("limon central : justification du double porte-à-faux et de la torsion saisie sur place (A29)", () => {
    expect(CANTILEVER_RULES.has("LIMON_CENTRAL_PORTE_A_FAUX")).toBe(true);
    expect(CANTILEVER_RULES.has("HELICOIDAL_PORTE_A_FAUX")).toBe(true);
    const base = createProject("quarter-left");
    const central = ProjectSchema.parse({
      ...base,
      stair: {
        ...base.stair,
        structure: {
          kind: "steel-central",
          params: { section: { kind: "box" }, cantileverJustification: "Note de calcul NC-12" },
        },
      },
    });
    const m = load(central);
    const r =
      m.compliance.results.find((x) => x.ruleId === "LIMON_CENTRAL_PORTE_A_FAUX") ??
      result({ ruleId: "LIMON_CENTRAL_PORTE_A_FAUX" });
    withModel([r]);
    const html = render(selectionOf(r));
    expect(text(html)).toContain("Justification du double porte-à-faux et de la torsion");
    // Valeur saisie reprise du paramètre de Structure (même chemin que l'hélicoïdal).
    expect(html).toContain("Note de calcul NC-12");
    expect(text(render(selectionOf(r), "en"))).toContain(
      "Justification of the double cantilever and torsion",
    );
    // Autre règle : pas de saisie.
    const other = result({ ruleId: "FAB_SUPPORT_LONGUEUR_MIN" });
    withModel([other]);
    expect(text(render(selectionOf(other)))).not.toContain("double porte-à-faux");
  });
});

describe("surcharge", () => {
  it("formulaire neuf : segmenté à 4 sévérités, « Surcharger » désactivé sans justification", () => {
    appStore.getState().setLocale("fr");
    const html = renderToStaticMarkup(
      createElement(OverrideEditor, { ruleId: "G_MIN_DTU", current: undefined, onClose: () => {} }),
    );
    expect(html).toContain('aria-label="Surcharge de G_MIN_DTU"');
    expect(text(html)).toContain("Surcharger la règle");
    expect(html).toContain('role="radiogroup" aria-label="Nouvelle sévérité"');
    const radios = [...html.matchAll(/role="radio"[^>]*>([^<]+)</g)].map((x) => x[1]);
    expect(radios).toEqual(["Bloquant", "Avert.", "Conseil", "Ignorer"]);
    expect(text(html)).toContain("Justification (obligatoire, reprise dans le dossier PDF)");
    expect(html).toMatch(
      /<button type="submit" class="btn btn-primary" disabled="">Surcharger<\/button>/,
    );
    expect(html).toContain('class="btn btn-secondary">Annuler');
    expect(html).not.toContain("Lever la surcharge");
  });

  it("surcharge existante : formulaire ouvert, rappel et « Lever la surcharge »", () => {
    const m = load(createProject("helical"));
    const r = violationsOf(m)[0]!;
    appStore
      .getState()
      .update((p) =>
        withRuleOverride(p, { ruleId: r.ruleId, severity: "conseil", justification: "Vis M8" }),
      );
    load(appStore.getState().project);
    const res = modelService.store
      .getState()
      .model.model!.compliance.results.find((x) => x.ruleId === r.ruleId)!;
    const html = render(selectionOf(res));
    expect(html).toContain("override-editor");
    expect(text(html)).toContain("Surcharge : Conseil — Vis M8");
    expect(text(html)).toContain("Lever la surcharge");
    expect(html).toMatch(/<button type="submit" class="btn btn-primary">Surcharger<\/button>/);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Conseil</);
    expect(text(render(selectionOf(res), "en"))).toContain("Lift the override");
  });
});
