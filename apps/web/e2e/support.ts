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

export const TABS = [
  "Plan 2D",
  "3D",
  "Élévation",
  "Développés",
  "Nomenclature",
  "Comparateur",
] as const;
export type TabName = (typeof TABS)[number];

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
 * Attend la fin des calculs : plus de « Calcul… » dans la barre d'état, comparaison terminée
 * si l'onglet Comparateur est affiché, puis deux images et un moment de repos du fil
 * principal (les observateurs de performance sont notifiés de façon asynchrone).
 */
export async function settle(page: Page): Promise<void> {
  await expect(page.locator(".statusbar__pending")).toHaveCount(0);
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

export async function applyPreset(page: Page, label: string, ix?: Interactions): Promise<void> {
  await page.getByLabel("Préréglage").selectOption({ label });
  ix?.count(`préréglage « ${label} »`);
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  ix?.count("Appliquer");
  await settle(page);
}

export function structureSelect(page: Page): Locator {
  return page.getByLabel("Structure", { exact: true });
}

export async function chooseStructure(page: Page, kind: string, ix?: Interactions): Promise<void> {
  await structureSelect(page).selectOption(kind);
  ix?.count(`structure ${kind}`);
  await settle(page);
}

export async function openTab(page: Page, name: TabName, ix?: Interactions): Promise<void> {
  await page.getByRole("tab", { name, exact: true }).click();
  ix?.count(`onglet ${name}`);
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
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

/** Nombre de contrôles bloquants annoncés par le panneau « Contrôle de conception ». */
export async function blockingCount(page: Page): Promise<number> {
  const count = page.locator(".compliance .sev--bloquant > summary .count");
  await expect(count).toHaveCount(1);
  return Number(await count.textContent());
}
