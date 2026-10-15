/**
 * Partition des développés d'un modèle, commune au DXF (`exportPartsDxf`) et au dossier PDF
 * (pages de développés et gabarits) : convention C3 du chantier « attribution des repères »
 * (F10) — un même développé donne le même regroupement dans les deux sorties.
 *
 * Développés « identiques » : même repère et même matériau, puis même structure (sommets,
 * lignes, libellés et paramètres de `Message`) et nombres égaux à `GEOM_EPS` près (cotes en
 * mm, angles de pli en degrés), comparés sommet à sommet (`groupNear`, chantier
 * `stable-tiebreaks`) : deux développés que seul le bruit d'arrondi distingue ne forment qu'un
 * groupe ; deux pièces de même repère mais de développés différents (texte de référence
 * compris) en forment deux, jamais une fusion silencieuse.
 */
import { GEOM_EPS, type Part } from "@blondel/core";
import { groupNear, nearlyEqualDeep } from "./grouping.js";

/** Un développé distinct : la pièce qui le porte (première du groupe) et les pièces couvertes. */
export interface FlatPartGroup {
  readonly part: Part;
  readonly ids: string[];
}

/**
 * Groupes de développés identiques, dans l'ordre des pièces (pièces sans développé ignorées) ;
 * la partition ne dépend pas de l'ordre d'entrée.
 */
export function flatPartGroups(parts: readonly Part[]): FlatPartGroup[] {
  return groupNear(
    parts.filter((part) => part.flat !== undefined),
    (part) => JSON.stringify([part.mark, part.material]),
    (a, b) => nearlyEqualDeep(a.flat, b.flat, GEOM_EPS),
  ).map((g) => ({ part: g[0]!, ids: g.map((p) => p.id) }));
}
