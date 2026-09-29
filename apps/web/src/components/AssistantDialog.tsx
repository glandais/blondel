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
  openingPolygon,
  type DesignCandidate,
  type SurveyMeasure,
  type TypologyId,
} from "@blondel/core";
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
import { AssistantCancelled, startAssistant, type AssistantRun } from "../model/assistantClient.js";
import type { AssistantOutcome } from "../model/assistantJob.js";
import { appStore, useApp } from "../store/appStore.js";
import "./assistant.css";

const SURVEY_LABELS: readonly [SurveyMeasure, string][] = [
  ["ab", "AB"],
  ["bc", "BC"],
  ["cd", "CD"],
  ["da", "DA"],
  ["ac", "Diagonale AC"],
  ["bd", "Diagonale BD"],
];

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly run: AssistantRun; readonly started: number }
  | { readonly kind: "done"; readonly outcome: AssistantOutcome }
  | { readonly kind: "error"; readonly message: string };

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

/** Croquis en plan d'un candidat (repère du site, y vers le haut). */
function Sketch({ sketch, label }: { readonly sketch: CandidateSketch; readonly label: string }) {
  const { box } = sketch;
  const m = Math.max(box.w, box.h) * 0.06;
  const pts = (ps: readonly { x: number; y: number }[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg
      className="assistant__sketch"
      viewBox={`${box.x - m} ${-(box.y + box.h) - m} ${box.w + 2 * m} ${box.h + 2 * m}`}
      role="img"
      aria-label={`Croquis en plan : ${label}`}
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

function title(c: DesignCandidate): string {
  const dir = c.direction === "left" ? " à gauche" : c.direction === "right" ? " à droite" : "";
  const pos = c.turnPosition ? `, tournant ${c.turnPosition}` : "";
  return `${TYPOLOGY_LABELS[c.typology]}${dir}${pos}`;
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
  const s = candidate.summary;
  return (
    <article
      className={`assistant__card${variant ? " assistant__card--variant" : ""}`}
      aria-labelledby={id}
      data-typology={candidate.typology}
    >
      {sketch ? <Sketch sketch={sketch} label={candidate.label} /> : null}
      <div className="assistant__card-body">
        <h4 id={id}>
          <span className="assistant__rank">{rank}.</span> {title(candidate)}
        </h4>
        <p className="assistant__label muted">{candidate.label}</p>
        <dl className="assistant__facts">
          {summaryFacts(candidate).map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
        <p className="assistant__warnings">
          {s.violations.avertissement === 0 && s.violations.conseil === 0
            ? "Aucun avertissement du contrôle de conception."
            : `${s.violations.avertissement} avertissement(s), ${s.violations.conseil} conseil(s)` +
              (s.warningRules.length > 0 ? ` : ${s.warningRules.join(", ")}` : "")}
        </p>
        <details className="assistant__score">
          <summary>
            Score {formatScore(candidate.score.total)}{" "}
            <span className="muted">(pénalités, plus petit = meilleur)</span>
          </summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Terme</th>
                <th scope="col">Valeur</th>
                <th scope="col">Poids</th>
                <th scope="col">Pénalité</th>
              </tr>
            </thead>
            <tbody>
              {candidate.score.terms.map((t) => (
                <tr key={t.id}>
                  <th scope="row">{t.label}</th>
                  <td>
                    {formatScore(t.value)} {t.unit === "mm" ? "mm" : ""}
                  </td>
                  <td>{t.weight.toLocaleString("fr-FR")}</td>
                  <td>{formatScore(t.penalty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="field__hint">Poids choisis par Blondel, à valider (aucune source).</p>
        </details>
        <button
          type="button"
          className="assistant__choose"
          aria-label={`Choisir : ${title(candidate)} (${variant ? "variante" : "proposition"} ${rank})`}
          onClick={onChoose}
        >
          Choisir
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
}: {
  readonly candidate: DesignCandidate;
  readonly sketches: Readonly<Record<string, CandidateSketch>>;
  readonly rank: number;
  readonly onChoose: (c: DesignCandidate) => void;
}) {
  const variants = candidate.variants;
  return (
    <div className="assistant__shape" data-shape={candidate.shape}>
      <CandidateCard
        candidate={candidate}
        sketch={sketches[candidate.id]}
        rank={String(rank)}
        onChoose={() => onChoose(candidate)}
      />
      {variants.length > 0 ? (
        <details className="assistant__variants">
          <summary>
            {variants.length === 1
              ? "1 autre variante de cette forme"
              : `${variants.length} autres variantes de cette forme`}{" "}
            <span className="muted">(sens, emmarchement, nombre de marches)</span>
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
  const project = useApp((s) => s.project);
  const [form, setForm] = useState<AssistantForm>(() => formFromProject(project));
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const structures = useMemo(
    () => [
      { value: "none", label: "Sans préférence (aucune structure)" },
      ...availableStructures().map((s) => ({ value: s.kind, label: s.label })),
    ],
    [],
  );
  const set = (patch: Partial<AssistantForm>) => setForm((f) => ({ ...f, ...patch }));

  const opening = formOpening(form, project);
  const polygon = opening.ok ? openingPolygon(opening.opening) : null;

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
    const t = setInterval(() => setElapsed(performance.now() - state.started), 250);
    return () => clearInterval(t);
  }, [state]);
  // Recherche en cours abandonnée au démontage (fenêtre fermée).
  const running = useRef<AssistantRun | null>(null);
  running.current = state.kind === "running" ? state.run : null;
  useEffect(() => () => running.current?.cancel(), []);

  const propose = (): void => {
    const r = assistantInput(form, project);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors([]);
    if (state.kind === "running") state.run.cancel();
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
              : { kind: "error", message: e instanceof Error ? e.message : String(e) }
            : s,
        ),
    );
  };

  const choose = (c: DesignCandidate): void => {
    try {
      const p = chosenProject(c, project, { guards: form.guards });
      const r = appStore
        .getState()
        .replaceProject(
          p,
          `Proposition de l'assistant retenue : ${title(c)}. « Annuler » (Ctrl+Z) revient au projet précédent.`,
        );
      if (!r.ok) {
        setErrors(r.issues);
        return;
      }
      appStore.getState().setAssistantOpen(false);
      appStore.getState().setView("plan");
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  };

  const toggleTypology = (t: TypologyId, on: boolean) =>
    set({
      typologies: on ? [...form.typologies, t] : form.typologies.filter((x) => x !== t),
    });
  const toggleSide = (i: number, on: boolean) =>
    set({ wallSides: on ? [...form.wallSides, i] : form.wallSides.filter((x) => x !== i) });

  const outcome = state.kind === "done" ? state.outcome : null;
  const openingModes: { value: OpeningMode; label: string }[] = [
    { value: "rect", label: "Rectangulaire" },
    { value: "survey", label: "Relevé (4 côtés + 2 diagonales)" },
    ...(project.site.opening?.kind === "polygon"
      ? [{ value: "project" as const, label: "Trémie polygonale du projet" }]
      : []),
    { value: "none", label: "Aucune (pas de plancher au-dessus)" },
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
          <h2 id={titleId}>Assistant d'initialisation</h2>
          <button type="button" onClick={close} aria-label="Fermer l'assistant">
            Fermer
          </button>
        </header>
        <div className="assistant__body">
          <form
            className="assistant__form"
            aria-label="Site et préférences"
            onSubmit={(e) => {
              e.preventDefault();
              propose();
            }}
          >
            <fieldset className="grid-2">
              <legend>Niveaux</legend>
              <TextInput
                label="Hauteur à monter H"
                value={form.floorToFloor}
                onChange={(v) => set({ floorToFloor: v })}
                hint="Sol fini à sol fini."
              />
              <TextInput
                label="Épaisseur de dalle"
                value={form.upperSlabThickness}
                onChange={(v) => set({ upperSlabThickness: v })}
                hint="Sol fini haut → sous-face."
              />
            </fieldset>
            <fieldset className="grid-2">
              <legend>Trémie</legend>
              <div className="assistant__wide">
                <Select
                  label="Trémie"
                  value={form.openingMode}
                  options={openingModes}
                  // Les côtés cochés désignent les côtés de l'ancienne trémie : décochés.
                  onChange={(v) => set({ openingMode: v, wallSides: [] })}
                />
              </div>
              {form.openingMode === "rect" || form.openingMode === "survey" ? (
                <>
                  <TextInput
                    label={form.openingMode === "rect" ? "Coin X" : "Point A, X"}
                    value={form.openingX}
                    onChange={(v) => set({ openingX: v })}
                  />
                  <TextInput
                    label={form.openingMode === "rect" ? "Coin Y" : "Point A, Y"}
                    value={form.openingY}
                    onChange={(v) => set({ openingY: v })}
                  />
                </>
              ) : null}
              {form.openingMode === "rect" ? (
                <>
                  <TextInput
                    label="Longueur de trémie (X)"
                    value={form.sizeX}
                    onChange={(v) => set({ sizeX: v })}
                  />
                  <TextInput
                    label="Largeur de trémie (Y)"
                    value={form.sizeY}
                    onChange={(v) => set({ sizeY: v })}
                  />
                </>
              ) : null}
              {form.openingMode === "survey"
                ? SURVEY_LABELS.map(([k, label]) => (
                    <TextInput
                      key={k}
                      label={`Relevé ${label}`}
                      value={form.survey[k]}
                      onChange={(v) => set({ survey: { ...form.survey, [k]: v } })}
                    />
                  ))
                : null}
              {form.openingMode === "survey" ? (
                <small className="field__hint assistant__wide">
                  A, B, C, D dans le sens trigonométrique vu de dessus, AB selon +X.
                </small>
              ) : null}
              {!opening.ok && form.openingMode !== "none" ? (
                <small className="field__error assistant__wide">{opening.error}</small>
              ) : null}
            </fieldset>
            <fieldset>
              <legend>Murs</legend>
              <Check
                label={`Garder les murs du projet (${project.site.walls.length})`}
                checked={form.keepWalls}
                onChange={(v) => set({ keepWalls: v })}
              />
              {polygon
                ? polygon.map((_, i) => (
                    <Check
                      key={i}
                      label={`Mur le long du ${openingSideLabel(polygon, i).replace(/^Côté/, "côté")}`}
                      checked={form.wallSides.includes(i)}
                      onChange={(v) => toggleSide(i, v)}
                    />
                  ))
                : null}
              {form.wallSides.length > 0 ? (
                <TextInput
                  label="Épaisseur des murs ajoutés"
                  value={form.wallThickness}
                  onChange={(v) => set({ wallThickness: v })}
                  hint="Nu du mur au bord de la trémie. Valeur proposée, à valider."
                />
              ) : null}
            </fieldset>
            <fieldset>
              <legend>Contexte</legend>
              <Select<UsageId>
                label="Usage"
                value={form.usage}
                options={USAGES.map((u) => ({ value: u.id, label: u.label }))}
                onChange={(v) => set({ usage: v })}
              />
              <Check
                label="Escalier en bois (NF DTU 36.3)"
                checked={form.wood}
                onChange={(v) => set({ wood: v })}
              />
              <Check
                label="Escalier extérieur"
                checked={form.outdoor}
                onChange={(v) => set({ outdoor: v })}
              />
            </fieldset>
            <fieldset>
              <legend>Préférences</legend>
              <Select
                label="Structure visée"
                value={form.structure}
                options={structures}
                onChange={(v) => set({ structure: v })}
              />
              <div className="assistant__typologies" role="group" aria-label="Typologies">
                <span className="field__hint">Typologies (aucune cochée : toutes)</span>
                {TYPOLOGY_IDS.map((t) => (
                  <Check
                    key={t}
                    label={TYPOLOGY_LABELS[t]}
                    checked={form.typologies.includes(t)}
                    onChange={(v) => toggleTypology(t, v)}
                  />
                ))}
              </div>
              <Select
                label="Sens des tournants"
                value={form.direction}
                options={[
                  { value: "both", label: "Les deux" },
                  { value: "left", label: "À gauche" },
                  { value: "right", label: "À droite" },
                ]}
                onChange={(v) => set({ direction: v })}
              />
              <TextInput
                label="Emmarchement imposé"
                value={form.width}
                onChange={(v) => set({ width: v })}
                hint="Vide : emmarchements explorés par l'assistant."
              />
              <Check
                label="Ajouter les garde-corps (côtés vides d'après les murs)"
                checked={form.guards}
                onChange={(v) => set({ guards: v })}
              />
              <Check
                label="Montrer toutes les variantes (liste à plat)"
                checked={form.showAllVariants}
                onChange={(v) => set({ showAllVariants: v })}
              />
            </fieldset>
            {errors.length > 0 ? (
              <ul className="notice notice--error" role="alert">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            <div className="button-row assistant__actions">
              <button type="submit" className="primary" disabled={state.kind === "running"}>
                Proposer
              </button>
              {state.kind === "running" ? (
                <button type="button" onClick={() => state.run.cancel()}>
                  Annuler la recherche
                </button>
              ) : null}
            </div>
          </form>
          <section
            className="assistant__results"
            aria-label="Propositions"
            aria-busy={state.kind === "running"}
          >
            {state.kind === "idle" ? (
              <p className="muted">
                Renseigner le site puis « Proposer » : l'assistant énumère les typologies, sens,
                positions de tournant, nombres de marches et girons, écarte les propositions
                bloquées par le contrôle de conception ou par l'échappée, et classe les autres.
              </p>
            ) : null}
            {state.kind === "running" ? (
              <p role="status" className="assistant__running">
                Recherche en cours…{" "}
                {(elapsed / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s
              </p>
            ) : null}
            {state.kind === "error" ? (
              <p className="notice notice--error" role="alert">
                Assistant indisponible : {state.message}
              </p>
            ) : null}
            {outcome ? (
              <>
                <p role="status" className="assistant__summary">
                  {outcome.result.candidates.length === 0
                    ? "Aucune proposition."
                    : `${outcome.result.candidates.length} proposition(s) sans contrôle bloquant`}
                  {variantCount(outcome.result.candidates) > 0
                    ? ` (et ${variantCount(outcome.result.candidates)} variante(s) repliée(s))`
                    : ""}{" "}
                  — {outcome.result.stats.enumerated.toLocaleString("fr-FR")} variantes énumérées,{" "}
                  {outcome.result.stats.built} modèles construits (
                  {Math.round(outcome.timeMs).toLocaleString("fr-FR")} ms).
                  {outcome.result.stats.truncated ? " Exploration partielle : budget atteint." : ""}
                </p>
                <div className="assistant__cards">
                  {outcome.result.candidates.map((c, i) => (
                    <ShapeGroup
                      key={c.id}
                      candidate={c}
                      sketches={outcome.sketches}
                      rank={i + 1}
                      onChoose={choose}
                    />
                  ))}
                </div>
                <details
                  className="assistant__diagnostics"
                  open={outcome.result.candidates.length === 0}
                >
                  <summary>Diagnostic de l'assistant</summary>
                  <ul>
                    {outcome.result.diagnostics.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  {outcome.result.rejections.length > 0 ? (
                    <table>
                      <caption>Variantes écartées</caption>
                      <thead>
                        <tr>
                          <th scope="col">Typologie</th>
                          <th scope="col">Motif</th>
                          <th scope="col">Nombre</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outcome.result.rejections.map((t, i) => (
                          <tr key={i} title={t.example}>
                            <td>
                              {TYPOLOGY_LABELS[t.typology]}
                              {t.direction === "left"
                                ? " (gauche)"
                                : t.direction === "right"
                                  ? " (droite)"
                                  : ""}
                            </td>
                            <td>{REJECTION_LABELS[t.reason]}</td>
                            <td>{t.count.toLocaleString("fr-FR")}</td>
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
