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
import { tr } from "../i18n/fr.js";
import { appStore, useApp } from "../store/appStore.js";

const LABELS: Readonly<Record<SurveyMeasure, string>> = {
  ab: "Côté AB",
  bc: "Côté BC",
  cd: "Côté CD",
  da: "Côté DA",
  ac: "Diagonale AC",
  bd: "Diagonale BD",
};

const fmt = (v: number, d = 0): string =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

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
): string {
  const blind = result.undetectable;
  let worst: SurveyMeasure = SURVEY_MEASURES[0]!;
  for (const k of SURVEY_MEASURES) if (blind[k] > blind[worst]) worst = k;
  const t = blind[worst];
  const label = LABELS[worst].toLowerCase();
  return Number.isFinite(t)
    ? `Limite du contrôle : une erreur isolée allant jusqu'à ${fmt(t)} mm sur la mesure « ${label} » peut ne pas être détectée ; la vérifier deux fois.`
    : `Limite du contrôle : une erreur sur la mesure « ${label} » ne peut pas être détectée ; la vérifier deux fois.`;
}

interface Props {
  /** Aperçu du quadrilatère sur le plan (null : aucun). */
  readonly onPreview: (points: readonly Vec2[] | null) => void;
}

export function PlanSurveyForm({ onPreview }: Props) {
  const id = useId();
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
  const [notice, setNotice] = useState<string | null>(null);

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
      r.ok ? "Trémie remplacée par le relevé (annulable)." : (r.issues[0] ?? "Relevé refusé."),
    );
  };

  const field = (k: SurveyMeasure) => (
    <div className="field" key={k}>
      <label htmlFor={`${id}-${k}`}>{LABELS[k]}</label>
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
      <summary>Relevé de trémie (4 côtés + 2 diagonales)</summary>
      <p className="muted">
        Coins A, B, C, D dans l'ordre,{" "}
        {orientation === "ccw" ? "sens trigonométrique" : "sens horaire"} vu de dessus ; A est placé
        au point ci-dessous, AB suit l'angle donné.
      </p>
      <div className="grid-2">{SURVEY_MEASURES.map(field)}</div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={`${id}-ox`}>A : X</label>
          <input
            id={`${id}-ox`}
            type="text"
            inputMode="decimal"
            value={origin.x}
            onChange={(e) => setOrigin((o) => ({ ...o, x: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-oy`}>A : Y</label>
          <input
            id={`${id}-oy`}
            type="text"
            inputMode="decimal"
            value={origin.y}
            onChange={(e) => setOrigin((o) => ({ ...o, y: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-angle`}>Direction de AB (°)</label>
          <input
            id={`${id}-angle`}
            type="text"
            inputMode="decimal"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-orient`}>Sens A → B → C</label>
          <select
            id={`${id}-orient`}
            value={orientation}
            onChange={(e) => setOrientation(e.target.value === "cw" ? "cw" : "ccw")}
          >
            <option value="ccw">Trigonométrique</option>
            <option value="cw">Horaire</option>
          </select>
        </div>
      </div>
      {result === null ? (
        <p className="muted">Saisir les six mesures.</p>
      ) : !result.ok ? (
        <p className="notice notice--error" role="alert">
          Relevé impossible : {tr(result.reason)}.
        </p>
      ) : (
        <div
          role="status"
          className={`notice ${result.consistent ? "notice--info" : "notice--error"}`}
        >
          <span>
            {result.consistent
              ? `Relevé cohérent : écart maximal ${fmt(result.maxResidual, 1)} mm.`
              : `Relevé incohérent : écart maximal ${fmt(result.maxResidual, 1)} mm (tolérance ${fmt(SURVEY_TOLERANCE_DEFAULT)} mm, à valider) — vérifier les mesures.`}
          </span>
          <span>
            Angles A, B, C, D : {result.angles.map((a) => `${fmt(a, 1)}°`).join(", ")}
            {result.convex ? "" : " (trémie non convexe)"}.
          </span>
          <span>{blindSpot(result)}</span>
        </div>
      )}
      <div className="button-row">
        <button type="button" disabled={!result?.ok} onClick={apply}>
          Remplacer la trémie par le relevé
        </button>
      </div>
      {notice ? (
        <p className="muted" role="status">
          {notice}
        </p>
      ) : null}
    </details>
  );
}
