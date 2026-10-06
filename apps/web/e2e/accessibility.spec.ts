/**
 * Accessibilité clavier et lecteur d'écran : fenêtre modale de l'assistant (focus piégé et
 * rendu, arrière-plan inerte, annuler sans effet derrière la fenêtre) et champs numériques
 * (saisie refusée puis rétablie à la perte de focus : champ valide, message transitoire) ;
 * écran Fabrication (repères nommés, onglets au clavier, commandes nommées).
 *
 * Vague 6 (ADR-0009) : modèle ARIA des onglets du rail et de la barre d'étapes (activation
 * manuelle, flèches, Début / Fin, focus itinérant) et des segmentés (activation automatique) ;
 * contour de focus 2 px plein décalé de 2 px ; aucune commande sans nom et aucun glyphe ◆ dans
 * un nom accessible (guidé, libre, inspecteurs 2a, 2b, 2c) ; audit axe-core WCAG A / AA des
 * écrans 1a, 1b, Fabrication, des inspecteurs 2a, 2b, 2c, en thème sombre, du tiroir à 760 px
 * et du guidé imposé à 390 px.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  chooseStructure,
  commitField,
  inspectorPanel,
  journeyRadio,
  openApp,
  openAppFresh,
  openProjectMenu,
  openSection,
  openTab,
  openWorkspace,
  selectTreadOnPlan,
  setWidth,
  settle,
  useFreeJourney,
  useGuidedJourney,
  viewTab,
} from "./support.js";

test("assistant : focus piégé dans la fenêtre, rendu à l'ouverture, Ctrl+Z sans effet", async ({
  page,
}) => {
  await openApp(page);
  await openSection(page, "Site");
  const h = page.getByLabel("Hauteur à monter H");
  await commitField(page, h, "2800");

  // L'assistant s'ouvre depuis le menu du projet ; le focus revient au bouton du projet.
  const menu = await openProjectMenu(page);
  await menu.getByRole("button", { name: "Assistant…" }).click();
  const opener = page.locator(".topbar__project");
  const dialog = page.getByRole("dialog", { name: "Assistant d'initialisation" });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button", { name: "Fermer l'assistant" });
  await expect(close).toBeFocused();

  // Maj+Tab et Tab bouclent dans la fenêtre (jamais vers l'arrière-plan).
  const insideDialog = () =>
    page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await insideDialog()).toBe(true);
  }
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await insideDialog()).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  // Arrière-plan inerte.
  await expect(page.locator(".app > .topbar")).toHaveAttribute("inert", "");

  // Ctrl+Z pendant la fenêtre : le projet ne change pas derrière elle.
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect(dialog.getByLabel("Hauteur à monter H")).toHaveValue("2800");

  // Échap : fenêtre fermée, focus rendu au bouton d'ouverture, arrière-plan réactivé.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(h).toHaveValue("2800");
  await expect(page.locator(".app > .topbar")).not.toHaveAttribute("inert", "");
  // Hors de la fenêtre, Ctrl+Z annule de nouveau.
  await viewTab(page, "Plan").focus();
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect(h).toHaveValue("2700");
});

test("champ numérique : saisie refusée puis rétablie au blur, champ non marqué invalide", async ({
  page,
}) => {
  await openApp(page);
  await openSection(page, "Site");
  const h = page.getByLabel("Hauteur à monter H");
  await expect(h).toHaveValue("2700");
  await h.fill("abc");
  // Pendant la saisie : erreur annoncée.
  await expect(h).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.press("Tab");
  await expect(h).toHaveValue("2700");
  await expect(h).not.toHaveAttribute("aria-invalid", /.*/);
  const note = page.locator(".field__note").filter({ hasText: "valeur précédente rétablie" });
  await expect(note).toHaveCount(1);
  await expect(page.locator(".field__error")).toHaveCount(0);
  // Nouvelle saisie : le message transitoire disparaît.
  await commitField(page, h, "2750");
  await expect(note).toHaveCount(0);
});

test("écran Fabrication : repères nommés, onglets au clavier, commandes nommées", async ({
  page,
}) => {
  await openApp(page);
  // Structure acier : valeurs ◆ de plugin dans la liste « À valider ».
  await chooseStructure(page, "steel-flat");
  await openWorkspace(page, "Fabrication");
  // Repères nommés : zone de Fabrication, liste des pièces, colonne de droite.
  await expect(page.getByRole("main", { name: "Fabrication de l'escalier" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Pièces par famille" })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Réglages de la pièce et sorties" }),
  ).toBeVisible();
  // Modèle ARIA des onglets : flèches et Fin pour passer d'un onglet à l'autre, panneau associé.
  await viewTab(page, "Pièces").focus();
  await page.keyboard.press("ArrowRight");
  await expect(viewTab(page, "Nomenclature")).toBeFocused();
  await expect(viewTab(page, "Nomenclature")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-bom");
  await page.keyboard.press("End");
  await expect(viewTab(page, "À valider")).toHaveAttribute("aria-selected", "true");
  // Liste à cocher : chaque case porte le nom de sa valeur.
  expect(await page.getByRole("checkbox", { name: /^Valider : .+/ }).count()).toBeGreaterThan(0);
  await expect(page.locator('#view-panel input[type="checkbox"]:not([aria-label])')).toHaveCount(0);
  // Aucune commande visible sans nom (texte, aria-label, aria-labelledby, étiquette ou title).
  const unnamed = await unnamedControls(page);
  expect(unnamed).toEqual([]);
});

// ------------------------------------------------------------------ Aides locales (vague 6)

/** Guidé, étape `n` par son onglet de la barre d'étapes. */
function stepTab(page: Page, n: number): Locator {
  return page.locator(`#step-tab-${n}`);
}

/** Onglet du rail d'une section par son identifiant (`site`, `layout`, …, `compliance`). */
function railTab(page: Page, id: string): Locator {
  return page.locator(`#rail-tab-${id}`);
}

/** Contour de focus de l'élément actif : style, largeur, décalage. */
async function focusRing(
  page: Page,
): Promise<{ readonly style: string; readonly width: string; readonly offset: string }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) {
      return { style: "", width: "", offset: "" };
    }
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset };
  });
}

/** Contour attendu partout : 2 px plein, couleur d'accent, décalé de 2 px (ADR-0009, vague 6). */
const RING = { style: "solid", width: "2px", offset: "2px" } as const;

/**
 * Commandes visibles sans nom accessible (texte, aria-label, aria-labelledby, étiquette, title
 * ou placeholder) sous `scope` : boutons, onglets, radios, cases, champs, listes.
 */
async function unnamedControls(page: Page, scope = ".app"): Promise<string[]> {
  return page.evaluate(
    (root) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          [
            "button",
            "[role='tab']",
            "[role='radio']",
            "[role='checkbox']",
            "[role='switch']",
            "input:not([type='hidden'])",
            "select",
            "textarea",
            "a[href]",
          ]
            .map((sel) => `${root} ${sel}`)
            .join(", "),
        ),
      ]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => {
          const by = el.getAttribute("aria-labelledby");
          const labelled = by
            ? by
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" ")
            : null;
          const field =
            el instanceof HTMLInputElement ||
            el instanceof HTMLSelectElement ||
            el instanceof HTMLTextAreaElement
              ? [...(el.labels ?? [])].map((l) => l.textContent ?? "").join(" ") ||
                ("placeholder" in el ? el.placeholder : "")
              : null;
          const label = el.getAttribute("aria-label") ?? labelled ?? field ?? "";
          return `${label}${el.textContent ?? ""}${el.title}`.trim() === "";
        })
        .map((el) => el.outerHTML.slice(0, 160)),
    scope,
  );
}

/**
 * Aucun nom accessible ne contient le glyphe ◆ (il est `aria-hidden`, remplacé par « à
 * valider » ou « n valeurs à valider ») : boutons, onglets, radios, cases, champs, titres,
 * régions.
 */
async function expectNoDiamondInNames(page: Page): Promise<void> {
  for (const role of [
    "button",
    "tab",
    "radio",
    "checkbox",
    "textbox",
    "combobox",
    "heading",
    "region",
    "link",
  ] as const) {
    await expect(page.getByRole(role, { name: /◆/ }), `rôle ${role}`).toHaveCount(0);
  }
}

/**
 * Audit axe-core (WCAG 2.0 / 2.1 niveaux A et AA) de la page affichée, canevas 3D exclu (rendu
 * WebGL sans arbre d'accessibilité, nommé par son conteneur). Attendu : aucune violation.
 *
 * Si une règle doit être écartée (faux positif avéré, ou écart accepté par l'utilisateur), ne
 * jamais la retirer en silence : la désactiver ici par `.disableRules(["<id>"])` avec, en
 * commentaire, la raison, l'écran concerné et la décision (ADR ou ligne de `docs/QUESTIONS.md`),
 * et l'inscrire dans `docs/ACCEPTATION.md` (section « Refonte de l'interface »).
 */
async function expectNoAxeViolations(page: Page, screen: string): Promise<void> {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("canvas")
    .analyze();
  const violations = results.violations.map(
    (v) => `${v.id} (${v.impact ?? "?"}) : ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(violations, `écran ${screen}`).toEqual([]);
}

// ------------------------------------------------------------------ Clavier (vague 6)

test("rail des sections : flèches et Début / Fin sans ouvrir, Entrée ouvre, un seul arrêt", async ({
  page,
}) => {
  await openApp(page);
  await openWorkspace(page, "Conception");
  const rail = page.getByRole("tablist", { name: "Sections" });
  // Focus itinérant : un seul onglet du rail dans l'ordre de tabulation.
  await expect(rail.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await railTab(page, "site").focus();
  const opened = await railTab(page, "site").getAttribute("aria-selected");

  // Flèche bas : le focus passe à « Tracé » sans ouvrir son panneau (activation manuelle).
  await page.keyboard.press("ArrowDown");
  await expect(railTab(page, "layout")).toBeFocused();
  await expect(railTab(page, "layout")).toHaveAttribute("aria-selected", "false");
  await expect(railTab(page, "site")).toHaveAttribute("aria-selected", opened ?? "false");
  // Fin : dernière section (Contexte) ; Début : première (Site) ; flèche haut depuis Site : boucle.
  await page.keyboard.press("End");
  await expect(railTab(page, "compliance")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(railTab(page, "site")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(railTab(page, "layout")).toBeFocused();

  // Entrée : ouvre la section qui a le focus ; l'arrêt de tabulation la suit.
  await page.keyboard.press("Enter");
  await expect(railTab(page, "layout")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#free-panel")).toBeVisible();
  await expect(rail.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await expect(railTab(page, "layout")).toHaveAttribute("tabindex", "0");
  // Contour de focus 2 px décalé de 2 px sur un onglet du rail atteint au clavier.
  await page.keyboard.press("ArrowUp");
  await expect(railTab(page, "site")).toBeFocused();
  expect(await focusRing(page)).toEqual(RING);
});

test("barre d'étapes : flèches, Début / Fin sans activer, Entrée change d'étape", async ({
  page,
}) => {
  await openAppFresh(page);
  await useGuidedJourney(page);
  const bar = page.getByRole("tablist", { name: "Étapes du parcours" });
  await stepTab(page, 1).click();
  await expect(stepTab(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(bar.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await stepTab(page, 1).focus();

  // Flèche droite : focus sur l'étape 2, l'étape 1 reste choisie (activation manuelle).
  await page.keyboard.press("ArrowRight");
  await expect(stepTab(page, 2)).toBeFocused();
  await expect(stepTab(page, 1)).toHaveAttribute("aria-selected", "true");
  await expect(stepTab(page, 2)).toHaveAttribute("aria-selected", "false");
  expect(await focusRing(page)).toEqual(RING);
  // Fin : étape 7 ; Début : étape 1.
  await page.keyboard.press("End");
  await expect(stepTab(page, 7)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(stepTab(page, 1)).toBeFocused();
  // Deux flèches puis Entrée : étape 3 choisie, seul arrêt de tabulation.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(stepTab(page, 3)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(stepTab(page, 3)).toHaveAttribute("aria-selected", "true");
  await expect(bar.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await expect(stepTab(page, 3)).toHaveAttribute("tabindex", "0");
});

test("segmentés : activation automatique aux flèches (espace de travail, vues)", async ({
  page,
}) => {
  await openApp(page);
  await openWorkspace(page, "Conception");
  // Conception | Fabrication : la flèche choisit l'option suivante et lui donne le focus.
  const workspace = page.getByRole("radiogroup", { name: "Espace de travail" });
  const design = workspace.getByRole("radio", { name: "Conception", exact: true });
  const fabrication = workspace.getByRole("radio", { name: "Fabrication", exact: true });
  await expect(workspace.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);
  await design.focus();
  await page.keyboard.press("ArrowRight");
  await expect(fabrication).toBeFocused();
  await expect(fabrication).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".app")).toHaveAttribute("data-workspace", "fabrication");
  expect(await focusRing(page)).toEqual(RING);
  await page.keyboard.press("ArrowLeft");
  await expect(design).toBeFocused();
  await expect(design).toHaveAttribute("aria-checked", "true");

  // Onglets de vue (`#tab-plan`, `#tab-3d`, `#tab-elevation`) : flèche, Fin, Début.
  await page.locator("#tab-plan").click();
  await expect(page.locator("#tab-plan")).toHaveAttribute("aria-selected", "true");
  await page.locator("#tab-plan").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-3d")).toBeFocused();
  await expect(page.locator("#tab-3d")).toHaveAttribute("aria-selected", "true");
  expect(await focusRing(page)).toEqual(RING);
  await page.keyboard.press("End");
  await expect(page.locator("#tab-elevation")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(page.locator("#tab-plan")).toBeFocused();
  await expect(page.locator("#tab-plan")).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tablist", { name: "Vues" }).locator('[role="tab"][tabindex="0"]'),
  ).toHaveCount(1);
});

test("contour de focus : 2 px plein décalé de 2 px sur la barre du haut au clavier", async ({
  page,
}) => {
  await openApp(page);
  // Tab depuis le début du document jusqu'au premier bouton de la barre du haut.
  await page.locator("body").focus();
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(
      () => document.activeElement?.closest(".topbar") !== null && document.activeElement !== null,
    );
  }
  expect(reached).toBe(true);
  expect(await focusRing(page)).toEqual(RING);
  // Option d'un segmenté de la barre du haut (Guidé | Libre), atteinte au clavier.
  await journeyRadio(page, "Libre").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(journeyRadio(page, "Libre")).toBeFocused();
  expect(await focusRing(page)).toEqual(RING);
});

// ------------------------------------------------------------------ Noms accessibles (vague 6)

test("noms accessibles : aucune commande sans nom, aucun ◆ dans un nom (guidé, libre, inspecteurs)", async ({
  page,
}) => {
  // Guidé, étapes 1 et 3.
  await openAppFresh(page);
  await useGuidedJourney(page);
  await stepTab(page, 1).click();
  expect(await unnamedControls(page)).toEqual([]);
  await stepTab(page, 3).click();
  await settle(page);
  expect(await unnamedControls(page)).toEqual([]);
  await expectNoDiamondInNames(page);

  // Libre, panneau ouvert (Structure acier : valeurs ◆ de plugin), inspecteur sans sélection.
  await useFreeJourney(page);
  await chooseStructure(page, "steel-flat");
  await expect(inspectorPanel(page)).toHaveAttribute("data-template", "project");
  expect(await unnamedControls(page)).toEqual([]);
  await expectNoDiamondInNames(page);

  // Inspecteur Marche (2a).
  await page.keyboard.press("Escape");
  await selectTreadOnPlan(page, 2);
  expect(await unnamedControls(page, "aside.inspector")).toEqual([]);
  await expectNoDiamondInNames(page);

  // Inspecteur Pièce (2b) : un limon choisi dans la liste de Fabrication.
  await openTab(page, "Pièces");
  const list = page.getByRole("navigation", { name: "Pièces par famille" });
  const group = list.getByRole("button", { name: /^Limons\b/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await list.getByRole("list", { name: "Repères : Limons" }).getByRole("button").first().click();
  expect(await unnamedControls(page)).toEqual([]);
  await expectNoDiamondInNames(page);
  await openWorkspace(page, "Conception");
  await expect(inspectorPanel(page)).toHaveAttribute("data-template", "part");
  expect(await unnamedControls(page, "aside.inspector")).toEqual([]);
  await expectNoDiamondInNames(page);

  // Inspecteur Règle (2c) : une règle respectée ouverte depuis l'inspecteur sans sélection.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const inspector = inspectorPanel(page);
  await expect(inspector).toHaveAttribute("data-template", "project");
  const passed = inspector.locator('button[data-fold="ok"]');
  if ((await passed.getAttribute("aria-expanded")) !== "true") await passed.click();
  await inspector.locator(".results button.result").first().click();
  await expect(inspector).toHaveAttribute("data-template", "rule");
  expect(await unnamedControls(page, "aside.inspector")).toEqual([]);
  await expectNoDiamondInNames(page);
});

// ------------------------------------------------------------------ Audit axe (vague 6)

test("audit axe (WCAG A / AA) : guidé étape 3, libre avec panneau, Fabrication", async ({
  page,
}) => {
  // 1a : parcours guidé, étape Découpage.
  await openAppFresh(page);
  await useGuidedJourney(page);
  await stepTab(page, 3).click();
  await expect(stepTab(page, 3)).toHaveAttribute("aria-selected", "true");
  await expectNoAxeViolations(page, "1a (guidé, étape 3)");

  // 1b : parcours libre, panneau Découpage ouvert, inspecteur sans sélection (2d).
  await useFreeJourney(page);
  await openSection(page, "Découpage");
  await expect(inspectorPanel(page)).toHaveAttribute("data-template", "project");
  await expectNoAxeViolations(page, "1b (libre, panneau ouvert, 2d)");

  // Fabrication : liste des pièces, colonne de droite et sorties.
  await chooseStructure(page, "steel-flat");
  await openTab(page, "Pièces");
  await expectNoAxeViolations(page, "Fabrication (Pièces)");
  await openTab(page, "À valider");
  await expectNoAxeViolations(page, "Fabrication (À valider)");
});

test("audit axe (WCAG A / AA) : inspecteurs Marche, Pièce, Règle ; thème sombre ; tiroir à 760 px ; guidé imposé à 390 px", async ({
  page,
}) => {
  await openApp(page);
  await chooseStructure(page, "steel-flat");
  const inspector = inspectorPanel(page);

  // 2a : inspecteur Marche.
  await selectTreadOnPlan(page, 2);
  await expectNoAxeViolations(page, "2a (inspecteur Marche)");

  // 2b : inspecteur Pièce, un limon choisi dans la liste de Fabrication.
  await openTab(page, "Pièces");
  const list = page.getByRole("navigation", { name: "Pièces par famille" });
  const group = list.getByRole("button", { name: /^Limons\b/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await list.getByRole("list", { name: "Repères : Limons" }).getByRole("button").first().click();
  await openWorkspace(page, "Conception");
  await expect(inspector).toHaveAttribute("data-template", "part");
  await expectNoAxeViolations(page, "2b (inspecteur Pièce)");

  // 2c : inspecteur Règle, une règle respectée ouverte depuis l'inspecteur sans sélection.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveAttribute("data-template", "project");
  const passed = inspector.locator('button[data-fold="ok"]');
  if ((await passed.getAttribute("aria-expanded")) !== "true") await passed.click();
  await inspector.locator(".results button.result").first().click();
  await expect(inspector).toHaveAttribute("data-template", "rule");
  await expectNoAxeViolations(page, "2c (inspecteur Règle)");

  // Thème sombre (thème du système) : 2c, puis 2d avec le panneau Découpage ouvert.
  await page.emulateMedia({ colorScheme: "dark" });
  await expectNoAxeViolations(page, "2c sombre");
  await page.keyboard.press("Escape");
  await openSection(page, "Découpage");
  await expect(inspector).toHaveAttribute("data-template", "project");
  await expectNoAxeViolations(page, "1b sombre (panneau ouvert, 2d)");
  await page.emulateMedia({ colorScheme: "light" });

  // 760 px : tiroir de l'inspecteur ouvert par la sélection d'une marche.
  await setWidth(page, 760, 900);
  await selectTreadOnPlan(page, 3);
  await expect(page.locator(".app")).toHaveAttribute("data-inspector", "open");
  await expectNoAxeViolations(page, "tiroir à 760 px (2a)");

  // 390 px : parcours guidé imposé.
  await setWidth(page, 390, 844);
  await expect(page.locator(".app")).toHaveAttribute("data-journey", "guided");
  await expectNoAxeViolations(page, "guidé imposé à 390 px");
});
