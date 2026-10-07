/**
 * Inspecteur « Règle » (maquette 2c, ADR-0009, vague 3), ouvert par une carte du contrôle, une
 * ligne des listes repliées, le badge ou une vue : la sélection porte la règle (`ruleId`) et la
 * localisation du résultat.
 *
 * Ordre de lecture de la maquette : quoi (sévérité, titre court, constat), combien (jauge mesuré
 * / attendu), où (étiquettes qui sélectionnent l'élément concerné), comment corriger
 * (corrections du cœur, annulables, et section du panneau libre), puis la provenance et la
 * référence (identifiant de la règle), enfin la surcharge (sévérité, justification obligatoire)
 * et la mention indicative.
 *
 * Lecture du rapport rendu par le cœur et des corrections proposées (`lib/fixes.ts`) : aucune
 * règle n'est évaluée ici ; la jauge n'est qu'une mise à l'échelle d'affichage (`ruleGauge`).
 */
import { ruleSourceText, ruleTitle, type Part, type RuleResult } from "@blondel/core";
import type { Message, MessageKey } from "@blondel/i18n";
import { CircleCheck, CircleDashed, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "../../i18n/useT.js";
import {
  SEVERITY_LABELS,
  findSelectedResult,
  ruleGauge,
  whereTargets,
  type WhereTarget,
} from "../../lib/compliance.js";
import { applyFixInStore, fixesFor, fixesForRule } from "../../lib/fixes.js";
import { ruleSection } from "../../lib/ruleSections.js";
import { formatMeasure } from "../../lib/units.js";
import { appStore, useApp, useModel } from "../../store/appStore.js";
import type { Selection } from "../../store/projectStore.js";
import { openSection } from "../../store/uiStore.js";
import { RAIL_LABEL_KEYS } from "../free/Rail.js";
import { getParam } from "../../lib/structureForm.js";
import { ParamInput, useStructureParamForm } from "../StructureSection.js";
import { Icon } from "../ui/Icon.js";
import { SEVERITY_ICONS } from "./RuleCard.js";
import {
  OverrideEditor,
  bounds,
  labelOf,
  resultMessage,
  useModelParts,
  useRuleOverride,
} from "./RuleResults.js";
import "./rule.css";

export interface RuleInspectorProps {
  /** Sélection d'une règle : `ruleId` défini, localisation du résultat. */
  readonly selection: Selection;
}

/**
 * Règles dont la justification se saisit dans l'inspecteur (spécification de contenu) : porte-à-
 * faux de l'hélicoïdal (A12) et double porte-à-faux / torsion du limon central (A29 n° 4), même
 * paramètre de plugin `cantileverJustification`.
 */
export const CANTILEVER_RULES: ReadonlySet<string> = new Set([
  "HELICOIDAL_PORTE_A_FAUX",
  "LIMON_CENTRAL_PORTE_A_FAUX",
]);

/**
 * Règle → paramètre de plugin (chemin) qui porte sa justification, saisie dans l'inspecteur :
 * porte-à-faux (`CANTILEVER_RULES` → `cantileverJustification`) et plis minces du lamellé-collé
 * cintré du limon central bois (SPEC Q10, `LAMELLE_PLIS_MINCES` → `laminationJustification`).
 * L'avertissement reste, la justification lui est jointe (A12).
 */
export const JUSTIFICATION_PARAMS: ReadonlyMap<string, string> = new Map([
  ...[...CANTILEVER_RULES].map((id): [string, string] => [id, "cantileverJustification"]),
  ["LAMELLE_PLIS_MINCES", "laminationJustification"],
]);

/** Statut affiché en surtitre : sévérité effective d'une violation, sinon le statut. */
function Eyebrow({ r }: { r: RuleResult }) {
  const t = useT();
  const [icon, label]: [LucideIcon, string] =
    r.status === "violation"
      ? [SEVERITY_ICONS[r.severity], t.t(SEVERITY_LABELS[r.severity])]
      : r.status === "ok"
        ? [CircleCheck, t.t("ui.ruleInspector.eyebrow.ok")]
        : [CircleDashed, t.t("ui.ruleInspector.eyebrow.notEvaluated")];
  return (
    <span
      className="insp-eyebrow rule-insp__status"
      data-status={r.status}
      data-severity={r.status === "violation" ? r.severity : undefined}
    >
      <Icon icon={icon} size={14} />
      {label}
    </span>
  );
}

/** Mesuré, attendu et jauge (barre du mesuré, repère vertical à la borne). */
function Gauge({ r }: { r: RuleResult }) {
  const t = useT();
  const unit = useApp((s) => s.displayUnit);
  if (r.measured === undefined) return null;
  const gauge = ruleGauge(r);
  const measured = formatMeasure(r.measured, r.unit, unit, t.locale);
  const expected = bounds(r, unit, t);
  return (
    <div className="rule-gauge" data-status={r.status} data-severity={r.severity}>
      <div className="rule-gauge__line">
        <span>
          {t.t("ui.ruleInspector.gauge.measured")} <b>{measured}</b>
        </span>
        {expected ? (
          <span className="rule-gauge__expected">
            {t.t("ui.ruleInspector.gauge.expected", { bounds: expected })}
          </span>
        ) : null}
      </div>
      {gauge ? (
        <div
          className="rule-gauge__bar"
          role="img"
          aria-label={t.t("ui.ruleInspector.gauge.label", { value: measured, bounds: expected })}
        >
          <span
            className="rule-gauge__fill"
            style={{ width: `${(gauge.fill * 100).toFixed(1)}%` }}
          />
          <span
            className="rule-gauge__marker"
            style={{ left: `${(gauge.marker * 100).toFixed(1)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Libellé d'une étiquette « Où ». */
function whereLabel(w: WhereTarget<Part>, t: ReturnType<typeof useT>): string {
  switch (w.kind) {
    case "tread":
      return t.t("ui.lib.location.tread", { number: String(w.number) });
    case "nosing":
      return t.t("ui.lib.location.nosing", { index: String(w.index) });
    case "part":
      return `${w.part.mark} ${t.t(w.part.name)}`;
    case "static":
      return t.t(w.label);
  }
}

/** « Où » : étiquettes qui sélectionnent l'élément (sans règle : inspecteur de l'élément). */
function Where({ r }: { r: RuleResult }) {
  const t = useT();
  const parts = useModelParts();
  const targets = whereTargets(r.location, parts);
  return (
    <div className="rule-insp__where">
      <span className="insp-section-title">{t.t("ui.ruleInspector.where")}</span>
      <ul className="rule-insp__tags">
        {targets.map((w, i) => (
          <li key={i}>
            {w.kind === "static" ? (
              <span className="tag tag-neutral">{whereLabel(w, t)}</span>
            ) : (
              <button
                type="button"
                className="tag tag-outline rule-insp__tag"
                onClick={() => appStore.getState().select({ location: w.location })}
              >
                {whereLabel(w, t)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * « Pour corriger » : corrections du cœur qui visent la règle (une entrée d'historique chacune,
 * annulable), proposées seulement pour le projet dont le modèle affiché est issu ; puis la
 * section du panneau libre où régler la cause. Masqué sans l'une ni l'autre.
 */
function Fixes({ ruleId }: { ruleId: string }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const { model, pending, project: modelProject } = useModel();
  const current = modelProject === project && !pending;
  const fixes = useMemo(
    () => (current && model ? fixesForRule(fixesFor(project, model), ruleId) : []),
    [current, model, project, ruleId],
  );
  const [failure, setFailure] = useState<Message | null>(null);
  const section = ruleSection(ruleId);
  if (fixes.length === 0 && section === null && failure === null) return null;
  return (
    <div className="rule-insp__fixes">
      <span className="insp-section-title">{t.t("ui.ruleInspector.fix.title")}</span>
      {fixes.map((f) => (
        <button
          key={f.id}
          type="button"
          className="btn btn-secondary rule-insp__fix"
          data-fix={f.id}
          title={t.t(f.reason)}
          onClick={() => setFailure(applyFixInStore(f))}
        >
          <span>{t.t(f.label)}</span>
          <span className="rule-insp__undoable">{t.t("ui.ruleInspector.fix.undoable")}</span>
        </button>
      ))}
      {section !== null ? (
        <button
          type="button"
          className="btn btn-ghost rule-insp__section"
          data-section={section}
          onClick={() => openSection(section)}
        >
          {t.t("ui.ruleInspector.fix.openSection", { section: t.t(RAIL_LABEL_KEYS[section]) })}
        </button>
      ) : null}
      {failure ? (
        <p className="field__error" role="alert">
          {t.t("ui.errors.failure", { reason: failure })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Nature d'une règle avec son explication (A-regles § 0.1 : réglementaire, normatif, métier),
 * une clé par valeur de `nature` de rules.yaml. Valeur inconnue : identifiant brut.
 */
export const NATURE_EXPLAINED_KEYS: Readonly<Record<string, MessageKey>> = {
  reglementaire: "ui.ruleInspector.nature.reglementaire",
  normatif: "ui.ruleInspector.nature.normatif",
  metier: "ui.ruleInspector.nature.metier",
};

/**
 * Fiabilité (confiance) d'une règle avec son explication (A-regles § 0.2 : élevée, moyenne,
 * faible), une clé par valeur de `confiance` de rules.yaml.
 */
export const CONFIDENCE_EXPLAINED_KEYS: Readonly<Record<string, MessageKey>> = {
  eleve: "ui.ruleInspector.confidence.eleve",
  moyen: "ui.ruleInspector.confidence.moyen",
  faible: "ui.ruleInspector.confidence.faible",
};

/** Nature, fiabilité, source, sévérité déclarée et déclassement, puis la référence. */
function Provenance({ r }: { r: RuleResult }) {
  const t = useT();
  // Source citée dans la langue de l'interface (QUESTIONS A26 (b)).
  const source = ruleSourceText(r, t);
  const rows: [string, string][] = [
    [t.t("ui.ruleInspector.meta.nature"), labelOf(NATURE_EXPLAINED_KEYS, r.nature, t)],
    [t.t("ui.ruleInspector.meta.confidence"), labelOf(CONFIDENCE_EXPLAINED_KEYS, r.confidence, t)],
    [
      t.t("ui.ruleInspector.meta.source"),
      r.secondarySource ? `${source} · ${t.t("ui.compliance.secondarySource")}` : source,
    ],
  ];
  if (r.declaredSeverity !== r.severity) {
    rows.push([t.t("ui.ruleInspector.meta.severity"), t.t(SEVERITY_LABELS[r.declaredSeverity])]);
  }
  if (r.downgradeReason) {
    rows.push([t.t("ui.ruleInspector.meta.downgrade"), t.t(r.downgradeReason)]);
  }
  return (
    <dl className="rule-insp__provenance">
      {rows.map(([k, v]) => (
        <div key={k} className="rule-insp__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      <div className="rule-insp__row">
        <dt>{t.t("ui.ruleInspector.meta.reference")}</dt>
        <dd>
          <code className="rule-insp__ref">{r.ruleId}</code>
        </dd>
      </div>
    </dl>
  );
}

/**
 * Justification jointe à une règle (porte-à-faux de l'hélicoïdal ou du limon central, plis
 * minces du lamellé-collé cintré) : même paramètre de plugin (`param`, `JUSTIFICATION_PARAMS`),
 * même validation et même historique que le panneau Structure. Rien si le plugin courant n'a pas
 * ce paramètre ou s'il ne s'applique pas au projet.
 */
function RuleJustification({ param }: { param: string }) {
  const t = useT();
  const form = useStructureParamForm();
  const field = form.fields.find((f) => f.path.join(".") === param);
  if (!field) return null;
  return (
    <div className="rule-insp__cantilever">
      <ParamInput
        field={field}
        value={getParam(form.params, field.path)}
        onCommit={form.onParam(field)}
      />
      {form.error ? (
        <span className="field__error" role="alert">
          {t.t(form.error)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Surcharge : formulaire ouvert d'emblée (maquette 2c), prérempli par la surcharge en cours.
 * Annuler (ou Échap sur une saisie en cours) le remet à son état initial sans le masquer.
 */
function Override({ ruleId }: { ruleId: string }) {
  const current = useRuleOverride(ruleId);
  const [resets, setResets] = useState(0);
  return (
    <OverrideEditor
      // Une nouvelle surcharge (ou sa levée) réinitialise le formulaire.
      key={`${resets}:${current ? `${current.severity}:${current.justification}` : "new"}`}
      ruleId={ruleId}
      current={current}
      onClose={() => setResets((n) => n + 1)}
    />
  );
}

/** Règle introuvable dans le rapport (disparue après un recalcul) : retour au projet. */
function Missing() {
  const t = useT();
  return (
    <div className="insp-template rule-insp rule-insp--missing">
      <p className="insp-subtitle">{t.t("ui.ruleInspector.missing")}</p>
      <button
        type="button"
        className="btn btn-secondary rule-insp__back"
        onClick={() => appStore.getState().select(null)}
      >
        {t.t("ui.ruleInspector.backToProject")}
      </button>
      <span className="insp-spacer" aria-hidden="true" />
      <p className="inspector-disclaimer">{t.t("ui.compliance.disclaimer")}</p>
    </div>
  );
}

export function RuleInspector({ selection }: RuleInspectorProps) {
  const t = useT();
  const { model } = useModel();
  const r = findSelectedResult(model?.compliance, selection);
  if (!r) return <Missing />;
  const justification = JUSTIFICATION_PARAMS.get(r.ruleId);
  return (
    <div
      className="insp-template rule-insp"
      data-rule={r.ruleId}
      data-status={r.status}
      aria-label={t.t("ui.ruleInspector.label", { ruleId: r.ruleId })}
      role="group"
    >
      <header className="insp-head">
        <Eyebrow r={r} />
        <h3 className="insp-title insp-title--rule">{t.t(ruleTitle(r.ruleId))}</h3>
        <p className="insp-subtitle rule-insp__finding">{resultMessage(r, t)}</p>
      </header>
      <Gauge r={r} />
      <Where r={r} />
      <Fixes ruleId={r.ruleId} />
      <Provenance r={r} />
      {justification === undefined ? null : <RuleJustification param={justification} />}
      <Override ruleId={r.ruleId} />
      <span className="insp-spacer" aria-hidden="true" />
      <p className="inspector-disclaimer">{t.t("ui.compliance.disclaimer")}</p>
    </div>
  );
}
