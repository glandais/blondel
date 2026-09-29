/**
 * Vue 3D : la grille au sol ne scintille pas quand la caméra bouge (signalement utilisateur,
 * 2026-09-30).
 *
 * Mesure : pour plusieurs poses (dont une caméra rasante, la plus sensible au moiré), la caméra
 * est tournée d'un angle infime (0,05°, déplacement de l'image bien inférieur au pixel) par le
 * point d'accès de test `__blondelViewer3D` ; une scène propre (lignes antialiasées, aucun
 * conflit de profondeur) ne change alors que de quelques niveaux par pixel, alors qu'un conflit
 * de profondeur (grille / plan d'ombre / faces posées au sol) ou un moiré de cellules plus
 * fines que le pixel fait basculer des pixels entiers. On compte les pixels dont une composante
 * varie de plus de `STRONG` niveaux. Un aller-retour (pose → rotation de 20° → pose) doit
 * redonner exactement la même image (rendu déterministe, aucune dérive de la grille).
 *
 * Mesures (1440 × 900, « Escalier droit », limons à la française) — part maximale de pixels qui
 * basculent sur les quatre poses : avant correction (grille de drei, plan d'ombre écrivant la
 * profondeur, near = 0,01 m) 1,72 % en rendu logiciel (la grille entière disparaissait d'une
 * pose à l'autre) et 0,27 % sur GPU (`E2E_GPU=1` : lignes de 1 m hachées par le conflit de
 * profondeur) ; après correction 0,05 % en rendu logiciel et 0,02 % sur GPU (bords des pièces
 * et texture du bois). Seuil : 0,1 %.
 *
 * Chaque pose est aussi capturée grille masquée (`showGrid(false)`) : les pixels dessinés par la
 * grille doivent couvrir au moins `MIN_GRID_RATIO` du canevas, sinon une grille absente passerait
 * la mesure (avant correction : 0 % dans les poses « côté » et « plongeante »). Limite : les
 * lignes de 10 cm (contraste d'environ 40 niveaux sur le fond clair) ne dépassent jamais
 * `STRONG` ; leur moiré n'est pas mesurable ici en rendu logiciel, il est traité par
 * construction (effacement selon le pas à l'écran, `three/groundGrid.ts`).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  chooseStructure,
  describeTasks,
  instrument,
  openApp,
  openTab,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

test.describe.configure({ retries: 1 });

/** Écart d'une composante (0 à 255) au-delà duquel un pixel « bascule ». */
const STRONG = 48;
/** Part maximale de pixels qui basculent pour une rotation infime. */
const MAX_FLIP_RATIO = 0.001;
/** Écart (niveaux) qui désigne un pixel dessiné par la grille (grille affichée / masquée). */
const GRID_PX = 6;
/**
 * Écart (niveaux) d'un pixel de la grille qui change (lignes de 10 cm peu contrastées) : mesure
 * rapportée seulement, le déplacement sous-pixel des bords antialiasés en fait déjà 4 à 8 %.
 */
const GRID_FLIP = 16;
/**
 * Part minimale du canevas couverte par la grille dans chaque pose : sans elle, une grille
 * absente (shader en échec, grille entièrement masquée par le plan d'ombre) passerait la mesure.
 * Avant correction, la grille couvrait 0 % du canevas dans deux poses sur quatre ; après, 7 à
 * 20 %.
 */
const MIN_GRID_RATIO = 0.03;

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

interface Viewer3DHook {
  orbit: (azimuthDeg: number, elevationDeg: number) => void;
  showGrid: (visible: boolean) => void;
}

async function hook(page: Page, call: ["orbit", number, number] | ["showGrid", boolean]) {
  await page.evaluate((c) => {
    const h = (window as Window & { __blondelViewer3D?: Viewer3DHook }).__blondelViewer3D;
    if (!h) throw new Error("point d'accès de test de la vue 3D absent");
    if (c[0] === "orbit") h.orbit(c[1], c[2]);
    else h.showGrid(c[1]);
  }, call);
  await settle(page);
}

async function shot(page: Page): Promise<string> {
  const png = await page.locator(".viewer3d canvas").screenshot({ animations: "disabled" });
  return png.toString("base64");
}

interface Diff {
  readonly total: number;
  /** Pixels où une composante varie de plus de `STRONG` niveaux entre `a` et `b`. */
  readonly flipped: number;
  /** Pixels de la grille : `a` diffère de `a` sans grille de plus de `GRID_PX` niveaux. */
  readonly grid: number;
  /** Pixels de la grille où une composante varie de plus de `GRID_FLIP` niveaux de `a` à `b`. */
  readonly gridFlipped: number;
}

/**
 * Compare les captures PNG (décodées dans la page) `a` et `b` d'une même pose à une rotation
 * infime près ; `aNoGrid` (pose de `a`, grille masquée) isole les pixels dessinés par la grille,
 * dont les lignes de 10 cm, trop peu contrastées pour le seuil `STRONG`.
 */
async function diff(page: Page, a: string, b: string, aNoGrid: string): Promise<Diff> {
  return page.evaluate(
    async ([pa, pb, pn, strong, gridPx, gridFlip]) => {
      const decode = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("contexte 2D indisponible");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [da, db, dn] = await Promise.all([decode(pa), decode(pb), decode(pn)]);
      const delta = (x: Uint8ClampedArray, y: Uint8ClampedArray, i: number) =>
        Math.max(
          Math.abs(x[i]! - y[i]!),
          Math.abs(x[i + 1]! - y[i + 1]!),
          Math.abs(x[i + 2]! - y[i + 2]!),
        );
      let flipped = 0;
      let grid = 0;
      let gridFlipped = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = delta(da, db, i);
        if (d > strong) flipped++;
        if (delta(da, dn, i) > gridPx) {
          grid++;
          if (d > gridFlip) gridFlipped++;
        }
      }
      return { total: da.length / 4, flipped, grid, gridFlipped };
    },
    [a, b, aNoGrid, STRONG, GRID_PX, GRID_FLIP] as const,
  );
}

test(`grille au sol sans scintillement quand la caméra bouge (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  await chooseStructure(page, "wood-housed");
  await takeLongTasks(page);
  await openTab(page, "3D");
  // Cotes en surimpression (texte SVG calé au pixel) retirées : seule la scène est comparée.
  await page.getByLabel("Cotes principales").uncheck();
  await expect.poll(() => page.evaluate(() => "__blondelViewer3D" in window)).toBe(true);

  const report: string[] = [];
  let worst = 0;
  // Poses : cadrage initial, vue de côté, caméra rasante (moiré), vue plongeante.
  const poses: readonly (readonly [number, number, string])[] = [
    [0, 0, "cadrage initial"],
    [60, 0, "côté"],
    [30, -25, "rasante"],
    [-40, 20, "plongeante"],
  ];
  for (const [az, el, label] of poses) {
    await hook(page, ["orbit", az, el]);
    const a = await shot(page);
    await hook(page, ["showGrid", false]);
    const aNoGrid = await shot(page);
    await hook(page, ["showGrid", true]);
    await hook(page, ["orbit", az + 0.05, el]);
    const b = await shot(page);
    const d = await diff(page, a, b, aNoGrid);
    const ratio = d.flipped / d.total;
    const gridRatio = d.gridFlipped / Math.max(1, d.grid);
    worst = Math.max(worst, ratio);
    report.push(
      `${label} : ${d.flipped} pixels basculent sur ${d.total} (${(ratio * 100).toFixed(3)} %) ; ` +
        `grille : ${d.grid} pixels (${((d.grid / d.total) * 100).toFixed(2)} %), ` +
        `${d.gridFlipped} scintillent (${(gridRatio * 100).toFixed(2)} %)`,
    );
    // La grille est bien dessinée (sinon la mesure ne prouverait rien).
    expect(d.grid / d.total, `${label} : grille visible`).toBeGreaterThanOrEqual(MIN_GRID_RATIO);

    // Aller-retour : même pose, même image au pixel près.
    await hook(page, ["orbit", az + 20, el]);
    await hook(page, ["orbit", az, el]);
    const back = await shot(page);
    const r = await diff(page, a, back, aNoGrid);
    report.push(`${label}, aller-retour : ${r.flipped} pixels basculent`);
    expect(back === a, `${label} : aller-retour identique`).toBe(true);
  }
  console.log(report.join("\n"));
  expect(worst, report.join("\n")).toBeLessThanOrEqual(MAX_FLIP_RATIO);

  const tasks = await takeLongTasks(page);
  const bad = overBudget(tasks);
  expect(bad.length, describeTasks(bad, tasks)).toBe(0);
});
