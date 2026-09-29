/**
 * Budget des tâches longues (d) : aucune tâche du fil principal de plus de 200 ms pendant les
 * parcours usuels — chargement, chaque préréglage, chaque structure, chaque onglet, saisie de H,
 * export PDF. Chaque étape est mesurée séparément (API Long Tasks) et l'échec cite les scripts
 * responsables (Long Animation Frames).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  LONG_TASK_BUDGET_MS,
  PRESETS,
  STRUCTURES,
  TABS,
  applyPreset,
  chooseStructure,
  commitField,
  describeTasks,
  instrument,
  openApp,
  openTab,
  overBudget,
  settle,
  takeLongTasks,
} from "./support.js";

interface Step {
  readonly label: string;
  readonly wallMs: number;
  readonly worst: number;
  readonly over: string;
}

async function measure(page: Page, steps: Step[], label: string, act: () => Promise<void>) {
  // Tâches survenues depuis la fin de l'étape précédente (rendu tardif après `settle`) : elles
  // comptent, rattachées à cette étape précédente, au lieu d'être oubliées.
  const late = await takeLongTasks(page);
  const lateOver = overBudget(late);
  if (lateOver.length > 0) {
    steps.push({
      label: `après « ${steps.at(-1)?.label ?? "début"} »`,
      wallMs: 0,
      worst: Math.max(...lateOver.map((t) => t.duration)),
      over: describeTasks(lateOver, late),
    });
  }
  const t0 = Date.now();
  await act();
  const wallMs = Date.now() - t0;
  const tasks = await takeLongTasks(page);
  const worst = Math.max(0, ...tasks.filter((t) => t.kind === "longtask").map((t) => t.duration));
  steps.push({ label, wallMs, worst, over: describeTasks(overBudget(tasks), tasks) });
}

function report(steps: readonly Step[]): string {
  return steps
    .map(
      (s) =>
        `${s.label.padEnd(60)} ${String(s.wallMs).padStart(6)} ms, pire tâche ${Math.round(s.worst)} ms`,
    )
    .join("\n");
}

function assertBudget(steps: readonly Step[]): void {
  const bad = steps.filter((s) => s.over !== "");
  expect(bad.map((s) => `${s.label}\n${s.over}`).join("\n\n"), report(steps)).toBe("");
}

// Mesures de temps : une reprise absorbe un pic de charge ponctuel de la machine (CI partagée) ;
// un dépassement systématique échoue toujours.
test.describe.configure({ retries: 1 });

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test(`chargement et onglets : aucune tâche > ${LONG_TASK_BUDGET_MS} ms`, async ({ page }, info) => {
  const steps: Step[] = [];
  await measure(page, steps, "chargement", () => openApp(page));
  await measure(page, steps, "préréglage Quart tournant à gauche", () =>
    applyPreset(page, "Quart tournant à gauche"),
  );
  await measure(page, steps, "structure wood-housed", () => chooseStructure(page, "wood-housed"));
  // Deux passages : premier montage de chaque vue, puis retour (constat : gel au premier
  // clic sur « Comparateur », puis Plan 2D → Comparateur → 3D).
  for (const round of [1, 2]) {
    for (const tab of TABS) {
      await measure(page, steps, `onglet ${tab} (${round})`, () => openTab(page, tab));
    }
  }
  await measure(page, steps, "onglet Comparateur → 3D", async () => {
    await openTab(page, "Comparateur");
    await openTab(page, "3D");
  });
  // Hélicoïdal (fût, main courante hélicoïdale, auto-recouvrement) : chaque onglet.
  await measure(page, steps, "préréglage Hélicoïdal à fût central (3D)", () =>
    applyPreset(page, "Hélicoïdal à fût central"),
  );
  for (const tab of TABS) {
    await measure(page, steps, `hélicoïdal : onglet ${tab}`, () => openTab(page, tab));
  }
  await info.attach("étapes", { body: report(steps), contentType: "text/plain" });
  assertBudget(steps);
});

test(`préréglages et structures : aucune tâche > ${LONG_TASK_BUDGET_MS} ms`, async ({
  page,
}, info) => {
  // 7 préréglages × 7 structures, Plan 2D puis 3D.
  test.setTimeout(600_000);
  const steps: Step[] = [];
  await measure(page, steps, "chargement", () => openApp(page));
  // Vue 3D ouverte : les changements de modèle remplacent aussi les géométries three.js.
  for (const tab of ["Plan 2D", "3D"] as const) {
    await measure(page, steps, `onglet ${tab}`, () => openTab(page, tab));
    for (const preset of PRESETS) {
      await measure(page, steps, `[${tab}] préréglage ${preset}`, () => applyPreset(page, preset));
      for (const kind of STRUCTURES) {
        await measure(page, steps, `[${tab}] ${preset} / ${kind}`, () =>
          chooseStructure(page, kind),
        );
      }
    }
  }
  await info.attach("étapes", { body: report(steps), contentType: "text/plain" });
  assertBudget(steps);
});

test(`saisie de H et export PDF : aucune tâche > ${LONG_TASK_BUDGET_MS} ms`, async ({
  page,
}, info) => {
  const steps: Step[] = [];
  await measure(page, steps, "chargement", () => openApp(page));
  await applyPreset(page, "Quart tournant à gauche");
  await chooseStructure(page, "wood-housed");
  const h = page.getByLabel("Hauteur à monter H");
  for (const value of ["2750", "2800"]) {
    await measure(page, steps, `H = ${value}`, () => commitField(page, h, value));
  }
  await measure(page, steps, "export PDF", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Exporter/ }).click();
    await page
      .getByRole("menuitem", { name: /^Dossier PDF complet \(gabarits 1:1 en A4\)/ })
      .click();
    await download;
    await settle(page);
  });
  await info.attach("étapes", { body: report(steps), contentType: "text/plain" });
  assertBudget(steps);
});
