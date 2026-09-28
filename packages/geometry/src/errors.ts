/** Erreur de construction géométrique (données d'entrée dégénérées ou incohérentes). */
export class GeometryError extends Error {
  override readonly name = "GeometryError";
}
