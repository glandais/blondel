/**
 * Onglet « Nomenclature » : pièces groupées par repère (mêmes lignes que la liste de débit CSV),
 * dimensions de débit, quantités, masses (`mass_kg` du cœur ; renvoi « * » pour une masse
 * calculée avec une masse volumique à valider, QUESTIONS A6) et totaux. Un clic sur une ligne sélectionne la pièce (surlignée
 * en 3D, affichée dans « Développés »).
 */
import type { Model } from "@blondel/core";
import { massNoteFor } from "@blondel/exports";
import { useMemo } from "react";
import { bomSummary, selectedPart } from "../lib/parts.js";
import { appStore, useApp, useModel } from "../store/appStore.js";

const dec = (digits: number) =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
const mm = dec(1);
const m3 = dec(4);
const kg = dec(1);

const fmt = (f: Intl.NumberFormat, v: number | undefined): string =>
  v === undefined || !Number.isFinite(v) ? "–" : f.format(v);

export function BomView({ model }: { model: Model }) {
  const selection = useApp((s) => s.selection);
  // Profil d'atelier du projet dont le modèle est issu : une masse volumique renseignée par
  // l'atelier n'est plus « à valider ».
  const { project } = useModel();
  const workshop = project?.workshop;
  const bom = useMemo(
    () => bomSummary(model.parts, massNoteFor(workshop)),
    [model.parts, workshop],
  );
  const noteMark = (note: string | undefined): string =>
    note === undefined ? "" : ` ${"*".repeat(bom.massNotes.indexOf(note) + 1)}`;
  const current = selectedPart(model, selection?.location);
  if (bom.lines.length === 0) {
    return (
      <div className="empty-view" role="status">
        <p>Aucune pièce dans le modèle.</p>
      </div>
    );
  }
  return (
    <div className="bom">
      <table>
        <caption>
          Nomenclature : {bom.count} pièce(s), {bom.lines.length} repère(s)
          {bom.withFlat > 0 ? `, ${bom.withFlat} à développé` : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col">Repère</th>
            <th scope="col">Désignation</th>
            <th scope="col">Matériau</th>
            <th scope="col">Section</th>
            <th scope="col" className="num">
              L (mm)
            </th>
            <th scope="col" className="num">
              l (mm)
            </th>
            <th scope="col" className="num">
              e (mm)
            </th>
            <th scope="col" className="num">
              Qté
            </th>
            <th scope="col" className="num">
              Volume (m³)
            </th>
            <th scope="col" className="num">
              Masse (kg)
            </th>
          </tr>
        </thead>
        <tbody>
          {bom.lines.map((l, i) => {
            const selected = current !== undefined && l.partIds.includes(current.id);
            const first = l.partIds[0];
            return (
              <tr
                key={`${l.mark}-${i}`}
                className={selected ? "is-selected" : undefined}
                aria-selected={selected}
              >
                <th scope="row">
                  <button
                    type="button"
                    className="link"
                    disabled={first === undefined}
                    onClick={() =>
                      first !== undefined &&
                      appStore.getState().select({ location: { kind: "part", partId: first } })
                    }
                  >
                    {l.mark}
                  </button>
                </th>
                <td>{l.name}</td>
                <td>{l.material}</td>
                <td>{l.section || "–"}</td>
                <td className="num">{fmt(mm, l.length)}</td>
                <td className="num">{fmt(mm, l.width)}</td>
                <td className="num">{fmt(mm, l.thickness)}</td>
                <td className="num">{l.quantity}</td>
                <td className="num">{fmt(m3, l.totalVolume)}</td>
                <td className="num" title={l.massNote}>
                  {fmt(kg, l.totalMass)}
                  {l.totalMass === undefined ? "" : noteMark(l.massNote)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={7}>
              Total
            </th>
            <td className="num">{bom.count}</td>
            <td className="num">{fmt(m3, bom.volume)}</td>
            <td
              className="num"
              title={
                bom.mass === undefined
                  ? "Masse non renseignée par le cœur pour au moins une pièce : jamais estimée ici"
                  : undefined
              }
            >
              {bom.mass === undefined ? "incomplet" : fmt(kg, bom.mass)}
            </td>
          </tr>
        </tfoot>
      </table>
      {bom.massNotes.length > 0 ? (
        <p className="muted bom__notes">
          {bom.massNotes.map((n, i) => `${"*".repeat(i + 1)} ${n}.`).join(" ")}
        </p>
      ) : null}
    </div>
  );
}
