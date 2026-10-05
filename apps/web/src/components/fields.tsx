/**
 * Champs de saisie accessibles (label associé, message d'erreur annoncé). Les saisies au clavier
 * sont appliquées à la validation (Entrée ou perte de focus), les choix discrets tout de suite. Les longueurs se
 * saisissent en mm entiers (ADR-0003) ; la validation métier reste celle du schéma du cœur,
 * appliquée par le store (une valeur refusée affiche le message sans modifier le projet).
 */
import { msg, type Message, type Translator } from "@blondel/i18n";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatNumber, numberFormat } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import {
  decideDraft,
  parseIntMm,
  type IntFieldBounds,
  type ParseNumberResult,
} from "../lib/units.js";
import { appStore } from "../store/appStore.js";
import type { UpdateResult } from "../store/projectStore.js";
import "./fields.css";

function endGroup(): void {
  appStore.getState().endGroup();
}

interface FieldShellProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | null | undefined;
  /**
   * Message transitoire d'une saisie refusée puis rétablie à la perte de focus : la valeur
   * affichée est valide, le champ n'est donc **pas** marqué invalide (annoncé comme statut).
   */
  readonly note?: string | null | undefined;
  readonly children: ReactNode;
}

function FieldShell({ id, label, hint, error, note, children }: FieldShellProps) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {note && !error ? (
        <small id={`${id}-note`} className="field__note" role="status">
          {note}
        </small>
      ) : null}
      {hint && !error ? (
        <small id={`${id}-hint`} className="field__hint">
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={`${id}-error`} className="field__error" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}

function describedBy(
  id: string,
  hint: string | undefined,
  error: string | null,
  note: string | null = null,
): string | undefined {
  if (error) return `${id}-error`;
  const ids = [note ? `${id}-note` : null, hint ? `${id}-hint` : null].filter((x) => x !== null);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** Message d'une saisie refusée dont la valeur précédente a été rétablie. */
export function revertedNote(error: Message, t: Translator): string {
  return t.t("ui.common.input.reverted", { error: t.t(error).replace(/\.$/, "") });
}

/** Premier motif de refus du store (traduit à l'affichage), ou « Valeur refusée. ». */
function refusal(issues: readonly Message[]): Message {
  return issues[0] ?? msg("ui.common.input.refused");
}

export interface IntFieldProps extends IntFieldBounds {
  readonly label: string;
  readonly value: number;
  /** Unité affichée à droite du champ (défaut : mm). */
  readonly unit?: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onCommit: (value: number) => UpdateResult;
}

export interface NumberFieldProps extends IntFieldProps {
  /** Lecture de la saisie (défaut : mm entiers). */
  readonly parse?: (text: string, bounds: IntFieldBounds) => ParseNumberResult;
  /** Mise en forme de la valeur dans le champ (défaut : `String`). */
  readonly format?: (value: number) => string;
}

/**
 * Champ numérique appliqué **à la validation** (Entrée ou perte de focus), pas à chaque frappe :
 * le pipeline n'est jamais appelé sur une valeur intermédiaire (« 2 », « 27 »… en tapant
 * 2 700) et chaque validation est une seule entrée d'historique. La saisie est vérifiée à la
 * frappe (message affiché), Échap revient à la valeur du projet.
 */
export function NumberField({
  label,
  value,
  unit = "mm",
  hint,
  min,
  max,
  disabled,
  onCommit,
  parse = parseIntMm,
  format = String,
}: NumberFieldProps) {
  const id = useId();
  const t = useT();
  const [draft, setDraft] = useState(format(value));
  const [error, setError] = useState<Message | null>(null);
  /** Motif d'une saisie refusée puis rétablie (message transitoire). */
  const [note, setNote] = useState<Message | null>(null);
  const [focused, setFocused] = useState(false);

  // Valeur modifiée ailleurs (annuler, préréglage) ou langue changée (séparateur décimal) :
  // resynchroniser hors saisie.
  useEffect(() => {
    if (!focused) setDraft(format(value));
    // `format` : fonction de présentation recréée à chaque rendu ; la langue suffit.
  }, [value, focused, t.locale]);
  // Nouvelle valeur du projet hors saisie : l'ancien message ne la concerne plus.
  useEffect(() => {
    if (!focused) {
      setError(null);
      setNote(null);
    }
  }, [value]);

  const bounds: IntFieldBounds = {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
  const read = (text: string) => parse(text, bounds);

  /**
   * Applique la saisie ; `revert` : revenir à la valeur du projet si elle est refusée (le champ
   * redevient valide, le refus reste signalé par un message transitoire, sans `aria-invalid`).
   */
  const validate = (revert: boolean): void => {
    const d = decideDraft(draft, value, read);
    let refused: Message;
    if (d.kind === "commit") {
      const u = onCommit(d.value);
      endGroup();
      if (u.ok) {
        setError(null);
        setNote(null);
        return;
      }
      refused = refusal(u.issues);
    } else if (d.kind === "invalid") {
      refused = d.error;
    } else {
      setError(null);
      return;
    }
    if (revert) {
      setDraft(format(value));
      setError(null);
      setNote(refused);
    } else {
      setError(refused);
      setNote(null);
    }
  };
  const errorText = error ? t.t(error) : null;
  const noteText = note ? revertedNote(note, t) : null;

  return (
    <FieldShell id={id} label={label} hint={hint} error={errorText} note={noteText}>
      <span className="input-unit">
        <input
          id={id}
          type="text"
          inputMode={parse === parseIntMm ? "numeric" : "decimal"}
          autoComplete="off"
          value={draft}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, errorText, noteText)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            validate(true);
            setFocused(false);
          }}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            setNote(null);
            const r = read(text);
            setError(r.ok ? null : r.error);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              validate(false);
            } else if (e.key === "Escape") {
              setDraft(format(value));
              setError(null);
              setNote(null);
            }
          }}
        />
        {unit ? (
          <span className="input-unit__unit" aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </span>
    </FieldShell>
  );
}

/** Champ entier (mm par défaut), appliqué à la validation. */
export function IntField(props: IntFieldProps) {
  return <NumberField {...props} />;
}

export interface AutoIntFieldProps extends IntFieldBounds {
  readonly label: string;
  readonly value: number | "auto";
  /**
   * Valeur réellement retenue par le calcul en mode Auto, lue dans le modèle rendu par le cœur
   * (ex. `model.stepping.riserCount`). Affichée à côté d'« Auto » ; un clic dessus l'impose.
   * Absente (le modèle ne l'expose pas) : un libellé neutre « calculé » est affiché, jamais un
   * chiffre qui ne serait pas celui du calcul.
   */
  readonly computed?: number | undefined;
  /**
   * Valeur proposée au passage en « Imposer » quand `computed` est absente (point de départ de
   * la saisie, jamais affiché comme valeur calculée).
   */
  readonly fallback: number;
  readonly unit?: string;
  readonly hint?: string;
  readonly onCommit: (value: number | "auto") => UpdateResult;
  /**
   * Le mode automatique est-il possible ici (défaut : oui) ? S'il ne l'est pas, la case ne peut
   * qu'être décochée (sortie d'un `auto` devenu invalide).
   */
  readonly autoAllowed?: boolean;
  /** Explication affichée quand le mode automatique n'est pas possible. */
  readonly autoHint?: string;
  /**
   * Texte affiché en mode Auto à la place de la valeur calculée (ex. « 15 hauteurs calculées ») ;
   * pris en compte seulement avec `computed`. Défaut : `computed` mis en forme dans la langue,
   * suivi de l'unité.
   */
  readonly autoText?: string | undefined;
}

/**
 * Champ entier « Auto | Imposer » (un seul contrôle segmenté, ADR-0009). En mode Auto, la
 * valeur calculée par le modèle (`computed`) s'affiche à côté : un clic dessus (ou sur
 * « Imposer ») la fixe et place le focus dans le champ ; sans valeur calculée exposée, un
 * libellé neutre la remplace et « Imposer » part de `fallback`. « Auto » rend la main au calcul.
 * Chaque bascule est une entrée d'historique (annulable) ; la saisie imposée suit `IntField`
 * (mm entiers, Entrée ou perte de focus valide, Échap rétablit).
 */
export function AutoIntField(props: AutoIntFieldProps) {
  const { label, value, computed, unit = "mm", hint, min, max, onCommit, autoHint } = props;
  const known = computed !== undefined && Number.isFinite(computed);
  // Valeur imposée au sortir du mode Auto : celle du calcul si elle est connue.
  const proposed = known ? computed : props.fallback;
  const autoAllowed = props.autoAllowed ?? true;
  const labelId = useId();
  const helpId = useId();
  const t = useT();
  const [error, setError] = useState<Message | null>(null);
  /** Valeur venant d'être imposée : le focus passe dans le champ dès qu'il est affiché. */
  const [focusPending, setFocusPending] = useState(false);
  const inputBox = useRef<HTMLSpanElement>(null);
  const isAuto = value === "auto";

  useEffect(() => {
    if (!focusPending || isAuto) return;
    inputBox.current?.querySelector("input")?.focus();
    setFocusPending(false);
  }, [focusPending, isAuto]);

  const commit = (next: number | "auto"): void => {
    const r = onCommit(next);
    endGroup();
    setError(r.ok ? null : refusal(r.issues));
    if (r.ok && next !== "auto") setFocusPending(true);
  };

  const computedText = known
    ? `${formatNumber(t.locale, computed, { maximumFractionDigits: 0 })}${unit ? ` ${unit}` : ""}`
    : undefined;
  // Aide : celle de l'appelant, puis le retour à Auto (ou pourquoi Auto est impossible).
  const help = [
    hint,
    !autoAllowed ? autoHint : isAuto ? undefined : t.t("ui.common.input.autoBack"),
  ]
    .filter((x): x is string => x !== undefined && x !== "")
    .join(" ");

  return (
    <div className="auto-int">
      <span id={labelId} className="auto-int__label">
        {label}
      </span>
      <div className="auto-int__row">
        <span
          className="seg"
          role="group"
          aria-labelledby={labelId}
          aria-describedby={isAuto && help !== "" ? helpId : undefined}
        >
          <button
            type="button"
            className="seg-opt"
            aria-pressed={isAuto}
            aria-label={t.t("ui.common.input.automatic", { label })}
            disabled={!autoAllowed && !isAuto}
            title={!autoAllowed ? autoHint : undefined}
            onClick={() => {
              if (!isAuto) commit("auto");
            }}
          >
            {t.t("ui.common.input.auto")}
          </button>
          <button
            type="button"
            className="seg-opt"
            aria-pressed={!isAuto}
            onClick={() => {
              if (isAuto) commit(proposed);
            }}
          >
            {t.t("ui.common.input.impose")}
          </button>
        </span>
        {isAuto && computedText !== undefined ? (
          <button
            type="button"
            className="auto-int__value num"
            title={t.t("ui.common.input.imposeValue", { label, value: computedText })}
            aria-label={t.t("ui.common.input.imposeValue", { label, value: computedText })}
            onClick={() => commit(proposed)}
          >
            {props.autoText ?? computedText}
          </button>
        ) : isAuto ? (
          <span className="auto-int__value auto-int__value--neutral">
            {t.t("ui.common.input.computed")}
          </span>
        ) : (
          <span ref={inputBox} className="auto-int__input">
            <IntField
              label={label}
              value={value}
              unit={unit}
              {...(help === "" ? {} : { hint: help })}
              {...(min === undefined ? {} : { min })}
              {...(max === undefined ? {} : { max })}
              onCommit={onCommit}
            />
          </span>
        )}
      </div>
      {isAuto && help !== "" ? (
        <small id={helpId} className="field__hint">
          {help}
        </small>
      ) : null}
      {error ? (
        <small className="field__error" role="alert">
          {t.t(error)}
        </small>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps<V extends string> {
  readonly label: string;
  readonly value: V;
  readonly options: readonly { readonly value: V; readonly label: string }[];
  readonly hint?: string;
  readonly onCommit: (value: V) => UpdateResult;
}

export function SelectField<V extends string>({
  label,
  value,
  options,
  hint,
  onCommit,
}: SelectFieldProps<V>) {
  const id = useId();
  const t = useT();
  const [error, setError] = useState<Message | null>(null);
  const errorText = error ? t.t(error) : null;
  return (
    <FieldShell id={id} label={label} hint={hint} error={errorText}>
      <select
        id={id}
        value={value}
        aria-describedby={describedBy(id, hint, errorText)}
        onChange={(e) => {
          const r = onCommit(e.target.value as V);
          setError(r.ok ? null : refusal(r.issues));
          endGroup();
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export interface CheckFieldProps {
  readonly label: string;
  readonly checked: boolean;
  readonly title?: string;
  /** Description affichée sous la case (reliée par `aria-describedby`). */
  readonly hint?: string;
  readonly onCommit: (checked: boolean) => UpdateResult;
}

export function CheckField({ label, checked, title, hint, onCommit }: CheckFieldProps) {
  const id = useId();
  const box = (
    <div className="check" title={title}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onChange={(e) => {
          onCommit(e.target.checked);
          endGroup();
        }}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
  if (hint === undefined) return box;
  return (
    <div className="check-field">
      {box}
      <small id={`${id}-hint`} className="field__hint check-field__hint">
        {hint}
      </small>
    </div>
  );
}

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly type?: "text" | "date";
  readonly hint?: string;
  readonly onCommit: (value: string) => UpdateResult;
}

export function TextField({ label, value, type = "text", hint, onCommit }: TextFieldProps) {
  const id = useId();
  const t = useT();
  const [error, setError] = useState<Message | null>(null);
  /** Motif d'un texte refusé puis rétabli (message transitoire). */
  const [note, setNote] = useState<Message | null>(null);
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  useEffect(() => {
    if (!focused) {
      setError(null);
      setNote(null);
    }
  }, [value]);
  /**
   * Applique le texte ; `revert` (perte de focus) : un refus rétablit la valeur du projet (effet
   * ci-dessus) et n'est plus qu'un message transitoire.
   */
  const commit = (text: string, revert: boolean): void => {
    if (text === value) {
      setError(null);
      return;
    }
    const r = onCommit(text);
    endGroup();
    if (r.ok) {
      setError(null);
      setNote(null);
      return;
    }
    const refused = refusal(r.issues);
    if (revert) {
      setError(null);
      setNote(refused);
    } else {
      setError(refused);
      setNote(null);
    }
  };
  const errorText = error ? t.t(error) : null;
  const noteText = note ? revertedNote(note, t) : null;
  // Texte : appliqué à la validation (Entrée, perte de focus) ; date : choix discret, appliqué
  // tout de suite.
  return (
    <FieldShell id={id} label={label} hint={hint} error={errorText} note={noteText}>
      <input
        id={id}
        type={type}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, errorText, noteText)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          commit(draft, true);
          setFocused(false);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setNote(null);
          if (type === "date") commit(e.target.value, false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft, false);
          else if (e.key === "Escape") {
            setDraft(value);
            setError(null);
            setNote(null);
          }
        }}
      />
    </FieldShell>
  );
}

export interface RangeFieldProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Unité affichée après la valeur (ex. « ° », « girons »). */
  readonly unit?: string;
  readonly hint?: string;
  /** Mise en forme de la valeur affichée (défaut : décimale dans la langue d'affichage). */
  readonly format?: (value: number) => string;
  /**
   * Applique la valeur ; appelé à chaque déplacement du curseur avec une clé de regroupement
   * **collante** (un geste = une entrée d'historique, close au relâchement).
   */
  readonly onChange: (value: number, groupKey: string) => UpdateResult;
  /** Bouton « Valeur par défaut » (retire la valeur du projet) ; absent : pas de bouton. */
  readonly onReset?: () => UpdateResult;
  /** La valeur affichée est-elle la valeur par défaut du cœur (non saisie) ? */
  readonly isDefault?: boolean;
}

const RANGE_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 2 };

/**
 * Curseur borné (`input type=range`, flèches du clavier comprises) avec la valeur affichée. Les
 * bornes viennent de l'appelant (schéma du cœur, borne rendue par le modèle) ; une valeur
 * refusée par le store est signalée sans modifier le projet.
 */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  hint,
  format,
  onChange,
  onReset,
  isDefault = false,
}: RangeFieldProps) {
  const id = useId();
  const t = useT();
  const [error, setError] = useState<Message | null>(null);
  useEffect(() => setError(null), [value]);
  const shown = format ? format(value) : numberFormat(t.locale, RANGE_FORMAT).format(value);
  const text = `${shown}${unit ? ` ${unit}` : ""}`;
  const errorText = error ? t.t(error) : null;
  return (
    <FieldShell id={id} label={label} hint={hint} error={errorText}>
      <span className="range-field">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={!(max > min)}
          aria-valuetext={text}
          aria-describedby={describedBy(id, hint, errorText)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            const r = onChange(v, `range:${id}`);
            setError(r.ok ? null : refusal(r.issues));
          }}
          onPointerUp={endGroup}
          onKeyUp={endGroup}
          onBlur={endGroup}
        />
        <output htmlFor={id} className="range-field__value">
          {text}
          {isDefault ? <span className="muted"> {t.t("ui.common.input.default")}</span> : null}
        </output>
        {onReset && !isDefault ? (
          <button
            type="button"
            className="range-field__reset"
            aria-label={t.t("ui.common.input.resetLabel", { label })}
            onClick={() => {
              const r = onReset();
              setError(r.ok ? null : refusal(r.issues));
              endGroup();
            }}
          >
            {t.t("ui.common.input.resetButton")}
          </button>
        ) : null}
      </span>
    </FieldShell>
  );
}
