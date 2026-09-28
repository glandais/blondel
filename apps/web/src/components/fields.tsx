/**
 * Champs de saisie accessibles (label associé, message d'erreur annoncé). Les longueurs se
 * saisissent en mm entiers (ADR-0003) ; la validation métier reste celle du schéma du cœur,
 * appliquée par le store (une valeur refusée affiche le message sans modifier le projet).
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { parseIntMm, type IntFieldBounds } from "../lib/units.js";
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

/** Champ entier (mm par défaut) : validation à la frappe, modification appliquée dès que valide. */
export function IntField({
  label,
  value,
  unit = "mm",
  hint,
  min,
  max,
  disabled,
  onCommit,
}: IntFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Valeur au moment de la prise de focus : la saisie est appliquée à la frappe, Échap doit
  // donc revenir à cette valeur (et non à la dernière valeur partielle appliquée).
  const [atFocus, setAtFocus] = useState(value);

  // Valeur modifiée ailleurs (annuler, préréglage) : resynchroniser hors saisie.
  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
      setError(null);
    }
  }, [value, focused]);

  const bounds: IntFieldBounds = {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };

  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <span className="input-unit">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={draft}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          onFocus={() => {
            setFocused(true);
            setAtFocus(value);
          }}
          onBlur={() => {
            setFocused(false);
            endGroup();
          }}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            const r = parseIntMm(text, bounds);
            if (!r.ok) {
              setError(r.error);
              return;
            }
            const u = onCommit(r.value);
            setError(u.ok ? null : (u.issues[0] ?? "Valeur refusée."));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(String(atFocus));
              setError(null);
              if (atFocus !== value) onCommit(atFocus);
            }
          }}
        />
        <span className="input-unit__unit" aria-hidden="true">
          {unit}
        </span>
      </span>
    </FieldShell>
  );
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
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type={type}
        value={value}
        aria-describedby={describedBy(id, hint, error)}
        onBlur={endGroup}
        onChange={(e) => {
          const r = onCommit(e.target.value);
          setError(r.ok ? null : (r.issues[0] ?? "Valeur refusée."));
        }}
      />
    </FieldShell>
  );
}
