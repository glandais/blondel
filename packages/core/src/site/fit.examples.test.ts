/**
 * Adéquation au site sur les exemples de référence (`examples/`, sous-lot 3b) : résumé figé de
 * `Model.siteFit` par exemple (type, sévérité, clé du message ou règle reprise, numéro de
 * marche). L'instantané des cotes (`pipeline/build.test.ts`) ne lit pas `Model.siteFit` : ce
 * test fige notamment le partage de la dalle en erreur / avertissement (QUESTIONS F15) sur les
 * exemples à limons (j3a, j3b, j3c, j4, j5b : limon côté extérieur au ras de la trémie,
 * avertissement `site.fit.slabStructure` à la marche 14, aucune erreur de dalle).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SiteConflict } from "../model/derived.js";
import { buildModel } from "../pipeline/build.js";
import { parseProjectText } from "../project/parse.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples");
const SUFFIX = ".blondel.json";

/** « type sévérité clé-ou-règle [marche] ». */
function summary(c: SiteConflict): string {
  const tread = c.message.params?.tread;
  return [
    c.kind,
    c.severity,
    c.ruleId ?? c.message.key,
    ...(tread !== undefined ? [tread] : []),
  ].join(" ");
}

const EXPECTED: Readonly<Record<string, readonly string[]>> = {
  "acceptance-01-quart-tournant": [
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  // Limons acier en plat (sous-lot 6b) : limon au ras de la trémie à l'arrivée, comme les limons
  // à la française de `cage-60-palier-limon`.
  "cage-45-palier-acier": [
    "slab avertissement site.fit.slabStructureArrival",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "cage-60": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  // Limons à la française (sous-lot 6a) : limon au ras de la trémie à l'arrivée (épaisseur de
  // structure seule sous la dalle, avertissement F15 (2)).
  // Limon central acier (sous-lot 6c) : poutre sous les marches, aucune épaisseur hors de
  // l'emmarchement, pas de conflit de dalle.
  "cage-60-palier-central": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "cage-60-palier-limon": [
    "slab avertissement site.fit.slabStructureArrival",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "cage-arc": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "cage-arc-palier-cintre": [
    "slab avertissement site.fit.slabStructureArrival",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "cage-palier-droit": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "cage-rayonnant": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "cage-trapeze": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  // Démos du tracé libre (sous-lot 7a) : arrivée le long d'un axe du site, aucun conflit de
  // dalle ; la démo en arc (volée courbe au départ) n'a pas même le conseil d'échappée.
  "demo-cage-arc-glass": [],
  "demo-cage-central-steel": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-cage-flared-steel": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-cage-oak-60": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  // Démo du site libre : contour, murs, poteau, porte et fenêtre sans conflit ; arrivée oblique
  // (jonction à 105°), limon au ras de la trémie (avertissement F15 (2), comme les exemples à
  // limons).
  "demo-cage-room": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-central-glulam": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-central-wreathed": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-erp-grand": [
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
    "headroom conseil ECHAPPEE_RECO_PUBLIC",
  ],
  "demo-half-turn-industrial": [],
  "demo-helical-glass": [
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "demo-helical-well": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-quarter-curved": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-quarter-landing-ash": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-straight-central-glulam": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-straight-cut-oak": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-straight-loft": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "demo-u-oak": [],
  "half-turn": [],
  "j3a-acceptance-01-bois": [
    "slab avertissement site.fit.slabStructure 14",
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "j3b-acceptance-01-acier-plat": [
    "slab avertissement site.fit.slabStructure 14",
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "j3b-acceptance-01-tole-pliee": [
    "slab avertissement site.fit.slabStructure 14",
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "j3c-acceptance-01-upn": [
    "slab avertissement site.fit.slabStructure 14",
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "j4-acceptance-01-garde-corps": [
    "slab avertissement site.fit.slabStructure 14",
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "j4-demi-tournant-acier-garde-corps": [],
  "j5a-helicoidal": [
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "j5b-debillarde-soude": ["slab avertissement site.fit.slabStructure 14"],
  "j5c-limon-central-bois-droit": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "j5c-limon-central-bois-helicoidal": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "j5c-limon-central-bois-quart-tournant": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "j5c-limon-central-droit": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "j5c-limon-central-helicoidal": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "j5c-limon-central-quart-tournant": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "quarter-landing": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "quarter-left": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "quarter-right": ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  straight: ["headroom conseil ECHAPPEE_RECO_PRIVATIF"],
  "two-quarters-s": [
    "headroom avertissement ECHAPPEE_LARGEUR",
    "headroom conseil ECHAPPEE_RECO_PRIVATIF",
  ],
  "two-quarters-u": [],
};

describe("adéquation au site : exemples de référence", () => {
  const names = readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith(SUFFIX))
    .map((f) => f.slice(0, -SUFFIX.length))
    .sort();

  it("chaque exemple a un résumé attendu", () => {
    expect(names).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(names)("%s", (name) => {
    const text = readFileSync(join(EXAMPLES_DIR, name + SUFFIX), "utf8");
    const fit = buildModel(parseProjectText(text), { memo: false }).siteFit ?? [];
    expect(fit.map(summary)).toEqual(EXPECTED[name]);
    // Aucune erreur de dalle sur un exemple de référence.
    expect(fit.filter((c) => c.kind === "slab" && c.severity === "erreur")).toEqual([]);
  });
});
