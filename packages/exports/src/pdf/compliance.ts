/**
 * Pages du contrôle de conception (CHALLENGE P3) : avertissement « indicatif », résultats
 * groupés (violations par sévérité, non évaluées, respectées) avec nature, confiance, source et
 * source secondaire ; l'avertissement est rappelé en tête de chaque page de suite.
 */
import {
  ruleDescription,
  type Model,
  type RuleOverride,
  type RuleResult,
  type Severity,
} from "@blondel/core";
import type { MessageKey } from "@blondel/i18n";
import { translatorOf, tr, type Translator } from "../i18n.js";
import type { PdfCanvas, Rgb } from "./canvas.js";
import { INK, MUTED, fr, pagedTitle, wrapText, type Frame, type PageDraft } from "./layout.js";

/** Avertissement imprimé en tête du contrôle de conception (CHALLENGE P3), dans la langue. */
export function complianceDisclaimer(t: Translator = translatorOf()): string {
  return t.t("pdf.compliance.disclaimer");
}

export const SEVERITY_COLOR: Readonly<Record<Severity, Rgb>> = {
  bloquant: [209, 36, 47],
  avertissement: [232, 134, 12],
  conseil: [191, 135, 0],
};

const NATURE_KEYS: Readonly<Record<string, MessageKey>> = {
  reglementaire: "compliance.nature.reglementaire",
  normatif: "compliance.nature.normatif",
  metier: "compliance.nature.metier",
};
const CONFIDENCE_KEYS: Readonly<Record<string, MessageKey>> = {
  eleve: "compliance.confidence.eleve",
  moyen: "compliance.confidence.moyen",
  faible: "compliance.confidence.faible",
};
const SEVERITY_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
  bloquant: "compliance.severityName.bloquant",
  avertissement: "compliance.severityName.avertissement",
  conseil: "compliance.severityName.conseil",
};

/** Libellé d'une table de clés (identifiant brut s'il est inconnu). */
function label(t: Translator, keys: Readonly<Record<string, MessageKey>>, id: string): string {
  const key = keys[id];
  return key === undefined ? id : t.t(key);
}

export interface CompliancePageInfo {
  readonly kind: "compliance";
  readonly title: string;
}

interface Line {
  readonly text: string;
  readonly size: number;
  readonly bold?: boolean;
  readonly color?: Rgb;
  readonly indent?: number;
  /** Espace avant la ligne, mm. */
  readonly before?: number;
}

/**
 * Décimales de base par unité de règle (choix d'affichage, ADR-0003 : l'arrondi n'a lieu qu'à
 * l'affichage) : 0,1 pour les longueurs et les autres unités, 0,01 pour les grandeurs sans
 * dimension ou de faible amplitude (ratio, pente mm/m, charges en kN).
 */
function baseDecimals(unit: string | undefined): number {
  if (unit === undefined) return 1;
  if (unit === "ratio" || unit === "mm/m" || unit.startsWith("kN")) return 2;
  return 1;
}

/** Plus petit nombre de décimales (≤ `cap`) qui représente `v` exactement. */
function exactDecimals(v: number, cap: number): number {
  for (let d = 0; d < cap; d++) if (Math.abs(Number(v.toFixed(d)) - v) < 1e-9) return d;
  return cap;
}

const MAX_DECIMALS = 6;
const round = (v: number, d: number): number => Number(v.toFixed(d));

/**
 * Nombre de décimales d'affichage d'un résultat : au moins celles de l'unité et celles qui
 * représentent exactement les seuils (1,32 ne s'imprime pas « 1,3 ») ; pour une violation dont
 * la mesure est hors de [min, max], décimales ajoutées jusqu'à ce que la mesure affichée soit
 * strictement du mauvais côté du seuil affiché (599,96 pour un min de 600 ne s'imprime pas
 * « 600 »). L'arrondi étant monotone, une mesure dans les bornes le reste à l'affichage.
 */
export function measureDecimals(r: RuleResult): number {
  const min = r.min ?? undefined;
  const max = r.max ?? undefined;
  let d = baseDecimals(r.unit);
  for (const t of [min, max])
    if (t !== undefined && Number.isFinite(t)) d = Math.max(d, exactDecimals(t, MAX_DECIMALS));
  const m = r.measured;
  if (r.status !== "violation" || m === undefined || !Number.isFinite(m)) return d;
  const below = min !== undefined && Number.isFinite(min) && m < min;
  const above = max !== undefined && Number.isFinite(max) && m > max;
  const separated = (k: number): boolean =>
    (!below || round(m, k) < round(min!, k)) && (!above || round(m, k) > round(max!, k));
  while (d < MAX_DECIMALS && !separated(d)) d++;
  return d;
}

/**
 * Unités de règle écrites en mots (`rules.yaml`), traduites à l'affichage et accordées à la
 * valeur (« 1 unit », « 2 units ») ; les symboles restent tels quels.
 */
const UNIT_WORD_KEYS: Readonly<Record<string, MessageKey>> = {
  marches: "pdf.compliance.unit.marches",
  unite: "pdf.compliance.unit.unite",
};

/** Valeur suivie de son unité (« 630 mm », « 15 steps »), dans la langue. */
function valueWithUnit(t: Translator, v: number, d: number, unit: string | undefined): string {
  const text = fr(t, v, d);
  if (unit === undefined || unit === "") return text;
  const key = UNIT_WORD_KEYS[unit];
  return `${text} ${key === undefined ? unit : t.t(key, { count: Number(v.toFixed(d)) })}`;
}

/** Ligne « mesuré … — min … — max … » d'un résultat de règle. */
export function measuredText(r: RuleResult, t: Translator = translatorOf()): string | undefined {
  const d = measureDecimals(r);
  const parts: string[] = [];
  if (r.measured !== undefined && Number.isFinite(r.measured))
    parts.push(t.t("pdf.compliance.measured", { value: valueWithUnit(t, r.measured, d, r.unit) }));
  if (r.min !== undefined && r.min !== null)
    parts.push(t.t("pdf.compliance.min", { value: valueWithUnit(t, r.min, d, r.unit) }));
  if (r.max !== undefined && r.max !== null)
    parts.push(t.t("pdf.compliance.max", { value: valueWithUnit(t, r.max, d, r.unit) }));
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function provenance(r: RuleResult, t: Translator): string {
  const text = t.t("pdf.compliance.provenance", {
    nature: label(t, NATURE_KEYS, r.nature),
    confidence: label(t, CONFIDENCE_KEYS, r.confidence),
    source: r.source,
  });
  return r.secondarySource ? t.t("pdf.compliance.provenanceSecondary", { text }) : text;
}

/**
 * Justification saisie par l'utilisateur, jointe au contrôle sans le lever
 * (`RuleResult.justification`, porte-à-faux hélicoïdal, décision A12) : reprise telle quelle
 * dans le dossier.
 */
export function justificationText(justification: string, t: Translator = translatorOf()): string {
  return t.t("pdf.compliance.justification", { text: justification });
}
const JUSTIFICATION: Omit<Line, "text"> = { size: 2.6, bold: true, color: INK, indent: 4 };

const SEVERITY_TITLE_KEYS: Readonly<Record<Severity, MessageKey>> = {
  bloquant: "pdf.compliance.severity.bloquant",
  avertissement: "pdf.compliance.severity.avertissement",
  conseil: "pdf.compliance.severity.conseil",
};

/**
 * Surcharges de règles du projet (décision A18 (b) : sévérité choisie par l'utilisateur et
 * justification obligatoire, reprises dans le dossier), une entrée par surcharge.
 */
export function overrideText(
  o: RuleOverride,
  results: readonly RuleResult[],
  t: Translator = translatorOf(),
): string {
  const declared = results.find((r) => r.ruleId === o.ruleId)?.declaredSeverity;
  const chosen =
    o.severity === "ignore"
      ? t.t("pdf.compliance.override.ignored")
      : label(t, SEVERITY_NAME_KEYS, o.severity);
  const from =
    declared !== undefined
      ? t.t("pdf.compliance.override.declared", {
          declared: label(t, SEVERITY_NAME_KEYS, declared),
          chosen,
        })
      : t.t("pdf.compliance.override.notEvaluated", { chosen });
  return t.t("pdf.compliance.override.line", {
    ruleId: o.ruleId,
    from,
    justification: o.justification,
  });
}

/**
 * Lignes du contrôle de conception (avant découpage en pages). `overrides` : surcharges de
 * règles du projet (`project.compliance.overrides`), listées avec leur justification.
 */
export function complianceLines(
  model: Model,
  c: Pick<PdfCanvas, "textWidth">,
  width: number,
  overrides: readonly RuleOverride[] = [],
  t: Translator = translatorOf(),
): Line[] {
  const rep = model.compliance;
  const body = 3;
  const small = 2.6;
  const out: Line[] = [];
  const push = (text: string, style: Omit<Line, "text">): void => {
    const indent = style.indent ?? 0;
    wrapText(c, text, style.size, width - indent, style.bold).forEach((t, i) =>
      out.push({ ...style, text: t, ...(i > 0 ? { before: 0 } : {}) }),
    );
  };
  push(complianceDisclaimer(t), { size: 3.4, bold: true, color: SEVERITY_COLOR.bloquant });
  push(
    t.t("pdf.compliance.summary", {
      profile: rep.profile,
      version: String(rep.rulesVersion),
      contexts: rep.contexts.join(", ") || "—",
      bloquant: String(rep.summary.bloquant),
      avertissement: String(rep.summary.avertissement),
      conseil: String(rep.summary.conseil),
    }),
    { size: body, color: INK, before: 2 },
  );
  for (const n of rep.notes ?? [])
    push(t.t("pdf.compliance.note", { text: tr(t, n) }), { size: small, color: MUTED });
  for (const e of model.errors)
    push(t.t("pdf.compliance.generationError", { text: tr(t, e) }), {
      size: small,
      color: SEVERITY_COLOR.bloquant,
    });
  if (overrides.length > 0) {
    push(t.t("pdf.compliance.overrides", { count: String(overrides.length) }), {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const o of overrides)
      push(overrideText(o, rep.results, t), { size: body, color: INK, indent: 2, before: 1 });
  }

  const results = rep.results;
  const block = (r: RuleResult, color: Rgb, detailed: boolean): void => {
    push(`${r.ruleId} — ${tr(t, ruleDescription(r.ruleId))}`, {
      size: body,
      bold: true,
      color,
      indent: 2,
      before: 1.5,
    });
    const message = tr(t, r.message);
    if (message !== "") push(message, { size: body, color: INK, indent: 4 });
    if (r.justification !== undefined) push(justificationText(r.justification, t), JUSTIFICATION);
    const m = measuredText(r, t);
    if (detailed && m !== undefined) push(m, { size: small, color: INK, indent: 4 });
    if (r.downgradeReason !== undefined) {
      push(
        t.t("pdf.compliance.downgraded", {
          declared: label(t, SEVERITY_NAME_KEYS, r.declaredSeverity),
          reason: tr(t, r.downgradeReason),
        }),
        { size: small, color: MUTED, indent: 4 },
      );
    }
    push(provenance(r, t), { size: small, color: MUTED, indent: 4 });
  };
  for (const s of ["bloquant", "avertissement", "conseil"] as const) {
    const group = results.filter((r) => r.status === "violation" && r.severity === s);
    if (group.length === 0) continue;
    push(`${t.t(SEVERITY_TITLE_KEYS[s])} (${group.length})`, {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of group) block(r, SEVERITY_COLOR[s], true);
  }
  const pending = results.filter((r) => r.status === "non-evaluee");
  if (pending.length > 0) {
    push(t.t("pdf.compliance.pending", { count: String(pending.length) }), {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of pending) block(r, MUTED, false);
  }
  const ok = results.filter((r) => r.status === "ok");
  if (ok.length > 0) {
    push(t.t("pdf.compliance.ok", { count: String(ok.length) }), {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of ok) {
      const m = measuredText(r, t);
      push(`${r.ruleId} — ${tr(t, ruleDescription(r.ruleId))}${m !== undefined ? ` (${m})` : ""}`, {
        size: small,
        color: INK,
        indent: 2,
      });
      if (r.justification !== undefined) push(justificationText(r.justification, t), JUSTIFICATION);
      push(provenance(r, t), { size: 2.2, color: MUTED, indent: 4 });
    }
  }
  if (results.length === 0)
    push(t.t("pdf.compliance.noRules"), { size: body, color: MUTED, before: 2 });
  return out;
}

const lineHeight = (l: Line): number => l.size * 1.35 + (l.before ?? 0);

/** Hauteur réservée à l'avertissement rappelé en tête des pages de suite, mm. */
const REPEATED_DISCLAIMER_H = 3.4 * 1.35;

export function compliancePages(
  c: Pick<PdfCanvas, "textWidth">,
  model: Model,
  frame: Frame,
  overrides: readonly RuleOverride[] = [],
  t: Translator = translatorOf(),
): PageDraft<CompliancePageInfo>[] {
  const lines = complianceLines(model, c, frame.w, overrides, t);
  const disclaimer = complianceDisclaimer(t);
  const chunks: Line[][] = [[]];
  let used = 0;
  for (const l of lines) {
    const h = lineHeight(l);
    if (used + h > frame.h && chunks[chunks.length - 1]!.length > 0) {
      chunks.push([]);
      // Pages de suite : l'avertissement rappelé en tête occupe sa hauteur.
      used = REPEATED_DISCLAIMER_H;
    }
    chunks[chunks.length - 1]!.push(l);
    used += h;
  }
  const title = t.t("pdf.compliance.title");
  return chunks.map((chunk, i) => ({
    info: {
      kind: "compliance" as const,
      title: pagedTitle(t, title, i + 1, chunks.length),
    },
    tocTitle: title,
    draw(cv, f) {
      let y = f.y;
      // L'avertissement est rappelé en tête de chaque page de suite.
      if (i > 0) {
        y += REPEATED_DISCLAIMER_H;
        cv.text(disclaimer, f.x, y - 1, {
          size: 2.6,
          bold: true,
          color: SEVERITY_COLOR.bloquant,
        });
      }
      for (const l of chunk) {
        y += lineHeight(l);
        cv.text(l.text, f.x + (l.indent ?? 0), y - l.size * 0.35, {
          size: l.size,
          color: l.color ?? INK,
          ...(l.bold ? { bold: true } : {}),
        });
      }
    },
  }));
}
