/**
 * Textes du contrôle de conception (ADR-0007) : descriptions des règles de rules.yaml et
 * traduction anglaise de constats représentatifs.
 */
import { dec, messagesFor, msg, translatorFor, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import { ruleDescription, ruleTitle } from "../model/messages.js";
import { PRECHECK_RULES } from "../precheck/checks.js";
import { FAB_RULES, type PluginRuleSpec } from "../structures/checks.js";
import { CENTRAL_BEAM_RULES } from "../structures/centralBeam.js";
import { HELICAL_RULES } from "../structures/helicalCore.js";
import { CENTRAL_RULES } from "../structures/steelCentral.js";
import { STEEL_RULES } from "../structures/steelCommon.js";
import { CURVED_RULES } from "../structures/steelCurved.js";
import { PROFILE_RULES } from "../structures/steelProfile.js";
import { evaluateCompliance, evaluateComplianceDetailed } from "./engine.js";
import { severityLabel } from "./severity.js";
import { CONFIDENCE_LABEL_KEYS, NATURE_LABEL_KEYS, RULES } from "./table.js";
import raw from "./rules.data.json" with { type: "json" };
import { makeInput } from "./test-fixtures.js";

const EN = translatorFor("en");

/** Marques d'un texte resté en français (mots courants, espace avant « : »). */
const FRENCH = /\s:\s|[àâçéèêëîïôûù]|\b(le|la|les|des|du|marche|giron|hauteur|sans|objet)\b/i;

describe("descriptions des règles", () => {
  it("chaque règle de rules.yaml a sa description, en français identique à la table", () => {
    const table = raw as { regles: { id: string; description: string }[] };
    expect(RULES.map((r) => r.id)).toEqual(table.regles.map((r) => r.id));
    for (const r of table.regles) expect(fr(ruleDescription(r.id))).toBe(r.description);
  });

  it("chaque description est traduite en anglais", () => {
    const en = messagesFor("en");
    for (const r of RULES) {
      const key = `rules.${r.id}.description`;
      expect(en[key], key).toBeTruthy();
      expect(en[key], key).not.toBe(r.description);
    }
    expect(EN.t(ruleDescription("MC_HAUTEUR"))).toBe(
      "Handrail height measured plumb with the nosing",
    );
  });
});

describe("titres courts des règles", () => {
  /** Contrôles propres aux plugins (`PluginRuleSpec`), hors rules.yaml. */
  const PLUGIN_SPECS: readonly Readonly<Record<string, PluginRuleSpec>>[] = [
    FAB_RULES,
    STEEL_RULES,
    PROFILE_RULES,
    CURVED_RULES,
    HELICAL_RULES,
    CENTRAL_RULES,
    CENTRAL_BEAM_RULES,
    PRECHECK_RULES,
  ];
  const pluginIds = PLUGIN_SPECS.flatMap((t) => Object.values(t).map((s) => s.id));
  const frMessages = messagesFor("fr");
  const enMessages = messagesFor("en");
  /** Identifiants décrits dans le dictionnaire (règles, contrôles de plugins et de garde-corps). */
  const describedIds = Object.keys(frMessages)
    .map((k) => /^rules\.([A-Z][A-Z0-9_]*)\.description$/.exec(k)?.[1])
    .filter((id): id is string => id !== undefined);
  const allIds = [...new Set([...RULES.map((r) => r.id), ...pluginIds, ...describedIds])];

  it("chaque règle de la table et chaque contrôle de plugin a un titre en français et en anglais", () => {
    expect(pluginIds).toContain("HELICOIDAL_PORTE_A_FAUX");
    expect(pluginIds).toContain("LIMON_CENTRAL_PORTE_A_FAUX");
    expect(pluginIds).toContain("PRECHECK_FLECHE");
    expect(allIds.length).toBeGreaterThanOrEqual(RULES.length);
    for (const id of allIds) {
      const key = `rules.${id}.title`;
      expect(frMessages[key], key).toBeTruthy();
      expect(enMessages[key], key).toBeTruthy();
      // Traduction effective : jamais la clé brute.
      expect(fr(ruleTitle(id)), key).not.toBe(key);
      expect(EN.t(ruleTitle(id)), key).not.toBe(key);
    }
  });

  it("titres courts (40 caractères au plus), sans seuil chiffré, anglais sans accent", () => {
    for (const id of allIds) {
      const f = fr(ruleTitle(id));
      const e = EN.t(ruleTitle(id));
      expect(f.length, id).toBeLessThanOrEqual(40);
      expect(e.length, id).toBeLessThanOrEqual(40);
      // Aucun seuil : ni nombre suivi d'une unité, ni comparaison.
      for (const t of [f, e]) expect(t, id).not.toMatch(/\d+\s*(mm|m|°|kN|Hz)\b|[≤≥<>]/);
      expect(e, id).not.toMatch(/[àâçéèêëîïôûù]/i);
    }
    expect(fr(ruleTitle("FAB_SUPPORT_LONGUEUR_MIN"))).toBe("Appui des marches sur support");
    expect(fr(ruleTitle("ECHAPPEE_MIN_DTU"))).toBe("Échappée minimale");
    expect(EN.t(ruleTitle("ECHAPPEE_MIN_DTU"))).toBe("Minimum headroom");
  });

  it("identifiant inconnu : la clé brute (aucune exception)", () => {
    expect(fr(ruleTitle("REGLE_FANTOME"))).toBe("rules.REGLE_FANTOME.title");
  });
});

describe("libellés de la table", () => {
  it("sévérités, natures et confiances traduites", () => {
    expect(fr(severityLabel("avertissement"))).toBe("avertissement");
    expect(EN.t(severityLabel("bloquant"))).toBe("blocking");
    expect(EN.t(NATURE_LABEL_KEYS.metier)).toBe("trade practice");
    expect(translatorFor("fr").t(CONFIDENCE_LABEL_KEYS.eleve)).toBe("élevée");
  });
});

describe("constats en anglais", () => {
  const find = (id: string, ms = evaluateCompliance(makeInput({ stepping: { going: 180 } }))) =>
    ms.results.find((r) => r.ruleId === id && r.status === "violation")!;

  it("violation d'une série (compliance.check.item imbriqué) : anglais sans reste français", () => {
    const r = find("G_MIN_DTU");
    expect(fr(r.message)).toMatch(/^Giron sur la ligne de foulée, marche 1 : 180 mm \(attendu ≥ /);
    const text = EN.t(r.message);
    expect(text).toMatch(/^Going on the walking line, tread 1: 180 mm \(expected ≥ /);
    expect(text).not.toMatch(FRENCH);
  });

  it("raison de rétrogradation (profil souple) : anglais sans reste français", () => {
    const m = evaluateCompliance(
      makeInput({ project: { profile: "souple" }, stepping: { going: 180 } }),
    );
    const reason = find("G_MIN_DTU", m).downgradeReason as Message;
    expect(fr(reason)).toBe(
      "Profil souple : valeur issue d'une source secondaire (norme non lue).",
    );
    expect(EN.t(reason)).toBe(
      "Lenient profile: value taken from a secondary source (standard not read).",
    );
  });

  it("remarques du moteur (surcharges, contextes) : anglais sans reste français", () => {
    const e = evaluateComplianceDetailed(
      makeInput({
        project: {
          overrides: [
            { ruleId: "REGLE_FANTOME", severity: "ignore", justification: "test" },
            { ruleId: "G_MIN_DTU", severity: "conseil", justification: " " },
          ],
        },
      }),
    );
    const texts = e.notes.map((n) => EN.t(n));
    expect(texts).toContain("Override ignored: unknown rule “REGLE_FANTOME”.");
    expect(texts).toContain("Override on G_MIN_DTU ignored: empty justification.");
    for (const t of texts) expect(t).not.toMatch(/\s:\s|[àâçéèêîôûù]/);
  });

  it("modèle partiel : constats non évalués traduits", () => {
    const m = evaluateCompliance({ ...makeInput(), incomplete: "layout" });
    const r = m.results.find((x) => x.ruleId === "G_MIN_DTU")!;
    expect(fr(r.message)).toBe(
      "Non évaluée : tracé non calculé (modèle partiel, voir les erreurs).",
    );
    expect(EN.t(r.message)).toBe(
      "Not evaluated: layout not computed (partial model, see the errors).",
    );
  });
});

describe("pluriels anglais (le français garde « (s) »)", () => {
  it("unités de passage, côtés équipés, collets", () => {
    const FR = translatorFor("fr");
    const units = (count: number) =>
      msg("rules.MC_INTERMEDIAIRE_ERP.okWidth", { count, width: dec(900, 0), max: "4" });
    expect(FR.t(units(1))).toBe(
      "1 unité(s) de passage (emmarchement 900 mm) ≤ 4 : pas de main courante intermédiaire exigée.",
    );
    expect(EN.t(units(1))).toMatch(/^1 exit unit \(stair width 900 mm\)/);
    expect(EN.t(units(3))).toMatch(/^3 exit units \(/);
    const sides = (count: number) => msg("compliance.handrails.count", { count, bounds: "≥ 2" });
    expect(FR.t(sides(1))).toBe(
      "Mains courantes le long de la volée : 1 côté(s) équipé(s) (attendu ≥ 2).",
    );
    expect(EN.t(sides(1))).toBe("Handrails along the flight: 1 side fitted (expected ≥ 2).");
    expect(EN.t(sides(0))).toBe("Handrails along the flight: 0 sides fitted (expected ≥ 2).");
    const collets = msg("rules.G_COLLET_MONOTONE.ok", {
      count: 1,
      corners: msg("rules.G_COLLET_MONOTONE.corners", { count: 1 }),
    });
    expect(FR.t(collets)).toBe(
      "Collets monotones vers l'angle dans 1 zone(s) balancée(s) (1 angle(s) du jour).",
    );
    expect(EN.t(collets)).toBe(
      "Narrow ends monotonic towards the corner in 1 winder zone (1 well corner).",
    );
  });
});
