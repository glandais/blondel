import { MessageError, type Message } from "@blondel/i18n";

/**
 * Erreur de construction géométrique (données d'entrée dégénérées ou incohérentes). Porte un
 * `Message` (clés `geometry.*`, ADR-0007) ; `message` en est la traduction française.
 */
export class GeometryError extends MessageError {
  constructor(message: Message) {
    super(message);
    this.name = "GeometryError";
  }
}
