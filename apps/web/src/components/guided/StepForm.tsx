/**
 * Formulaire d'une étape du parcours guidé (maquette 1a, spécification de contenu § 2 ; ADR-0009
 * points 5, 6 et 9). Rendu dans la colonne de gauche (`.guided-form`, onglet ARIA de la barre
 * d'étapes : le conteneur porte le `tabpanel` et le défilement), dans l'ordre :
 *
 * - en-tête : surtitre « Étape n sur 7 », titre de l'étape, phrase d'objectif ;
 * - champs : composants de section en affichage guidé (`display = { kind: "guided", step }`),
 *   qui rangent eux-mêmes les réglages secondaires sous « Plus de réglages » (`Tiered`) et
 *   rendent leurs cartes de choix (forme, structure, remplissage) ; à l'étape 2, le balancement
 *   suit le tracé seulement s'il y a un tournant ; l'étape 7 a son propre contenu
 *   (`FabricationStep`) ;
 * - cadre de chiffres clés (`StepFigures`, jauge 2h + g à l'étape 3) ;
 * - encart d'aide (une phrase qui décrit l'interface, sans seuil) ;
 * - lien « Réglage avancé… », sous l'encart et collé au bas de la colonne quand le formulaire
 *   défile (toujours visible), affiché seulement si le formulaire contient un repli « Plus de
 *   réglages ». Les résumés de ces replis sont masqués (maquette 1a : le lien est le seul accès) :
 *   il les ouvre tous et donne le focus au premier champ (`aria-expanded` reflète l'état ; un
 *   second clic les referme). Il porte le compteur ◆ des champs repliés.
 */
import type { MessageKey } from "@blondel/i18n";
import { ChevronDown, Info } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useT } from "../../i18n/useT.js";
import type { Display } from "../../lib/paramTiers.js";
import { STEP_TITLE_KEYS, GUIDED_STEP_COUNT } from "../../lib/guidedSteps.js";
import type { GuidedStep } from "../../lib/sectionIds.js";
import { formatLength } from "../../lib/units.js";
import { useApp } from "../../store/appStore.js";
import { disabledSections } from "../free/Rail.js";
import {
  BalancingSection,
  GuardsSection,
  LayoutSection,
  SiteSection,
  SteppingSection,
  StructureSection,
  TreadsSection,
} from "../sections/index.js";
import { Icon } from "../ui/Icon.js";
import { FabricationStep } from "./FabricationStep.js";
import { StepFigures } from "./StepFigures.js";
import "./stepForm.css";

/** Phrase d'objectif de chaque étape (l'étape 3 cite la hauteur à monter, `{height}`). */
export const STEP_OBJECTIVE_KEYS: Readonly<Record<GuidedStep, MessageKey>> = {
  1: "ui.guided.objective.1",
  2: "ui.guided.objective.2",
  3: "ui.guided.objective.3",
  4: "ui.guided.objective.4",
  5: "ui.guided.objective.5",
  6: "ui.guided.objective.6",
  7: "ui.guided.objective.7",
};

/** Texte de l'encart d'aide de chaque étape. */
export const STEP_HELP_KEYS: Readonly<Record<GuidedStep, MessageKey>> = {
  1: "ui.guided.help.1",
  2: "ui.guided.help.2",
  3: "ui.guided.help.3",
  4: "ui.guided.help.4",
  5: "ui.guided.help.5",
  6: "ui.guided.help.6",
  7: "ui.guided.help.7",
};

/** Sélecteur des replis « Plus de réglages » (rendus par `Tiered` ou par l'étape 7). */
const MORE_FOLDS = "details.tiered__fold--more";

/** Champs de l'étape. */
function StepFields({ step }: { step: GuidedStep }) {
  const turnCount = useApp((s) => s.project.stair.layout.turns.length);
  const d: Display = { kind: "guided", step };
  switch (step) {
    case 1:
      return <SiteSection display={d} />;
    case 2:
      return (
        <>
          <LayoutSection display={d} />
          {disabledSections(turnCount).has("balancing") ? null : <BalancingSection display={d} />}
        </>
      );
    case 3:
      return <SteppingSection display={d} />;
    case 4:
      return <TreadsSection display={d} />;
    case 5:
      return <StructureSection display={d} />;
    case 6:
      return <GuardsSection display={d} />;
    case 7:
      return <FabricationStep />;
  }
}

/** Phrase d'objectif ; à l'étape 3, la hauteur à monter du projet (mm entiers). */
function Objective({ step }: { step: GuidedStep }) {
  const t = useT();
  const height = useApp((s) => s.project.site.floorToFloor);
  const unit = useApp((s) => s.displayUnit);
  const text =
    step === 3
      ? t.t(STEP_OBJECTIVE_KEYS[3], { height: formatLength(Math.round(height), unit, t.locale) })
      : t.t(STEP_OBJECTIVE_KEYS[step]);
  return <p className="step-form__objective">{text}</p>;
}

/** Repère inséré à la place du terme en gras, puis découpé : jamais présent dans un texte. */
const STRONG_MARK = "\u0000";

/**
 * Phrase traduite en un seul morceau dont le paramètre `{strong}` est rendu en gras : l'ordre
 * des mots et la ponctuation restent ceux de la langue (aucune phrase assemblée par fragments).
 */
export function withStrong(sentence: string, strong: string): ReactNode {
  const parts = sentence.split(STRONG_MARK);
  return parts.map((p, i) => (
    <Fragment key={i}>
      {i > 0 ? <b>{strong}</b> : null}
      {p}
    </Fragment>
  ));
}

/** Encart d'aide ; à l'étape 3, « 2h + g, le module de Blondel » en gras (maquette 1a). */
function StepHelp({ step }: { step: GuidedStep }) {
  const t = useT();
  const body: ReactNode =
    step === 3
      ? withStrong(t.t(STEP_HELP_KEYS[3], { strong: STRONG_MARK }), t.t("ui.guided.help.3.strong"))
      : t.t(STEP_HELP_KEYS[step]);
  return (
    <div className="step-form__help">
      <Icon icon={Info} size={18} className="step-form__help-icon" />
      <p className="step-form__help-text">{body}</p>
    </div>
  );
}

interface FoldState {
  readonly count: number;
  readonly open: boolean;
  /** Champs ◆ restants (non validés) dans les replis. */
  readonly toValidate: number;
}

const SAME = (a: FoldState, b: FoldState): boolean =>
  a.count === b.count && a.open === b.open && a.toValidate === b.toValidate;

/** Champs ◆ restants rendus par `Tiered` dans les replis « Plus de réglages ». */
const MORE_TO_VALIDATE = `${MORE_FOLDS} .tiered__item--tv`;

/** Premier élément focalisable d'un repli (champ, bouton). */
const FOCUSABLE =
  "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Lien « Réglage avancé… » (maquette 1a : seul accès aux réglages repliés, sous l'encart
 * d'aide ; les résumés « Plus de réglages » sont masqués dans le formulaire d'étape). Il suit les
 * replis du formulaire (ajoutés ou retirés au fil des modifications, ouverts par le lien
 * « Ouvrir » d'une valeur ◆) sans modifier `Tiered`, et porte le compteur ◆ de leurs champs.
 */
function AdvancedLink({ root }: { root: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const [folds, setFolds] = useState<FoldState>({ count: 0, open: false, toValidate: 0 });
  const sync = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const all = [...el.querySelectorAll<HTMLDetailsElement>(MORE_FOLDS)];
    const next = {
      count: all.length,
      open: all.length > 0 && all.every((d) => d.open),
      toValidate: el.querySelectorAll(MORE_TO_VALIDATE).length,
    };
    setFolds((prev) => (SAME(prev, next) ? prev : next));
  }, [root]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    sync();
    // `toggle` ne remonte pas : écouté en capture. Les replis apparaissent avec les champs.
    el.addEventListener("toggle", sync, true);
    const observer = new MutationObserver(sync);
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("toggle", sync, true);
      observer.disconnect();
    };
  }, [root, sync]);
  if (folds.count === 0) return null;
  const onClick = (): void => {
    const all = [...(root.current?.querySelectorAll<HTMLDetailsElement>(MORE_FOLDS) ?? [])];
    const open = !folds.open;
    for (const d of all) d.open = open;
    if (open) {
      const first = all
        .map((d) => d.querySelector<HTMLElement>(`:scope > .tiered__fold-body ${FOCUSABLE}`))
        .find((x) => x !== null);
      first?.focus();
    }
    sync();
  };
  const label = t.t("ui.sections.toValidateCount", { count: folds.toValidate });
  return (
    <div className="step-form__foot">
      <button
        type="button"
        className="btn btn-ghost step-form__advanced"
        aria-expanded={folds.open}
        onClick={onClick}
      >
        {t.t("ui.guided.form.advanced")}
        {folds.toValidate > 0 ? (
          <span className="step-form__advanced-count" title={label}>
            <span className="tv-mark num" aria-hidden="true">
              ◆ {folds.toValidate}
            </span>
            <span className="visually-hidden">{label}</span>
          </span>
        ) : null}
        <Icon icon={ChevronDown} size={14} className="step-form__advanced-icon" />
      </button>
    </div>
  );
}

export function StepForm({ step }: { readonly step: GuidedStep }) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  return (
    <div className="step-form" ref={root} data-step={step}>
      <header className="step-form__head">
        <span className="eyebrow step-form__eyebrow">
          {t.t("ui.guided.form.eyebrow", { n: step, total: GUIDED_STEP_COUNT })}
        </span>
        <h2 className="step-form__title">{t.t(STEP_TITLE_KEYS[step])}</h2>
        <Objective step={step} />
      </header>
      <div className="step-form__fields">
        <StepFields step={step} />
      </div>
      <StepFigures step={step} />
      <StepHelp step={step} />
      <AdvancedLink root={root} />
    </div>
  );
}
