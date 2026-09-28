/**
 * Erreur de l'étape « Découpage » : paramètres impossibles (hauteurs, paliers).
 * Le message est en français, destiné à l'utilisateur (`Model.errors`).
 */
export class SteppingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SteppingError";
  }
}
