/**
 * Erreur de l'étape « Tracé » : paramètres impossibles ou topologie non prise en charge.
 * Le message est en français, destiné à l'utilisateur (`Model.errors`).
 */
export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}
