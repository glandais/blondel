import { isMessage, translatorFor, type Message } from "@blondel/i18n";
import { describe, expect, it } from "vitest";
import { fr } from "../i18n.test-helpers.js";
import { ruleDescription } from "./messages.js";
import { HelicalLayoutSpecSchema } from "./project.js";

describe("ruleDescription", () => {
  it("clé rules.<id>.description, française et anglaise", () => {
    expect(ruleDescription("FAB_LIMON_JOUE_MIN")).toEqual({
      key: "rules.FAB_LIMON_JOUE_MIN.description",
    });
    expect(fr(ruleDescription("FAB_LIMON_JOUE_MIN"))).toBe(
      "Joue : bois entre un encastrement et une rive du limon",
    );
    expect(translatorFor("en").t(ruleDescription("FAB_LIMON_JOUE_MIN"))).toMatch(/^Cheek: /);
  });

  it("identifiant inconnu : la clé, jamais d'exception", () => {
    expect(fr(ruleDescription("INCONNUE"))).toBe("rules.INCONNUE.description");
  });
});

describe("hélicoïdal : rayon extérieur ≤ rayon du fût ou du jour", () => {
  const spec = (kind: "column" | "well") => ({
    kind: "helical",
    direction: "left",
    outerRadius: 400,
    core: { kind, radius: 500 },
    sweep: { mode: "angle", degrees: 360 },
  });

  it("texte français de zod inchangé, Message dans params", () => {
    for (const [kind, word, en] of [
      ["column", "du fût", "centre column"],
      ["well", "du jour", "well"],
    ] as const) {
      const r = HelicalLayoutSpecSchema.safeParse(spec(kind));
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path.join(".") === "outerRadius")!;
      expect(issue.message).toBe(
        `le rayon extérieur (400 mm) doit dépasser le rayon ${word} (500 mm)`,
      );
      const m = (issue as unknown as { params?: { message?: unknown } }).params?.message;
      expect(isMessage(m)).toBe(true);
      expect(fr(m as Message)).toBe(issue.message);
      expect(translatorFor("en").t(m as Message)).toBe(
        `the outer radius (400 mm) must exceed the ${en} radius (500 mm)`,
      );
    }
  });
});
