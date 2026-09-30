/**
 * Assistant d'initialisation (prompt 2 §3, SPEC §2.2, CHALLENGE G8) : fenêtre modale.
 *
 * 1. Saisie : H, dalle, trémie (rectangle, relevé 4 côtés + 2 diagonales, trémie du projet ou
 *    aucune), murs (ceux du projet, et murs le long des côtés de la trémie), usage (contextes),
 *    bois, extérieur, structure visée, typologies, sens, emmarchement, garde-corps.
 * 2. « Proposer » : `proposeDesigns` du cœur dans un worker dédié (`model/assistantClient.ts`),
 *    annulable (« Annuler la recherche » termine le worker).
 * 3. Cartes des candidats : croquis en plan, typologie, n, h, g, 2h + g, E, collet, échappée,
 *    score détaillé (pénalités pondérées, plus petit = meilleur), diagnostic du cœur. Une carte
 *    par forme (typologie × position du tournant) ; les autres variantes de la forme (sens, E,
 *    n) sont repliées sous elle, ou toutes à plat avec « Montrer toutes les variantes ».
 * 4. « Choisir » : le projet du candidat remplace le projet courant (une entrée d'historique,
 *    « Annuler » revient au projet précédent).
 */
import {
  REJECTION_LABELS,
  TYPOLOGY_IDS,
  TYPOLOGY_LABELS,
  TURN_POSITION_LABELS,
  errorMessageOf,
  openingPolygon,
  type DesignCandidate,
  type SurveyMeasure,
  type TypologyId,
} from "@blondel/core";
import { msg, type Message, type MessageKey, type Translator } from "@blondel/i18n";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  USAGES,
  assistantInput,
  chosenProject,
  formFromProject,
  formOpening,
  formatScore,
  openingSideLabel,
  summaryFacts,
  variantCount,
  type AssistantForm,
  type CandidateSketch,
  type OpeningMode,
  type UsageId,
} from "../lib/assistant.js";
import { availableStructures } from "../lib/optionalApi.js";
import { formatNumber } from "../i18n/locale.js";
import { useT } from "../i18n/useT.js";
import {
  AssistantCancelled,
  startAssistant,
  startSketches,
  type AssistantRun,
} from "../model/assistantClient.js";
import type { AssistantOutcome } from "../model/assistantJob.js";
import { appStore, useApp } from "../store/appStore.js";
import "./assistant.css";

const SURVEY_LABELS: readonly [SurveyMeasure, MessageKey][] = [
  ["ab", "ui.assistant.survey.ab"],
  ["bc", "ui.assistant.survey.bc"],
  ["cd", "ui.assistant.survey.cd"],
  ["da", "ui.assistant.survey.da"],
  ["ac", "ui.assistant.survey.ac"],
  ["bd", "ui.assistant.survey.bd"],
];

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly run: AssistantRun; readonly started: number }
  | { readonly kind: "done"; readonly outcome: AssistantOutcome }
  | { readonly kind: "error"; readonly message: Message };

function TextInput({
  label,
  value,
  onChange,
  unit = "mm",
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly unit?: string;
  readonly hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-unit">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="input-unit__unit">{unit}</span>
      </div>
      {hint ? <small className="field__hint">{hint}</small> : null}
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Première lettre en minuscule (« Côté b1 » → « côté b1 » au milieu d'une phrase). */
function lowerFirst(text: string, t: Translator): string {
  return text.charAt(0).toLocaleLowerCase(t.locale) + text.slice(1);
}

/** Croquis en plan d'un candidat (repère du site, y vers le haut). */
function Sketch({ sketch, label }: { readonly sketch: CandidateSketch; readonly label: string }) {
  const t = useT();
  const { box } = sketch;
  const m = Math.max(box.w, box.h) * 0.06;
  const pts = (ps: readonly { x: number; y: number }[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg
      className="assistant__sketch"
      viewBox={`${box.x - m} ${-(box.y + box.h) - m} ${box.w + 2 * m} ${box.h + 2 * m}`}
      role="img"
      aria-label={t.t("ui.assistant.sketch", { label })}
    >
      <g transform="scale(1,-1)">
        {sketch.walls.map((w, i) => (
          <polygon
            key={i}
            className="assistant__wall"
            points={pts(w)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polygon
          className="assistant__stair"
          points={pts(sketch.footprint)}
          vectorEffect="non-scaling-stroke"
        />
        {sketch.nosings.map(([a, b], i) => (
          <line
            key={i}
            className="assistant__nosing"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {sketch.walkline.length > 1 ? (
          <polyline
            className="assistant__walkline"
            points={pts(sketch.walkline)}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {sketch.opening ? (
          <polygon
            className="assistant__opening"
            points={pts(sketch.opening)}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </g>
    </svg>
  );
}

/** Titre d'une carte : typologie, sens, position du tournant (traduit à l'affichage). */
function title(c: DesignCandidate): Message {
  const typology = msg(TYPOLOGY_LABELS[c.typology]);
  const shape =
    c.direction === "left"
      ? msg("assistant.shape.left", { typology })
      : c.direction === "right"
        ? msg("assistant.shape.right", { typology })
        : typology;
  return c.turnPosition
    ? msg("ui.assistant.candidate.withTurn", {
        shape,
        position: msg(TURN_POSITION_LABELS[c.turnPosition]),
      })
    : shape;
}

function CandidateCard({
  candidate,
  sketch,
  rank,
  variant = false,
  onChoose,
}: {
  readonly candidate: DesignCandidate;
  readonly sketch: CandidateSketch | undefined;
  /** Rang affiché : « 3 » pour une proposition, « 3.2 » pour sa deuxième variante. */
  readonly rank: string;
  readonly variant?: boolean;
  readonly onChoose: () => void;
}) {
  const id = useId();
  const t = useT();
  const s = candidate.summary;
  return (
    <article
      className={`assistant__card${variant ? " assistant__card--variant" : ""}`}
      aria-labelledby={id}
      data-typology={candidate.typology}
    >
      {sketch ? <Sketch sketch={sketch} label={t.t(candidate.label)} /> : null}
      <div className="assistant__card-body">
        <h4 id={id}>
          <span className="assistant__rank">{rank}.</span> {t.t(title(candidate))}
        </h4>
        <p className="assistant__label muted">{t.t(candidate.label)}</p>
        <dl className="assistant__facts">
          {summaryFacts(candidate, t.locale).map((f, i) => (
            <div key={i}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        <p className="assistant__warnings">
          {s.violations.avertissement === 0 && s.violations.conseil === 0
            ? t.t("ui.assistant.warnings.none")
            : t.t(
                s.warningRules.length > 0
                  ? "ui.assistant.warnings.withRules"
                  : "ui.assistant.warnings.summary",
                {
                  warnings: msg("ui.assistant.warnings.warningCount", {
                    count: s.violations.avertissement,
                  }),
                  advice: msg("ui.assistant.warnings.adviceCount", {
                    count: s.violations.conseil,
                  }),
                  rules: s.warningRules.join(", "),
                },
              )}
        </p>
        <details className="assistant__score">
          <summary>
            {t.t("ui.assistant.score.label", {
              score: formatScore(candidate.score.total, t.locale),
            })}{" "}
            <span className="muted">{t.t("ui.assistant.score.note")}</span>
          </summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{t.t("ui.assistant.score.term")}</th>
                <th scope="col">{t.t("ui.assistant.score.value")}</th>
                <th scope="col">{t.t("ui.assistant.score.weight")}</th>
                <th scope="col">{t.t("ui.assistant.score.penalty")}</th>
              </tr>
            </thead>
            <tbody>
              {candidate.score.terms.map((term) => (
                <tr key={term.id}>
                  <th scope="row">{t.t(term.label)}</th>
                  <td>
                    {formatScore(term.value, t.locale)} {term.unit === "mm" ? "mm" : ""}
                  </td>
                  <td>{formatNumber(t.locale, term.weight)}</td>
                  <td>{formatScore(term.penalty, t.locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="field__hint">{t.t("ui.assistant.score.weightsHint")}</p>
        </details>
        <button
          type="button"
          className="assistant__choose"
          aria-label={t.t(
            variant ? "ui.assistant.choose.variant" : "ui.assistant.choose.proposal",
            {
              title: title(candidate),
              rank,
            },
          )}
          onClick={onChoose}
        >
          {t.t("ui.assistant.choose.button")}
        </button>
      </div>
    </article>
  );
}

/** Carte d'une forme et ses variantes repliées (sens, E, n de la même forme). */
function ShapeGroup({
  candidate,
  sketches,
  rank,
  onChoose,
  onShowVariants,
}: {
  readonly candidate: DesignCandidate;
  readonly sketches: Readonly<Record<string, CandidateSketch>>;
  readonly rank: number;
  readonly onChoose: (c: DesignCandidate) => void;
  /** Dépliage des variantes : leurs croquis sont demandés à ce moment (QUESTIONS D5). */
  readonly onShowVariants: (variants: readonly DesignCandidate[]) => void;
}) {
  const variants = candidate.variants;
  const t = useT();
  return (
    <div className="assistant__shape" data-shape={candidate.shape}>
      <CandidateCard
        candidate={candidate}
        sketch={sketches[candidate.id]}
        rank={String(rank)}
        onChoose={() => onChoose(candidate)}
      />
      {variants.length > 0 ? (
        <details
          className="assistant__variants"
          onToggle={(e) => {
            if (e.currentTarget.open) onShowVariants(variants);
          }}
        >
          <summary>
            {t.t("ui.assistant.variants.count", { count: variants.length })}{" "}
            <span className="muted">{t.t("ui.assistant.variants.note")}</span>
          </summary>
          <div className="assistant__variant-list">
            {variants.map((v, j) => (
              <CandidateCard
                key={v.id}
                candidate={v}
                sketch={sketches[v.id]}
                rank={`${rank}.${j + 2}`}
                variant
                onChoose={() => onChoose(v)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Éléments focalisables visibles de `container`, dans l'ordre du document. */
function focusables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 && el.closest("[inert]") === null,
  );
}

/** Tab / Maj+Tab : le focus boucle dans la fenêtre (il ne passe jamais à l'arrière-plan). */
function trapTab(e: KeyboardEvent, dialog: HTMLElement): void {
  const items = focusables(dialog);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    e.preventDefault();
    return;
  }
  const active = document.activeElement;
  const inside = active instanceof Node && dialog.contains(active);
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Rend inertes les frères de `backdrop` (le reste de l'application) ; renvoie la fonction qui
 * rétablit leur état d'origine.
 */
function makeBackgroundInert(backdrop: Element | null): () => void {
  const parent = backdrop?.parentElement;
  if (!backdrop || !parent) return () => {};
  const changed: HTMLElement[] = [];
  for (const el of parent.children) {
    if (el !== backdrop && el instanceof HTMLElement && !el.inert) {
      el.inert = true;
      changed.push(el);
    }
  }
  return () => {
    for (const el of changed) el.inert = false;
  };
}

export function AssistantDialog() {
  const open = useApp((s) => s.assistantOpen);
  return open ? <AssistantDialogBody /> : null;
}

function AssistantDialogBody() {
  const t = useT();
  const project = useApp((s) => s.project);
  const [form, setForm] = useState<AssistantForm>(() => formFromProject(project));
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [errors, setErrors] = useState<readonly Message[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const structures = useMemo(
    () => [
      { value: "none", label: t.t("ui.assistant.structure.none") },
      ...availableStructures().map((s) => ({ value: s.kind, label: t.t(s.labelKey) })),
    ],
    [t],
  );
  const set = (patch: Partial<AssistantForm>) => setForm((f) => ({ ...f, ...patch }));

  // Trémie du formulaire (un relevé coûte un ajustement et ses seuils exacts, ≈ 12 ms) : pas
  // recalculée à chaque rendu (minuterie de la recherche, 4 fois par seconde).
  const opening = useMemo(() => formOpening(form, project), [form, project]);
  const polygon = useMemo(() => (opening.ok ? openingPolygon(opening.opening) : null), [opening]);

  // Fermeture : la recherche en cours est abandonnée au démontage (effet ci-dessous).
  const close = (): void => appStore.getState().setAssistantOpen(false);

  // Fenêtre modale : arrière-plan inerte (ni focus, ni clic, ni lecteur d'écran), focus initial
  // dans la fenêtre et rendu à l'élément qui l'a ouverte à la fermeture ; Tab / Maj+Tab bouclent
  // dans la fenêtre ; Échap la ferme où que soit le focus.
  useEffect(() => {
    const dialog = root.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreInert = makeBackgroundInert(dialog?.closest(".assistant__backdrop") ?? null);
    dialog?.querySelector<HTMLElement>("input, select, button")?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab" && dialog) {
        trapTab(e, dialog);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreInert();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    if (state.kind !== "running") return;
    const timer = setInterval(() => setElapsed(performance.now() - state.started), 250);
    return () => clearInterval(timer);
  }, [state]);
  // Recherche en cours abandonnée au démontage (fenêtre fermée).
  const running = useRef<AssistantRun | null>(null);
  running.current = state.kind === "running" ? state.run : null;
  useEffect(() => () => running.current?.cancel(), []);

  // Croquis des variantes repliées, calculés au dépliage (worker dédié) ; oubliés à chaque
  // nouvelle recherche, abandonnés à la fermeture.
  const [variantSketches, setVariantSketches] = useState<Readonly<Record<string, CandidateSketch>>>(
    {},
  );
  const sketchJobs = useRef(new Set<{ cancel(): void }>());
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const jobs = sketchJobs.current;
    return () => {
      for (const j of jobs) j.cancel();
    };
  }, []);
  const showVariants = (variants: readonly DesignCandidate[]): void => {
    const missing = variants.filter((v) => !requested.current.has(v.id));
    if (missing.length === 0) return;
    for (const v of missing) requested.current.add(v.id);
    const job = startSketches(missing.map((v) => ({ id: v.id, project: v.project })));
    sketchJobs.current.add(job);
    job.promise.then(
      (sketches) => {
        sketchJobs.current.delete(job);
        setVariantSketches((s) => ({ ...s, ...sketches }));
      },
      () => {
        sketchJobs.current.delete(job);
        for (const v of missing) requested.current.delete(v.id);
      },
    );
  };

  const propose = (): void => {
    const r = assistantInput(form, project);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors([]);
    if (state.kind === "running") state.run.cancel();
    for (const j of sketchJobs.current) j.cancel();
    sketchJobs.current.clear();
    requested.current.clear();
    setVariantSketches({});
    const run = startAssistant(r.input);
    setElapsed(0);
    setState({ kind: "running", run, started: performance.now() });
    run.promise.then(
      (outcome) =>
        setState((s) => (s.kind === "running" && s.run === run ? { kind: "done", outcome } : s)),
      (e: unknown) =>
        setState((s) =>
          s.kind === "running" && s.run === run
            ? e instanceof AssistantCancelled
              ? { kind: "idle" }
              : { kind: "error", message: errorMessageOf(e) }
            : s,
        ),
    );
  };

  const choose = (c: DesignCandidate): void => {
    try {
      const p = chosenProject(c, project, { guards: form.guards });
      const r = appStore
        .getState()
        .replaceProject(p, msg("ui.assistant.chosen", { title: title(c) }));
      if (!r.ok) {
        setErrors(r.issues);
        return;
      }
      appStore.getState().setAssistantOpen(false);
      appStore.getState().setView("plan");
    } catch (e) {
      setErrors([errorMessageOf(e)]);
    }
  };

  const toggleTypology = (typology: TypologyId, on: boolean) =>
    set({
      typologies: on
        ? [...form.typologies, typology]
        : form.typologies.filter((x) => x !== typology),
    });
  const toggleSide = (i: number, on: boolean) =>
    set({ wallSides: on ? [...form.wallSides, i] : form.wallSides.filter((x) => x !== i) });

  const outcome = state.kind === "done" ? state.outcome : null;
  const sketches = useMemo(
    () => (outcome ? { ...outcome.sketches, ...variantSketches } : variantSketches),
    [outcome, variantSketches],
  );
  const openingModes: { value: OpeningMode; label: string }[] = [
    { value: "rect", label: t.t("ui.assistant.opening.rect") },
    { value: "survey", label: t.t("ui.assistant.opening.survey") },
    ...(project.site.opening?.kind === "polygon"
      ? [{ value: "project" as const, label: t.t("ui.assistant.opening.project") }]
      : []),
    { value: "none", label: t.t("ui.assistant.opening.none") },
  ];

  return (
    <div className="assistant__backdrop">
      <div
        ref={root}
        className="assistant"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="assistant__header">
          <h2 id={titleId}>{t.t("ui.assistant.title")}</h2>
          <button type="button" onClick={close} aria-label={t.t("ui.assistant.close.label")}>
            {t.t("ui.assistant.close.button")}
          </button>
        </header>
        <div className="assistant__body">
          <form
            className="assistant__form"
            aria-label={t.t("ui.assistant.form")}
            onSubmit={(e) => {
              e.preventDefault();
              propose();
            }}
          >
            <fieldset className="grid-2">
              <legend>{t.t("ui.assistant.levels.legend")}</legend>
              <TextInput
                label={t.t("ui.assistant.levels.floorToFloor.label")}
                value={form.floorToFloor}
                onChange={(v) => set({ floorToFloor: v })}
                hint={t.t("ui.assistant.levels.floorToFloor.hint")}
              />
              <TextInput
                label={t.t("ui.assistant.levels.slab.label")}
                value={form.upperSlabThickness}
                onChange={(v) => set({ upperSlabThickness: v })}
                hint={t.t("ui.assistant.levels.slab.hint")}
              />
            </fieldset>
            <fieldset className="grid-2">
              <legend>{t.t("ui.assistant.opening.legend")}</legend>
              <div className="assistant__wide">
                <Select
                  label={t.t("ui.assistant.opening.label")}
                  value={form.openingMode}
                  options={openingModes}
                  // Les côtés cochés désignent les côtés de l'ancienne trémie : décochés.
                  onChange={(v) => set({ openingMode: v, wallSides: [] })}
                />
              </div>
              {form.openingMode === "rect" || form.openingMode === "survey" ? (
                <>
                  <TextInput
                    label={t.t(
                      form.openingMode === "rect"
                        ? "ui.assistant.opening.cornerX"
                        : "ui.assistant.opening.pointAX",
                    )}
                    value={form.openingX}
                    onChange={(v) => set({ openingX: v })}
                  />
                  <TextInput
                    label={t.t(
                      form.openingMode === "rect"
                        ? "ui.assistant.opening.cornerY"
                        : "ui.assistant.opening.pointAY",
                    )}
                    value={form.openingY}
                    onChange={(v) => set({ openingY: v })}
                  />
                </>
              ) : null}
              {form.openingMode === "rect" ? (
                <>
                  <TextInput
                    label={t.t("ui.assistant.opening.sizeX")}
                    value={form.sizeX}
                    onChange={(v) => set({ sizeX: v })}
                  />
                  <TextInput
                    label={t.t("ui.assistant.opening.sizeY")}
                    value={form.sizeY}
                    onChange={(v) => set({ sizeY: v })}
                  />
                </>
              ) : null}
              {form.openingMode === "survey"
                ? SURVEY_LABELS.map(([k, label]) => (
                    <TextInput
                      key={k}
                      label={t.t(label)}
                      value={form.survey[k]}
                      onChange={(v) => set({ survey: { ...form.survey, [k]: v } })}
                    />
                  ))
                : null}
              {form.openingMode === "survey" ? (
                <small className="field__hint assistant__wide">
                  {t.t("ui.assistant.opening.surveyHint")}
                </small>
              ) : null}
              {!opening.ok && form.openingMode !== "none" ? (
                <small className="field__error assistant__wide">{t.t(opening.error)}</small>
              ) : null}
            </fieldset>
            <fieldset>
              <legend>{t.t("ui.assistant.walls.legend")}</legend>
              <Check
                label={t.t("ui.assistant.walls.keep", { count: project.site.walls.length })}
                checked={form.keepWalls}
                onChange={(v) => set({ keepWalls: v })}
              />
              {polygon
                ? polygon.map((_, i) => (
                    <Check
                      key={i}
                      label={t.t("ui.assistant.walls.along", {
                        side: lowerFirst(openingSideLabel(polygon, i, t.locale), t),
                      })}
                      checked={form.wallSides.includes(i)}
                      onChange={(v) => toggleSide(i, v)}
                    />
                  ))
                : null}
              {form.wallSides.length > 0 ? (
                <TextInput
                  label={t.t("ui.assistant.walls.thickness.label")}
                  value={form.wallThickness}
                  onChange={(v) => set({ wallThickness: v })}
                  hint={t.t("ui.assistant.walls.thickness.hint")}
                />
              ) : null}
            </fieldset>
            <fieldset>
              <legend>{t.t("ui.assistant.context.legend")}</legend>
              <Select<UsageId>
                label={t.t("ui.assistant.context.usage")}
                value={form.usage}
                options={USAGES.map((u) => ({ value: u.id, label: t.t(u.labelKey) }))}
                onChange={(v) => set({ usage: v })}
              />
              <Check
                label={t.t("ui.assistant.context.wood")}
                checked={form.wood}
                onChange={(v) => set({ wood: v })}
              />
              <Check
                label={t.t("compliance.context.exterieur")}
                checked={form.outdoor}
                onChange={(v) => set({ outdoor: v })}
              />
            </fieldset>
            <fieldset>
              <legend>{t.t("ui.assistant.preferences.legend")}</legend>
              <Select
                label={t.t("ui.assistant.preferences.structure")}
                value={form.structure}
                options={structures}
                onChange={(v) => set({ structure: v })}
              />
              <div
                className="assistant__typologies"
                role="group"
                aria-label={t.t("ui.assistant.preferences.typologies.label")}
              >
                <span className="field__hint">
                  {t.t("ui.assistant.preferences.typologies.hint")}
                </span>
                {TYPOLOGY_IDS.map((typology) => (
                  <Check
                    key={typology}
                    label={t.t(TYPOLOGY_LABELS[typology])}
                    checked={form.typologies.includes(typology)}
                    onChange={(v) => toggleTypology(typology, v)}
                  />
                ))}
              </div>
              <Select
                label={t.t("ui.assistant.preferences.direction.label")}
                value={form.direction}
                options={[
                  { value: "both", label: t.t("ui.assistant.preferences.direction.both") },
                  { value: "left", label: t.t("ui.params.turn.left") },
                  { value: "right", label: t.t("ui.params.turn.right") },
                ]}
                onChange={(v) => set({ direction: v })}
              />
              <TextInput
                label={t.t("ui.assistant.preferences.width.label")}
                value={form.width}
                onChange={(v) => set({ width: v })}
                hint={t.t("ui.assistant.preferences.width.hint")}
              />
              <Check
                label={t.t("ui.assistant.preferences.guards")}
                checked={form.guards}
                onChange={(v) => set({ guards: v })}
              />
              <Check
                label={t.t("ui.assistant.preferences.showAllVariants")}
                checked={form.showAllVariants}
                onChange={(v) => set({ showAllVariants: v })}
              />
            </fieldset>
            {errors.length > 0 ? (
              <ul className="notice notice--error" role="alert">
                {errors.map((e, i) => (
                  <li key={i}>{t.t(e)}</li>
                ))}
              </ul>
            ) : null}
            <div className="button-row assistant__actions">
              <button type="submit" className="primary" disabled={state.kind === "running"}>
                {t.t("ui.assistant.propose")}
              </button>
              {state.kind === "running" ? (
                <button type="button" onClick={() => state.run.cancel()}>
                  {t.t("ui.assistant.cancel")}
                </button>
              ) : null}
            </div>
          </form>
          <section
            className="assistant__results"
            aria-label={t.t("ui.assistant.results.label")}
            aria-busy={state.kind === "running"}
          >
            {state.kind === "idle" ? (
              <p className="muted">{t.t("ui.assistant.results.idle")}</p>
            ) : null}
            {state.kind === "running" ? (
              <p role="status" className="assistant__running">
                {t.t("ui.assistant.results.running", {
                  seconds: formatNumber(t.locale, elapsed / 1000, { maximumFractionDigits: 1 }),
                })}
              </p>
            ) : null}
            {state.kind === "error" ? (
              <p className="notice notice--error" role="alert">
                {t.t("ui.assistant.results.error", { error: state.message })}
              </p>
            ) : null}
            {outcome ? (
              <>
                <p role="status" className="assistant__summary">
                  {outcome.result.candidates.length === 0
                    ? t.t("ui.assistant.results.none")
                    : t.t("ui.assistant.results.count", {
                        count: outcome.result.candidates.length,
                      })}
                  {variantCount(outcome.result.candidates) > 0
                    ? ` ${t.t("ui.assistant.results.folded", { count: variantCount(outcome.result.candidates) })}`
                    : ""}{" "}
                  {t.t("ui.assistant.results.stats", {
                    enumerated: msg("ui.assistant.results.enumerated", {
                      count: outcome.result.stats.enumerated,
                      value: formatNumber(t.locale, outcome.result.stats.enumerated),
                    }),
                    built: msg("ui.assistant.results.built", {
                      count: outcome.result.stats.built,
                      value: String(outcome.result.stats.built),
                    }),
                    ms: formatNumber(t.locale, Math.round(outcome.timeMs)),
                  })}
                  {outcome.result.stats.truncated
                    ? ` ${t.t("ui.assistant.results.truncated")}`
                    : ""}
                </p>
                <div className="assistant__cards">
                  {outcome.result.candidates.map((c, i) => (
                    <ShapeGroup
                      key={c.id}
                      candidate={c}
                      sketches={sketches}
                      rank={i + 1}
                      onChoose={choose}
                      onShowVariants={showVariants}
                    />
                  ))}
                </div>
                <details
                  className="assistant__diagnostics"
                  open={outcome.result.candidates.length === 0}
                >
                  <summary>{t.t("ui.assistant.diagnostics.title")}</summary>
                  <ul>
                    {outcome.result.diagnostics.map((d, i) => (
                      <li key={i}>{t.t(d)}</li>
                    ))}
                  </ul>
                  {outcome.result.rejections.length > 0 ? (
                    <table>
                      <caption>{t.t("ui.assistant.diagnostics.rejected")}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t.t("ui.assistant.diagnostics.typology")}</th>
                          <th scope="col">{t.t("ui.assistant.diagnostics.reason")}</th>
                          <th scope="col">{t.t("ui.assistant.diagnostics.count")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outcome.result.rejections.map((rej, i) => (
                          <tr key={i} title={t.t(rej.example)}>
                            <td>
                              {rej.direction === "left" || rej.direction === "right"
                                ? t.t(
                                    rej.direction === "left"
                                      ? "ui.assistant.diagnostics.left"
                                      : "ui.assistant.diagnostics.right",
                                    { typology: msg(TYPOLOGY_LABELS[rej.typology]) },
                                  )
                                : t.t(TYPOLOGY_LABELS[rej.typology])}
                            </td>
                            <td>{t.t(REJECTION_LABELS[rej.reason])}</td>
                            <td>{formatNumber(t.locale, rej.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </details>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
