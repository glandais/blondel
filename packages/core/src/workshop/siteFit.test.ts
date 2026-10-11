/** Réglages d'adéquation au site du profil d'atelier (décision F7, sous-lot 3b). */
import { describe, expect, it } from "vitest";
import { WorkshopProfileSchema, resolveWorkshopProfile } from "./profile.js";
import { DEFAULT_SITE_FIT_PROFILE, SITE_FIT_PROVENANCE, resolveSiteFitProfile } from "./siteFit.js";

describe("profil d'atelier : adéquation au site", () => {
  it("défauts déduits du projet (null) et « à valider », aucune valeur en dur", () => {
    expect(DEFAULT_SITE_FIT_PROFILE).toEqual({ arrivalClearance: null, doorSwingRadius: null });
    expect(resolveWorkshopProfile().siteFit).toBe(DEFAULT_SITE_FIT_PROFILE);
    for (const p of Object.values(SITE_FIT_PROVENANCE)) expect(p.status).toBe("a-valider");
  });

  it("réglage partiel : champs saisis, null explicite = valeur déduite", () => {
    expect(resolveSiteFitProfile({ arrivalClearance: 1200 })).toEqual({
      arrivalClearance: 1200,
      doorSwingRadius: null,
    });
    expect(resolveSiteFitProfile({ arrivalClearance: null, doorSwingRadius: 900 })).toEqual({
      arrivalClearance: null,
      doorSwingRadius: 900,
    });
    expect(resolveWorkshopProfile({ siteFit: { doorSwingRadius: 800 } }).siteFit).toEqual({
      arrivalClearance: null,
      doorSwingRadius: 800,
    });
  });

  it("schéma : valeurs strictement positives ou null, champ facultatif", () => {
    expect(WorkshopProfileSchema.safeParse({}).success).toBe(true);
    expect(WorkshopProfileSchema.safeParse({ siteFit: { arrivalClearance: null } }).success).toBe(
      true,
    );
    expect(WorkshopProfileSchema.safeParse({ siteFit: { arrivalClearance: 0 } }).success).toBe(
      false,
    );
    expect(WorkshopProfileSchema.safeParse({ siteFit: { doorSwingRadius: -1 } }).success).toBe(
      false,
    );
  });
});
