import { MessageError, type Message } from "@blondel/i18n";

/**
 * Paramètres de garde-corps impossibles. Porte un `Message` (ADR-0007), repris tel quel dans
 * `Model.errors` ; `message` en est la traduction française.
 */
export class GuardError extends MessageError {
  constructor(message: Message) {
    super(message);
    this.name = "GuardError";
  }
}
