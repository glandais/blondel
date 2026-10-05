/**
 * Bloc « Ligne de nez » de l'inspecteur Marche (maquette 2a, ADR-0009 point 4) : il remplace le
 * mode expert du plan. Pour le nez k qui porte la marche k + 1 :
 *
 * - « Angle » : écart à la perpendiculaire à la ligne de foulée (degrés, 0,1°), saisi et validé
 *   à Entrée ou à la perte de focus (Échap rétablit) → retouche « angle » ;
 * - en regard, l'angle calculé par le découpage avant retouche (`NosingLine.computedAngle`, à
 *   défaut l'angle courant) et la méthode de la zone balancée ;
 * - « Fixer le nez » (touche F) : retouche « nez fixe », bascule ;
 * - « Retirer la retouche » (touche Suppr) : retire les retouches de ce nez ;
 * - ← / → (Maj : 0,1°) quand la vue centrale a le focus ; une rafale de touches sur un même nez
 *   ne fait qu'une entrée d'historique (regroupement par nez) ;
 * - en pied, les retouches de l'escalier, nez par nez (lien vers la marche que porte le nez,
 *   « Retirer » pour chacune, y compris le nez d'arrivée qu'aucune marche ne porte), « Tout
 *   retirer », les orphelines et les remarques du découpage sur les lignes de nez.
 *
 * Chaque action est une entrée d'historique, annulable. Les angles affichés sont ceux du cœur
 * (`NosingLine.angle`, `computedAngle`) : un modèle qui ne les expose pas affiche « — ».
 */
import type { Model } from "@blondel/core";
import { msg, type Message } from "@blondel/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { formatNumber } from "../../i18n/locale.js";
import { useT } from "../../i18n/useT.js";
import { BALANCING_METHOD_LABELS } from "../../lib/balancingForm.js";
import {
  EXPERT_ANGLE_LIMIT_DEG,
  clampAngle,
  nosingEditAvailability,
  orphanOverrides,
  overrideLabel,
  overrideNotes,
  overridesAt,
  overridesByNosing,
  roundAngle,
  withAngleOverride,
  withFixedOverride,
  withoutNosingOverrides,
  zoneMethodLabel,
  zoneOfNosing,
} from "../../lib/nosingOverrides.js";
import { parseDecimal } from "../../lib/units.js";
import { appStore, useApp } from "../../store/appStore.js";
import type { UpdateResult } from "../../store/projectStore.js";
import { plainShortcut, type EscapeTarget } from "../escapeChain.js";
import { NumberField } from "../fields.js";

type Recipe = Parameters<ReturnType<typeof appStore.getState>["update"]>[0];

/** Modification ponctuelle : une entrée d'historique (groupes clos avant et après). */
function commit(recipe: Recipe): UpdateResult {
  const s = appStore.getState();
  s.endGroup();
  const r = s.update(recipe);
  s.endGroup();
  return r;
}

/** Motif d'un refus du store. */
function refusal(r: UpdateResult): Message | null {
  return r.ok ? null : (r.issues[0] ?? msg("ui.common.input.refused"));
}

/** Commandes de la vue qui gardent leurs flèches (onglets, segmentés, saisies, plan de site). */
const ARROW_OWNERS =
  "input, select, textarea, button, [role='tablist'], [role='radiogroup'], [role='toolbar'], .plan-site";

/** Les flèches visent-elles la ligne de nez (focus dans la vue, hors de ses commandes) ? */
export function arrowsTargetNosing(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return target.closest("#view-panel") !== null && target.closest(ARROW_OWNERS) === null;
}

/** Clé de regroupement d'historique d'une rafale de flèches sur le nez k. */
export const nosingArrowGroup = (k: number): string => `nosing-angle-${k}`;

export interface NosingLineBlockProps {
  readonly model: Model;
  /** Indice du nez (k = numéro de marche − 1). */
  readonly index: number;
}

export function NosingLineBlock({ model, index: k }: NosingLineBlockProps) {
  const t = useT();
  const project = useApp((s) => s.project);
  const [message, setMessage] = useState<Message | null>(null);
  const titleId = useId();
  const availability = nosingEditAvailability(model);
  const nosing = model.stepping.nosings[k];
  const own = overridesAt(project, k);
  const orphans = orphanOverrides(project, model);
  const notes = overrideNotes(model);
  const overrideCount = project.stair.nosingOverrides.length;
  const treadNumbers = new Set(model.stepping.treads.map((tr) => tr.number));

  // Modèle courant pour l'écouteur clavier (installé une fois par nez).
  const modelRef = useRef(model);
  modelRef.current = model;

  const report = (r: UpdateResult): void => {
    const why = refusal(r);
    setMessage(why ? msg("ui.inspector.tread.nosing.refused", { error: why }) : null);
  };

  const toggleFixed = (): void => {
    const fixed = overridesAt(appStore.getState().project, k).fixed;
    report(commit((p) => withFixedOverride(p, k, !fixed)));
  };
  const toggleRef = useRef(toggleFixed);
  toggleRef.current = toggleFixed;
  const removeOwn = (): void => {
    const own = overridesAt(appStore.getState().project, k);
    if (!own.fixed && own.angle === null) return;
    report(commit((p) => withoutNosingOverrides(p, [k])));
  };
  const removeRef = useRef(removeOwn);
  removeRef.current = removeOwn;

  useEffect(() => {
    if (!availability.ok) return;
    const onKey = (e: KeyboardEvent): void => {
      const app = appStore.getState();
      const target = e.target instanceof Element ? (e.target as EscapeTarget) : null;
      const keys = { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey };
      if (
        !plainShortcut({ ...keys, defaultPrevented: e.defaultPrevented, target }, app.assistantOpen)
      ) {
        return;
      }
      if ((e.key === "f" || e.key === "F") && !e.shiftKey) {
        e.preventDefault();
        toggleRef.current();
      } else if (e.key === "Delete") {
        e.preventDefault();
        removeRef.current();
      } else if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        arrowsTargetNosing(e.target)
      ) {
        const base =
          overridesAt(app.project, k).angle ?? modelRef.current.stepping.nosings[k]?.angle;
        if (base === undefined) return;
        e.preventDefault();
        const step = (e.shiftKey ? 0.1 : 1) * (e.key === "ArrowRight" ? 1 : -1);
        const angle = clampAngle(base + step);
        report(app.update((p) => withAngleOverride(p, k, angle), nosingArrowGroup(k)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      appStore.getState().endGroup();
    };
  }, [k, availability.ok]);

  const fmt = (a: number): string =>
    formatNumber(t.locale, a, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  if (!availability.ok) {
    return (
      <section className="insp-block nosing-line" aria-labelledby={titleId}>
        <h4 id={titleId} className="insp-block__title">
          {t.t("ui.inspector.tread.nosing.title")}
        </h4>
        <p className="nosing-line__unavailable" role="status">
          {t.t("ui.inspector.tread.nosing.unavailable", { reason: availability.reason })}
        </p>
      </section>
    );
  }

  const angle = nosing?.angle;
  const computed = nosing?.computedAngle ?? angle;
  const zone = zoneOfNosing(model.stepping, k);
  // Marche balancée dont le nez avant (k) précède la zone : la zone commence au nez suivant
  // (k + 1, arrière de la marche) ; le libellé le dit plutôt que « hors balancement » seul.
  const winder = model.stepping.treads.find((tr) => tr.number === k + 1)?.kind === "winder";
  const nextZone = zone || !winder ? undefined : zoneOfNosing(model.stepping, k + 1);
  const methodText = (m: string): string => {
    const label = zoneMethodLabel(m, BALANCING_METHOD_LABELS);
    return typeof label === "string" ? label : t.t(label);
  };
  const computedLabel = zone
    ? t.t("ui.inspector.tread.nosing.computedBy", { method: methodText(zone.method) })
    : nextZone
      ? t.t("ui.inspector.tread.nosing.computedBeforeZone", { method: methodText(nextZone.method) })
      : t.t("ui.inspector.tread.nosing.computedStraight");
  const hasOwn = own.fixed || own.angle !== null;

  return (
    <section className="insp-block nosing-line" aria-labelledby={titleId}>
      <h4 id={titleId} className="insp-block__title">
        {t.t("ui.inspector.tread.nosing.title")}
      </h4>
      {angle === undefined ? (
        <div className="nosing-line__row">
          <span className="nosing-line__label">{t.t("ui.inspector.tread.nosing.angle")}</span>
          <span className="nosing-line__value">—</span>
        </div>
      ) : (
        <div className="nosing-line__angle">
          <NumberField
            label={t.t("ui.inspector.tread.nosing.angle")}
            value={roundAngle(angle)}
            unit="°"
            min={-EXPERT_ANGLE_LIMIT_DEG}
            max={EXPERT_ANGLE_LIMIT_DEG}
            parse={parseDecimal}
            format={fmt}
            onCommit={(v) => {
              const r = commit((p) => withAngleOverride(p, k, roundAngle(v)));
              report(r);
              return r;
            }}
          />
        </div>
      )}
      <div className="nosing-line__row" data-computed>
        <span className="nosing-line__label">{computedLabel}</span>
        <span className="nosing-line__value">
          {computed === undefined ? "—" : `${fmt(computed)}°`}
        </span>
      </div>
      <div className="insp-actions">
        <button
          type="button"
          className="btn btn-secondary"
          aria-pressed={own.fixed}
          title={t.t("ui.inspector.tread.nosing.fix.title")}
          onClick={toggleFixed}
        >
          {t.t("ui.inspector.tread.nosing.fix")}{" "}
          <kbd aria-hidden="true">{t.t("ui.inspector.tread.nosing.fix.key")}</kbd>
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!hasOwn}
          title={t.t("ui.inspector.tread.nosing.remove.title")}
          onClick={removeOwn}
        >
          {t.t("ui.inspector.tread.nosing.remove")}
        </button>
      </div>
      {message ? (
        <p className="nosing-line__error" role="alert">
          {t.t(message)}
        </p>
      ) : null}
      <p className="nosing-line__keys">{t.t("ui.inspector.tread.nosing.keys")}</p>
      {overrideCount > 0 ? (
        <div className="nosing-line__row nosing-line__all">
          <span>{t.t("ui.inspector.tread.nosing.overrides", { count: overrideCount })}</span>
          <button
            type="button"
            className="link"
            onClick={() => report(commit((p) => withoutNosingOverrides(p)))}
          >
            {t.t("ui.inspector.tread.nosing.removeAll")}
          </button>
        </div>
      ) : null}
      {overrideCount > 0 ? (
        <ul className="nosing-line__list" aria-label={t.t("ui.inspector.tread.nosing.list.label")}>
          {overridesByNosing(project).map((g) => {
            const label = g.overrides.map((o) => overrideLabel(o, t.locale)).join(" ; ");
            // Le nez i porte la marche i + 1 ; le nez d'arrivée (et une orpheline) n'en porte pas.
            const tread = treadNumbers.has(g.index + 1) ? g.index + 1 : null;
            return (
              <li key={g.index} data-nosing={g.index} aria-current={g.index === k || undefined}>
                {tread === null ? (
                  <span className="nosing-line__entry">{label}</span>
                ) : (
                  <button
                    type="button"
                    className="link nosing-line__entry"
                    title={t.t("ui.lib.location.tread", { number: String(tread) })}
                    onClick={() =>
                      appStore.getState().select({ location: { kind: "tread", number: tread } })
                    }
                  >
                    {label}
                  </button>
                )}
                <button
                  type="button"
                  className="link"
                  aria-label={t.t("ui.inspector.tread.nosing.removeOne", { label })}
                  onClick={() => report(commit((p) => withoutNosingOverrides(p, [g.index])))}
                >
                  {t.t("ui.inspector.tread.nosing.removeShort")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {orphans.length > 0 ? (
        <div className="nosing-line__row nosing-line__orphans">
          <span>{t.t("ui.inspector.tread.nosing.orphans", { count: orphans.length })}</span>
          <button
            type="button"
            className="link"
            onClick={() =>
              report(commit((p) => withoutNosingOverrides(p, new Set(orphans.map((o) => o.index)))))
            }
          >
            {t.t("ui.inspector.tread.nosing.removeOrphans")}
          </button>
        </div>
      ) : null}
      {notes.length > 0 ? (
        <ul
          className="nosing-line__notes"
          aria-label={t.t("ui.inspector.tread.nosing.notes.label")}
        >
          {notes.map((n, i) => (
            <li key={i}>{t.t(n)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
