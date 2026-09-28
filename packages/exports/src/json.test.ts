import { parseProjectText, serializeProject } from "@blondel/core";
import { describe, expect, it } from "vitest";
import { exportProjectJson } from "./json.js";
import { sampleProject } from "./testing/fixtures.js";

describe("exportProjectJson", () => {
  it("réutilise la sérialisation stable du cœur (aller-retour)", () => {
    const p = sampleProject();
    const text = exportProjectJson(p);
    expect(text).toBe(serializeProject(p));
    expect(parseProjectText(text)).toEqual(p);
  });
});
