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
import { tr } from "../i18n.js";
import type { PdfCanvas, Rgb } from "./canvas.js";
import { INK, MUTED, fr, wrapText, type Frame, type PageDraft } from "./layout.js";

/** Avertissement imprimé en tête du contrôle de conception (CHALLENGE P3). */
export const COMPLIANCE_DISCLAIMER =
  "Contrôle de conception indicatif, ne vaut pas attestation de conformité.";

export const SEVERITY_COLOR: Readonly<Record<Severity, Rgb>> = {
  bloquant: [209, 36, 47],
  avertissement: [232, 134, 12],
  conseil: [191, 135, 0],
};

const NATURE_LABELS: Readonly<Record<string, string>> = {
  reglementaire: "réglementaire",
  normatif: "normatif",
  metier: "métier",
};
const CONFIDENCE_LABELS: Readonly<Record<string, string>> = {
  eleve: "élevée",
  moyen: "moyenne",
  faible: "faible",
};

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

/** Ligne « mesuré … — min … — max … » d'un résultat de règle. */
export function measuredText(r: RuleResult): string | undefined {
  const u = r.unit !== undefined && r.unit !== "" ? ` ${r.unit}` : "";
  const d = measureDecimals(r);
  const parts: string[] = [];
  if (r.measured !== undefined && Number.isFinite(r.measured))
    parts.push(`mesuré ${fr(r.measured, d)}${u}`);
  if (r.min !== undefined && r.min !== null) parts.push(`min ${fr(r.min, d)}${u}`);
  if (r.max !== undefined && r.max !== null) parts.push(`max ${fr(r.max, d)}${u}`);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

function provenance(r: RuleResult): string {
  const nature = NATURE_LABELS[r.nature] ?? r.nature;
  const conf = CONFIDENCE_LABELS[r.confidence] ?? r.confidence;
  return `Nature : ${nature} — confiance : ${conf} — source : ${r.source}${r.secondarySource ? " (source secondaire : norme payante non lue)" : ""}`;
}

/**
 * Justification saisie par l'utilisateur, jointe au contrôle sans le lever
 * (`RuleResult.justification`, porte-à-faux hélicoïdal, décision A12) : reprise telle quelle
 * dans le dossier.
 */
export function justificationText(justification: string): string {
  return `Justification fournie : ${justification}`;
}
const JUSTIFICATION: Omit<Line, "text"> = { size: 2.6, bold: true, color: INK, indent: 4 };

const SEVERITY_TITLES: Readonly<Record<Severity, string>> = {
  bloquant: "Violations bloquantes",
  avertissement: "Avertissements",
  conseil: "Conseils",
};

/**
 * Surcharges de règles du projet (décision A18 (b) : sévérité choisie par l'utilisateur et
 * justification obligatoire, reprises dans le dossier), une entrée par surcharge.
 */
export function overrideText(o: RuleOverride, results: readonly RuleResult[]): string {
  const declared = results.find((r) => r.ruleId === o.ruleId)?.declaredSeverity;
  const chosen = o.severity === "ignore" ? "ignorée" : o.severity;
  const from =
    declared !== undefined
      ? `sévérité déclarée ${declared} → ${chosen}`
      : `${chosen} (règle non évaluée dans les contextes actifs)`;
  return `${o.ruleId} : ${from}. Justification : ${o.justification}`;
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
  push(COMPLIANCE_DISCLAIMER, { size: 3.4, bold: true, color: SEVERITY_COLOR.bloquant });
  push(
    `Profil ${rep.profile} — règles v${rep.rulesVersion} — contextes : ${rep.contexts.join(", ") || "—"} — ` +
      `${rep.summary.bloquant} bloquant(s), ${rep.summary.avertissement} avertissement(s), ${rep.summary.conseil} conseil(s)`,
    { size: body, color: INK, before: 2 },
  );
  for (const n of rep.notes ?? []) push(`Remarque : ${tr(n)}`, { size: small, color: MUTED });
  for (const e of model.errors)
    push(`Erreur de génération : ${tr(e)}`, { size: small, color: SEVERITY_COLOR.bloquant });
  if (overrides.length > 0) {
    push(`Surcharges de règles par l'utilisateur (${overrides.length})`, {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const o of overrides)
      push(overrideText(o, rep.results), { size: body, color: INK, indent: 2, before: 1 });
  }

  const results = rep.results;
  const block = (r: RuleResult, color: Rgb, detailed: boolean): void => {
    push(`${r.ruleId} — ${tr(ruleDescription(r.ruleId))}`, {
      size: body,
      bold: true,
      color,
      indent: 2,
      before: 1.5,
    });
    const message = tr(r.message);
    if (message !== "") push(message, { size: body, color: INK, indent: 4 });
    if (r.justification !== undefined) push(justificationText(r.justification), JUSTIFICATION);
    const m = measuredText(r);
    if (detailed && m !== undefined) push(m, { size: small, color: INK, indent: 4 });
    if (r.downgradeReason !== undefined) {
      push(`Sévérité déclarée ${r.declaredSeverity}, rétrogradée : ${tr(r.downgradeReason)}`, {
        size: small,
        color: MUTED,
        indent: 4,
      });
    }
    push(provenance(r), { size: small, color: MUTED, indent: 4 });
  };
  for (const s of ["bloquant", "avertissement", "conseil"] as const) {
    const group = results.filter((r) => r.status === "violation" && r.severity === s);
    if (group.length === 0) continue;
    push(`${SEVERITY_TITLES[s]} (${group.length})`, {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of group) block(r, SEVERITY_COLOR[s], true);
  }
  const pending = results.filter((r) => r.status === "non-evaluee");
  if (pending.length > 0) {
    push(`Règles non évaluées (${pending.length})`, {
      size: 3.6,
      bold: true,
      color: INK,
      before: 4,
    });
    for (const r of pending) block(r, MUTED, false);
  }
  const ok = results.filter((r) => r.status === "ok");
  if (ok.length > 0) {
    push(`Règles respectées (${ok.length})`, { size: 3.6, bold: true, color: INK, before: 4 });
    for (const r of ok) {
      const m = measuredText(r);
      push(`${r.ruleId} — ${tr(ruleDescription(r.ruleId))}${m !== undefined ? ` (${m})` : ""}`, {
        size: small,
        color: INK,
        indent: 2,
      });
      if (r.justification !== undefined) push(justificationText(r.justification), JUSTIFICATION);
      push(provenance(r), { size: 2.2, color: MUTED, indent: 4 });
    }
  }
  if (results.length === 0) push("Aucune règle évaluée.", { size: body, color: MUTED, before: 2 });
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
): PageDraft<CompliancePageInfo>[] {
  const lines = complianceLines(model, c, frame.w, overrides);
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
  return chunks.map((chunk, i) => ({
    info: {
      kind: "compliance" as const,
      title:
        chunks.length > 1
          ? `Contrôle de conception (${i + 1}/${chunks.length})`
          : "Contrôle de conception",
    },
    draw(cv, f) {
      let y = f.y;
      // L'avertissement est rappelé en tête de chaque page de suite.
      if (i > 0) {
        y += REPEATED_DISCLAIMER_H;
        cv.text(COMPLIANCE_DISCLAIMER, f.x, y - 1, {
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
