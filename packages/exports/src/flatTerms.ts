/**
 * Terme du développé selon la pièce (QUESTIONS A26 (a), décision du 2026-10-06) : en anglais,
 * « development » pour un limon bois (limon ou crémaillère en bois, `isWoodMaterial` du cœur),
 * « flat pattern » pour la tôle et l'acier (et toute autre pièce) ; en français, « Développé »
 * dans tous les cas (les clés « development » ont le même texte français que les clés
 * génériques). Point unique utilisé par le dossier PDF, les dessins SVG et l'interface.
 *
 * Les libellés génériques sans pièce (onglet, menu d'export, légende de la nomenclature) gardent
 * « flat pattern ».
 */
import { isWoodMaterial, type Part } from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import { tr, type Translator } from "./i18n.js";

/** Catégories de pièces dont le développé bois s'appelle « development » en anglais. */
const TIMBER_STRING_CATEGORIES: ReadonlySet<Part["category"]> = new Set(["stringer", "carriage"]);

/**
 * Le développé de la pièce est-il celui d'un limon bois (« development » en anglais) ? Limon
 * ou crémaillère en bois ; tout le reste (tôle, acier, poteau, marche) : « flat pattern ».
 */
export function isTimberDevelopment(part: Pick<Part, "category" | "material">): boolean {
  return TIMBER_STRING_CATEGORIES.has(part.category) && isWoodMaterial(part.material);
}

/** Clés de libellé du développé d'une pièce : « development » (limon bois) ou « flat pattern ». */
export interface FlatTermKeys {
  /** Titre du dessin SVG (« Développé LI1 »). */
  readonly drawingTitle: MessageKey;
  /** Titre de la page du dossier PDF (« Développé LI1 — Limon… »). */
  readonly pdfTitle: MessageKey;
  /** Libellé accessible du dessin dans l'interface (« Développé de la pièce LI1 »). */
  readonly viewLabel: MessageKey;
  /** Développé non calculable (« Développé indisponible : … »). */
  readonly unavailable: MessageKey;
  /** Bouton de l'inspecteur Pièce (« Développé »). */
  readonly action: MessageKey;
  /** Bulle du bouton (« Afficher le développé de LI1 (Fabrication) »). */
  readonly actionTitle: MessageKey;
  /** Bulle du bouton DXF (« Télécharger le développé de LI1 en DXF R12 »). */
  readonly dxfTitle: MessageKey;
  /** Titre du gabarit de la fiche pièce (« Gabarit coté du développé »). */
  readonly template: MessageKey;
}

const FLAT_PATTERN_KEYS: FlatTermKeys = {
  drawingTitle: "drawing.flat.title",
  pdfTitle: "pdf.flat.title",
  viewLabel: "ui.flat.drawing.label",
  unavailable: "ui.flat.unavailable",
  action: "ui.partInspector.action.flat",
  actionTitle: "ui.partInspector.action.flat.title",
  dxfTitle: "ui.partInspector.action.dxf.title",
  template: "ui.fab.sheet.template",
};

const DEVELOPMENT_KEYS: FlatTermKeys = {
  drawingTitle: "drawing.flat.titleDevelopment",
  pdfTitle: "pdf.flat.titleDevelopment",
  viewLabel: "ui.flat.drawing.labelDevelopment",
  unavailable: "ui.flat.unavailableDevelopment",
  action: "ui.partInspector.action.development",
  actionTitle: "ui.partInspector.action.development.title",
  dxfTitle: "ui.partInspector.action.dxf.titleDevelopment",
  template: "ui.fab.sheet.templateDevelopment",
};

/** Clés de libellé du développé de la pièce (pièce absente : « flat pattern »). */
export function flatTermKeys(part: Pick<Part, "category" | "material"> | undefined): FlatTermKeys {
  return part !== undefined && isTimberDevelopment(part) ? DEVELOPMENT_KEYS : FLAT_PATTERN_KEYS;
}

/** Titre du dessin SVG du développé d'une pièce (« Développé LI1 », « Development LI1 »). */
export function flatDrawingTitle(
  t: Translator,
  part: Pick<Part, "mark" | "category" | "material">,
): string {
  return t.t(flatTermKeys(part).drawingTitle, { mark: part.mark });
}

/** Titre de la page de développé d'une pièce dans le dossier PDF (« Développé LI1 — Limon… »). */
export function pdfFlatTitle(
  t: Translator,
  part: Pick<Part, "mark" | "name" | "category" | "material">,
): string {
  return t.t(flatTermKeys(part).pdfTitle, { mark: part.mark, name: tr(t, part.name) });
}
