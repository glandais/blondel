/**
 * Inspecteur du parcours libre, état « sans sélection » (maquette 2d, ADR-0009) : 9 chiffres
 * clés, coût (profil d'atelier ou comparateur), compteurs et cartes du contrôle, carte
 * de règle (titre court et localisation), liens repliés, surcharges, prédimensionnement et
 * mention, en français et en anglais. Le choix du gabarit est testé dans `template.test.ts`.
 */
import {
  buildModel,
  contextShortLabel,
  createProject,
  ruleTitle,
  withRuleOverride,
  type Project,
  type RuleResult,
} from "@blondel/core";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { translatorFor } from "@blondel/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { COST_FIELDS } from "../../lib/workshopRates.js";
import { appStore, journeyStore, modelService, workshopStore } from "../../store/appStore.js";
import { uiStore } from "../../store/uiStore.js";
import { ControlSummary, type FoldId } from "./ControlSummary.js";
import { Inspector } from "./Inspector.js";
import { ProjectInspector, precheckCounts } from "./ProjectInspector.js";

const initial = appStore.getState().project;
const initialRates = workshopStore.getState().rates;

// Rendu serveur : zustand lit `getInitialState()` (instantané serveur de
// `useSyncExternalStore`) ; le test rend l'état courant des stores.
appStore.getInitialState = appStore.getState;
modelService.store.getInitialState = modelService.store.getState;
journeyStore.getInitialState = journeyStore.getState;
uiStore.getInitialState = uiStore.getState;
workshopStore.getInitialState = workshopStore.getState;

/** Projet courant et son modèle (calculé ici, sans le worker). */
function load(p: Project): void {
  appStore.getState().replaceProject(p);
  const project = appStore.getState().project;
  const model = buildModel(project);
  modelService.store.setState((s) => ({
    model: { ...s.model, model, project, pending: false },
  }));
}

afterEach(() => {
  appStore.getState().select(null);
  appStore.getState().setDisplayUnit("mm");
  appStore.getState().setLocale("fr");
  workshopStore.setState({ rates: initialRates });
  load(initial);
});

function render(
  component: ComponentType,
  locale: "fr" | "en" = "fr",
  props: Record<string, unknown> = {},
): string {
  appStore.getState().setLocale(locale);
  return renderToStaticMarkup(createElement(component, props));
}

const controlWith = (open: readonly FoldId[], locale: "fr" | "en" = "fr"): string =>
  render(ControlSummary as ComponentType, locale, { initialOpen: open });

/** Chiffres de la fiche : identifiant → [légende, valeur] (entités HTML décodées). */
function figures(html: string): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  const re = /data-figure="(\w+)"><dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    out[m[1]!] = [decode(m[2]!), decode(m[3]!)];
  }
  return out;
}

/** Titre court d'une règle tel qu'il apparaît dans le HTML (apostrophes échappées). */
const titleOf = (ruleId: string): string =>
  translatorFor("fr").t(ruleTitle(ruleId)).replace(/'/g, "&#x27;");

const decode = (s: string): string =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s/gu, " ");

/** Nombre affiché par une cellule de compteur. */
function count(html: string, severity: string): number {
  const m = new RegExp(`data-severity="${severity}"[^>]*>.*?<dd>(\\d+)</dd>`).exec(html);
  return m ? Number(m[1]) : Number.NaN;
}

const withStructure = (kind: string, params: Record<string, unknown> = {}): Project => ({
  ...initial,
  stair: { ...initial.stair, structure: { kind, params } },
});

const helical = (): Project => createProject("helical");

const violations = (): readonly RuleResult[] =>
  modelService.store
    .getState()
    .model.model!.compliance.results.filter((r) => r.status === "violation");

describe("fiche du projet : 9 chiffres", () => {
  it("français : légendes, ordre et valeurs lues dans le projet et le modèle", () => {
    load(createProject("straight"));
    const model = modelService.store.getState().model.model!;
    const f = figures(render(Inspector));
    expect(Object.keys(f)).toEqual([
      "floorToFloor",
      "width",
      "riserCount",
      "blondel",
      "run",
      "headroom",
      "mass",
      "parts",
      "executionClass",
    ]);
    expect(f["floorToFloor"]).toEqual(["H mm", "2 700"]);
    expect(f["width"]).toEqual(["E mm", "900"]);
    expect(f["riserCount"]).toEqual(["hauteurs", String(model.stepping.riserCount)]);
    expect(f["blondel"]![0]).toBe("2h + g mm");
    expect(f["run"]![0]).toBe("reculement mm");
    expect(f["headroom"]![0]).toBe("échappée mm");
    expect(f["mass"]![0]).toBe("masse");
    expect(f["mass"]![1]).toMatch(/^[\d ]+ kg$|^–$/);
    expect(f["parts"]).toEqual(["pièces", String(model.parts.length)]);
    // Structure bois : pas de classe d'exécution.
    expect(f["executionClass"]).toEqual(["classe", "–"]);
  });

  it("anglais : légendes traduites (glossaire), unité d'affichage suivie", () => {
    load(createProject("straight"));
    appStore.getState().setDisplayUnit("cm");
    const f = figures(render(Inspector, "en"));
    const unit = "cm";
    expect(f["floorToFloor"]![0]).toBe(`H ${unit}`);
    expect(f["width"]![0]).toBe(`W ${unit}`);
    expect(f["riserCount"]![0]).toBe("risers");
    expect(f["blondel"]![0]).toBe(`2R + G ${unit}`);
    expect(f["run"]![0]).toBe(`total going ${unit}`);
    expect(f["headroom"]![0]).toBe(`headroom ${unit}`);
    expect(f["mass"]![0]).toBe("mass");
    expect(f["parts"]![0]).toBe("parts");
    expect(f["executionClass"]![0]).toBe("class");
    expect(f["floorToFloor"]![1]).toBe("270");
    appStore.getState().setDisplayUnit("mm");
  });

  it("chiffre indisponible : « – » sans modèle", () => {
    modelService.store.setState((s) => ({ model: { ...s.model, model: null } }));
    const f = figures(render(Inspector));
    for (const id of ["riserCount", "blondel", "run", "headroom", "mass", "parts"]) {
      expect(f[id]![1], id).toBe("–");
    }
    // Lu dans le projet : toujours connu.
    expect(f["floorToFloor"]![1]).not.toBe("–");
  });
});

describe("coût estimé", () => {
  it("barème vide : lien « Compléter le profil d'atelier (0 / 9) »", () => {
    workshopStore.setState({ rates: {} });
    const html = render(Inspector);
    expect(html).toContain("Coût estimé");
    expect(html).toContain("Compléter le profil d&#x27;atelier (0 / 9)");
    expect(html).not.toContain("Voir le coût dans le comparateur");
    expect(render(Inspector, "en")).toContain("Complete the workshop profile (0 / 9)");
  });

  it("barème complet : bouton vers le comparateur", () => {
    workshopStore.setState({ rates: Object.fromEntries(COST_FIELDS.map((f) => [f.key, 1])) });
    const html = render(Inspector);
    expect(html).toContain("Voir le coût dans le comparateur");
    expect(html).not.toContain("Compléter le profil");
  });
});

describe("contrôle de conception", () => {
  it("quatre compteurs, data-severity et nombres du rapport", () => {
    load(helical());
    const html = render(Inspector);
    expect(html).toContain("Contrôle de conception");
    const cells = html.match(/class="control-counts__cell"/g) ?? [];
    expect(cells).toHaveLength(4);
    const results = modelService.store.getState().model.model!.compliance.results;
    expect(count(html, "bloquant")).toBe(0);
    expect(count(html, "avertissement")).toBe(2);
    expect(count(html, "conseil")).toBe(1);
    expect(count(html, "ok")).toBe(results.filter((r) => r.status === "ok").length);
    for (const label of ["Bloquant", "Avert.", "Conseil", "Respect."]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('title="Avertissements"');
  });

  it("une carte par violation, seulement pour les groupes non vides, ordre de sévérité", () => {
    load(helical());
    const html = render(Inspector);
    const cards = [
      ...html.matchAll(
        /<li class="blueprint rule-card[^"]*" data-severity="(\w+)" data-rule="(\w+)"/g,
      ),
    ];
    expect(cards.map((c) => c[1])).toEqual(["avertissement", "avertissement", "conseil"]);
    expect(cards.map((c) => c[2]).sort()).toEqual(
      violations()
        .map((r) => r.ruleId)
        .sort(),
    );
    expect(html).not.toMatch(/rule-card[^"]*" data-severity="bloquant"/);
    expect(html).toContain('class="result result--violation rule-card__button"');
    expect(html).toContain("Avertissement");
    // Titre court de chaque règle et localisation courte ; l'identifiant n'est plus sur la
    // carte (Référence de l'inspecteur Règle), ni aucun détail déplié.
    for (const r of violations()) expect(html, r.ruleId).toContain(titleOf(r.ruleId));
    expect(html).toContain('class="rule-card__loc"');
    expect(html).not.toContain("<code");
    expect(html).not.toContain("rule-card__details");
    expect(html).not.toContain("aria-pressed");
  });

  it("sans violation : phrase courte, aucune carte", () => {
    load(createProject("straight"));
    const { results } = modelService.store.getState().model.model!.compliance;
    const project = results
      .filter((r) => r.status === "violation")
      .reduce(
        (p, r) => withRuleOverride(p, { ruleId: r.ruleId, severity: "ignore", justification: "x" }),
        appStore.getState().project,
      );
    load(project);
    const html = render(Inspector);
    expect(violations()).toHaveLength(0);
    expect(html).toContain("Aucune règle en défaut.");
    expect(html).not.toContain("rule-card");
  });

  it("règle sélectionnée : la carte de la fiche ne se déplie plus (inspecteur Règle)", () => {
    load(helical());
    const r = violations().find((v) => v.severity === "avertissement")!;
    appStore.getState().select({ location: r.location, ruleId: r.ruleId });
    const html = render(ProjectInspector);
    const start = html.indexOf(`data-rule="${r.ruleId}"`);
    expect(start).toBeGreaterThan(0);
    const card = html.slice(start, html.indexOf("</li>", start));
    expect(card).toContain(titleOf(r.ruleId));
    expect(card).not.toContain("confiance");
    expect(card).not.toContain("Surcharger la règle…");
  });

  it("liens repliés : compteurs, aria-expanded, listes absentes tant que repliées", () => {
    load(helical());
    const html = render(Inspector);
    const model = modelService.store.getState().model.model!;
    const na = model.compliance.results.filter((r) => r.status === "non-evaluee").length;
    const ok = model.compliance.results.filter((r) => r.status === "ok").length;
    expect(html).toMatch(new RegExp(`${na} non évaluées?`));
    expect(html).toMatch(new RegExp(`${ok} respectées?`));
    expect(html).toMatch(/\d+ remarques?/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("sev--ok");
    expect(html).not.toContain("surcharge");
  });

  it("listes dépliées : classes .sev--na / .sev--ok / .sev--notes, titre et localisation", () => {
    load(helical());
    const html = controlWith(["na", "ok", "notes"]);
    expect(html).toContain('class="sev sev--na"');
    expect(html).toContain('class="sev sev--ok"');
    expect(html).toContain("Non évaluées");
    expect(html).toContain("Respectées");
    const okList = html.slice(html.indexOf('class="sev sev--ok"'));
    expect(okList).toMatch(/<li data-rule="\w+"><button type="button" class="result result--ok">/);
    expect(okList).toContain('class="result__title"');
    expect(okList).toContain('class="result__loc"');
    const passed = modelService.store
      .getState()
      .model.model!.compliance.results.find((r) => r.status === "ok")!;
    expect(okList).toContain(titleOf(passed.ruleId));
    // La surcharge se fait dans l'inspecteur Règle : plus de bouton en ligne.
    expect(okList).not.toContain("Surcharger la règle…");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/aria-controls="[^"]+-ok"/);
  });

  it("surcharge : lien « 1 surcharge », sévérité traduite (jamais la clé brute)", () => {
    appStore
      .getState()
      .update((p) =>
        withRuleOverride(p, { ruleId: "BLONDEL", severity: "ignore", justification: "Essai" }),
      );
    const closed = render(Inspector);
    expect(closed).toContain("1 surcharge");
    const fr = controlWith(["overrides"]);
    expect(fr).toContain('class="sev sev--overrides"');
    expect(fr).toContain("Surcharge : Ignorée — Essai");
    // Liste des surcharges : identifiant, titre court et levée.
    expect(fr).toContain("<code>BLONDEL</code>");
    expect(fr).toContain("Lever la surcharge");
    const en = controlWith(["overrides"], "en");
    expect(en).toContain("1 override");
    expect(en).toContain("Override: Ignored — Essai");
    expect(en).toContain("Lift the override");
    expect(en).not.toContain("ui.label");
  });

  it("profil et contextes du rapport, par leur libellé court (jamais l'identifiant)", () => {
    load(createProject("straight"));
    const html = render(Inspector);
    expect(html).toContain("Strict");
    expect(html).toContain("panneau Contexte");
    const { contexts } = modelService.store.getState().model.model!.compliance;
    const fr = translatorFor("fr");
    const line = contexts.map((c) => fr.t(contextShortLabel(c))).join(" · ");
    expect(html).toContain(line.replace(/'/g, "&#x27;"));
    expect(html).toContain("Logement (intérieur)");
    for (const c of contexts) if (c.includes("_")) expect(html).not.toContain(c);
    const en = render(Inspector, "en");
    expect(en).toContain(
      contexts.map((c) => translatorFor("en").t(contextShortLabel(c))).join(" · "),
    );
    // Version des règles en texte visible (plus seulement en info-bulle).
    expect(html).toMatch(/<p class="inspector-control__contexts">Règles v/);
  });
});

describe("prédimensionnement", () => {
  it("structure métal : ligne repliée avec classe d'exécution et limons", () => {
    load(withStructure("steel-flat"));
    const html = render(Inspector);
    expect(html).toContain('class="precheck-line"');
    expect(html).toContain("Prédimensionnement");
    expect(html).toMatch(/EXC[12]/);
    expect(html).toMatch(/\d+ \/ \d+ limons?/);
    expect(html).toContain('aria-expanded="false"');
    // Repliée : le tableau n'est pas rendu.
    expect(html).not.toContain('class="precheck"');
    const en = render(Inspector, "en");
    expect(en).toContain("Preliminary sizing");
    expect(en).toMatch(/\d+ \/ \d+ strings?/);
  });

  it("sans structure : ligne masquée", () => {
    load(withStructure("none"));
    expect(render(Inspector)).not.toContain("precheck-line");
  });

  it("comptes des limons : critères bloquants rendus par le cœur", () => {
    expect(precheckCounts(null)).toEqual({ count: 0, passed: 0 });
    const row = (ok: boolean) => ({
      ok: { deflection: true, advice: ok, stress: ok, frequency: true },
    });
    expect(
      precheckCounts({ rows: [row(true), row(false)] } as unknown as Parameters<
        typeof precheckCounts
      >[0]),
    ).toEqual({ count: 2, passed: 1 });
  });
});

describe("mention et langues", () => {
  it("mention indicative toujours présente, même sans modèle", () => {
    const disclaimer =
      "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.";
    load(helical());
    expect(render(Inspector)).toContain(disclaimer);
    modelService.store.setState((s) => ({ model: { ...s.model, model: null } }));
    const html = render(Inspector);
    expect(html).toContain(disclaimer);
    expect(html).toContain("Aucun modèle calculé.");
    expect(render(Inspector, "en")).toContain("it is not a certificate of compliance");
  });

  it("anglais : aucune clé brute, aucun texte français", () => {
    load(withStructure("steel-flat"));
    appStore
      .getState()
      .update((p) =>
        withRuleOverride(p, { ruleId: "BLONDEL", severity: "ignore", justification: "x" }),
      );
    const html = render(Inspector, "en");
    expect(html).toContain('aria-label="Inspector"');
    expect(html).toContain("Design check");
    expect(html).toContain("Estimated cost");
    expect(html).not.toMatch(/\bui\.[a-z]+\.[a-zA-Z.]+/);
    for (const fr of [
      "Contrôle de conception",
      "Coût estimé",
      "Compléter",
      "respectées",
      "non évaluées",
      "remarques",
      "Prédimensionnement",
      "hauteurs",
      "reculement",
      "échappée",
      "Projet",
      "Avert.",
      "Respect.",
      "Inspecteur",
    ]) {
      expect(html, fr).not.toContain(fr);
    }
    const fr = render(Inspector);
    expect(fr).toContain('aria-label="Inspecteur"');
    expect(fr).toContain("Projet");
    expect(fr).not.toMatch(/\bui\.[a-z]+\.[a-zA-Z.]+/);
  });
});
