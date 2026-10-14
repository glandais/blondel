/**
 * Marches dansantes sur un tronçon à axe en arc (décision F10 (1), sous-lot P2) : effets sur les
 * **exports** des cages saisies en arc, que `packages/core/src/pipeline/arcWinder.test.ts` (qui
 * borne l'effet sur le `Model`) ne voit pas. Mesurés contre le commit 67672d2 :
 * - plan et élévation SVG : les marches de l'arc sont peintes en dansantes
 *   (`data-kind="winder"` au lieu de `straight`) ;
 * - la cote de giron du plan (`data-dimension="going"`) porte sur une marche droite : sans
 *   marche droite (`cage-arc`), elle disparaît (plan DXF R12 : couche COTES de 17 à 11
 *   entités) ; `demo-cage-arc-glass` la garde, posée sur une autre marche droite (plan DXF :
 *   26 lignes de coordonnées changées) ;
 * - liste de débit, visserie et développés inchangés (mêmes pièces).
 * À confirmer par l'utilisateur (question F10 (9)).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, parseProjectText } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { renderElevationSvg } from "./svg/elevation.js";
import { renderPlanSvg } from "./svg/plan.js";

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

describe("marches dansantes sur axe en arc (décision F10 (1)) — exports", () => {
  it.each([
    // Exemple, marches dansantes, marches droites, cote de giron au plan.
    ["cage-arc", 14, 0, 0],
    ["cage-arc-palier-cintre", 7, 6, 1],
    ["demo-cage-arc-glass", 7, 6, 1],
  ])("%s : %i dansantes, %i droites, %i cote de giron", (name, winders, straights, going) => {
    const project = parseProjectText(
      readFileSync(join(EXAMPLES_DIR, `${name}.blondel.json`), "utf8"),
    );
    const model = buildModel(project);
    const opts = { project, theme: "light" as const, title: project.name, locale: "fr" as const };
    const plan = renderPlanSvg(model, opts);
    expect(count(plan, /data-kind="winder"/g)).toBe(winders);
    expect(count(plan, /data-kind="straight"/g)).toBe(straights);
    expect(count(plan, /data-dimension="going"/g)).toBe(going);
    const elevation = renderElevationSvg(model, opts);
    expect(count(elevation, /data-kind="winder"/g)).toBe(winders);
    expect(count(elevation, /data-kind="straight"/g)).toBe(straights);
  });
});
