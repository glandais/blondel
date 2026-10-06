/**
 * Sources citées traduites (QUESTIONS A26 (b), décision du 2026-10-06) : français strictement
 * identique à `RuleResult.source` pour tous les résultats des exemples, anglais sans texte
 * français (hors références de textes réglementaires gardées dans leur langue), titres de
 * normes conservés.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { msg, translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { STEEL_SECTIONS } from "../catalog/sections.js";
import { JOUR_POSTS_CLASH_RULE, SLAB_CLASH_RULE } from "../guards/checks.js";
import { buildModel } from "../pipeline/build.js";
import { PRECHECK_RULES } from "../precheck/checks.js";
import { stairLoads } from "../precheck/loads.js";
import { DEFAULT_PRECHECK_SETTINGS } from "../precheck/settings.js";
import { parseProjectText } from "../project/parse.js";
import { FAB_RULES, pluginRuleDef, type PluginRuleSpec } from "../structures/checks.js";
import { HELICAL_RULES } from "../structures/helicalCore.js";
import { STEEL_RULES } from "../structures/steelCommon.js";
import { CURVED_RULES } from "../structures/steelCurved.js";
import { PROFILE_RULES } from "../structures/steelProfile.js";
import {
  profileLabel,
  ruleDefSourceText,
  ruleSourceText,
  sourceSpec,
  WORKSHOP_DEFAULT_SOURCE,
} from "./sources.js";
import { RULES } from "./table.js";

const FR = translatorFor("fr");
const EN = translatorFor("en");

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const EXAMPLES = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith(".blondel.json"));

/**
 * Références françaises permises dans une source anglaise (titres de textes réglementaires,
 * glossaire « Conventions ») ; même liste que `CITED_FRENCH_REFERENCES` des exports.
 */
const ALLOWED = ["Arrêtés", "Arrêté", "arrêté", "Légifrance"];

/** Texte français resté dans une source anglaise : accent ou mot outil français. */
function frenchIn(text: string): boolean {
  let s = text;
  for (const a of ALLOWED) s = s.split(a).join(" ");
  return (
    /[àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ]/u.test(s) ||
    /(?<!\p{L})(?:de|du|des|la|le|les|et|ou|au|aux|une|sur|pour|avec|sans|dans|selon|tableau|valeurs?)(?!\p{L})/u.test(
      s,
    )
  );
}

/** Contrôles de plugin hors table. */
const PLUGIN_SPECS: readonly PluginRuleSpec[] = [
  ...Object.values(FAB_RULES),
  ...Object.values(STEEL_RULES),
  ...Object.values(CURVED_RULES),
  ...Object.values(PROFILE_RULES),
  ...Object.values(HELICAL_RULES),
  ...Object.values(PRECHECK_RULES),
];

describe("sources citées de rules.yaml (source_en)", () => {
  it("chaque règle a une traduction anglaise sans texte français", () => {
    for (const r of RULES) {
      expect(r.source_en.trim(), r.id).not.toBe("");
      expect(frenchIn(r.source_en), `${r.id} : ${r.source_en}`).toBe(false);
    }
  });

  it("titres de normes, références et numéros de sources conservés", () => {
    const refs = /NF [A-Z]*\s?[\d.-]+[^\s,;)]*|ISO [\d-]+|DIN \d+|CO \d+|\[\d+\]|§\s?[\d.]+/g;
    for (const r of RULES) {
      for (const ref of r.source.match(refs) ?? []) {
        expect(r.source_en, `${r.id} : ${ref}`).toContain(ref);
      }
    }
  });

  it("ruleDefSourceText : source en français, source_en en anglais", () => {
    for (const r of RULES) {
      expect(ruleDefSourceText(r, FR)).toBe(r.source);
      expect(ruleDefSourceText(r, EN)).toBe(r.source_en);
    }
  });
});

describe("sources citées des contrôles hors table (sourceMessage)", () => {
  it("chaque contrôle de plugin porte un message dont le français est sa source", () => {
    for (const spec of PLUGIN_SPECS) {
      expect(spec.sourceMessage, spec.id).toBeDefined();
      expect(FR.t(spec.sourceMessage!), spec.id).toBe(spec.source);
      const en = EN.t(spec.sourceMessage!);
      expect(frenchIn(en), `${spec.id} : ${en}`).toBe(false);
      const def = pluginRuleDef(spec);
      expect(def.source).toBe(spec.source);
      expect(ruleDefSourceText(def, EN)).toBe(en);
    }
  });

  it("contrôles des garde-corps : RuleDef porteuse du message", () => {
    for (const rule of [SLAB_CLASH_RULE, JOUR_POSTS_CLASH_RULE]) {
      expect(FR.t(rule.sourceMessage!)).toBe(rule.source);
      expect(frenchIn(rule.source_en), rule.id).toBe(false);
    }
  });

  it("profil d'atelier : texte français historique inchangé", () => {
    expect(sourceSpec(WORKSHOP_DEFAULT_SOURCE).source).toBe(
      "Profil d'atelier Blondel (valeur par défaut à valider, LEDGER §2)",
    );
    expect(EN.t(WORKSHOP_DEFAULT_SOURCE)).toBe(
      "Blondel workshop profile (default value to be validated, LEDGER §2)",
    );
  });

  it("charges du prédimensionnement : français historique, anglais traduit", () => {
    const an = stairLoads({ ...DEFAULT_PRECHECK_SETTINGS, category: "B", loadSet: "AN" }, []);
    expect(an.source).toBe(
      "NF EN 1991-1-1/NA tableau 6.2(NF), catégorie B (A §3.6, rules.yaml CHARGE_ESCALIER_AUTRES)",
    );
    expect(EN.t(an.sourceMessage)).toBe(
      "NF EN 1991-1-1/NA table 6.2(NF), category B (A §3.6, rules.yaml CHARGE_ESCALIER_AUTRES)",
    );
    const en16481 = stairLoads({ ...DEFAULT_PRECHECK_SETTINGS, loadSet: "EN16481" }, []);
    expect(en16481.source).toBe("NF EN 16481 § 4.2, valeurs par défaut (C §1.2)");
    expect(FR.t(en16481.sourceMessage)).toBe(en16481.source);
  });

  it("catalogue de profilés : « consulté le » / « accessed », français historique", () => {
    const upn = STEEL_SECTIONS.find((s) => s.family === "UPN")!;
    expect(upn.source).toBe("CivilAxis, UPN (DIN 1026-1), consulté le 2026-09-29 ; C §2.3 [24]");
    expect(EN.t(upn.sourceMessage)).toBe(
      "CivilAxis, UPN (DIN 1026-1), accessed 2026-09-29; C §2.3 [24]",
    );
    const ipn = STEEL_SECTIONS.find((s) => s.family === "IPN")!;
    expect(ipn.source).toBe(
      "Metala Konstrukcijas, IPN (DIN 1025-1:1995), consulté le 2026-09-29 ; W_el,y = 2·I_y / h recalculé",
    );
    for (const s of STEEL_SECTIONS) {
      expect(FR.t(s.sourceMessage)).toBe(s.source);
      expect(frenchIn(EN.t(s.sourceMessage)), s.name).toBe(false);
    }
  });
});

describe("ruleSourceText sur tous les exemples", () => {
  for (const file of EXAMPLES) {
    it(file, () => {
      const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
      const model = buildModel(project);
      for (const r of model.compliance.results) {
        // Français strictement identique à la source du résultat.
        expect(ruleSourceText(r, FR), r.ruleId).toBe(r.source);
        if (r.sourceMessage !== undefined) expect(FR.t(r.sourceMessage), r.ruleId).toBe(r.source);
        // Anglais : plus aucune source française.
        const en = ruleSourceText(r, EN);
        expect(frenchIn(en), `${r.ruleId} : ${en}`).toBe(false);
      }
    });
  }

  it("repli : source inconnue rendue telle quelle", () => {
    const r = { ruleId: "INCONNUE", source: "texte", sourceMessage: undefined };
    expect(ruleSourceText(r, EN)).toBe("texte");
    // Source de table remplacée : pas de source_en d'une autre source.
    const def = RULES[0]!;
    expect(ruleSourceText({ ruleId: def.id, source: "autre" }, EN)).toBe("autre");
    expect(ruleSourceText({ ruleId: def.id, source: def.source }, EN)).toBe(def.source_en);
  });
});

describe("libellé du profil du contrôle", () => {
  it("français identique à l'identifiant, anglais Strict / Lenient", () => {
    expect(FR.t(profileLabel("strict"))).toBe("strict");
    expect(FR.t(profileLabel("souple"))).toBe("souple");
    expect(EN.t(profileLabel("strict"))).toBe("Strict");
    expect(EN.t(profileLabel("souple"))).toBe("Lenient");
    expect(EN.t(profileLabel("autre"))).toBe("autre");
    expect(EN.t(msg("compliance.profileName.souple"))).toBe("Lenient");
  });
});
