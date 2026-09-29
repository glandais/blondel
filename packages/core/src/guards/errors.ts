/** Paramètres de garde-corps impossibles (message français repris dans `Model.errors`). */
export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}
