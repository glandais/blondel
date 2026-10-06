import { textMessage, translatorFor } from "@blondel/i18n";
import fc from "fast-check";
import {
  DEMO_PRESET_IDS,
  DEMO_PRESET_LABELS,
  PRESET_IDS,
  PRESET_LABELS,
  ProjectSchema,
  createProject,
  serializeProject,
  stableStringify,
  type Project,
} from "@blondel/core";
import { describe, expect, it, vi } from "vitest";
import { AUTOSAVE_KEY, AUTOSAVE_REJECTED_KEY, memoryStorage } from "./persistence.js";
import { createProjectStore } from "./projectStore.js";

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

const FR = translatorFor("fr");

describe("store du projet", () => {
  it("démarre sur le préréglage par défaut sans autosauvegarde", () => {
    const s = createProjectStore();
    expect(s.getState().project).toEqual(createProject("straight"));
    expect(s.getState().canUndo()).toBe(false);
  });

  it("modifie un champ, annule et rétablit", () => {
    const s = createProjectStore();
    const p0 = s.getState().project;
    expect(s.getState().setField(["site", "floorToFloor"], 2800)).toEqual({ ok: true });
    expect(s.getState().project.site.floorToFloor).toBe(2800);
    expect(s.getState().project.stair).toBe(p0.stair); // partage structurel
    s.getState().undo();
    expect(s.getState().project).toBe(p0);
    s.getState().redo();
    expect(s.getState().project.site.floorToFloor).toBe(2800);
  });

  it("refuse une modification qui rend le projet invalide", () => {
    const s = createProjectStore();
    const p0 = s.getState().project;
    const r = s.getState().setField(["site", "floorToFloor"], 2700.5);
    expect(r.ok).toBe(false);
    expect(s.getState().project).toBe(p0);
    expect(s.getState().setField(["stair", "layout", "width"], -5).ok).toBe(false);
    expect(s.getState().canUndo()).toBe(false);
  });

  it("regroupe la saisie continue d'un même champ", () => {
    const c = clock();
    const s = createProjectStore({ now: c.now });
    const p0 = s.getState().project;
    for (const v of [2, 27, 270, 2700, 2750]) {
      c.advance(150);
      s.getState().setField(["site", "floorToFloor"], v);
    }
    expect(s.getState().project.site.floorToFloor).toBe(2750);
    expect(s.getState().history.past).toHaveLength(1);
    s.getState().endGroup();
    c.advance(10);
    s.getState().setField(["site", "floorToFloor"], 2760);
    expect(s.getState().history.past).toHaveLength(2);
    s.getState().undo();
    s.getState().undo();
    expect(s.getState().project).toBe(p0);
  });

  it("charge un préréglage de façon annulable", () => {
    const s = createProjectStore();
    const p0 = s.getState().project;
    expect(s.getState().loadPreset("quarter-left").ok).toBe(true);
    expect(s.getState().project.stair.layout.turns).toHaveLength(1);
    s.getState().undo();
    expect(s.getState().project).toBe(p0);
    // Options incohérentes : refus, message, pas de changement.
    const r = s.getState().loadPreset("straight", { width: 5000 });
    expect(r.ok).toBe(false);
    expect(s.getState().notice?.kind).toBe("error");
    expect(s.getState().project).toBe(p0);
  });

  it("importe et exporte un .blondel.json (aller-retour)", () => {
    const s = createProjectStore();
    const src = createProject("two-quarters-u", { name: "Maison Dupont" });
    const r = s.getState().importText(serializeProject(src));
    expect(r.ok).toBe(true);
    expect(s.getState().project).toEqual(src);
    const out = s.getState().exportFile();
    expect(out.filename).toBe("maison-dupont.blondel.json");
    expect(out.text).toBe(serializeProject(src));
    // Import invalide : message localisé, projet inchangé.
    const before = s.getState().project;
    const bad = s.getState().importText('{"schemaVersion":1,"site":{}}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.length).toBeGreaterThan(0);
    expect(s.getState().project).toBe(before);
    expect(s.getState().importText("pas du json").ok).toBe(false);
  });

  it("autosauvegarde et relit le projet", () => {
    const storage = memoryStorage();
    const s = createProjectStore({ storage, autosaveDelayMs: 0 });
    s.getState().setField(["name"], "Chalet");
    expect(storage.getItem(AUTOSAVE_KEY)).toContain("Chalet");
    const s2 = createProjectStore({ storage });
    expect(s2.getState().project.name).toBe("Chalet");
    expect(s2.getState().project).toEqual(s.getState().project);
  });

  it("autosauvegarde corrompue : projet neuf, message, et survit à un stockage qui lève", () => {
    const corrupt = memoryStorage({ [AUTOSAVE_KEY]: "{oups" });
    const c = createProjectStore({ storage: corrupt });
    expect(c.getState().project.name).toBe(createProject("straight").name);
    expect(c.getState().notice?.kind).toBe("error");
    expect(corrupt.getItem(AUTOSAVE_REJECTED_KEY)).toBe("{oups");
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const s = createProjectStore({ storage: throwing, autosaveDelayMs: 0 });
    s.getState().setField(["name"], "X");
    expect(s.getState().project.name).toBe("X");
    expect(s.getState().autosaveFailed).toBe(true);
  });

  describe("autosauvegarde refusée au démarrage (jamais écrasée en silence)", () => {
    const client = (): Project => ({ ...createProject("straight"), name: "Mon escalier client" });
    const newer = (): string => {
      const json = JSON.parse(serializeProject(client())) as Record<string, unknown>;
      return JSON.stringify({ ...json, schemaVersion: 2 });
    };
    const invalid = (): string => {
      const json = JSON.parse(serializeProject(client())) as { site: Record<string, unknown> };
      return JSON.stringify({ ...json, site: { ...json.site, floorToFloor: -1 } });
    };

    it.each([
      ["format plus récent", newer, /format 2, plus récent/],
      ["projet invalide", invalid, /invalide/i],
    ])("%s : message du cœur, copie de secours, original conservé", (_, text, message) => {
      const raw = text();
      const storage = memoryStorage({ [AUTOSAVE_KEY]: raw });
      const s = createProjectStore({ storage, autosaveDelayMs: 0 });
      expect(s.getState().project.name).toBe(createProject("straight").name);
      expect(s.getState().notice?.kind).toBe("error");
      expect(FR.t(s.getState().notice!.msg)).toMatch(message);
      expect(s.getState().rejectedAutosave).toMatchObject({ text: raw, preserved: true });
      expect(s.getState().rejectedAutosave?.since).toBeUndefined();
      // La première modification écrit l'autosauvegarde, mais l'original reste récupérable.
      s.getState().setField(["site", "floorToFloor"], 2800);
      expect(storage.getItem(AUTOSAVE_KEY)).toContain("Escalier droit");
      expect(storage.getItem(AUTOSAVE_REJECTED_KEY)).toBe(raw);
      // Congé explicite : la copie est libérée.
      s.getState().dismissRejectedAutosave();
      expect(storage.getItem(AUTOSAVE_REJECTED_KEY)).toBeNull();
      expect(s.getState().rejectedAutosave).toBeNull();
    });

    it("copie impossible (quota) : autosauvegarde suspendue jusqu'au choix de l'utilisateur", () => {
      const raw = newer();
      const inner = memoryStorage({ [AUTOSAVE_KEY]: raw });
      const storage = {
        ...inner,
        setItem: (k: string, v: string) => {
          if (k === AUTOSAVE_REJECTED_KEY) throw new Error("QuotaExceededError");
          inner.setItem(k, v);
        },
      };
      const s = createProjectStore({ storage, autosaveDelayMs: 0 });
      expect(s.getState().rejectedAutosave).toMatchObject({ text: raw, preserved: false });
      expect(FR.t(s.getState().notice!.msg)).toMatch(/suspendue/);
      s.getState().setField(["site", "floorToFloor"], 2800);
      s.getState().flushAutosave();
      expect(inner.getItem(AUTOSAVE_KEY)).toBe(raw);
      s.getState().dismissRejectedAutosave();
      expect(inner.getItem(AUTOSAVE_KEY)).toContain("2800");
    });

    describe("copie de secours laissée par un démarrage antérieur (QUESTIONS A22)", () => {
      const current = (): string => serializeProject({ ...client(), name: "Projet courant" });

      it("bandeau à chaque démarrage tant que la copie existe ; supprimer la libère", () => {
        const raw = newer();
        const storage = memoryStorage({ [AUTOSAVE_KEY]: current(), [AUTOSAVE_REJECTED_KEY]: raw });
        const s = createProjectStore({ storage, autosaveDelayMs: 0 });
        // Le projet de l'autosauvegarde est ouvert normalement, sans message d'erreur.
        expect(s.getState().project.name).toBe("Projet courant");
        expect(s.getState().notice).toBeNull();
        expect(s.getState().rejectedAutosave).toMatchObject({
          text: raw,
          preserved: true,
          since: "earlier",
          restorable: false,
        });
        expect(FR.t(s.getState().rejectedAutosave!.reason!)).toMatch(/plus récent/);
        // Pas de restauration d'une copie illisible : message, rien ne change.
        const before = s.getState().project;
        expect(s.getState().restoreRejectedAutosave().ok).toBe(false);
        expect(s.getState().project).toBe(before);
        expect(storage.getItem(AUTOSAVE_REJECTED_KEY)).toBe(raw);
        // Démarrage suivant : toujours signalée.
        const s2 = createProjectStore({ storage });
        expect(s2.getState().rejectedAutosave?.since).toBe("earlier");
        s2.getState().dismissRejectedAutosave();
        expect(storage.getItem(AUTOSAVE_REJECTED_KEY)).toBeNull();
        expect(createProjectStore({ storage }).getState().rejectedAutosave).toBeNull();
      });

      it("copie relisible (application mise à jour) : restaurée, annulable, puis supprimée", () => {
        const raw = serializeProject(client());
        const storage = memoryStorage({ [AUTOSAVE_KEY]: current(), [AUTOSAVE_REJECTED_KEY]: raw });
        const s = createProjectStore({ storage, autosaveDelayMs: 0 });
        expect(s.getState().rejectedAutosave?.restorable).toBe(true);
        const r = s.getState().restoreRejectedAutosave();
        expect(r.ok).toBe(true);
        expect(s.getState().project.name).toBe("Mon escalier client");
        expect(s.getState().rejectedAutosave).toBeNull();
        expect(storage.getItem(AUTOSAVE_REJECTED_KEY)).toBeNull();
        expect(storage.getItem(AUTOSAVE_KEY)).toContain("Mon escalier client");
        s.getState().undo();
        expect(s.getState().project.name).toBe("Projet courant");
      });

      it("paramètre `reportBackupCopy: false` : pas de bandeau", () => {
        const storage = memoryStorage({ [AUTOSAVE_REJECTED_KEY]: newer() });
        const s = createProjectStore({ storage, reportBackupCopy: false });
        expect(s.getState().rejectedAutosave).toBeNull();
      });
    });

    it("un projet initial fourni ne lit ni ne signale l'autosauvegarde", () => {
      const storage = memoryStorage({ [AUTOSAVE_KEY]: "{oups" });
      const s = createProjectStore({ storage, initialProject: client() });
      expect(s.getState().notice).toBeNull();
      expect(s.getState().rejectedAutosave).toBeNull();
      expect(storage.getItem(AUTOSAVE_REJECTED_KEY)).toBeNull();
    });
  });

  it("propriété : tout préréglage survit à l'export puis l'import, et à l'autosauvegarde", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESET_IDS),
        fc.integer({ min: 2200, max: 3500 }),
        fc.integer({ min: 700, max: 1200 }),
        (id, H, E) => {
          let p: Project;
          try {
            p = createProject(id, { floorToFloor: H, width: E });
          } catch {
            return true; // combinaison refusée par le cœur (RangeError) : hors sujet ici.
          }
          const storage = memoryStorage();
          const s = createProjectStore({ storage, autosaveDelayMs: 0, initialProject: p });
          s.getState().setField(["name"], "P");
          const exported = s.getState().exportFile().text;
          const s2 = createProjectStore({ initialProject: createProject("straight") });
          const r = s2.getState().importText(exported);
          const s3 = createProjectStore({ storage });
          return (
            r.ok &&
            JSON.stringify(s2.getState().project) === JSON.stringify(s.getState().project) &&
            serializeProject(s3.getState().project) === exported
          );
        },
      ),
      { numRuns: 40 },
    );
  });

  it("rétablit la valeur par défaut d'un champ retiré au lieu de stocker un projet incomplet", () => {
    const s = createProjectStore();
    expect(s.getState().setField(["stair", "stepping", "targetRise"], 180).ok).toBe(true);
    expect(s.getState().setField(["stair", "stepping", "targetRise"], undefined).ok).toBe(true);
    // Avant correction : la clé disparaissait du projet (le pipeline recevait `undefined`).
    expect(s.getState().project.stair.stepping.targetRise).toBe(
      ProjectSchema.parse(s.getState().project).stair.stepping.targetRise,
    );
    expect(s.getState().project.stair.stepping.targetRise).toBeTypeOf("number");
  });

  it("n'enregistre pas d'entrée d'historique quand la forme canonique ne change pas", () => {
    const s = createProjectStore();
    const p0 = s.getState().project;
    const def = ProjectSchema.parse({ ...p0, stair: { ...p0.stair, stepping: {} } }).stair.stepping;
    expect(p0.stair.stepping.targetRise).toBe(def.targetRise);
    expect(s.getState().setField(["stair", "stepping", "targetRise"], undefined).ok).toBe(true);
    expect(s.getState().project).toBe(p0);
    expect(s.getState().canUndo()).toBe(false);
  });

  it("retire une clé inconnue (le projet stocké est celui que relirait l'import)", () => {
    const s = createProjectStore();
    expect(s.getState().setField(["stair", "bogus"], 3).ok).toBe(true);
    expect(Object.keys(s.getState().project.stair)).not.toContain("bogus");
  });

  it("propriété : le projet stocké reste canonique pour toute suite d'éditions", () => {
    const paths = [
      ["stair", "stepping", "targetRise"],
      ["stair", "stepping", "riserCount"],
      ["stair", "stepping", "firstRiseOffset"],
      ["stair", "treads", "nosing"],
      ["stair", "treads", "thickness"],
      ["stair", "balancing", "windersPerSide"],
      ["site", "lowerFinish"],
      ["site", "opening"],
      ["compliance", "contexts"],
      ["stair", "extra"],
    ] as const;
    const value = fc.oneof(
      fc.constant(undefined),
      fc.constant("auto"),
      fc.integer({ min: -50, max: 400 }),
      fc.double({ min: 0, max: 400, noNaN: true }),
      fc.constant([] as string[]),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...PRESET_IDS),
        fc.array(fc.tuple(fc.constantFrom(...paths), value), { maxLength: 12 }),
        (id, edits) => {
          const s = createProjectStore({ initialProject: createProject(id) });
          for (const [path, v] of edits) {
            s.getState().setField(path, v);
            const p = s.getState().project;
            if (stableStringify(ProjectSchema.parse(p)) !== stableStringify(p)) return false;
          }
          // Toute l'histoire est canonique et annulable jusqu'au départ.
          while (s.getState().canUndo()) s.getState().undo();
          return stableStringify(s.getState().project) === stableStringify(createProject(id));
        },
      ),
      { numRuns: 60 },
    );
  });

  it("écrit l'autosauvegarde en attente à la demande (fermeture de la page)", () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const s = createProjectStore({ storage, autosaveDelayMs: 500 });
      s.getState().setField(["name"], "Grenier");
      expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
      s.getState().flushAutosave();
      expect(storage.getItem(AUTOSAVE_KEY)).toContain("Grenier");
      // Plus rien en attente : le minuteur ne réécrit pas.
      storage.removeItem(AUTOSAVE_KEY);
      vi.advanceTimersByTime(1000);
      expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
      s.getState().flushAutosave(); // sans effet
      expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
      // Sans stockage : sans effet et sans erreur.
      createProjectStore().getState().flushAutosave();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("remplacement du projet (assistant) et état d'interface", () => {
  it("remplace le projet en une entrée annulable, efface la sélection et affiche un message", () => {
    const s = createProjectStore();
    const p0 = s.getState().project;
    s.getState().select({ location: { kind: "tread", number: 2 } });
    // Saisie en cours (groupe ouvert) : le remplacement reste une entrée distincte.
    s.getState().setField(["site", "floorToFloor"], 2750);
    const q = createProject("quarter-left");
    expect(s.getState().replaceProject(q, textMessage("Proposition retenue."))).toEqual({
      ok: true,
    });
    expect(s.getState().project).toEqual(q);
    expect(s.getState().selection).toBeNull();
    expect(s.getState().notice).toEqual({ kind: "info", msg: textMessage("Proposition retenue.") });
    s.getState().undo();
    expect(s.getState().project.site.floorToFloor).toBe(2750);
    s.getState().undo();
    expect(s.getState().project).toBe(p0);
  });

  it("refuse un projet invalide sans rien changer", () => {
    const s = createProjectStore();
    const p0 = s.getState().project;
    const bad = { ...p0, site: { ...p0.site, floorToFloor: -1 } } as Project;
    expect(s.getState().replaceProject(bad).ok).toBe(false);
    expect(s.getState().project).toBe(p0);
  });

  it("geste continu : une seule entrée d'historique quel que soit le délai", () => {
    const c = clock();
    const s = createProjectStore({ now: c.now });
    const p0 = s.getState().project;
    for (const h of [2710, 2720, 2730]) {
      s.getState().update((p) => ({ ...p, site: { ...p.site, floorToFloor: h } }), "drag", {
        sticky: true,
      });
      c.advance(5000);
    }
    s.getState().endGroup();
    expect(s.getState().history.past).toHaveLength(1);
    s.getState().undo();
    expect(s.getState().project).toBe(p0);
  });

  it("refus d'une modification : motifs en `Message`, qui suivent un changement de langue", () => {
    const s = createProjectStore();
    const r = s.getState().setField(["site", "floorToFloor"], 2700.5);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.length).toBeGreaterThan(0);
    const EN = translatorFor("en");
    const fr = FR.t(r.issues[0]!);
    const en = EN.t(r.issues[0]!);
    expect(fr).toMatch(/floorToFloor/);
    expect(en).toMatch(/floorToFloor/);
    expect(en).not.toBe(fr);
    // Même résultat quelle que soit la langue au moment du refus (traduit à l'affichage).
    s.getState().setLocale("en");
    const again = s.getState().setField(["site", "floorToFloor"], 2700.5);
    expect(again).toEqual(r);
  });

  it("projet neuf nommé dans la langue de l'interface (démarrage, préréglage, démo, import)", () => {
    const EN = translatorFor("en");
    const s = createProjectStore({ locale: "en" });
    expect(s.getState().project.name).toBe(EN.t(PRESET_LABELS.straight));
    expect(s.getState().project.name).not.toBe(createProject("straight").name);
    s.getState().loadPreset("quarter-left");
    expect(s.getState().project.name).toBe(EN.t(PRESET_LABELS["quarter-left"]));
    const demo = DEMO_PRESET_IDS[0]!;
    s.getState().loadDemo(demo);
    expect(s.getState().project.name).toBe(EN.t(DEMO_PRESET_LABELS[demo]));
    // Import d'un fichier sans nom : nom de la langue courante ; avec nom : repris tel quel.
    const { name: _omitted, ...rest } = JSON.parse(serializeProject(createProject("straight"))) as {
      name: string;
    };
    expect(s.getState().importText(JSON.stringify(rest)).ok).toBe(true);
    expect(s.getState().project.name).toBe("Untitled");
    s.getState().setLocale("fr");
    expect(s.getState().importText(JSON.stringify(rest)).ok).toBe(true);
    expect(s.getState().project.name).toBe("Sans titre");
    const named = serializeProject(createProject("straight", { name: "Chalet" }));
    s.getState().setLocale("en");
    expect(s.getState().importText(named).ok).toBe(true);
    expect(s.getState().project.name).toBe("Chalet");
    // Français : le nom du cœur (inchangé).
    expect(createProjectStore().getState().project.name).toBe(createProject("straight").name);
  });

  it("autosauvegarde refusée au démarrage : détails en `Message` (suivent la langue)", () => {
    const storage = memoryStorage();
    storage.setItem(AUTOSAVE_KEY, '{"schemaVersion":1,"site":{}}');
    const s = createProjectStore({ storage, autosaveDelayMs: 0, locale: "en" });
    const notice = s.getState().notice;
    expect(notice?.kind).toBe("error");
    if (!notice) return;
    for (const d of notice.details ?? []) {
      expect(FR.t(d)).not.toBe(translatorFor("en").t(d));
    }
  });

  it("mode du plan et apparence 3D : état d'interface, hors historique", () => {
    const s = createProjectStore();
    s.getState().setPlanMode("site");
    s.getState().setAppearance({ treads: "wood-ash" });
    expect(s.getState().planMode).toBe("site");
    expect(s.getState().appearance).toEqual({ treads: "wood-ash" });
    expect(s.getState().canUndo()).toBe(false);
  });
});

describe("dernier projet chargé (parcours, ADR-0009)", () => {
  it("origine et numéro d'ordre de chaque chargement réussi", () => {
    const s = createProjectStore();
    expect(s.getState().lastOpened).toBeNull();
    // Saisie, annuler : pas un chargement.
    s.getState().setField(["site", "floorToFloor"], 2800);
    s.getState().undo();
    expect(s.getState().lastOpened).toBeNull();
    expect(s.getState().loadDemo(DEMO_PRESET_IDS[0]!).ok).toBe(true);
    expect(s.getState().lastOpened).toEqual({ origin: "demo", seq: 1 });
    expect(s.getState().loadPreset("quarter-left").ok).toBe(true);
    expect(s.getState().lastOpened).toEqual({ origin: "preset", seq: 2 });
    expect(s.getState().importText(serializeProject(createProject("straight"))).ok).toBe(true);
    expect(s.getState().lastOpened).toEqual({ origin: "import", seq: 3 });
    expect(s.getState().replaceProject(createProject("quarter-right")).ok).toBe(true);
    expect(s.getState().lastOpened).toEqual({ origin: "assistant", seq: 4 });
    expect(s.getState().replaceProject(createProject("straight"), undefined, "import").ok).toBe(
      true,
    );
    expect(s.getState().lastOpened).toEqual({ origin: "import", seq: 5 });
    // Même origine deux fois : deux ouvertures distinctes.
    s.getState().loadPreset("straight");
    s.getState().loadPreset("straight");
    expect(s.getState().lastOpened?.seq).toBe(7);
  });

  it("échecs : rien ne change", () => {
    const s = createProjectStore();
    expect(s.getState().importText("pas du json").ok).toBe(false);
    expect(s.getState().restoreRejectedAutosave().ok).toBe(false);
    const invalid = { ...createProject("straight"), site: { floorToFloor: -1 } } as Project;
    expect(s.getState().replaceProject(invalid).ok).toBe(false);
    expect(s.getState().lastOpened).toBeNull();
  });

  it("copie de secours restaurée : origine « restore »", () => {
    const raw = serializeProject(createProject("straight", { name: "Copie" }));
    const storage = memoryStorage({
      [AUTOSAVE_KEY]: serializeProject(createProject("straight", { name: "Courant" })),
      [AUTOSAVE_REJECTED_KEY]: raw,
    });
    const s = createProjectStore({ storage, autosaveDelayMs: 0 });
    expect(s.getState().lastOpened).toBeNull();
    expect(s.getState().restoreRejectedAutosave().ok).toBe(true);
    expect(s.getState().lastOpened).toEqual({ origin: "restore", seq: 1 });
  });
});

describe("validation des valeurs ◆ (ADR-0009 point 9)", () => {
  it("valider puis Annuler rend le projet d'avant ; Rétablir revalide", () => {
    const s = createProjectStore();
    const p0 = s.getState().project;
    const r = s.getState().setValuesValidated([{ path: "guards.posts.size", value: 40 }], true);
    expect(r).toEqual({ ok: true });
    expect(s.getState().project.validatedValues).toEqual([
      { path: "guards.posts.size", value: 40 },
    ]);
    s.getState().undo();
    expect(s.getState().project).toBe(p0);
    s.getState().redo();
    expect(s.getState().project.validatedValues).toHaveLength(1);
    // Dévalider : le champ disparaît, annulable aussi.
    s.getState().setValuesValidated([{ path: "guards.posts.size", value: 40 }], false);
    expect("validatedValues" in s.getState().project).toBe(false);
    s.getState().undo();
    expect(s.getState().project.validatedValues).toHaveLength(1);
  });

  it("plusieurs valeurs (« Tout valider ») : une seule entrée d'historique, distincte d'une saisie", () => {
    const c = clock();
    const s = createProjectStore({ now: c.now });
    s.getState().setField(["site", "floorToFloor"], 2800);
    const p1 = s.getState().project;
    c.advance(10);
    s.getState().setValuesValidated(
      [
        { path: "guards.posts.size", value: 40 },
        { path: "guards.material", value: "steel" },
        { path: "stair.structure.params.a", value: true, structureKind: "steel-plate" },
      ],
      true,
    );
    expect(s.getState().project.validatedValues).toHaveLength(3);
    // Une saisie qui suit ne se fond pas dans la validation.
    c.advance(10);
    s.getState().setField(["site", "floorToFloor"], 2810);
    s.getState().undo();
    expect(s.getState().project.validatedValues).toHaveLength(3);
    s.getState().undo();
    expect(s.getState().project).toBe(p1);
  });
});
