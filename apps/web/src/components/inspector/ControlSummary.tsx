/**
 * Bloc « Contrôle de conception » de l'inspecteur sans sélection (maquette 2d, ADR-0009) :
 * profil (ouvre le panneau Contexte), contextes du rapport, quatre compteurs (bloquants,
 * avertissements, conseils, respectées), une carte par règle en défaut (groupes non vides
 * seulement), puis une ligne de liens qui déplient les listes repliées (non évaluées,
 * respectées, remarques, surcharges). Lecture du rapport rendu par le cœur : aucune règle
 * n'est évaluée ici.
 *
 * Chaque carte (titre court et localisation courte) et chaque ligne des listes repliées ouvre
 * l'inspecteur Règle (maquette 2c), qui porte la mesure, les corrections et la surcharge.
 *
 * Badge « Contrôle » de la barre du haut (`revealControl`) : le bloc défile dans le champ et son
 * titre reçoit le focus. Lien du compteur de surcharges du panneau Contexte
 * (`revealOverrides`) : la liste des surcharges se déplie, défile dans le champ et son résumé
 * reçoit le focus.
 */
import type { MessageKey } from "@blondel/i18n";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { useT } from "../../i18n/useT.js";
import {
  controlCounts,
  groupResults,
  modelNotes,
  orderedViolations,
  type ControlCounts,
} from "../../lib/compliance.js";
import { useApp, useModel } from "../../store/appStore.js";
import { openSection, uiStore, useUi } from "../../store/uiStore.js";
import { RuleCard } from "./RuleCard.js";
import { OverrideList, ResultList } from "./RuleResults.js";

/** Cellules des compteurs, dans l'ordre de la maquette. */
export const COUNT_CELLS: readonly {
  readonly id: "bloquant" | "avertissement" | "conseil" | "ok";
  readonly short: MessageKey;
  readonly full: MessageKey;
}[] = [
  {
    id: "bloquant",
    short: "ui.control.count.bloquant.short",
    full: "ui.control.count.bloquant.full",
  },
  {
    id: "avertissement",
    short: "ui.control.count.avertissement.short",
    full: "ui.control.count.avertissement.full",
  },
  { id: "conseil", short: "ui.control.count.conseil.short", full: "ui.control.count.conseil.full" },
  { id: "ok", short: "ui.control.count.ok.short", full: "ui.control.count.ok.full" },
];

const PROFILE_LABELS: Readonly<Record<"strict" | "souple", MessageKey>> = {
  strict: "ui.params.compliance.profile.strict",
  souple: "ui.params.compliance.profile.souple",
};

/** Listes repliées de la ligne de liens. */
export type FoldId = "na" | "ok" | "notes" | "overrides";

/**
 * Dernière demande traitée de chaque sorte (badge « Contrôle », lien des surcharges), commune à
 * tous les montages du bloc : au départ, les compteurs du store d'interface.
 */
const seen: Record<"control" | "overrides", number> = {
  control: uiStore.getState().controlRevealSeq,
  overrides: uiStore.getState().overridesRevealSeq,
};

/** La demande `seq` est-elle nouvelle ? Elle est alors marquée traitée. */
export function takeReveal(kind: "control" | "overrides", seq: number): boolean {
  if (seq <= seen[kind]) return false;
  seen[kind] = seq;
  return true;
}

/**
 * Profil : ouvre le Contexte de contrôle (libre : panneau Contexte, en Conception ; guidé : repli
 * « Contexte » de la liste du contrôle).
 */
function openContextPanel(): void {
  openSection("compliance");
}

function Counts({ counts }: { counts: ControlCounts }) {
  const t = useT();
  return (
    <dl className="control-counts" aria-label={t.t("ui.control.counts.label")}>
      {COUNT_CELLS.map((c) => {
        const n = counts[c.id];
        return (
          <div
            key={c.id}
            className="control-counts__cell"
            data-severity={c.id}
            data-zero={n === 0 ? "true" : undefined}
            title={t.t(c.full)}
          >
            <dt>
              <abbr title={t.t(c.full)}>{t.t(c.short)}</abbr>
            </dt>
            <dd>{String(n)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Liste dépliée sous la ligne de liens ; la refermer (résumé) replie le lien. */
function Fold({
  id,
  kind,
  title,
  count,
  onClose,
  summaryRef,
  children,
}: {
  id: string;
  kind: FoldId;
  title: string;
  count: number;
  onClose: () => void;
  summaryRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      className={`sev sev--${kind}`}
      open
      onToggle={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
    >
      <summary ref={summaryRef}>
        {title} <span className="count">{count}</span>
      </summary>
      {children}
    </details>
  );
}

export interface ControlSummaryProps {
  /** Listes dépliées au premier rendu (tout replié par défaut). */
  readonly initialOpen?: readonly FoldId[];
}

export function ControlSummary({ initialOpen = [] }: ControlSummaryProps = {}) {
  const t = useT();
  const baseId = useId();
  const { model } = useModel();
  const report = model?.compliance;
  const groups = useMemo(() => groupResults(report), [report]);
  const counts = controlCounts(groups);
  const violations = orderedViolations(groups);
  const notes = useMemo(() => modelNotes(model), [model]);
  const overrides = useApp((s) => s.project.compliance.overrides);
  const projectProfile = useApp((s) => s.project.compliance.profile);
  const profile = report?.profile ?? projectProfile;
  const [open, setOpen] = useState<ReadonlySet<FoldId>>(() => new Set(initialOpen));

  // Badge « Contrôle » : défilement jusqu'au bloc et focus du titre. Le bloc peut être monté par
  // la demande elle-même (sélection effacée : la 2d remplace un autre gabarit) : la demande
  // traitée est mémorisée hors du composant (`seen`), pas au montage.
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const revealSeq = useUi((s) => s.controlRevealSeq);
  useEffect(() => {
    if (!takeReveal("control", revealSeq)) return;
    sectionRef.current?.scrollIntoView?.({ block: "start" });
    titleRef.current?.focus({ preventScroll: true });
  }, [revealSeq]);

  // Lien du compteur de surcharges (panneau Contexte) : liste dépliée, montrée et focalisée.
  const overridesSummaryRef = useRef<HTMLElement>(null);
  const overridesSeq = useUi((s) => s.overridesRevealSeq);
  const [overridesFocus, setOverridesFocus] = useState(0);
  useEffect(() => {
    if (!takeReveal("overrides", overridesSeq)) return;
    setOpen((s) => (s.has("overrides") ? s : new Set([...s, "overrides"])));
    setOverridesFocus((n) => n + 1);
  }, [overridesSeq]);
  useEffect(() => {
    if (overridesFocus === 0) return;
    const summary = overridesSummaryRef.current;
    summary?.scrollIntoView?.({ block: "nearest" });
    summary?.focus({ preventScroll: true });
  }, [overridesFocus]);

  const toggle = (f: FoldId): void =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  const close = (f: FoldId) => () =>
    setOpen((s) => {
      const next = new Set(s);
      next.delete(f);
      return next;
    });
  const foldId = (f: FoldId): string => `${baseId}-${f}`;

  const links: { id: FoldId; label: string; count: number }[] = [
    {
      id: "na",
      label: t.t("ui.control.fold.notEvaluated", { count: counts.notEvaluated }),
      count: counts.notEvaluated,
    },
    { id: "ok", label: t.t("ui.control.fold.passed", { count: counts.ok }), count: counts.ok },
    {
      id: "notes",
      label: t.t("ui.control.fold.notes", { count: notes.length }),
      count: notes.length,
    },
    ...(overrides.length > 0
      ? [
          {
            id: "overrides" as const,
            label: t.t("ui.control.fold.overrides", { count: overrides.length }),
            count: overrides.length,
          },
        ]
      : []),
  ];

  const profileLabel = t.t(PROFILE_LABELS[profile]);

  return (
    <section ref={sectionRef} className="inspector-control" aria-labelledby={`${baseId}-title`}>
      <div className="inspector-control__head">
        <h4
          id={`${baseId}-title`}
          ref={titleRef}
          tabIndex={-1}
          className="inspector-control__title"
        >
          {t.t("ui.compliance.title")}
        </h4>
        <button
          type="button"
          className="btn btn-ghost inspector-control__profile"
          title={t.t("ui.control.profile.title", { profile: profileLabel })}
          onClick={openContextPanel}
        >
          {profileLabel}
          <span aria-hidden="true"> ▾</span>
        </button>
      </div>
      {report ? (
        // Version des règles, profil et contextes en texte visible (lisible au clavier et au
        // lecteur d'écran) ; libellés courts des contextes : vague 6 (libellés unifiés).
        <p className="inspector-control__contexts">
          {t.t("ui.compliance.summary", {
            version: String(report.rulesVersion),
            profile: profileLabel,
            contexts: report.contexts.join(" · ") || "–",
          })}
        </p>
      ) : (
        <p className="inspector-control__contexts">{t.t("ui.compliance.noModel")}</p>
      )}
      <Counts counts={counts} />
      {violations.length > 0 ? (
        <ul className="rule-cards" aria-label={t.t("ui.control.cards.label")}>
          {violations.map((r, i) => (
            <RuleCard key={`${r.ruleId}-${i}`} r={r} />
          ))}
        </ul>
      ) : report ? (
        <p className="inspector-control__none">{t.t("ui.control.noViolation")}</p>
      ) : null}
      <div className="control-folds" role="group" aria-label={t.t("ui.control.folds.label")}>
        {links.map((l, i) => {
          const expanded = open.has(l.id);
          return (
            <span key={l.id} className="control-folds__item">
              {i > 0 ? (
                <span className="control-folds__sep" aria-hidden="true">
                  {" · "}
                </span>
              ) : null}
              <button
                type="button"
                className="control-folds__link"
                data-fold={l.id}
                aria-expanded={expanded}
                aria-controls={expanded ? foldId(l.id) : undefined}
                disabled={l.count === 0}
                onClick={() => toggle(l.id)}
              >
                {l.label}
                <span aria-hidden="true">{expanded ? " ▾" : " ▸"}</span>
              </button>
            </span>
          );
        })}
      </div>
      {open.has("na") ? (
        <Fold
          id={foldId("na")}
          kind="na"
          title={t.t("ui.compliance.notEvaluated")}
          count={counts.notEvaluated}
          onClose={close("na")}
        >
          <ResultList results={groups.notEvaluated} />
        </Fold>
      ) : null}
      {open.has("ok") ? (
        <Fold
          id={foldId("ok")}
          kind="ok"
          title={t.t("ui.compliance.passed")}
          count={counts.ok}
          onClose={close("ok")}
        >
          <ResultList results={groups.passed} />
        </Fold>
      ) : null}
      {open.has("notes") && notes.length > 0 ? (
        <Fold
          id={foldId("notes")}
          kind="notes"
          title={t.t("ui.compliance.notes")}
          count={notes.length}
          onClose={close("notes")}
        >
          <ul className="notes">
            {notes.map((n, i) => (
              <li key={i}>{t.t(n)}</li>
            ))}
          </ul>
        </Fold>
      ) : null}
      {open.has("overrides") && overrides.length > 0 ? (
        <Fold
          id={foldId("overrides")}
          kind="overrides"
          title={t.t("ui.compliance.overrides")}
          count={overrides.length}
          onClose={close("overrides")}
          summaryRef={overridesSummaryRef}
        >
          <OverrideList />
        </Fold>
      ) : null}
    </section>
  );
}
