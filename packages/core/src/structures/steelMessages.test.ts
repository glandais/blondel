/**
 * Textes des plugins métal et hélicoïdal (ADR-0007) : chaque message a sa traduction anglaise,
 * sans reste de français, et le français reste celui des anciens textes.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dec, msg, translatorFor, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import type { StructureOutput } from "../model/plugins.js";
import type { Project } from "../model/project.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";
import "./index.js";
import { getStructure } from "./registry.js";
import { deduceExecutionClass, executionClassReasons } from "./steelCommon.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const loadExample = (file: string): Project =>
  parseProjectText(readFileSync(join(EXAMPLES_DIR, file), "utf8"));

const EN = translatorFor("en");

/** Sortie du plugin de structure du projet (sans les messages des autres étapes). */
function pluginOutput(project: Project): StructureOutput {
  const m = buildModel(project, { memo: false });
  const plugin = getStructure(project.stair.structure.kind)!;
  const params = plugin.paramsSchema.parse(project.stair.structure.params);
  return plugin.build({ project, layout: m.layout, stepping: m.stepping }, params);
}

/** Tous les messages d'une sortie de plugin : remarques, erreurs, constats, pièces, développés. */
function messagesOf(out: StructureOutput): Message[] {
  const list: Message[] = [...out.notes, ...(out.errors ?? [])];
  for (const r of out.checks ?? []) list.push(r.message);
  for (const p of out.parts) {
    list.push(p.name);
    if (p.section) list.push(p.section);
    if (p.flat?.reference) list.push(p.flat.reference.description);
    for (const l of p.flat?.lines ?? []) if (l.label) list.push(l.label);
  }
  return list;
}

/** Mots ou lettres qui trahissent un texte français resté dans la traduction anglaise. */
const FRENCH =
  /[àâçéèêëîïôûùœ«»]|\b(limons?|marches?|tôle|poteau|volée|soudure|aucune?|sans|avec|platine|cornières?|tournant|pliée?|roulée?|naissance|développé|contremarche)\b/i;

describe("plugins métal : messages traduits en anglais", () => {
  it.each([
    ["steel-flat (tôle pliée)", "j3b-acceptance-01-tole-pliee.blondel.json"],
    ["steel-flat (plat)", "j3b-acceptance-01-acier-plat.blondel.json"],
    ["steel-curved", "j5b-debillarde-soude.blondel.json"],
    ["helical-core (fût)", "j5a-helicoidal.blondel.json"],
    ["helical-core (jour central)", "demo-helical-well.blondel.json"],
  ])("%s : aucune clé manquante, aucun reste de français", (_, file) => {
    const out = pluginOutput(loadExample(file));
    const messages = messagesOf(out);
    expect(messages.length).toBeGreaterThan(10);
    for (const m of messages) {
      const en = EN.t(m);
      expect(en, m.key).not.toMatch(/\b(structure|rules|compliance)\.[A-Za-z]+\.[A-Za-z.]+\b/);
      expect(en, `${m.key} : ${en}`).not.toMatch(FRENCH);
      expect(fr(m), m.key).not.toBe("");
    }
  });

  it("classe d'exécution : même texte français qu'avant, anglais du glossaire", () => {
    const exc = deduceExecutionClass({ grade: "S355", buttWeld: 1234.4, welded: true });
    const note = msg("structure.steel.exc.note", {
      executionClass: exc.executionClass,
      reasons: executionClassReasons(exc, "S355"),
    });
    expect(fr(note)).toBe(
      "Classe d'exécution EN 1090-2 : EXC2 (nuance S355 soudée, soudures bout à bout (1234 mm de cordon)).",
    );
    expect(EN.t(note)).toBe(
      "Execution class to EN 1090-2: EXC2 (welded S355 grade, butt welds (1234 mm of weld)).",
    );
    const none = deduceExecutionClass({ grade: "S235", buttWeld: 0 });
    expect(
      fr(
        msg("structure.steel.exc.note", {
          executionClass: "EXC1",
          reasons: executionClassReasons(none, "S235"),
        }),
      ),
    ).toBe("Classe d'exécution EN 1090-2 : EXC1 (S235, aucune soudure bout à bout).");
  });

  it("constat de format de tôle : nombres localisés, repère non traduit", () => {
    const m = msg("structure.steel.check.inSheetFormat", {
      mark: "LE1",
      length: dec(3210.46, 0),
      width: dec(312.5, 0),
    });
    expect(fr(m)).toBe("LE1 : développé 3210 × 313 mm dans un format de tôle.");
    expect(EN.t(m)).toBe("LE1: flat pattern 3210 × 313 mm within a sheet size.");
  });

  it("comptes : « (s) » conservé en français, vrai pluriel en anglais", () => {
    const splices = (count: number): Message =>
      msg("structure.steelProfile.note.weldedSplices", {
        mark: "LM1",
        length: dec(7000, 0),
        bar: dec(6000, 0),
        count,
      });
    expect(fr(splices(1))).toBe(
      "LM1 : longueur de débit 7000 mm > barre de 6000 mm, 1 aboutage(s) soudé(s) bout à bout (EXC2).",
    );
    expect(fr(splices(2))).toBe(
      "LM1 : longueur de débit 7000 mm > barre de 6000 mm, 2 aboutage(s) soudé(s) bout à bout (EXC2).",
    );
    expect(EN.t(splices(1))).toBe(
      "LM1: cut length 7000 mm > 6000 mm bar, 1 butt-welded splice (EXC2).",
    );
    expect(EN.t(splices(2))).toBe(
      "LM1: cut length 7000 mm > 6000 mm bar, 2 butt-welded splices (EXC2).",
    );
    const folded = msg("structure.steelFlat.note.foldedTreads", {
      profile: "Z",
      parts: msg("structure.steelFlat.count.parts", { count: 14 }),
      unique: msg("structure.steelFlat.count.uniqueParts", { count: 1 }),
      tolerance: dec(0.5, 1),
    });
    expect(fr(folded)).toBe(
      "Marches en tôle pliée Z : 14 pièce(s), 1 pièce(s) unique(s) (tolérance 0,5 mm) ; développés en fibre neutre, loi de pli à valider (CHALLENGE G5).",
    );
    expect(EN.t(folded)).toMatch(
      /^Z folded-plate treads: 14 parts, 1 unique part \(tolerance 0\.5 mm\)/,
    );
  });
});
