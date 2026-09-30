/**
 * Quota `localStorage` de Chromium remesuré dans le navigateur (QUESTIONS D6, ledger l. 280) :
 * l'autosauvegarde d'un projet aux bornes du calque de fond est dimensionnée pour tenir sous
 * 5 000 000 caractères (`store/persistence.test.ts`, calcul hors navigateur) ; on vérifie ici
 * que Chromium en accepte au moins autant pour une seule clé, et l'on joint la valeur mesurée
 * au rapport (marge restante pour la copie de secours d'une autosauvegarde refusée).
 */
import { expect, test } from "@playwright/test";
import { openApp } from "./support.js";

/** Budget d'autosauvegarde retenu par `store/persistence.test.ts` (caractères, clé comprise). */
const AUTOSAVE_BUDGET_CHARS = 5_000_000;

test("quota localStorage de Chromium : au moins le budget d'autosauvegarde", async ({
  page,
}, info) => {
  await openApp(page);
  const measured = await page.evaluate(() => {
    const saved: [string, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      saved.push([k, localStorage.getItem(k)!]);
    }
    localStorage.clear();
    const key = "q";
    const fits = (n: number): boolean => {
      try {
        localStorage.setItem(key, "x".repeat(n));
        return true;
      } catch {
        return false;
      } finally {
        localStorage.removeItem(key);
      }
    };
    // Plus grande valeur acceptée pour une clé seule (dichotomie à 1 caractère près).
    let lo = 0;
    let hi = 1 << 24;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    for (const [k, v] of saved) localStorage.setItem(k, v);
    return lo + key.length;
  });
  await info.attach("quota", {
    body: `Quota localStorage mesuré : ${measured} caractères (clé comprise) ; budget d'autosauvegarde ${AUTOSAVE_BUDGET_CHARS} ; marge ${measured - AUTOSAVE_BUDGET_CHARS}.`,
    contentType: "text/plain",
  });
  expect(measured).toBeGreaterThanOrEqual(AUTOSAVE_BUDGET_CHARS);
});
