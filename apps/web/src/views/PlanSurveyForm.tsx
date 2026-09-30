/**
 * Relevé de trémie par 4 côtés + 2 diagonales (CHALLENGE P7, jalon 7) : saisie des six mesures,
 * aperçu du quadrilatère déduit par le cœur (`openingFromSurvey`) avec ses écarts, puis
 * application à la trémie du projet (une entrée d'historique, annulable).
 */
import {
  openingFromSurvey,
  SURVEY_MEASURES,
  SURVEY_TOLERANCE_DEFAULT,
  withOpeningPolygon,
  type OpeningSurvey,
  type SurveyMeasure,
  type SurveyResult,
  type Vec2,
} from "@blondel/core";
import { useEffect, useId, useMemo, useState } from "react";
import { msg, type Locale, type Message, type MessageKey, type Translator } from "@blondel/i18n";
import { formatNumber } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import { appStore, useApp } from "../store/appStore.js";

const LABELS: Readonly<Record<SurveyMeasure, MessageKey>> = {
  ab: "ui.plan.survey.measure.ab",
  bc: "ui.plan.survey.measure.bc",
  cd: "ui.plan.survey.measure.cd",
  da: "ui.plan.survey.measure.da",
  ac: "ui.plan.survey.measure.ac",
  bd: "ui.plan.survey.measure.bd",
};

const fmt = (v: number, locale: Locale, d = 0): string =>
  formatNumber(locale, v, { minimumFractionDigits: d, maximumFractionDigits: d });

/** Lecture d'une saisie en mm (virgule décimale acceptée) ; NaN si vide ou illisible. */
export function parseMm(text: string): number {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return Number.NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : Number.NaN;
}

/**
 * Limite du contrôle par la sixième mesure : plus grande erreur isolée qui passerait inaperçue,
 * dans le sens défavorable (`undetectable` de `openingFromSurvey`, et non `detectable`, plus
 * petit des deux sens, qui sous-estimerait l'angle mort sur un quadrilatère mal conditionné).
 */
export function blindSpot(
  result: Pick<Extract<SurveyResult, { ok: true }>, "undetectable">,
  t: Translator,
): string {
  const blind = result.undetectable;
  let worst: SurveyMeasure = SURVEY_MEASURES[0]!;
  for (const k of SURVEY_MEASURES) if (blind[k] > blind[worst]) worst = k;
  const limit = blind[worst];
  const label = t.t(LABELS[worst]).toLowerCase();
  return Number.isFinite(limit)
    ? t.t("ui.plan.survey.blindSpot", { limit: fmt(limit, t.locale), label })
    : t.t("ui.plan.survey.blindSpot.none", { label });
}

interface Props {
  /** Aperçu du quadrilatère sur le plan (null : aucun). */
  readonly onPreview: (points: readonly Vec2[] | null) => void;
}

export function PlanSurveyForm({ onPreview }: Props) {
  const id = useId();
  const t = useT();
  const opening = useApp((s) => s.project.site.opening);
  const [values, setValues] = useState<Record<SurveyMeasure, string>>({
    ab: "",
    bc: "",
    cd: "",
    da: "",
    ac: "",
    bd: "",
  });
  // A placé par défaut au coin de la trémie rectangulaire actuelle, sinon à l'origine.
  const [origin, setOrigin] = useState(() => ({
    x: opening?.kind === "rect" ? String(opening.x) : "0",
    y: opening?.kind === "rect" ? String(opening.y) : "0",
  }));
  const [angle, setAngle] = useState("0");
  const [orientation, setOrientation] = useState<"ccw" | "cw">("ccw");
  // Remarque d'application : message traduit à l'affichage, ou motif de refus du schéma.
  const [notice, setNotice] = useState<Message | null>(null);

  const measures = useMemo(
    () =>
      Object.fromEntries(
        SURVEY_MEASURES.map((k) => [k, parseMm(values[k])]),
      ) as unknown as OpeningSurvey,
    [values],
  );
  const complete = SURVEY_MEASURES.every((k) => Number.isFinite(measures[k]));
  const result: SurveyResult | null = useMemo(() => {
    if (!complete) return null;
    return openingFromSurvey(measures, {
      origin: { x: parseMm(origin.x) || 0, y: parseMm(origin.y) || 0 },
      angle: parseMm(angle) || 0,
      orientation,
    });
  }, [complete, measures, origin, angle, orientation]);

  useEffect(() => {
    onPreview(result?.ok ? result.points : null);
  }, [result, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const apply = (): void => {
    if (!result?.ok) return;
    const r = appStore.getState().update((p) => withOpeningPolygon(p, result.points));
    appStore.getState().endGroup();
    setNotice(
      r.ok ? msg("ui.plan.survey.applied") : (r.issues[0] ?? msg("ui.plan.survey.refused")),
    );
  };

  const field = (k: SurveyMeasure) => (
    <div className="field" key={k}>
      <label htmlFor={`${id}-${k}`}>{t.t(LABELS[k])}</label>
      <span className="input-unit">
        <input
          id={`${id}-${k}`}
          type="text"
          inputMode="decimal"
          value={values[k]}
          onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
        />
        <span className="input-unit__unit">mm</span>
      </span>
    </div>
  );

  return (
    <details className="plan-site__group" open>
      <summary>{t.t("ui.plan.survey.title")}</summary>
      <p className="muted">
        {t.t("ui.plan.survey.hint", {
          direction: msg(
            orientation === "ccw" ? "ui.plan.survey.direction.ccw" : "ui.plan.survey.direction.cw",
          ),
        })}
      </p>
      <div className="grid-2">{SURVEY_MEASURES.map(field)}</div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={`${id}-ox`}>{t.t("ui.plan.survey.originX")}</label>
          <input
            id={`${id}-ox`}
            type="text"
            inputMode="decimal"
            value={origin.x}
            onChange={(e) => setOrigin((o) => ({ ...o, x: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-oy`}>{t.t("ui.plan.survey.originY")}</label>
          <input
            id={`${id}-oy`}
            type="text"
            inputMode="decimal"
            value={origin.y}
            onChange={(e) => setOrigin((o) => ({ ...o, y: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-angle`}>{t.t("ui.plan.survey.angle")}</label>
          <input
            id={`${id}-angle`}
            type="text"
            inputMode="decimal"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-orient`}>{t.t("ui.plan.survey.orientation")}</label>
          <select
            id={`${id}-orient`}
            value={orientation}
            onChange={(e) => setOrientation(e.target.value === "cw" ? "cw" : "ccw")}
          >
            <option value="ccw">{t.t("ui.plan.survey.orientation.ccw")}</option>
            <option value="cw">{t.t("ui.plan.survey.orientation.cw")}</option>
          </select>
        </div>
      </div>
      {result === null ? (
        <p className="muted">{t.t("ui.plan.survey.incomplete")}</p>
      ) : !result.ok ? (
        <p className="notice notice--error" role="alert">
          {t.t("ui.plan.survey.impossible", { reason: result.reason })}
        </p>
      ) : (
        <div
          role="status"
          className={`notice ${result.consistent ? "notice--info" : "notice--error"}`}
        >
          <span>
            {result.consistent
              ? t.t("ui.plan.survey.consistent", {
                  residual: fmt(result.maxResidual, t.locale, 1),
                })
              : t.t("ui.plan.survey.inconsistent", {
                  residual: fmt(result.maxResidual, t.locale, 1),
                  tolerance: fmt(SURVEY_TOLERANCE_DEFAULT, t.locale),
                })}
          </span>
          <span>
            {t.t(result.convex ? "ui.plan.survey.angles" : "ui.plan.survey.angles.concave", {
              angles: result.angles.map((a) => `${fmt(a, t.locale, 1)}°`).join(", "),
            })}
          </span>
          <span>{blindSpot(result, t)}</span>
        </div>
      )}
      <div className="button-row">
        <button type="button" disabled={!result?.ok} onClick={apply}>
          {t.t("ui.plan.survey.apply")}
        </button>
      </div>
      {notice ? (
        <p className="muted" role="status">
          {t.t(notice)}
        </p>
      ) : null}
    </details>
  );
}
