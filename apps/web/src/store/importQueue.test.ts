import { translatorFor } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import {
  cancelUnderlayImport,
  importQueue,
  queuedImportMessage,
  requestUnderlayImport,
} from "./importQueue.js";

const FR = translatorFor("fr");

describe("file des imports de calque (QUESTIONS D1)", () => {
  const file = new File(["0\nEOF\n"], "rdc.dxf");

  it("modèle en échec : message explicite, jamais d'attente silencieuse", () => {
    requestUnderlayImport("dxf", file);
    const pending = importQueue.getState().pending;
    const failed = queuedImportMessage(pending, { available: false, computing: false });
    expect(failed?.kind).toBe("error");
    expect(FR.t(failed!.text)).toContain("« rdc.dxf »");
    expect(FR.t(failed!.text)).toMatch(/en échec/);
    const computing = queuedImportMessage(pending, { available: false, computing: true });
    expect(computing?.kind).toBe("info");
    expect(FR.t(computing!.text)).toMatch(/fin du calcul/);
    // Modèle disponible : le plan « Site et saisie » prend la demande, rien à signaler.
    expect(queuedImportMessage(pending, { available: true, computing: false })).toBeNull();
    cancelUnderlayImport();
    expect(importQueue.getState().pending).toBeNull();
    expect(queuedImportMessage(null, { available: false, computing: false })).toBeNull();
  });

  it("image : libellé adapté", () => {
    requestUnderlayImport("image", new File([""], "plan.png"));
    const m = queuedImportMessage(importQueue.getState().pending, {
      available: false,
      computing: false,
    });
    expect(FR.t(m!.text)).toMatch(/^L'image « plan\.png »/);
    expect(translatorFor("en").t(m!.text)).toMatch(/^The image “plan\.png” cannot be imported/);
    cancelUnderlayImport();
  });

  it("modèle disponible mais plan « Site et saisie » fermé (autre onglet) : message, pas d'attente silencieuse", () => {
    // Revue adverse D1 : l'utilisateur change d'onglet pendant l'échec ; le modèle revient, la
    // vue affichée n'est pas le plan « Site et saisie » : la demande attendait sans rien dire.
    requestUnderlayImport("dxf", file);
    const pending = importQueue.getState().pending;
    const m = queuedImportMessage(pending, { available: true, computing: false, hostShown: false });
    expect(m?.kind).toBe("info");
    expect(FR.t(m!.text)).toMatch(/Site et saisie/);
    expect(
      queuedImportMessage(pending, { available: true, computing: false, hostShown: true }),
    ).toBeNull();
    // Sans modèle, le message d'échec prime.
    expect(
      queuedImportMessage(pending, { available: false, computing: false, hostShown: false })?.kind,
    ).toBe("error");
    cancelUnderlayImport();
  });
});
