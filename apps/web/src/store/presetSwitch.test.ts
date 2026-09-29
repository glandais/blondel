/**
 * Bogue « Quart tournant à gauche » (rendu figé ~30 s) : appliquer un préréglage ne doit
 * produire qu'**un** changement de projet, **un** calcul du modèle (quel que soit le nombre de
 * composants qui le lisent) et **une** écriture d'autosauvegarde — aucune boucle entre le store,
 * le calcul et le stockage.
 */
import { ALL_PRESET_IDS, buildModel, type Project } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { createModelCache } from "../model/buildModel.js";
import { memoryStorage } from "./persistence.js";
import { createProjectStore } from "./projectStore.js";

describe("application d'un préréglage", () => {
  it.each(ALL_PRESET_IDS.filter((id) => id !== "straight"))(
    "droit → %s : un seul recalcul",
    (id) => {
      const storage = memoryStorage();
      let writes = 0;
      const counting = {
        ...storage,
        setItem: (k: string, v: string) => {
          writes++;
          storage.setItem(k, v);
        },
      };
      const store = createProjectStore({ storage: counting, autosaveDelayMs: 0 });
      let builds = 0;
      const modelOf = createModelCache((p: Project) => {
        builds++;
        return buildModel(p);
      });
      // Plusieurs lecteurs du modèle (barre d'état, panneaux, vue) à chaque changement.
      let changes = 0;
      store.subscribe((s, prev) => {
        if (s.project === prev.project) return;
        changes++;
        for (let i = 0; i < 5; i++) modelOf(s.project);
      });
      modelOf(store.getState().project);
      builds = 0;
      writes = 0;

      expect(store.getState().loadPreset(id).ok).toBe(true);
      expect(changes).toBe(1);
      expect(builds).toBe(1);
      expect(writes).toBe(1);
      expect(modelOf(store.getState().project).errors).toEqual([]);

      // Annuler / rétablir : aucun recalcul (même snapshot, modèle mémoïsé).
      store.getState().undo();
      store.getState().redo();
      expect(builds).toBe(1);
    },
  );
});
