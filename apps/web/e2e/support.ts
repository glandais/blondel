/**
 * Outils communs des tests de bout en bout : instrumentation des tâches longues (API Long Tasks
 * et Long Animation Frames de Chromium, avec l'attribution des scripts), attente de la fin des
 * calculs (worker de calcul, comparateur), gestes de l'interface (préréglage, structure,
 * onglets, champs) et compteur d'interactions de l'utilisateur.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** Budget par défaut d'une tâche du fil principal (critère de la mission e2e). */
export const DEFAULT_LONG_TASK_BUDGET_MS = 200;

/**
 * Budget lu dans l'environnement : absent ou vide → `DEFAULT_LONG_TASK_BUDGET_MS` ; sinon un
 * nombre fini strictement positif, faute de quoi la configuration est rejetée (un `NaN` ferait
 * passer toutes les mesures : aucune durée n'est « > NaN »).
 */
export function parseLongTaskBudget(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_LONG_TASK_BUDGET_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`E2E_LONG_TASK_BUDGET_MS invalide : « ${raw} » (nombre de ms > 0 attendu).`);
  }
  return value;
}

/**
 * Budget d'une tâche du fil principal pendant les parcours (critère de la mission e2e : 200 ms),
 * ajustable par `E2E_LONG_TASK_BUDGET_MS` (poste de mesure très chargé, par exemple).
 */
export const LONG_TASK_BUDGET_MS = parseLongTaskBudget(process.env["E2E_LONG_TASK_BUDGET_MS"]);

/** Vues de l'espace Conception (onglets de la vue centrale). */
export const DESIGN_TABS = ["Plan", "3D", "Élévation"] as const;
/** Vues de l'espace Fabrication (provisoires jusqu'à la vague 4). */
export const FABRICATION_TABS = ["Développés", "Nomenclature", "Comparateur"] as const;
/** Toutes les vues, Conception puis Fabrication. */
export const TABS = [...DESIGN_TABS, ...FABRICATION_TABS] as const;
export type TabName = (typeof TABS)[number];

/** Sections du rail du parcours libre, dans l'ordre (noms accessibles des onglets). */
export const SECTIONS = [
  "Site",
  "Tracé",
  "Découpage",
  "Balancement",
  "Marches",
  "Structure",
  "Garde-corps",
  "Contexte",
] as const;
export type SectionName = (typeof SECTIONS)[number];

export const PRESETS = [
  "Escalier droit",
  "Quart tournant à gauche",
  "Quart tournant à droite",
  "Deux quarts tournants (U)",
  "Deux quarts tournants opposés (S)",
  "Demi-tournant balancé",
  "Quart tournant avec palier",
  "Hélicoïdal à fût central",
] as const;

/**
 * Structures du cœur (valeurs de la liste « Structure »), « none » compris. Sur un tracé qu'elle
 * ne sait pas construire (volées / hélicoïdal), une structure rend une erreur de génération :
 * le parcours la mesure quand même (modèle partiel, barre d'erreurs).
 */
export const STRUCTURES = [
  "none",
  "wood-housed",
  "wood-cut",
  "steel-flat",
  "steel-profile",
  "steel-curved",
  "helical-core",
];

export interface LongTask {
  readonly kind: "longtask" | "long-animation-frame";
  readonly start: number;
  readonly duration: number;
  /** Scripts responsables (Long Animation Frames : invocateur, fonction, fichier, durée). */
  readonly scripts: readonly string[];
}

declare global {
  interface Window {
    __blondelLongTasks?: LongTask[];
  }
}

/**
 * Enregistre, dès le chargement de la page, les tâches longues (> 50 ms) et les images longues
 * (> 50 ms) avec les scripts qui les ont occupées.
 */
export async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const out: LongTask[] = [];
    window.__blondelLongTasks = out;
    const observe = (type: LongTask["kind"]): void => {
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const scripts = (
              (e as PerformanceEntry & { scripts?: readonly Record<string, unknown>[] }).scripts ??
              []
            ).map(
              (s) =>
                `${String(s["invoker"])} ${String(s["sourceFunctionName"] ?? "")} ` +
                `${String(s["sourceURL"] ?? "")
                  .split("/")
                  .pop()} ${Math.round(Number(s["duration"]))} ms`,
            );
            out.push({ kind: type, start: e.startTime, duration: e.duration, scripts });
          }
        }).observe({ type, buffered: true });
      } catch {
        // Type d'entrée non pris en charge par ce navigateur : rien à mesurer.
      }
    };
    observe("longtask");
    observe("long-animation-frame");
  });
}

/** Tâches longues enregistrées depuis le dernier appel (puis oubliées). */
export async function takeLongTasks(page: Page): Promise<LongTask[]> {
  return page.evaluate(() => {
    const all = window.__blondelLongTasks ?? [];
    const copy = all.splice(0, all.length);
    return copy;
  });
}

/** Tâches du fil principal (API Long Tasks) de plus de `budget` ms. */
export function overBudget(tasks: readonly LongTask[], budget = LONG_TASK_BUDGET_MS): LongTask[] {
  return tasks.filter((t) => t.kind === "longtask" && t.duration > budget);
}

/**
 * Description lisible des tâches trop longues (`over`), chacune avec les scripts des images
 * longues qui la recouvrent (`all` : toutes les entrées de la même étape).
 */
export function describeTasks(over: readonly LongTask[], all: readonly LongTask[] = over): string {
  return over
    .map((t) => {
      const scripts = all
        .filter(
          (f) =>
            f.kind === "long-animation-frame" &&
            f.start < t.start + t.duration &&
            t.start < f.start + f.duration,
        )
        .flatMap((f) => f.scripts);
      return `${t.kind} ${Math.round(t.duration)} ms${scripts.length ? ` [${scripts.join("; ")}]` : ""}`;
    })
    .join("\n");
}

/**
 * Attend la fin des calculs : plus de « Calcul… » dans la ligne de chiffres, comparaison
 * terminée si l'onglet Comparateur est affiché, puis deux images et un moment de repos du fil
 * principal (les observateurs de performance sont notifiés de façon asynchrone).
 */
export async function settle(page: Page): Promise<void> {
  await expect(page.locator(".figure-line__pending")).toHaveCount(0);
  const compare = page.locator(".compare, .empty-view");
  if (await page.getByRole("tab", { name: "Comparateur", selected: true }).count()) {
    await expect(page.locator(".compare caption")).toContainText(" ms)");
    await expect(compare.first()).toBeVisible();
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const idle = (
              window as Window & {
                requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
              }
            ).requestIdleCallback;
            if (idle) idle(() => resolve(), { timeout: 1000 });
            else setTimeout(resolve, 50);
          }),
        );
      }),
  );
}

/** Compteur des interactions de l'utilisateur (clics, choix, saisies validées, fichiers). */
export class Interactions {
  readonly log: string[] = [];
  count(what: string): void {
    this.log.push(what);
  }
  get total(): number {
    return this.log.length;
  }
}

/** Clé de stockage de la langue choisie (ADR-0007, `apps/web/src/i18n/locale.ts`). */
export const LANG_KEY = "blondel.lang";

/**
 * Langue de départ des parcours : les specs vérifient les libellés français. Le contexte
 * Playwright est déjà en `fr-FR` (`playwright.config.ts`, langue détectée au premier
 * lancement) ; ce script l'impose en plus dans le stockage **s'il n'y a pas encore de choix**,
 * pour qu'un choix fait pendant le parcours (passage en anglais) survive à un rechargement.
 */
export async function startInLanguage(page: Page, lang: "fr" | "en" = "fr"): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value);
      } catch {
        // Stockage indisponible : la langue du navigateur (fr-FR) s'applique.
      }
    },
    [LANG_KEY, lang] as const,
  );
}

export async function openApp(page: Page): Promise<void> {
  await startInLanguage(page, "fr");
  await page.goto("./");
  await expect(page.getByRole("toolbar", { name: "Barre d'outils" })).toBeVisible();
  await settle(page);
}

/** Ouvre le menu du projet de la barre du haut (renommage, démos, préréglages, assistant). */
export async function openProjectMenu(page: Page, ix?: Interactions): Promise<Locator> {
  const menu = page.getByRole("dialog", { name: "Menu du projet" });
  if (!(await menu.isVisible())) {
    await page.locator(".topbar__project").click();
    ix?.count("menu du projet");
  }
  await expect(menu).toBeVisible();
  return menu;
}

/** Ferme le menu du projet (re-clic sur son bouton) s'il est ouvert. */
export async function closeProjectMenu(page: Page): Promise<void> {
  const menu = page.getByRole("dialog", { name: "Menu du projet" });
  if (await menu.isVisible()) {
    await page.locator(".topbar__project").click();
    await expect(menu).toBeHidden();
  }
}

/** Ouvre le menu ⋯ « Plus d'options » (affichage, thème, langue, profil d'atelier). */
export async function openMoreMenu(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Plus d'options" });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

/** Bascule l'espace de travail (Conception | Fabrication) si besoin. */
export async function openWorkspace(
  page: Page,
  name: "Conception" | "Fabrication",
  ix?: Interactions,
): Promise<void> {
  const radio = page
    .getByRole("radiogroup", { name: "Espace de travail" })
    .getByRole("radio", { name, exact: true });
  if ((await radio.getAttribute("aria-checked")) !== "true") {
    await radio.click();
    ix?.count(`espace ${name}`);
  }
  await expect(radio).toHaveAttribute("aria-checked", "true");
}

/** Onglet du rail d'une section. */
export function sectionTab(page: Page, name: SectionName): Locator {
  return page.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name, exact: true });
}

/**
 * Ouvre la section `name` dans le panneau unique (clic sur l'onglet du rail, sauf si elle est
 * déjà ouverte), puis attend le panneau. Bascule d'abord en Conception si besoin.
 */
export async function openSection(
  page: Page,
  name: SectionName,
  ix?: Interactions,
): Promise<Locator> {
  await openWorkspace(page, "Conception", ix);
  const tab = sectionTab(page, name);
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
    ix?.count(`section ${name}`);
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const panel = page.locator("#free-panel");
  await expect(panel).toBeVisible();
  return panel;
}

export async function applyPreset(page: Page, label: string, ix?: Interactions): Promise<void> {
  const menu = await openProjectMenu(page, ix);
  await menu.getByLabel("Préréglage").selectOption({ label });
  ix?.count(`préréglage « ${label} »`);
  await menu.getByRole("button", { name: "Appliquer", exact: true }).click();
  ix?.count("Appliquer");
  await closeProjectMenu(page);
  await settle(page);
}

/** Liste « Structure » (le panneau, nommé par l'onglet « Structure », n'est pas visé). */
export function structureSelect(page: Page): Locator {
  return page.getByRole("combobox", { name: "Structure", exact: true });
}

export async function chooseStructure(page: Page, kind: string, ix?: Interactions): Promise<void> {
  await openSection(page, "Structure", ix);
  await structureSelect(page).selectOption(kind);
  ix?.count(`structure ${kind}`);
  await settle(page);
}

/** Onglet de vue `name` (liste « Vues » de la vue centrale). */
export function viewTab(page: Page, name: TabName): Locator {
  return page.getByRole("tablist", { name: "Vues" }).getByRole("tab", { name, exact: true });
}

/** Affiche une vue : bascule d'abord l'espace qui la contient, puis choisit son onglet. */
export async function openTab(page: Page, name: TabName, ix?: Interactions): Promise<void> {
  const fabrication = (FABRICATION_TABS as readonly string[]).includes(name);
  await openWorkspace(page, fabrication ? "Fabrication" : "Conception", ix);
  const tab = viewTab(page, name);
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    await tab.click();
    ix?.count(`onglet ${name}`);
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
  if (name === "3D") await expect(page.locator(".viewer3d canvas")).toBeVisible();
  await settle(page);
}

/** Saisie d'un champ numérique validée par Entrée (une interaction). */
export async function commitField(
  page: Page,
  field: Locator,
  value: string,
  ix?: Interactions,
  label = "champ",
): Promise<void> {
  await field.fill(value);
  await field.press("Enter");
  ix?.count(`${label} = ${value}`);
  await settle(page);
}

/** Nombre de contrôles bloquants annoncés par l'inspecteur (bloc « Contrôle de conception »). */
export async function blockingCount(page: Page): Promise<number> {
  const count = page.locator('.control-counts [data-severity="bloquant"] dd');
  await expect(count).toHaveCount(1);
  return Number(await count.textContent());
}

/** Inspecteur contextuel (colonne de droite) ; `data-template` : tread, part, rule, project. */
export function inspectorPanel(page: Page): Locator {
  return page.locator("aside.inspector");
}

/**
 * Point de la page où un clic atteint réellement l'élément `[data-tread="n"]` du SVG affiché
 * (`root`) : échantillonnage de sa boîte, le premier point dont l'élément visible le plus haut
 * appartient à cette marche (une cote ou un texte peut recouvrir le centre).
 */
export async function treadClickPoint(
  page: Page,
  n: number,
  root = "#view-panel .svg-export",
): Promise<{ x: number; y: number }> {
  const point = await page.locator(`${root} [data-tread="${n}"]`).evaluateAll((els, tread) => {
    for (const el of els) {
      const r = el.getBoundingClientRect();
      for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          const hit = document.elementFromPoint(x, y);
          if (hit?.closest("[data-tread]")?.getAttribute("data-tread") === tread) return { x, y };
        }
      }
    }
    return null;
  }, String(n));
  if (!point) throw new Error(`marche ${n} introuvable dans la vue`);
  return point;
}

/**
 * Sélectionne la marche `n` d'un clic sur le plan coté (onglet Plan, mode « Plan coté ») et
 * attend l'inspecteur Marche (gabarit 2a). Sans effet si la marche est déjà inspectée (un
 * second clic la désélectionnerait).
 */
export async function selectTreadOnPlan(page: Page, n: number): Promise<Locator> {
  await openTab(page, "Plan");
  const drawing = page.getByRole("button", { name: "Plan coté", exact: true });
  if ((await drawing.getAttribute("aria-pressed")) !== "true") await drawing.click();
  await expect(page.locator("#view-panel .svg-export svg")).toBeVisible();
  const inspector = inspectorPanel(page);
  const shown = inspector.locator(`[data-tread-number="${n}"]`);
  if ((await shown.count()) === 0) {
    const { x, y } = await treadClickPoint(page, n);
    await page.mouse.click(x, y);
  }
  await expect(inspector).toHaveAttribute("data-template", "tread");
  await expect(shown).toBeVisible();
  return inspector;
}

/**
 * Règle CSS de surlignage de la marche sélectionnée dans la vue (plan coté, élévation), ou `""`
 * sans sélection. Lue par `textContent` : les assertions de texte de Playwright ignorent le
 * contenu d'un élément `<style>`. À employer avec `expect.poll`.
 */
export async function viewHighlight(page: Page): Promise<string> {
  return page
    .locator("#view-panel .zoomable style")
    .evaluateAll((els) => els.map((el) => el.textContent ?? "").join("\n"));
}
