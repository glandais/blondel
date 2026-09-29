/**
 * Outils des tests de bout en bout (sans navigateur) : lecture du budget de tâches longues et
 * sélection des dépassements.
 */
import { expect, test } from "@playwright/test";
import {
  DEFAULT_LONG_TASK_BUDGET_MS,
  describeTasks,
  overBudget,
  parseLongTaskBudget,
  type LongTask,
} from "./support.js";

test("budget : défaut, valeur explicite, valeurs invalides rejetées", () => {
  expect(parseLongTaskBudget(undefined)).toBe(DEFAULT_LONG_TASK_BUDGET_MS);
  expect(parseLongTaskBudget("")).toBe(DEFAULT_LONG_TASK_BUDGET_MS);
  expect(parseLongTaskBudget("350")).toBe(350);
  for (const bad of ["abc", "0", "-5", "Infinity", "200ms"]) {
    expect(() => parseLongTaskBudget(bad), bad).toThrow("E2E_LONG_TASK_BUDGET_MS invalide");
  }
});

test("dépassements : tâches longues seules, scripts des images longues qui les recouvrent", () => {
  const tasks: LongTask[] = [
    { kind: "longtask", start: 0, duration: 250, scripts: [] },
    { kind: "longtask", start: 1000, duration: 200, scripts: [] },
    { kind: "long-animation-frame", start: 10, duration: 400, scripts: ["a.js 240 ms"] },
    { kind: "long-animation-frame", start: 2000, duration: 400, scripts: ["b.js 300 ms"] },
  ];
  const over = overBudget(tasks, 200);
  expect(over.map((t) => t.start)).toEqual([0]);
  expect(describeTasks(over, tasks)).toBe("longtask 250 ms [a.js 240 ms]");
});
