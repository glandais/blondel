/**
 * Section « Gabarits des jarrets » du dossier PDF (limon coudé des profilés, QUESTIONS A41,
 * convention CK17, sous-lot K2d) : liste des jarrets de chaque limon fait de tronçons soudés
 * au marbre (`Part.jig`), avec le repère du limon, le numéro du jarret, l'abscisse horizontale
 * du sommet de rive haute depuis l'extrémité basse, la cote de la rive haute au-dessus du sol fini
 * et les pentes des tronçons avant et après le jarret. Mêmes cotes que la remarque
 * `structure.steelProfile.note.jigDimensions`.
 *
 * Aucune page sans jarret : les dossiers des autres structures sont inchangés. Le chapeau rappelle
 * que la préfabrication au marbre est une convention Blondel à valider.
 */
import type { Model } from "@blondel/core";
import { formatIn } from "../format.js";
import type { Translator } from "../i18n.js";
import { pagedTitle, tablePages, type Frame, type PageDraft } from "./layout.js";

/** Ligne de la liste des jarrets (unités du modèle : mm, radians). */
interface JigRow {
  readonly mark: string;
  readonly partId: string;
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly before: number;
  readonly after: number;
}

/** Lignes de la liste, dans l'ordre des pièces du modèle puis des jarrets (du bas vers le haut). */
function jigRows(model: Pick<Model, "parts">): JigRow[] {
  return model.parts.flatMap((p) =>
    (p.jig ?? []).map((k) => ({
      mark: p.mark,
      partId: p.id,
      index: k.index,
      x: k.x,
      z: k.z,
      before: k.before,
      after: k.after,
    })),
  );
}

const deg = (a: number): number => (a * 180) / Math.PI;

/** Pages de la section (vide sans jarret) ; `info` décrit chaque page pour l'appelant. */
export function jigPages<Info>(
  model: Pick<Model, "parts">,
  frame: Frame,
  t: Translator,
  info: (title: string, partIds: readonly string[]) => Info,
): PageDraft<Info>[] {
  const rows = jigRows(model);
  if (rows.length === 0) return [];
  const mm = (v: number): string => formatIn(t, v, { decimals: 0 });
  const angle = (v: number): string => formatIn(t, deg(v), { decimals: 1 });
  const draws = tablePages(
    {
      columns: [
        { title: t.t("pdf.jigs.col.string"), weight: 14, align: "left" },
        { title: t.t("pdf.jigs.col.knee"), weight: 10, align: "right" },
        { title: t.t("pdf.jigs.col.abscissa"), weight: 28, align: "right" },
        { title: t.t("pdf.jigs.col.topEdge"), weight: 28, align: "right" },
        { title: t.t("pdf.jigs.col.slopes"), weight: 30, align: "right" },
      ],
      rows: rows.map((r) => ({
        cells: [
          r.mark,
          String(r.index),
          mm(r.x),
          mm(r.z),
          t.t("pdf.jigs.slopes", { before: angle(r.before), after: angle(r.after) }),
        ],
      })),
      empty: t.t("pdf.jigs.empty"),
      intro: [t.t("pdf.jigs.intro")],
    },
    frame,
  );
  const title = t.t("pdf.jigs.title");
  const partIds = [...new Set(rows.map((r) => r.partId))];
  return draws.map((draw, i) => ({
    info: info(pagedTitle(t, title, i + 1, draws.length), partIds),
    tocTitle: title,
    draw,
  }));
}
