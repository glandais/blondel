/**
 * Heuristique partagée des tests d'exports en anglais (ADR-0007) : repère un texte français
 * resté en dur (lettres accentuées, mots courants du français et du métier), une clé de message
 * restée brute, un paramètre de gabarit non rempli ou une valeur mal convertie en texte
 * (« [object Object] », « undefined », « NaN »).
 *
 * Les textes repris tels quels (nom du projet, identifiants des murs, sources citées des règles,
 * identifiants de contextes) sont retirés avant le contrôle par `residualFrench`.
 */

/** Lettres propres au français (absentes de l'anglais technique). */
export const FRENCH_ACCENTS = /[àâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸ]/u;

/**
 * Mots outils du français, sans faux ami anglais (pas de « par », « un »…). Les mots accentués
 * sont déjà couverts par `FRENCH_ACCENTS`.
 */
const FUNCTION_WORDS = [
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "et",
  "ou",
  "au",
  "aux",
  "une",
  "sur",
  "pour",
  "avec",
  "sans",
  "dans",
];

/** Vocabulaire du métier et des dessins, sans faux ami anglais (pas de « pose », « inox »). */
const TRADE_WORDS = [
  "marche",
  "marches",
  "contremarche",
  "limon",
  "limons",
  "palier",
  "giron",
  "reculement",
  "emmarchement",
  "hauteur",
  "hauteurs",
  "largeur",
  "longueur",
  "pente",
  "escalier",
  "poteau",
  "barreau",
  "barreaux",
  "lisse",
  "platine",
  "garde-corps",
  "main courante",
  "plancher",
  "plafond",
  "jour",
  "rive",
  "bord",
  "gauche",
  "droite",
  "haut",
  "bas",
  "nez",
  "prof",
  "bois",
  "acier",
  "verre",
  "cotes",
  "masse",
  "volumique",
  "valider",
  "incomplet",
  "maillage",
  "vide",
  "remarque",
  "sommaire",
  "nomenclature",
  "gabarit",
  "recouvrement",
  "fiche",
  "conseil",
  "avertissement",
  "bloquant",
  "tracage",
  "mortaise",
  "roulage",
  "texte",
];

const wordRe = (words: readonly string[], flags: string): RegExp =>
  new RegExp(`(?<!\\p{L})(?:${words.join("|")})(?!\\p{L})`, flags);

/** Mot outil français entier, en minuscules seulement (les repères « LE1 », « DE2 » n'en sont pas). */
export const FRENCH_FUNCTION_WORDS = wordRe(FUNCTION_WORDS, "u");

/** Mot français du métier entier (bornes : toute lettre, accentuée ou non ; casse ignorée). */
export const FRENCH_TRADE_WORDS = wordRe(TRADE_WORDS, "iu");

/** Clé de message restée brute (« pdf.toc.title »). */
export const RAW_KEY = /\b[a-z]+(?:\.[A-Za-z0-9_]+){2,}\b/;

/** Paramètre de gabarit non remplacé (« {count} »). */
export const UNFILLED_PARAM = /\{[A-Za-z_][A-Za-z0-9_]*\}/;

/** Valeur mal convertie en texte. */
export const BAD_VALUE = /\[object Object\]|(?<!\p{L})(?:undefined|NaN)(?!\p{L})/u;

const CHECKS: readonly [string, RegExp][] = [
  ["accent", FRENCH_ACCENTS],
  ["mot français", FRENCH_FUNCTION_WORDS],
  ["mot du métier", FRENCH_TRADE_WORDS],
  ["clé brute", RAW_KEY],
  ["paramètre non rempli", UNFILLED_PARAM],
  ["valeur mal convertie", BAD_VALUE],
];

/**
 * Retire de `s` le texte repris `v` : occurrences entières, puis, pour un texte coupé ou
 * renvoyé à la ligne, début de `v` en fin de `s`, fin de `v` en début de `s`, ou ligne entière
 * contenue dans `v` (au moins 4 caractères pour une coupure).
 */
function stripVerbatim(input: string, v: string): string {
  let s = input.split(v).join(" ");
  const trimmed = s.replace(/…\s*$/, "").trim();
  if (trimmed !== "" && v.includes(trimmed)) return "";
  s = s.replace(/…\s*$/, "");
  for (let k = v.length - 1; k >= 4; k--) {
    if (s.trimEnd().endsWith(v.slice(0, k))) {
      s = s.trimEnd().slice(0, -k);
      break;
    }
  }
  for (let k = v.length - 1; k >= 4; k--) {
    if (s.trimStart().startsWith(v.slice(v.length - k))) {
      s = s.trimStart().slice(k);
      break;
    }
  }
  return s;
}

/**
 * Textes suspects (« motif : texte ») parmi `texts`, après retrait des textes repris tels quels
 * (`verbatim`, les plus longs d'abord ; voir `stripVerbatim`).
 */
export function residualFrench(
  texts: readonly string[],
  verbatim: readonly string[] = [],
): string[] {
  const kept = [...new Set(verbatim.filter((v) => v.length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
  const out: string[] = [];
  for (const raw of texts) {
    let s = raw;
    for (const v of kept) s = stripVerbatim(s, v);
    for (const [label, re] of CHECKS) {
      if (re.test(s)) {
        out.push(`${label} : ${raw}`);
        break;
      }
    }
  }
  return out;
}
