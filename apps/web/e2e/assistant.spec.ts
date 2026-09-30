/**
 * Critère d'acceptation n° 1 par l'assistant d'initialisation (CHALLENGE P1, G8) : depuis une
 * page vierge, obtenir un quart tournant bois (limons à la française, poteau d'angle) avec
 * garde-corps, sans contrôle bloquant, puis télécharger le dossier PDF et le plan DXF, en moins
 * de 2 minutes, mesurées en nombre d'interactions (journal joint au rapport).
 *
 * Interactions comptées : ouverture de l'assistant (1), longueur et largeur de trémie (2),
 * structure visée (1), typologie « Quart tournant » (1), emmarchement E = 800 (1), « Proposer »
 * (1), « Choisir » (1), menu « Exporter » et PDF (2), menu et DXF (2) : 12. H = 2 700 et dalle = 200 sont repris du
 * projet de départ (vérifiés, non comptés).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  Interactions,
  LONG_TASK_BUDGET_MS,
  blockingCount,
  describeTasks,
  instrument,
  openApp,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

/** Plafond d'interactions (même plafond que le parcours par préréglage, acceptance.spec.ts). */
const MAX_INTERACTIONS = 20;
/** Critère n° 1 : « en moins de 2 minutes ». */
const MAX_DURATION_MS = 120_000;

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

function dialog(page: Page) {
  return page.getByRole("dialog", { name: "Assistant d'initialisation" });
}

async function download(page: Page, entry: RegExp, ix: Interactions) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Exporter/ }).click();
  ix.count("menu Exporter");
  const item = page.getByRole("menuitem", { name: entry });
  await expect(item).toBeEnabled();
  await item.click();
  ix.count(`export ${entry.source}`);
  return pending;
}

test("critère n° 1 par l'assistant : quart tournant bois conforme, PDF et DXF", async ({
  page,
}, info) => {
  const ix = new Interactions();
  await openApp(page);
  await takeLongTasks(page);
  const t0 = Date.now();

  await page.getByRole("button", { name: "Assistant…" }).click();
  ix.count("Assistant…");
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByLabel("Hauteur à monter H")).toHaveValue("2700");
  await expect(d.getByLabel("Épaisseur de dalle")).toHaveValue("200");

  await d.getByLabel("Longueur de trémie (X)").fill("2800");
  ix.count("trémie X = 2 800");
  await d.getByLabel("Largeur de trémie (Y)").fill("900");
  ix.count("trémie Y = 900");
  await d.getByLabel("Structure visée").selectOption("wood-housed");
  ix.count("structure visée : limons à la française");
  await d.getByLabel("Quart tournant", { exact: true }).check();
  ix.count("typologie : quart tournant");
  // Critère n° 1 (CHALLENGE P1) : E = 800 mm, imposé (sinon l'assistant choisit dans sa grille).
  await d.getByLabel("Emmarchement imposé").fill("800");
  ix.count("emmarchement E = 800");
  await d.getByRole("button", { name: "Proposer", exact: true }).click();
  ix.count("Proposer");

  // Cartes : croquis, cotes et score détaillé.
  const cards = d.locator(".assistant__card");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  await expect(d.getByRole("status").filter({ hasText: "sans contrôle bloquant" })).toBeVisible();
  const first = cards.first();
  await expect(first.locator("svg.assistant__sketch")).toHaveCount(1);
  await expect(first).toContainText("Hauteurs n");
  await expect(first).toContainText("2h + g");
  await expect(first).toContainText("Collet mini");
  await expect(first).toContainText("Échappée mini");
  await expect(first.locator(".assistant__score summary")).toContainText("Score");
  await expect(first.locator("h4")).toContainText("Quart tournant");
  await expect(first.locator("dt", { hasText: "Emmarchement E" }).locator("+ dd")).toHaveText(
    /^800\s?mm$/,
  );

  await first.getByRole("button", { name: /^Choisir/ }).click();
  ix.count("Choisir la première proposition");
  await expect(d).toHaveCount(0);
  await settle(page);
  const designMs = Date.now() - t0;

  // Projet retenu : limons à la française, poteau d'angle, garde-corps, sans bloquant.
  await expect(page.getByLabel("Structure", { exact: true })).toHaveValue("wood-housed");
  await expect(page.getByLabel("Jour", { exact: true })).toHaveValue("newel");
  const blocking = await blockingCount(page);
  expect(blocking).toBe(0);
  await expect(page.locator(".statusbar__errors")).toHaveCount(0);
  await page.getByRole("tab", { name: "Nomenclature", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText(/[Bb]alustre/);
  await expect(page.getByRole("tabpanel")).toContainText(/[Pp]oteau/);

  const pdf = await download(page, /^Dossier PDF complet \(gabarits 1:1 en A4\)/, ix);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const dxf = await download(page, /^Plan coté \(DXF 2007/, ix);
  expect(dxf.suggestedFilename()).toMatch(/\.dxf$/);
  const totalMs = Date.now() - t0;

  // « Annuler » revient au projet de départ (le choix est une seule entrée d'historique).
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await settle(page);
  await expect(page.getByLabel("Structure", { exact: true })).not.toHaveValue("wood-housed");

  const tasks = await takeLongTasks(page);
  const over = overBudget(tasks);
  await info.attach("interactions", {
    body:
      `${ix.total} interactions ; conception ${designMs} ms, avec exports ${totalMs} ms\n` +
      ix.log.map((l, i) => `${i + 1}. ${l}`).join("\n"),
    contentType: "text/plain",
  });
  expect(ix.total).toBeLessThanOrEqual(MAX_INTERACTIONS);
  expect(totalMs).toBeLessThan(MAX_DURATION_MS);
  expect(describeTasks(over, tasks), `tâches > ${LONG_TASK_BUDGET_MS} ms`).toBe("");
});

test("accueil, annulation de la recherche, fermeture", async ({ page }) => {
  await openApp(page);
  // Première visite : l'accueil propose l'assistant.
  const welcome = page.getByRole("region", { name: "Accueil" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Démarrer avec l'assistant" }).click();
  const d = dialog(page);
  await expect(d).toBeVisible();

  // Saisie invalide : message, aucune recherche.
  await d.getByLabel("Hauteur à monter H").fill("");
  await d.getByRole("button", { name: "Proposer", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Hauteur à monter H");
  await d.getByLabel("Hauteur à monter H").fill("2700");

  // Annulation déterministe (QUESTIONS D5) : le worker de l'assistant est remplacé par un
  // worker qui ne répond jamais, la recherche tourne donc tant qu'on ne l'annule pas.
  const workerUrl = /assistant\.worker/;
  await page.route(workerUrl, (route) =>
    route.fulfill({ contentType: "text/javascript", body: "self.onmessage = () => {};" }),
  );
  await d.getByRole("button", { name: "Proposer", exact: true }).click();
  await expect(d.getByText("Recherche en cours")).toBeVisible();
  await d.getByRole("button", { name: "Annuler la recherche" }).click();
  await expect(d.getByText("Recherche en cours")).toHaveCount(0);
  await expect(d.locator(".assistant__summary")).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Proposer", exact: true })).toBeEnabled();
  await page.unroute(workerUrl);

  // Nouvelle recherche menée à terme, puis fermeture par Échap : projet inchangé.
  await d.getByRole("button", { name: "Proposer", exact: true }).click();
  await expect(d.locator(".assistant__summary")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Annuler", exact: true })).toBeDisabled();
});

test("variantes : repliées sous la carte de chaque forme, avec croquis ; liste à plat sur demande", async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole("button", { name: "Assistant…" }).click();
  const d = dialog(page);
  await d.getByLabel("Longueur de trémie (X)").fill("2800");
  await d.getByLabel("Largeur de trémie (Y)").fill("900");
  await d.getByLabel("Quart tournant", { exact: true }).check();
  await d.getByRole("button", { name: "Proposer", exact: true }).click();
  await expect(d.locator(".assistant__summary")).toBeVisible({ timeout: 30_000 });

  // Une carte principale par forme (typologie × position du tournant).
  const shapes = d.locator(".assistant__shape");
  const n = await shapes.count();
  expect(n).toBeGreaterThan(0);
  const keys = await shapes.evaluateAll((els) => els.map((e) => e.getAttribute("data-shape")));
  expect(new Set(keys).size).toBe(keys.length);

  const withVariants = d.locator(".assistant__shape:has(.assistant__variants)").first();
  await expect(withVariants).toHaveCount(1);
  const summary = withVariants.locator(".assistant__variants > summary");
  await expect(summary).toContainText(/variantes? de cette forme/);
  const variant = withVariants.locator(".assistant__card--variant").first();
  await expect(variant).toBeHidden();
  // Croquis des variantes calculés au dépliage seulement (QUESTIONS D5).
  await expect(variant.locator("svg.assistant__sketch")).toHaveCount(0);
  await summary.click();
  await expect(variant).toBeVisible();
  await expect(variant.locator("svg.assistant__sketch")).toHaveCount(1);
  await expect(
    variant.getByRole("button", { name: /^Choisir : .*\(variante \d+\.2\)$/ }),
  ).toBeVisible();

  // « Montrer toutes les variantes » : liste à plat, plus de variantes repliées.
  await d.getByLabel("Montrer toutes les variantes (liste à plat)").check();
  await d.getByRole("button", { name: "Proposer", exact: true }).click();
  await expect(d.locator(".assistant__summary")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => d.locator(".assistant__card").count(), { timeout: 30_000 })
    .toBeGreaterThan(n);
  await expect(d.locator(".assistant__variants")).toHaveCount(0);

  // Choisir une variante remplace le projet (une entrée d'historique).
  await d
    .locator(".assistant__card")
    .nth(1)
    .getByRole("button", { name: /^Choisir/ })
    .click();
  await expect(d).toHaveCount(0);
  await settle(page);
  await expect(page.getByRole("button", { name: "Annuler", exact: true })).toBeEnabled();
});
