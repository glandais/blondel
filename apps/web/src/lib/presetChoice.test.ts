import {
  ALL_PRESET_IDS,
  DEMO_PRESET_DESCRIPTIONS,
  DEMO_PRESET_IDS,
  PRESET_LABELS,
  createDemoProject,
  serializeProject,
} from "@blondel/core";
import { describe, expect, it, vi } from "vitest";
import { trKey } from "../i18n/fr.js";
import { DEFAULT_OVERLAYS, DEMO_OVERLAYS, createProjectStore } from "../store/projectStore.js";
import {
  BASIC_GROUP_LABEL,
  DEMO_GROUP_LABEL,
  PRESET_GROUPS,
  applyPresetChoice,
  presetDescription,
} from "./presetChoice.js";

describe("choix d'un préréglage : Basiques et Démo", () => {
  it("deux groupes, dans l'ordre, qui couvrent tous les préréglages du cœur", () => {
    expect(PRESET_GROUPS.map((g) => g.label)).toEqual([BASIC_GROUP_LABEL, DEMO_GROUP_LABEL]);
    expect(PRESET_GROUPS[0]!.items.map((i) => i.id)).toEqual([...ALL_PRESET_IDS]);
    expect(PRESET_GROUPS[0]!.items.map((i) => i.label)).toEqual(
      ALL_PRESET_IDS.map((id) => trKey(PRESET_LABELS[id])),
    );
    expect(PRESET_GROUPS[1]!.items.map((i) => i.id)).toEqual([...DEMO_PRESET_IDS]);
    for (const item of PRESET_GROUPS[1]!.items) expect(item.description).toBeTruthy();
    for (const item of PRESET_GROUPS[0]!.items) expect(item.description).toBeUndefined();
  });

  it("description d'une ligne pour les démos seulement", () => {
    expect(presetDescription("straight")).toBeUndefined();
    for (const id of DEMO_PRESET_IDS) {
      expect(presetDescription(id)).toBe(trKey(DEMO_PRESET_DESCRIPTIONS[id]));
    }
  });

  it("aiguille vers loadDemo ou loadPreset", () => {
    const state = { loadDemo: vi.fn(() => ({ ok: true as const })), loadPreset: vi.fn() };
    applyPresetChoice(state as never, "demo-u-oak");
    expect(state.loadDemo).toHaveBeenCalledWith("demo-u-oak");
    expect(state.loadPreset).not.toHaveBeenCalled();
    applyPresetChoice(state as never, "half-turn");
    expect(state.loadPreset).toHaveBeenCalledWith("half-turn");
  });
});

describe("store : loadDemo", () => {
  it.each(DEMO_PRESET_IDS)(
    "%s : une entrée d'annulation, onglet 3D, cadrage demandé, essais d'apparence effacés",
    (id) => {
      const s = createProjectStore();
      const p0 = s.getState().project;
      s.getState().setAppearance({ treads: "wood-pine" });
      s.getState().select({ location: { kind: "part", partId: "tread-1" } });
      expect(s.getState().loadDemo(id)).toEqual({ ok: true });
      const st = s.getState();
      expect(serializeProject(st.project)).toBe(serializeProject(createDemoProject(id)));
      expect(st.view).toBe("3d");
      expect(st.appearance).toEqual({});
      expect(st.selection).toBeNull();
      expect(st.frameRequest).toEqual({ project: st.project, seq: 1 });
      expect(st.overlays).toEqual(DEMO_OVERLAYS);
      expect(st.notice?.kind).toBe("info");
      expect(st.history.past).toHaveLength(1);
      st.undo();
      expect(s.getState().project).toBe(p0);
    },
  );

  it("chaque choix de démo renouvelle la demande de cadrage", () => {
    const s = createProjectStore();
    s.getState().loadDemo("demo-u-oak");
    s.getState().loadDemo("demo-helical-glass");
    expect(s.getState().frameRequest?.seq).toBe(2);
    expect(s.getState().frameRequest?.project).toBe(s.getState().project);
    expect(s.getState().history.past).toHaveLength(2);
  });

  it("un préréglage de base ne change ni l'onglet ni le cadrage", () => {
    const s = createProjectStore();
    expect(s.getState().loadPreset("quarter-left").ok).toBe(true);
    expect(s.getState().view).toBe("plan");
    expect(s.getState().frameRequest).toBeNull();
  });

  it("démo : cotes et contrôles masqués, réactivables ; tout autre projet les rétablit", () => {
    const s = createProjectStore();
    expect(s.getState().overlays).toEqual(DEFAULT_OVERLAYS);
    expect(DEFAULT_OVERLAYS).toEqual({ showControls: true, showDimensions: true });
    expect(DEMO_OVERLAYS).toEqual({ showControls: false, showDimensions: false });
    const demo = (): void => {
      s.getState().loadDemo("demo-helical-glass");
      expect(s.getState().overlays).toEqual(DEMO_OVERLAYS);
    };
    demo();
    // Option d'affichage : l'utilisateur la réactive, une autre démo la masque de nouveau.
    s.getState().setOverlays({ showControls: true });
    expect(s.getState().overlays).toEqual({ showControls: true, showDimensions: false });
    demo();
    // Préréglage de base.
    s.getState().loadPreset("straight");
    expect(s.getState().overlays).toEqual(DEFAULT_OVERLAYS);
    // Fichier importé.
    demo();
    const text = serializeProject(s.getState().project);
    expect(s.getState().importText(text).ok).toBe(true);
    expect(s.getState().overlays).toEqual(DEFAULT_OVERLAYS);
    // Projet de l'assistant.
    demo();
    expect(s.getState().replaceProject(createDemoProject("demo-u-oak")).ok).toBe(true);
    expect(s.getState().overlays).toEqual(DEFAULT_OVERLAYS);
    // Annuler / rétablir ne touche pas à l'affichage.
    demo();
    s.getState().undo();
    expect(s.getState().overlays).toEqual(DEMO_OVERLAYS);
  });

  it("création d'une démo sur le fil principal : bien sous le budget de tâche longue", () => {
    for (const id of DEMO_PRESET_IDS) createDemoProject(id); // préchauffage
    for (const id of DEMO_PRESET_IDS) {
      const t0 = performance.now();
      createDemoProject(id);
      // Budget e2e de 200 ms par tâche ; marge ×2 pour une machine chargée.
      expect(performance.now() - t0, id).toBeLessThan(100);
    }
  });
});
