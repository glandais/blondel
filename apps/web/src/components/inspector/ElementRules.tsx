/**
 * Bloc « Règles sur cette marche / cette pièce » des inspecteurs Marche (2a) et Pièce (2b),
 * ADR-0009, vague 3 : surtitre avec le nombre de règles en défaut, une carte compacte par
 * violation (constat en corps, clic = inspecteur Règle), ou une phrase s'il n'y en a pas ; puis
 * une ligne « Respectées ici : … ▸ » qui déplie la liste des règles respectées sur l'élément.
 * Rattachement des résultats à l'élément : `resultsForElement` (lecture du rapport du cœur).
 */
import { ruleTitle } from "@blondel/core";
import { useId, useMemo, useState } from "react";
import { commaMessages } from "../../i18n/text.js";
import { useT } from "../../i18n/useT.js";
import { resultsForElement } from "../../lib/compliance.js";
import { useModel } from "../../store/appStore.js";
import { RuleCard } from "./RuleCard.js";
import { ResultList, useModelParts } from "./RuleResults.js";

/** Élément inspecté dont on liste les règles. */
export type ElementTarget =
  | { readonly kind: "tread"; readonly number: number }
  | { readonly kind: "part"; readonly partId: string };

export interface ElementRulesProps {
  readonly target: ElementTarget;
}

/** Titres nommés dans la ligne « Respectées ici » avant « (+ k) ». */
export const PASSED_PREVIEW = 3;

export function ElementRules({ target }: ElementRulesProps) {
  const t = useT();
  const id = useId();
  const { model } = useModel();
  const parts = useModelParts();
  // Mémoïsation sur des primitives : la cible est un littéral recréé à chaque rendu du parent.
  const kind = target.kind;
  const ref = target.kind === "tread" ? target.number : target.partId;
  const results = useMemo(
    () =>
      resultsForElement(
        model?.compliance,
        kind === "tread"
          ? { kind: "tread", number: ref as number }
          : { kind: "part", partId: ref as string },
        parts,
      ),
    [model, kind, ref, parts],
  );
  const [open, setOpen] = useState(false);
  const n = results.violations.length;
  const passed = results.passed;
  const shown = passed.slice(0, PASSED_PREVIEW);
  const titles = commaMessages(shown.map((r) => ruleTitle(r.ruleId))) ?? "";
  const more = passed.length - shown.length;
  return (
    <section className="element-rules" aria-labelledby={`${id}-title`}>
      <span id={`${id}-title`} className="insp-section-title">
        {target.kind === "tread"
          ? t.t("ui.elementRules.tread", { n: String(n) })
          : t.t("ui.elementRules.part", { n: String(n) })}
      </span>
      {n > 0 ? (
        <ul className="rule-cards">
          {results.violations.map((r, i) => (
            <RuleCard key={`${r.ruleId}-${i}`} r={r} compact />
          ))}
        </ul>
      ) : (
        <p className="element-rules__none">{t.t("ui.elementRules.none")}</p>
      )}
      {passed.length > 0 ? (
        <>
          <button
            type="button"
            className="control-folds__link element-rules__passed"
            aria-expanded={open}
            aria-controls={open ? `${id}-passed` : undefined}
            onClick={() => setOpen((o) => !o)}
          >
            {more > 0
              ? t.t("ui.elementRules.passedMore", {
                  titles,
                  n: String(more),
                })
              : t.t("ui.elementRules.passed", { titles })}
            <span aria-hidden="true">{open ? " ▾" : " ▸"}</span>
          </button>
          {open ? (
            <div id={`${id}-passed`} className="element-rules__list">
              <ResultList results={passed} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
