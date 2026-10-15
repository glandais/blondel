/**
 * Remarque du contrôle de conception sur la tolérance d'identité des pièces repérées (décision
 * F10 (22)). Une pièce repérée est débitée sur le représentant de son repère (décision Q3,
 * `unifyMarkGroup`) : ses cotes, et donc ses perçages, peuvent s'écarter jusqu'à T
 * (`WorkshopProfile.identicalPartTolerance`) de sa place réelle. Quand T dépasse le jeu des
 * perçages (`FastenerProfile.holeClearance`, jeu au diamètre : Ø perçage − Ø nominal), un
 * perçage peut être décalé de plus que le jeu : la remarque invite à réduire T.
 *
 * Remarque et non règle de `rules.yaml` : les deux grandeurs sont des paramètres du profil
 * d'atelier « à valider », sans seuil sourcé. Émise seulement quand le modèle contient au moins
 * un repère porté par deux pièces percées ou plus (sinon la tolérance n'a pas d'effet sur un
 * perçage).
 */
import { dec, msg, type Message } from "@blondel/i18n";
import type { Part } from "../model/derived.js";
import type { Mm } from "../model/primitives.js";

/** Pièce percée : perçages comptés (`quantities.holes`) ou trous dans son développé. */
function drilled(p: Part): boolean {
  return (p.quantities["holes"] ?? 0) > 0 || (p.flat?.outline.holes.length ?? 0) > 0;
}

/** Un repère au moins porté par deux pièces percées ou plus. */
function hasSharedDrilledMark(parts: readonly Part[]): boolean {
  const seen = new Set<string>();
  for (const p of parts) {
    if (!drilled(p)) continue;
    const key = `${p.mark}|${p.material}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * Remarque « tolérance d'identité supérieure au jeu de perçage », ou `null`. Comparaison
 * stricte (`tolerance > clearance`). Ne lève jamais (grandeurs non finies : `null`).
 */
export function identicalToleranceNote(
  parts: readonly Part[],
  tolerance: Mm,
  clearance: Mm,
): Message | null {
  if (!Number.isFinite(tolerance) || !Number.isFinite(clearance)) return null;
  if (!(tolerance > clearance)) return null;
  if (!hasSharedDrilledMark(parts)) return null;
  return msg("compliance.note.identicalToleranceOverClearance", {
    tolerance: dec(tolerance, 3),
    clearance: dec(clearance, 3),
  });
}
