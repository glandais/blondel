/**
 * Liste à cocher des valeurs ◆ « à valider » du projet (ADR-0009 point 9) : onglet « À valider »
 * du mode Fabrication (`full`, tableau) et étape 7 du parcours guidé (`compact`, liste sans
 * colonne Section).
 *
 * Une ligne par valeur ◆ effective : case « Valider : {libellé} » (désactivée si la valeur n'est
 * pas calculable), paramètre, valeur avec son unité, section, lien « Ouvrir » vers le champ :
 * panneau de la section en Conception (libre) ou formulaire de l'étape (guidé), repli déplié,
 * focus ; en guidé imposé (< 760 px), un réglage sans étape guidée affiche à la place que le
 * libre n'est disponible qu'à partir de 760 px. Cocher, décocher et « Tout valider » passent par
 * `setValuesValidated` du projectStore : une entrée d'historique, annulable. La validation est
 * enregistrée dans le projet avec la valeur effective : elle devient caduque si la valeur change.
 * Aucun calcul métier : les lignes viennent de `lib/toValidate.ts`. Le glyphe ◆ n'entre dans
 * aucun nom accessible (titre de la région « Valeurs à valider », cases, compteur : `TvMark`).
 */
import { useId } from "react";
import { useT } from "../../i18n/useT.js";
import { SECTION_TITLE_KEYS } from "../../lib/sectionIds.js";
import {
  formatToValidateValue,
  pendingValidationEntries,
  validationEntry,
  type ToValidateRow,
} from "../../lib/toValidate.js";
import { guidedStepOfRow } from "../../lib/guidedSteps.js";
import { appStore, useJourney } from "../../store/appStore.js";
import { openParam } from "../../store/uiStore.js";
import { TvMark } from "../ui/TvMark.js";
import { focusParamField } from "./focusParam.js";
import { useToValidateRows } from "./useToValidate.js";
import "./toValidate.css";

/**
 * Ouvre la section de la valeur (`openParam` : libre, panneau de la section en Conception ;
 * guidé, étape du paramètre, ou panneau libre pour un réglage absent du guidé) et mène à son
 * champ (repli déplié, focus).
 */
function openField(row: ToValidateRow): void {
  openParam(row);
  focusParamField(row.key);
}

function setValidated(row: ToValidateRow, validated: boolean): void {
  const entry = validationEntry(row);
  if (entry !== null) appStore.getState().setValuesValidated([entry], validated);
}

function Row({ row, compact }: { readonly row: ToValidateRow; readonly compact: boolean }) {
  const t = useT();
  const label = t.t(row.label);
  const section = t.t(SECTION_TITLE_KEYS[row.section]);
  const Cell = compact ? "span" : "td";
  // Guidé imposé (fenêtre étroite) : un réglage sans étape guidée (M6…) n'est atteignable que
  // dans le libre, indisponible ici ; « Ouvrir » laisse place à l'explication.
  const narrow = useJourney((s) => s.guidedImposed && s.journey === "guided");
  const unreachable = narrow && guidedStepOfRow(row) === null;
  return (
    <>
      <Cell className="tv-list__check">
        <input
          type="checkbox"
          checked={row.validated}
          disabled={row.value === undefined}
          aria-label={t.t("ui.toValidate.validate", { label })}
          onChange={(e) => setValidated(row, e.currentTarget.checked)}
        />
      </Cell>
      <Cell className="tv-list__label">
        {row.validated ? null : (
          <>
            <TvMark silent />{" "}
          </>
        )}
        {label}
      </Cell>
      <Cell className="tv-list__value num">{formatToValidateValue(row, t)}</Cell>
      {compact ? null : <Cell className="tv-list__section">{section}</Cell>}
      <Cell className="tv-list__open">
        {unreachable ? (
          <small className="muted tv-list__narrow">{t.t("ui.topbar.journey.freeNarrow")}</small>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={t.t("ui.toValidate.openLabel", { label, section })}
            onClick={() => openField(row)}
          >
            {t.t("ui.toValidate.open")}
          </button>
        )}
      </Cell>
    </>
  );
}

export function ToValidateList(props: { readonly variant?: "full" | "compact" }) {
  const compact = props.variant === "compact";
  const t = useT();
  const rows = useToValidateRows();
  const remaining = rows.filter((r) => !r.validated).length;
  const pending = pendingValidationEntries(rows);
  const titleId = useId();
  return (
    <section
      className={`tv-list tv-list--${compact ? "compact" : "full"}`}
      aria-labelledby={titleId}
    >
      <header className="tv-list__head">
        {/* Titre visible « Valeurs ◆ à valider » ; nom accessible sans glyphe. */}
        <h2 id={titleId} className="tv-list__title">
          <span aria-hidden="true">{t.t("ui.toValidate.title")}</span>
          <span className="visually-hidden">{t.t("ui.toValidate.heading")}</span>
        </h2>
        {/* Projet sans valeur ◆ : ni compte (« toutes validées » contredirait « aucune valeur »),
            ni « Tout valider », ni consigne ; seul le message du corps reste. */}
        <span className="tv-list__count num" role="status">
          {rows.length === 0 ? null : remaining > 0 ? (
            <>
              <TvMark silent tone="inherit" />{" "}
              {t.t("ui.toValidate.remaining", { count: remaining })}
            </>
          ) : (
            t.t("ui.toValidate.allValidated")
          )}
        </span>
        {rows.length === 0 ? null : (
          <button
            type="button"
            className="btn btn-secondary tv-list__all"
            disabled={pending.length === 0}
            onClick={() => appStore.getState().setValuesValidated(pending, true)}
          >
            {t.t("ui.toValidate.validateAll")}
          </button>
        )}
      </header>
      {rows.length === 0 ? null : (
        <p className="tv-list__hint muted">{t.t("ui.toValidate.hint")}</p>
      )}
      {rows.length === 0 ? (
        <p className="tv-list__empty muted">{t.t("ui.toValidate.noneInProject")}</p>
      ) : compact ? (
        <ul className="tv-list__items">
          {rows.map((row) => (
            <li
              key={row.key}
              className={row.validated ? "tv-list__row is-validated" : "tv-list__row"}
            >
              <Row row={row} compact />
            </li>
          ))}
        </ul>
      ) : (
        <table className="tv-list__table">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">{t.t("ui.toValidate.col.validated")}</span>
              </th>
              <th scope="col">{t.t("ui.toValidate.col.param")}</th>
              <th scope="col">{t.t("ui.toValidate.col.value")}</th>
              <th scope="col">{t.t("ui.toValidate.col.section")}</th>
              <th scope="col">
                <span className="visually-hidden">{t.t("ui.toValidate.open")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.validated ? "is-validated" : undefined}>
                <Row row={row} compact={false} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
