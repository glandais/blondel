import { MessageError, type Message } from "@blondel/i18n";

/**
 * Erreur de l'étape « Découpage » : paramètres impossibles (hauteurs, paliers).
 * Porte un `Message` (ADR-0007), repris tel quel dans `Model.errors` ; `message` en est la
 * traduction française.
 */
export class SteppingError extends MessageError {
  constructor(message: Message) {
    super(message);
    this.name = "SteppingError";
  }
}
