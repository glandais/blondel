import {
  UNDERLAY_IMAGE_MAX_CHARS,
  UNDERLAY_MAX_ENTITIES,
  UNDERLAY_MAX_VERTICES,
  createProject,
  parseProjectText,
  serializeProject,
  type Project,
} from "@blondel/core";
import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_KEY,
  autosaveText,
  loadAutosave,
  memoryStorage,
  saveAutosave,
} from "./persistence.js";

/**
 * Quota `localStorage` de Chromium : 10 Mio en UTF-16 par origine, soit ≈ 5 242 880 caractères
 * clé comprise. Marge prise pour la clé, la copie de secours éventuelle mise à part.
 */
const LOCAL_STORAGE_BUDGET_CHARS = 5_000_000;

/**
 * Projet aux bornes d'import : calque DXF de `UNDERLAY_MAX_ENTITIES` polylignes à renflements
 * totalisant `UNDERLAY_MAX_VERTICES` sommets (coordonnées au 1/100 mm comme l'import, plus
 * longues que la moyenne) et image de fond de `UNDERLAY_IMAGE_MAX_CHARS` caractères.
 */
function projectAtUnderlayBounds(): Project {
  const perEntity = UNDERLAY_MAX_VERTICES / UNDERLAY_MAX_ENTITIES;
  const coord = (i: number, j: number) => -123456.78 + i * 10.01 + j * 0.37;
  const entities = Array.from({ length: UNDERLAY_MAX_ENTITIES }, (_, i) => ({
    kind: "polyline" as const,
    layer: "MURS-PORTEURS",
    closed: true,
    points: Array.from({ length: perEntity }, (_, j) => ({ x: coord(i, j), y: -coord(j, i) })),
    bulges: Array.from({ length: perEntity }, (_, j) => (j % 2 === 0 ? 0 : -0.414214)),
  }));
  const prefix = "data:image/png;base64,";
  const base = createProject("straight");
  const text = JSON.stringify({
    ...JSON.parse(serializeProject(base)),
    site: {
      ...base.site,
      underlay: {
        dxf: {
          name: "plan-de-masse.dxf",
          unitScale: 1,
          placement: { origin: { x: 0, y: 0 }, rotation: 0 },
          entities,
        },
        image: {
          name: "plan.png",
          dataUrl: prefix + "A".repeat(UNDERLAY_IMAGE_MAX_CHARS - prefix.length),
          widthPx: 4000,
          heightPx: 3000,
          mmPerPx: 5,
          placement: { origin: { x: 0, y: 0 }, rotation: 0 },
        },
      },
    },
  });
  // Passe la validation du cœur (bornes comprises).
  return parseProjectText(text);
}

describe("autosauvegarde", () => {
  it("écrit du JSON compact, relu à l'identique", () => {
    const storage = memoryStorage();
    const p = createProject("quarter-left");
    expect(saveAutosave(storage, p)).toBe(true);
    const text = storage.getItem(AUTOSAVE_KEY) ?? "";
    expect(text).not.toContain("\n");
    expect(loadAutosave(storage)).toEqual({ kind: "ok", project: p });
  });

  it("un projet aux bornes du calque de fond tient dans le quota localStorage", () => {
    const p = projectAtUnderlayBounds();
    const indented = serializeProject(p).length;
    const compact = autosaveText(p).length + AUTOSAVE_KEY.length;
    // Le format indenté de l'export déborde : c'est le défaut corrigé.
    expect(indented).toBeGreaterThan(LOCAL_STORAGE_BUDGET_CHARS);
    expect(compact).toBeLessThan(LOCAL_STORAGE_BUDGET_CHARS);
  });

  it("absente ou stockage illisible : rien", () => {
    expect(loadAutosave(undefined)).toEqual({ kind: "none" });
    expect(loadAutosave(memoryStorage())).toEqual({ kind: "none" });
    const throwing = {
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadAutosave(throwing)).toEqual({ kind: "none" });
  });
});
