/**
 * Exports du jalon 6 dans l'interface : modèle 3D glTF binaire (.glb, calculé dans le worker),
 * fiche de pose PDF ; menu « Importer » → plan DXF (calque du plan « Site et saisie »).
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  applyPreset,
  chooseStructure,
  describeTasks,
  instrument,
  openApp,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

async function exportEntry(page: Page, name: string): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Exporter/ }).click();
  const item = page.getByRole("menuitem", { name, exact: true });
  await expect(item).toBeEnabled();
  await item.click();
  const d = await pending;
  const path = await d.path();
  return readFile(path);
}

test(`export glTF (.glb) et fiche de pose PDF (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await chooseStructure(page, "wood-housed");
  await takeLongTasks(page);

  const glb = await exportEntry(page, "Modèle 3D glTF (.glb)");
  // En-tête GLB : « glTF », version 2, longueur totale ; premier bloc JSON.
  expect(glb.subarray(0, 4).toString("latin1")).toBe("glTF");
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  expect(glb.readUInt32LE(16)).toBe(0x4e4f534a);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8")) as {
    asset: { version: string };
    nodes: unknown[];
    meshes: unknown[];
  };
  expect(json.asset.version).toBe("2.0");
  expect(json.nodes.length).toBeGreaterThan(10);
  expect(json.meshes.length).toBeGreaterThan(0);
  await settle(page);

  const pose = await exportEntry(page, "Fiche de pose (PDF)");
  expect(pose.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(pose.subarray(-1024).toString("latin1")).toContain("%%EOF");
  await settle(page);

  const tasks = await takeLongTasks(page);
  expect(describeTasks(overBudget(tasks), tasks)).toBe("");
});

test("menu Importer : plan DXF ouvert dans le plan « Site et saisie »", async ({ page }) => {
  await openApp(page);
  const g = (...kv: (string | number)[]): string => kv.map(String).join("\n");
  const dxf =
    [
      g(0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC"),
      g(0, "SECTION", 2, "ENTITIES"),
      g(0, "LINE", 8, "MURS", 10, 0, 20, 0, 30, 0, 11, 3000, 21, 0, 31, 0),
      g(0, "LINE", 8, "MURS", 10, 3000, 20, 0, 30, 0, 11, 3000, 21, 4000, 31, 0),
      g(0, "ENDSEC", 0, "EOF"),
    ].join("\n") + "\n";
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Importer/ }).click();
  await page.getByRole("menuitem", { name: "Plan DXF (calque de fond)…" }).click();
  await (
    await chooser
  ).setFiles({ name: "murs.dxf", mimeType: "application/dxf", buffer: Buffer.from(dxf) });
  await expect(page.getByRole("tab", { name: "Plan 2D", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: "Site et saisie", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("status").filter({ hasText: "« murs.dxf » importé" })).toContainText(
    "2 entités",
  );
  await expect(page.locator("path.plan-site__dxf")).toHaveCount(1);
  // Outils de tracé de la trémie et des murs disponibles dans ce mode.
  await expect(page.getByRole("button", { name: "Tracer la trémie" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tracer un mur" })).toBeVisible();
  // L'import est annulable.
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(page.locator("path.plan-site__dxf")).toHaveCount(0);
});

test("menus Importer et Exporter : jamais hors de la fenêtre, quelle que soit la largeur", async ({
  page,
}) => {
  await openApp(page);
  const problems: string[] = [];
  for (const width of [760, 900, 1024, 1180, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const name of [/^Importer/, /^Exporter/]) {
      await page.getByRole("button", { name }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const r = document.querySelector('[role="menu"]')!.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          right: Math.round(r.right),
          view: de.clientWidth,
          overflowX: de.scrollWidth - de.clientWidth,
        };
      });
      if (m.overflowX > 0 || m.left < 0 || m.right > m.view)
        problems.push(`${width} px, ${String(name)} : ${JSON.stringify(m)}`);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    }
  }
  expect(problems.join("\n"), "menu hors de la fenêtre").toBe("");
});
