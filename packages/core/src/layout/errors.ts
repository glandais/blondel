import { MessageError, type Message } from "@blondel/i18n";

/**
 * Erreur de l'étape « Tracé » : paramètres impossibles ou topologie non prise en charge.
 * Porte un `Message` (ADR-0007), repris tel quel dans `Model.errors` ; `message` en est la
 * traduction française.
 */
export class LayoutError extends MessageError {
  constructor(message: Message) {
    super(message);
    this.name = "LayoutError";
  }
}
