/**
 * Parcours libre (ADR-0009, maquette 1b) : rail des 8 sections (onglets ARIA, clavier), panneau
 * unique (re-clic, épingle, clic dans la vue, Échap hors saisie), Balancement indisponible sans
 * tournant, compteurs ◆ d'une démo, badge Contrôle (couleur de la sévérité, inspecteur sans
 * sélection), bascule Conception / Fabrication sans perte d'historique ni de vue, option Guidé
 * désactivée, réglages du menu ⋯ (unité, thème), contraste du bouton Exporter (ADR-0009
 * point 11) et absence de défilement horizontal du document aux petites largeurs.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  SECTIONS,
  STRUCTURES,
  applyPreset,
  closeProjectMenu,
  commitField,
  describeTasks,
  instrument,
  openApp,
  openMoreMenu,
  openProjectMenu,
  openSection,
  openTab,
  openWorkspace,
  overBudget,
  sectionTab,
  settle,
  structureSelect,
  takeLongTasks,
  viewTab,
} from "./support.js";

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

const panel = (page: Page) => page.locator("#free-panel");

/** Rapport de contraste WCAG de deux couleurs CSS calculées (`rgb(…)` / `rgba(…)`). */
function contrast(fg: string, bg: string): number {
  const lum = (c: string) => {
    const [r, g, b] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

/** Couleurs calculées (texte, fond) d'un élément. */
async function colors(locator: Locator): Promise<{ color: string; background: string }> {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
}

/** Défilement horizontal du document (px). */
async function overflowX(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test(`rail et panneau unique : clavier, re-clic, épingle, clic dans la vue, Échap (tâches ≤ ${LONG_TASK_BUDGET_MS} ms)`, async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await takeLongTasks(page);

  // Premier lancement : aucun panneau, la vue occupe la place.
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator(".app")).toHaveAttribute("data-panel", "closed");
  const rail = page.getByRole("tablist", { name: "Sections" });
  await expect(rail).toHaveAttribute("aria-orientation", "vertical");
  const tabs = rail.getByRole("tab");
  await expect(tabs).toHaveText([...SECTIONS].map((s) => new RegExp(`^${s}`)));
  for (const name of SECTIONS) {
    // Nom accessible : le libellé seul.
    await expect(rail.getByRole("tab", { name, exact: true })).toHaveCount(1);
  }

  // Clavier : un seul arrêt de tabulation, flèches sans ouvrir, Entrée ouvre.
  const site = sectionTab(page, "Site");
  await expect(site).toHaveAttribute("tabindex", "0");
  await site.focus();
  await page.keyboard.press("ArrowDown");
  await expect(sectionTab(page, "Tracé")).toBeFocused();
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(sectionTab(page, "Découpage")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(sectionTab(page, "Tracé")).toHaveAttribute("aria-selected", "true");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute("role", "tabpanel");
  await expect(panel(page)).toHaveAttribute("aria-labelledby", "rail-tab-layout");
  await expect(panel(page).getByRole("heading", { level: 3 })).toHaveText("Tracé");
  await expect(page.locator(".app")).toHaveAttribute("data-panel", "open");
  await expect(
    panel(page).getByRole("group", { name: "Chiffres clés de la section" }),
  ).toBeVisible();

  // Un seul panneau : choisir une autre section remplace le contenu.
  await sectionTab(page, "Marches").click();
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).getByRole("heading", { level: 3 })).toHaveText("Marches");
  await expect(sectionTab(page, "Tracé")).toHaveAttribute("aria-selected", "false");
  // Re-clic sur l'entrée active : le panneau se ferme.
  await sectionTab(page, "Marches").click();
  await expect(panel(page)).toHaveCount(0);

  // Clic sur une commande de la vue (mode du plan) : le panneau reste ouvert, le clic agit.
  await openSection(page, "Découpage");
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  await expect(page.getByRole("button", { name: "Site et saisie", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel(page)).toBeVisible();
  await page.getByRole("button", { name: "Plan coté", exact: true }).click();
  // Clic dans le dessin : panneau non épinglé fermé.
  await page.locator("#view-panel .svg-export svg").click();
  await expect(panel(page)).toHaveCount(0);

  // Épinglé : il reste ouvert au clic dans la vue et suit la section choisie.
  await openSection(page, "Découpage");
  const pin = panel(page).getByRole("button", { name: "Épingler le panneau" });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await page.locator("#view-panel .svg-export svg").click();
  await expect(panel(page)).toBeVisible();
  await sectionTab(page, "Site").click();
  await expect(panel(page).getByRole("heading", { level: 3 })).toHaveText("Site");
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  // Échap pendant une saisie : rétablit la valeur, ne ferme pas le panneau.
  const h = page.getByLabel("Hauteur à monter H");
  await h.fill("2810");
  await h.press("Escape");
  await expect(h).toHaveValue("2700");
  await expect(panel(page)).toBeVisible();
  // Échap hors saisie : panneau fermé (même épinglé), focus rendu à l'onglet du rail.
  await sectionTab(page, "Site").focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(sectionTab(page, "Site")).toBeFocused();

  // Fermer par la croix.
  await openSection(page, "Contexte");
  await panel(page).getByRole("button", { name: "Fermer le panneau" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(sectionTab(page, "Contexte")).toBeFocused();

  const tasks = await takeLongTasks(page);
  expect(describeTasks(overBudget(tasks), tasks)).toBe("");
});

test("Balancement indisponible sans tournant ; compteurs ◆ d'une démo", async ({ page }) => {
  await openApp(page);
  await applyPreset(page, "Escalier droit");
  const balancing = sectionTab(page, "Balancement");
  await expect(balancing).toHaveAttribute("aria-disabled", "true");
  await balancing.click({ force: true });
  await expect(panel(page)).toHaveCount(0);
  // Les flèches sautent l'entrée indisponible.
  await sectionTab(page, "Découpage").focus();
  await page.keyboard.press("ArrowDown");
  await expect(sectionTab(page, "Marches")).toBeFocused();

  // Avec un tournant, Balancement s'ouvre.
  await applyPreset(page, "Quart tournant à gauche");
  await expect(balancing).not.toHaveAttribute("aria-disabled", "true");
  await openSection(page, "Balancement");
  await expect(panel(page).getByLabel("Méthode", { exact: true })).toBeVisible();

  // Démo : valeurs « à valider » (◆) comptées sur Structure et Garde-corps, décrites hors du
  // nom accessible de l'onglet.
  await applyPreset(page, "Quart tournant débillardé soudé");
  for (const name of ["Structure", "Garde-corps"] as const) {
    const tab = sectionTab(page, name);
    await expect(tab.locator(".rail__count")).toHaveText(/^◆ \d+$/);
    await expect(tab).toHaveAttribute("aria-describedby", /.+/);
    const id = (await tab.getAttribute("aria-describedby"))!;
    await expect(page.locator(`[id="${id}"]`)).toHaveText(/\d+ valeurs? à valider/);
  }
});

test("badge Contrôle : couleur de la sévérité, inspecteur sans sélection, focus", async ({
  page,
}) => {
  await openApp(page);
  // Contrôle bloquant : hauteur de marche cible excessive.
  await openSection(page, "Découpage");
  await commitField(page, page.getByLabel("Hauteur de marche cible"), "215");
  const badge = page.locator(".control-badge");
  await expect(badge).toHaveAttribute("data-severity", "bloquant");
  await expect(badge).toHaveAccessibleName(/^Contrôle : \d+ bloquant/);
  // Bordure de la couleur de la sévérité la plus haute.
  const tone = await badge.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--sev-bloquant)";
    el.parentElement!.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { border: getComputedStyle(el).borderTopColor, expected };
  });
  expect(tone.border).toBe(tone.expected);

  // Une carte de règle ouvre l'inspecteur Règle (2c) ; le badge ramène l'inspecteur « sans
  // sélection » (2d), contrôle focalisé.
  const inspector = page.getByRole("complementary", { name: "Inspecteur" });
  const firstCard = inspector.locator('.rule-card[data-severity="bloquant"]').first();
  const ruleId = (await firstCard.getAttribute("data-rule"))!;
  await firstCard.locator("button.result").click();
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(inspector.locator(".rule-insp__ref")).toHaveText(ruleId);
  await expect(inspector.locator(".rule-insp__status")).toContainText("Bloquant");
  await badge.click();
  await expect(inspector).toHaveAttribute("data-template", "project");
  await expect(inspector.locator(".inspector-control__title")).toBeFocused();
  await expect(inspector.locator(".inspector-control__title")).toHaveText("Contrôle de conception");
  // Compteurs (4 cellules) et mention indicative.
  await expect(inspector.locator(".control-counts__cell")).toHaveCount(4);
  await expect(inspector.locator('.control-counts [data-severity="bloquant"] dd')).not.toHaveText(
    "0",
  );
  await expect(inspector).toContainText(
    "Contrôle de conception indicatif : il ne vaut pas attestation de conformité.",
  );

  // Retour à la normale : badge d'une autre couleur.
  await page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true }).click();
  await settle(page);
  await expect(badge).not.toHaveAttribute("data-severity", "bloquant");
});

test("Conception → Fabrication → Conception : historique, vue, sélection et unité conservés", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openSection(page, "Site");
  const h = page.getByLabel("Hauteur à monter H");
  await commitField(page, h, "2800");
  await openTab(page, "Élévation");
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  await expect(undo).toBeEnabled();
  // Sélection d'un résultat de contrôle (liste des règles respectées : inspecteur Règle) et
  // unité en cm.
  const control = page.locator(".inspector-control");
  await control.locator('.control-folds__link[data-fold="ok"]').click();
  const item = control.locator(".sev--ok li").first();
  const ruleId = (await item.getAttribute("data-rule"))!;
  await item.locator("button.result").click();
  const inspector = page.getByRole("complementary", { name: "Inspecteur" });
  const selectedRule = inspector.locator(".rule-insp__ref");
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(selectedRule).toHaveText(ruleId);
  await openMoreMenu(page);
  await page.getByLabel("Affichage", { exact: true }).selectOption("cm");
  await page.getByRole("button", { name: "Plus d'options" }).click();

  // Parcours : Guidé visible mais désactivé (vague 5), Libre choisi.
  const journey = page.getByRole("radiogroup", { name: "Parcours" });
  await expect(journey.getByRole("radio", { name: "Guidé" })).toBeDisabled();
  await expect(journey.getByRole("radio", { name: "Libre" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Fabrication : ni rail, ni panneau, ni inspecteur ; colonne de Fabrication à droite ; vues
  // de fabrication (Pièces par défaut).
  await openWorkspace(page, "Fabrication");
  await expect(page.locator(".app")).toHaveAttribute("data-workspace", "fabrication");
  await expect(page.locator("nav.rail")).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator("aside.inspector")).toHaveCount(0);
  await expect(page.locator("aside.fab-aside")).toBeVisible();
  await expect(viewTab(page, "Pièces")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tablist", { name: "Vues" }).getByRole("tab")).toHaveText([
    "Pièces",
    "Nomenclature",
    "Comparer",
    "À valider",
  ]);
  await expect(page.getByRole("button", { name: "Recadrer" })).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await openTab(page, "Nomenclature");
  await expect(page.locator("#view-panel")).toContainText(/[Mm]arche/);

  // Retour en Conception : vue quittée (Élévation), panneau « Site » rouvert, historique intact.
  await openWorkspace(page, "Conception");
  await expect(viewTab(page, "Élévation")).toHaveAttribute("aria-selected", "true");
  await expect(panel(page)).toBeVisible();
  // Sélection et unité inchangées par les bascules (retour en mm pour la suite).
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expect(selectedRule).toHaveText(ruleId);
  await openMoreMenu(page);
  await expect(page.getByLabel("Affichage", { exact: true })).toHaveValue("cm");
  await page.getByLabel("Affichage", { exact: true }).selectOption("mm");
  await page.getByRole("button", { name: "Plus d'options" }).click();
  await expect(h).toHaveValue("2800");
  await undo.click();
  await settle(page);
  await expect(h).toHaveValue("2700");

  // Fabrication de nouveau : dernière vue de fabrication (Nomenclature) rendue.
  await openWorkspace(page, "Fabrication");
  await expect(viewTab(page, "Nomenclature")).toHaveAttribute("aria-selected", "true");
});

test("menu ⋯ : unité d'affichage et thème ; contraste du bouton Exporter", async ({ page }) => {
  await openApp(page);
  const rise = page.locator('.figure-line__item[data-figure="h"] dd');
  const mm = (await rise.textContent()) ?? "";
  await openMoreMenu(page);
  await page.getByLabel("Affichage", { exact: true }).selectOption("cm");
  await expect(rise).not.toHaveText(mm);
  await page.getByLabel("Affichage", { exact: true }).selectOption("mm");
  await expect(rise).toHaveText(mm);

  // Bouton primaire (fond plein d'accent) : texte lisible, clair et sombre (ADR-0009 point 11).
  const exporter = page.getByRole("button", { name: /^Exporter/ });
  for (const theme of ["light", "dark"] as const) {
    await openMoreMenu(page);
    await page.getByLabel("Thème", { exact: true }).selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const c = await colors(exporter);
    expect(
      contrast(c.color, c.background),
      `${theme} : ${JSON.stringify(c)}`,
    ).toBeGreaterThanOrEqual(4.5);
    // Option active d'un segmenté (onglet de vue choisi) : même exigence.
    const active = await colors(viewTab(page, "Plan"));
    expect(
      contrast(active.color, active.background),
      `${theme}, onglet : ${JSON.stringify(active)}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
});

test("petites largeurs : pas de défilement horizontal du document, contenu atteignable", async ({
  page,
}) => {
  await openApp(page);
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await settle(page);
    expect(await overflowX(page), `${width} px`).toBe(0);
    await openSection(page, "Tracé");
    await expect(page.getByLabel("Emmarchement E")).toBeVisible();
    expect(await overflowX(page), `${width} px, panneau ouvert`).toBe(0);
    await page.getByRole("complementary", { name: "Inspecteur" }).scrollIntoViewIfNeeded();
    await expect(page.locator(".inspector-control__title")).toBeVisible();
    await openTab(page, "Nomenclature");
    expect(await overflowX(page), `${width} px, Fabrication`).toBe(0);
    await openWorkspace(page, "Conception");
  }
});

test("Échap pendant un tracé sur le plan : le tracé est abandonné, le panneau épinglé reste", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  await openSection(page, "Site");
  await panel(page).getByRole("button", { name: "Épingler le panneau" }).click();
  await openTab(page, "Plan");
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  await page.getByRole("button", { name: "Tracer un mur" }).click();
  // Premier point du mur : un tracé est en cours.
  const svg = page.locator("svg.plan-site__svg");
  await svg.click();
  const cancel = page.getByRole("button", { name: "Abandonner le tracé" });
  await expect(cancel).toBeVisible();
  await expect(svg).toBeFocused();
  // Échap consommé par le plan : tracé abandonné, panneau ouvert, focus resté sur le plan.
  await page.keyboard.press("Escape");
  await expect(cancel).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(svg).toBeFocused();
  // Second Échap, sans tracé : il ferme le panneau (même épinglé).
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("panneau : aucun champ ne déborde de la colonne, pour chaque section et chaque structure", async ({
  page,
}) => {
  await openApp(page);
  await applyPreset(page, "Quart tournant à gauche");
  /** Descendants du panneau qui dépassent son bord droit (px). */
  const overflowing = (): Promise<string[]> =>
    panel(page).evaluate((root) => {
      const right = root.getBoundingClientRect().right;
      return [...root.querySelectorAll("*")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > right + 1;
        })
        .map(
          (el) =>
            `${el.tagName}.${String(el.className)} → ${Math.round(el.getBoundingClientRect().right)}`,
        );
    });
  // Réglages repliés dépliés : tout le contenu du panneau est mesuré.
  const unfold = (): Promise<void> =>
    panel(page).evaluate((root) => {
      for (const d of root.querySelectorAll("details")) d.open = true;
    });
  for (const name of SECTIONS) {
    await openSection(page, name);
    await unfold();
    expect(await overflowing(), name).toEqual([]);
  }
  for (const kind of STRUCTURES) {
    await openSection(page, "Structure");
    await structureSelect(page).selectOption(kind);
    await settle(page);
    await unfold();
    expect(await overflowing(), `Structure ${kind}`).toEqual([]);
  }
});

test("zoom − / + / Recadrer des SVG du plan coté et du plan Site et saisie", async ({ page }) => {
  await openApp(page);
  // Projet de départ (escalier droit) : historique vide, que le zoom ne doit pas remplir.
  await openTab(page, "Plan");
  const zoom = page.getByRole("group", { name: "Zoom de la vue" });
  const zoomIn = zoom.getByRole("button", { name: "Zoom avant", exact: true });
  const zoomOut = zoom.getByRole("button", { name: "Zoom arrière", exact: true });
  const fit = zoom.getByRole("button", { name: "Recadrer", exact: true });
  const zoomable = page.locator("#view-panel .zoomable");
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  await expect(zoomable).toHaveAttribute("data-zoom", "1");
  await zoomIn.click();
  await expect(zoomable).toHaveAttribute("data-zoom", "1.25");
  await zoomIn.click();
  await zoomOut.click();
  await expect(zoomable).toHaveAttribute("data-zoom", "1.25");
  // Zoom d'affichage seulement : rien dans l'historique.
  await expect(undo).toBeDisabled();

  // Clic sur une marche après le zoom : elle est sélectionnée (surlignage de l'export).
  const target = await page
    .locator("#view-panel .svg-export path[data-tread]")
    .evaluateAll((polys) => {
      for (const p of polys) {
        const r = p.getBoundingClientRect();
        const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
        const hit = document.elementFromPoint(x, y);
        if (
          hit !== null &&
          hit.closest("[data-tread]")?.getAttribute("data-tread") === p.getAttribute("data-tread")
        ) {
          return { x, y, tread: p.getAttribute("data-tread") };
        }
      }
      return null;
    });
  expect(target).not.toBeNull();
  await page.mouse.click(target!.x, target!.y);
  const highlight = page.locator("#view-panel .zoomable style");
  await expect(highlight).toHaveCount(1);
  expect(await highlight.textContent()).toContain(`data-tread="${target!.tread}"`);
  await fit.click();
  await expect(zoomable).toHaveAttribute("data-zoom", "1");
  expect(await highlight.textContent()).toContain(`data-tread="${target!.tread}"`);

  // Plan « Site et saisie » : la commande change le cadrage (viewBox), Recadrer le rétablit.
  await page.getByRole("button", { name: "Site et saisie", exact: true }).click();
  const svg = page.locator("svg.plan-site__svg");
  const initial = (await svg.getAttribute("viewBox"))!;
  await zoomIn.click();
  await expect(svg).not.toHaveAttribute("viewBox", initial);
  await fit.click();
  await expect(svg).toHaveAttribute("viewBox", initial);
  await expect(undo).toBeDisabled();
});

test("menu du projet : renommer, démo appliquée et menu refermé, Nouveau annulable", async ({
  page,
}) => {
  await openApp(page);
  const name = page.locator(".topbar__project-name");
  const undo = page.getByRole("button", { name: "Annuler (Ctrl+Z)", exact: true });
  // Renommage : pris en compte par le bouton du projet et par l'inspecteur.
  let menu = await openProjectMenu(page);
  const field = menu.getByLabel("Projet", { exact: true });
  await field.fill("Escalier de la grange");
  await field.press("Enter");
  await expect(name).toHaveText("Escalier de la grange");
  await expect(page.locator(".project-inspector__name")).toHaveText("Escalier de la grange");
  await closeProjectMenu(page);

  // Démo : appliquée, menu refermé, étiquette « Démo ».
  menu = await openProjectMenu(page);
  await menu.getByRole("button", { name: "Quart tournant débillardé soudé" }).click();
  await expect(menu).toBeHidden();
  await settle(page);
  await expect(name).toHaveText(/débillardé/);
  await expect(page.locator(".topbar__demo")).toHaveText("Démo");

  // Nouveau : projet de départ, annulable (la démo revient).
  menu = await openProjectMenu(page);
  await menu.getByRole("button", { name: "Nouveau", exact: true }).click();
  await settle(page);
  await expect(name).not.toHaveText(/débillardé/);
  await closeProjectMenu(page);
  await undo.click();
  await settle(page);
  await expect(name).toHaveText(/débillardé/);
});
