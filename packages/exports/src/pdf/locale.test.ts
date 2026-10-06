/**
 * Dossier PDF en anglais (ADR-0007) : sur des exemples réels, aucun texte français ni clé brute
 * ne reste ; le français par défaut est inchangé (les instantanés et tests existants en font
 * foi, ici seulement quelques repères).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText, type Model, type Project } from "@blondel/core";
import { messagesFor, msg, textMessage } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { translatorOf } from "../i18n.js";
import {
  report,
  ruleResult,
  sampleParts,
  sampleProject,
  straightModel,
  woodStringerPart,
} from "../testing/fixtures.js";
import { installationSheet } from "../installation.js";
import { FRENCH_ACCENTS, RAW_KEY, residualFrench } from "../testing/french.js";
import { RecordingCanvas, helveticaMeasure } from "./canvas.js";
import { measuredText } from "./compliance.js";
import { installationLines } from "./installation.js";
import {
  complianceDisclaimer,
  exportPdfDocument,
  renderPdf,
  type PdfLayoutOptions,
  type PdfPageInfo,
} from "./document.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const EXAMPLES = [
  "j4-acceptance-01-garde-corps.blondel.json",
  "j5a-helicoidal.blondel.json",
  "j3b-acceptance-01-tole-pliee.blondel.json",
];

function load(file: string): { project: Project; model: Model } {
  const project = parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));
  return { project, model: buildModel(project) };
}

function render(
  model: Model,
  options: PdfLayoutOptions,
): { pages: PdfPageInfo[]; texts: string[][] } {
  const c = new RecordingCanvas(297, 210, helveticaMeasure());
  const pages = renderPdf(c, model, options);
  return { pages, texts: c.pageTexts() };
}

/**
 * Textes repris tels quels, non traduits : sources bibliographiques des règles (`rules.yaml`,
 * citations), nom du projet et identifiants des murs saisis par l'utilisateur.
 */
function verbatim(project: Project, model: Model): { sources: string[]; ids: string[] } {
  return {
    // Le nom du projet peut être tronqué (cartouche) : traité comme une source.
    sources: [project.name, ...model.compliance.results.map((r) => r.source)],
    ids: [project.name, ...project.site.walls.map((w) => w.id)].filter((s) => s !== ""),
  };
}

function frenchProblems(texts: readonly string[][], project: Project, model: Model): string[] {
  const { sources, ids } = verbatim(project, model);
  // Identifiants repris tels quels : règles et contextes du contrôle de conception.
  const idents = [...model.compliance.results.map((r) => r.ruleId), ...model.compliance.contexts];
  const out: string[] = [];
  texts.forEach((page, i) =>
    page.forEach((raw) => {
      let s = raw;
      for (const id of ids) s = s.split(id).join("");
      // Ligne de provenance : la source citée n'est pas traduite (suite coupée : texte de source).
      s = s.replace(/source: .*$/, "source:");
      const bare = s.replace(/…$/, "").trim();
      if (bare !== "" && sources.some((src) => src.includes(bare))) return;
      if (residualFrench([s], idents).length > 0) out.push(`page ${i + 1} : ${raw}`);
    }),
  );
  return out;
}

describe("dossier PDF en anglais sur examples/", () => {
  for (const file of EXAMPLES) {
    describe(file, () => {
      const { project, model } = load(file);
      const date = new Date(2026, 8, 30);
      const en = render(model, { project, locale: "en", date });

      it("titres, cartouche, sommaire et date en anglais", () => {
        const all = en.texts.flat();
        expect(en.pages[0]!.title).toMatch(/^Contents( \(1\/\d+\))?$/);
        expect(all).toContain("Project");
        expect(all).toContain("Scale");
        expect(all).toContain(`Page 1 / ${en.pages.length}`);
        expect(all).toContain("2026-09-30");
        expect(all.some((s) => s.startsWith("Project: "))).toBe(true);
        const titles = en.pages.map((p) => p.title);
        const kinds = new Set(en.pages.map((p) => p.kind));
        if (kinds.has("bom"))
          expect(titles.some((s) => s.startsWith("Bill of materials"))).toBe(true);
        if (kinds.has("cutsheet"))
          expect(titles.some((s) => s.startsWith("Cutting list"))).toBe(true);
        if (kinds.has("installation"))
          expect(titles.some((s) => s.startsWith("Installation sheet"))).toBe(true);
        if (kinds.has("compliance"))
          expect(all).toContain(complianceDisclaimer(translatorOf({ locale: "en" })));
      });

      it("aucun texte français ni clé brute dans le dossier", () => {
        expect(frenchProblems(en.texts, project, model)).toEqual([]);
        for (const p of en.pages) {
          expect(p.title).not.toMatch(RAW_KEY);
          expect(p.title).not.toMatch(FRENCH_ACCENTS);
          if (p.scaleNote !== undefined) expect(p.scaleNote).not.toMatch(FRENCH_ACCENTS);
        }
      });

      it("même découpage en pages qu'en français (seuls les textes changent)", () => {
        const fr = render(model, { project, date });
        expect(en.pages.map((p) => [p.kind, p.scale, p.partIds])).toEqual(
          fr.pages.map((p) => [p.kind, p.scale, p.partIds]),
        );
        expect(fr.pages[0]!.title).toMatch(/^Sommaire( \(1\/\d+\))?$/);
        expect(fr.texts.flat()).toContain("30/09/2026");
        expect(fr.texts.flat()).toContain(complianceDisclaimer());
      });
    });
  }

  it("dossier complet de synthèse (surcharges, rétrogradation, trémie, gabarits tuilés)", () => {
    const base = sampleProject();
    const project: Project = {
      ...base,
      compliance: {
        ...base.compliance,
        overrides: [
          { ruleId: "GIRON_MIN", severity: "ignore", justification: "J1" },
          { ruleId: "ABSENTE", severity: "conseil", justification: "J2" },
        ],
      },
    };
    const model: Model = {
      ...straightModel(),
      parts: [...sampleParts(), woodStringerPart(), woodStringerPart({ mark: "LE1" })],
      compliance: report([
        ruleResult("GIRON_MIN", { kind: "tread", number: 2 }, "bloquant", {
          measured: 200,
          min: 210,
          unit: "mm",
          nature: "reglementaire",
          confidence: "eleve",
          source: "Arrêté 2015",
        }),
        ruleResult("BLONDEL", { kind: "stair" }, "avertissement", {
          secondarySource: true,
          nature: "normatif",
          confidence: "moyen",
          source: "NF DTU 36.3",
          downgradeReason: textMessage("soft profile"),
          declaredSeverity: "bloquant",
        }),
        ruleResult("CONSEIL_X", { kind: "stair" }, "conseil", { measured: 3, unit: "marches" }),
        { ...ruleResult("NON_EVAL", { kind: "stair" }), status: "non-evaluee" },
        { ...ruleResult("OK_1", { kind: "stair" }), status: "ok", measured: 620, unit: "mm" },
      ]),
    };
    const toValidate = [
      {
        label: textMessage("Post size"),
        value: "40 mm",
        section: msg("pipeline.stage.guards"),
        validated: false,
      },
      {
        label: textMessage("Pinch"),
        value: "30 mm",
        section: msg("pipeline.stage.structure"),
        validated: true,
      },
    ];
    const en = render(model, {
      project,
      locale: "en",
      date: new Date(2026, 0, 2),
      toValidate,
    });
    // Les pièces et règles de synthèse ont des noms français bruts (`textMessage`) : on vérifie
    // seulement qu'aucun texte français propre au PDF ne reste (fragments fixes des `pdf.*`).
    const fr = messagesFor("fr");
    const enMessages = messagesFor("en");
    const fixed = Object.keys(fr)
      .filter((k) => k.startsWith("pdf.") && fr[k] !== enMessages[k])
      .flatMap((k) => fr[k]!.split(/\{[A-Za-z0-9_]+\}/))
      .map((s) => s.trim())
      .filter((s) => s.length >= 5);
    const all = en.texts.flat().join("\n");
    const asWords = (s: string): RegExp =>
      new RegExp(`(?<!\\p{L})${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "u");
    expect(fixed.filter((s) => asWords(s).test(all))).toEqual([]);
    expect(all).toContain("Rule overrides by the user (2)");
    expect(all).toContain("GIRON_MIN: declared severity blocking → ignored. Justification: J1");
    expect(all).toContain("ABSENTE: advice (rule not evaluated in the active contexts)");
    expect(all).toContain("Declared severity blocking, downgraded: soft profile");
    expect(all).toContain("(secondary source: paid standard not read)");
    expect(all).toContain("Blocking violations (1)");
    expect(all).toMatch(/measured 3 steps/);
    expect(all).toContain("Stairwell opening: distance to the nearest edge (mm)");
    const tiled = en.pages.filter((p) => p.kind === "template" && p.tile!.count > 1);
    expect(tiled.length).toBeGreaterThan(0);
    expect(tiled[0]!.title).toMatch(/^1:1 template \S+ — tile [A-Z]+\d+ \(1\/\d+\)/);
    expect(all).toMatch(/1:1 template \S+: grid of \d+ × \d+ tiles \(\d+ printed\)/);
    expect(all).toContain("2026-01-02");
    expect(en.pages.some((p) => p.kind === "toValidate" && p.title === "Values to validate")).toBe(
      true,
    );
    expect(all).toContain("1 validated · 1 remaining");
    expect(all).toContain("to be validated");
  });

  it("unités en mots accordées en anglais, inchangées en français", () => {
    const en = translatorOf({ locale: "en" });
    const r = (measured: number, min: number, unit: string) =>
      ruleResult("X", { kind: "stair" }, "conseil", { measured, min, unit });
    expect(measuredText(r(2, 1, "unite"), en)).toBe("measured 2 units — min 1 unit");
    expect(measuredText(r(1, 3, "marches"), en)).toBe("measured 1 step — min 3 steps");
    expect(measuredText(r(2, 1, "unite"))).toBe("mesuré 2 unite — min 1 unite");
    expect(measuredText(r(1, 3, "marches"))).toBe("mesuré 1 marches — min 3 marches");
  });

  it("cotes aux nus des murs : séparateur de la langue", () => {
    const { project, model } = load(EXAMPLES[0]!);
    const sheet = installationSheet(model, project);
    const walls = (t: ReturnType<typeof translatorOf>) =>
      installationLines(sheet, t)
        .map((l) => l.text)
        .filter((s) => project.site.walls.some((w) => s.includes(`${w.id} `)));
    expect(walls(translatorOf({ locale: "en" })).some((s) => /\d; \S/.test(s))).toBe(true);
    expect(walls(translatorOf()).some((s) => /\d ; \S/.test(s))).toBe(true);
  });

  it("métadonnées jsPDF : sujet et nom par défaut dans la langue", () => {
    const { model } = load(EXAMPLES[0]!);
    const pages = {
      toc: true,
      plan: false,
      elevation: false,
      installation: false,
      bom: false,
      cutsheet: false,
      compliance: false,
      flats: false,
      templates: false,
    };
    const decode = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
    const en = decode(exportPdfDocument(model, { locale: "en", compress: false, pages }).bytes);
    // Chaînes PDF : parenthèses échappées.
    expect(en).toContain("/Subject (Staircase drawing package \\(Blondel\\))");
    expect(en).toContain("/Title (Staircase)");
    expect(en).not.toContain("Dossier d'escalier");
    const fr = decode(exportPdfDocument(model, { compress: false, pages }).bytes);
    expect(fr).toContain("/Subject (Dossier d'escalier \\(Blondel\\))");
    expect(fr).toContain("/Title (Escalier)");
  });
});
