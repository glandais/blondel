/**
 * Champs de saisie accessibles (label associé, message d'erreur annoncé). Les saisies au clavier
 * sont appliquées à la validation (Entrée ou perte de focus), les choix discrets tout de suite. Les longueurs se
 * saisissent en mm entiers (ADR-0003) ; la validation métier reste celle du schéma du cœur,
 * appliquée par le store (une valeur refusée affiche le message sans modifier le projet).
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  decideDraft,
  parseIntMm,
  type IntFieldBounds,
  type ParseNumberResult,
} from "../lib/units.js";
import { appStore } from "../store/appStore.js";
import type { UpdateResult } from "../store/projectStore.js";

function endGroup(): void {
  appStore.getState().endGroup();
}

interface FieldShellProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | null | undefined;
  readonly children: ReactNode;
}

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
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
): string | undefined {
  if (error) return `${id}-error`;
  return hint ? `${id}-hint` : undefined;
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
  const [draft, setDraft] = useState(format(value));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // Valeur modifiée ailleurs (annuler, préréglage) : resynchroniser hors saisie.
  useEffect(() => {
    if (!focused) setDraft(format(value));
    // `format` : fonction de présentation, sans effet sur la resynchronisation.
  }, [value, focused]);

  const bounds: IntFieldBounds = {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
  const read = (text: string) => parse(text, bounds);

  /** Applique la saisie ; `revert` : revenir à la valeur du projet si elle est refusée. */
  const validate = (revert: boolean): void => {
    const d = decideDraft(draft, value, read);
    if (d.kind === "commit") {
      const u = onCommit(d.value);
      endGroup();
      if (u.ok) {
        setError(null);
        return;
      }
      setError(u.issues[0] ?? "Valeur refusée.");
    } else if (d.kind === "invalid") {
      setError(d.error);
    } else {
      setError(null);
      return;
    }
    if (revert) setDraft(format(value));
  };

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <span className="input-unit">
        <input
          id={id}
          type="text"
          inputMode={parse === parseIntMm ? "numeric" : "decimal"}
          autoComplete="off"
          value={draft}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            validate(true);
            setFocused(false);
          }}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
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
  /** Valeur proposée quand on quitte le mode automatique (ex. valeur calculée par le modèle). */
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
}

/** Champ entier avec case « automatique ». */
export function AutoIntField(props: AutoIntFieldProps) {
  const { label, value, fallback, unit, hint, min, max, onCommit } = props;
  const autoAllowed = props.autoAllowed ?? true;
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const isAuto = value === "auto";
  return (
    <div className="auto-field">
      <div className="auto-field__toggle">
        <input
          id={id}
          type="checkbox"
          checked={isAuto}
          disabled={!autoAllowed && !isAuto}
          title={!autoAllowed ? props.autoHint : undefined}
          onChange={(e) => {
            const r = onCommit(e.target.checked ? "auto" : fallback);
            setError(r.ok ? null : (r.issues[0] ?? "Valeur refusée."));
            endGroup();
          }}
        />
        <label htmlFor={id}>{label} : automatique</label>
      </div>
      {isAuto ? null : (
        <IntField
          label={label}
          value={value}
          {...(unit === undefined ? {} : { unit })}
          {...(hint === undefined ? {} : { hint })}
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          onCommit={onCommit}
        />
      )}
      {error ? (
        <small className="field__error" role="alert">
          {error}
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
  const [error, setError] = useState<string | null>(null);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        value={value}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(e) => {
          const r = onCommit(e.target.value as V);
          setError(r.ok ? null : (r.issues[0] ?? "Valeur refusée."));
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
  readonly onCommit: (checked: boolean) => UpdateResult;
}

export function CheckField({ label, checked, title, onCommit }: CheckFieldProps) {
  const id = useId();
  return (
    <div className="check" title={title}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onCommit(e.target.checked);
          endGroup();
        }}
      />
      <label htmlFor={id}>{label}</label>
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
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const commit = (text: string): void => {
    if (text === value) return;
    const r = onCommit(text);
    setError(r.ok ? null : (r.issues[0] ?? "Valeur refusée."));
    endGroup();
  };
  // Texte : appliqué à la validation (Entrée, perte de focus) ; date : choix discret, appliqué
  // tout de suite.
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type={type}
        value={draft}
        aria-describedby={describedBy(id, hint, error)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          commit(draft);
          setFocused(false);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (type === "date") commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft);
          else if (e.key === "Escape") setDraft(value);
        }}
      />
    </FieldShell>
  );
}
