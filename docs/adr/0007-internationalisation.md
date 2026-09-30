# ADR-0007 — Internationalisation (français, anglais)

- Statut : accepté le 2026-09-30 (décisions de l'utilisateur) ; mise en œuvre par vagues (socle, core, exports, web, e2e et documentation)

## Constat

Tout le texte visible est écrit en dur, en français, à trois endroits :

- **UI** (`apps/web`) : littéraux JSX, dictionnaires de libellés, notifications du store ;
- **core** : `Model.errors` et `notes` en `string[]`, messages des constats de règles, noms de pièces, messages d'exceptions, libellés des plugins, erreurs zod traduites par `z.locales.fr()` ;
- **exports** : cartouches SVG et DXF, en-têtes CSV, pages PDF, calques DXF, noms glTF, `formatFr`, tri `localeCompare(…, "fr")`.

On veut l'interface et toutes les sorties (page, PDF, DXF, SVG, CSV, glTF) en français ou en anglais, sans relancer de calcul au changement de langue.

## Décision

- **Messages structurés.** Le `Model`, les constats de règles et les erreurs ne contiennent que des `Message` neutres : `{ key, params }`. Un paramètre est un texte brut (repère, nom de projet), un nombre (`{ num, digits?, unit?, trimZeros? }`, mis en forme dans la langue d'affichage) ou un `Message` imbriqué. La traduction a lieu à l'affichage et dans les exports : changer de langue ne relance pas `buildModel` et ne touche pas à la mémoïsation par identité (ADR-0002, ADR-0005).
- **Paquet `@blondel/i18n`** (`packages/i18n`), sans DOM ni dépendance, consommé par core, geometry, exports et l'UI : types `Locale`, `Message`, `MessageKey` ; `msg()`, `num()` ; `createTranslator(locale)` (mémoïsé par langue) qui fournit `t` (interpolation `{name}`, pluriel `Intl.PluralRules` sur le paramètre `count` avec sous-clés `.one` / `.other`, repli sur la clé), `num`, `date` et `compare`.
- **Un JSON plat par langue** : `packages/i18n/src/locales/fr.json` et `en.json`, clés ASCII `domaine.sousDomaine.element` triées (par exemple `ui.toolbar.undo.title`, `rules.H_MAX_DTU.description`, `dxf.layer.outline`). Ajouter une langue = ajouter un fichier et l'entrée de `Locale`.
- **`fr.json` fait foi** : `MessageKey` est dérivé de ses clés (`keyof typeof fr`), une clé inconnue ne compile pas. Les tests vérifient la parité exacte des clés fr/en, l'égalité des paramètres `{…}`, l'absence de valeur vide, l'ordre des clés, l'existence de toute clé littérale employée dans le code et l'absence de clé orpheline (familles de clés construites dynamiquement déclarées dans `src/dynamicKeys.ts` : seulement `rules.<ID>.description`).
- **Langue de l'UI** : celle du navigateur au premier lancement (`en*` → anglais, sinon français), puis le choix de l'utilisateur, mémorisé dans le navigateur.
- **Français par défaut dans core et les exports** : les exports reçoivent une option `locale?` (français si absente) et core garde ses valeurs par défaut en français (nom de projet de `createProject`…). Les exemples `examples/*.blondel.json` et les instantanés existants restent identiques octet par octet ; les variantes anglaises sont testées à part.
- **Nombres** : le français reprend exactement `formatFr` (virgule décimale, espace fine insécable U+202F en milliers, `-0` → `0`, valeur non finie → « — »), vérifié par un test de propriété ; l'anglais utilise le point décimal et la virgule en milliers. L'unité suit la valeur après une espace insécable U+00A0 en français (règle typographique : pas de coupure entre la valeur et l'unité), une espace simple en anglais ; `°`, `′` et `″` restent accolés. Le format machine des coordonnées SVG/DXF (`formatNum`) ne dépend pas de la langue (ADR-0003).
- **Dates** : JJ/MM/AAAA en français, AAAA-MM-JJ (ISO 8601) en anglais, pour éviter l'ambiguïté entre usages britannique et américain.
- **Calques DXF traduits**, toujours passés par `sanitizeLayerName`. CSV anglais : séparateur `,` et point décimal ; CSV français inchangé (`;`, virgule, BOM).
- **Terminologie** : les traductions anglaises suivent `docs/research/glossaire-en.md` et sont **à valider** par un utilisateur anglophone du métier. Les titres et références de normes (NF DTU 36.3, NF P01-012…) restent dans leur langue d'origine.
- **Seuils des règles** : `docs/research/rules.yaml` reste la source des seuils et de la description française ; un test vérifie que `fr.json` reprend la description du yaml.

## Conséquences

- Aucun texte visible n'est écrit en dur dans le code : les libellés vivent dans `packages/i18n/src/locales/*.json`. Les tests de texte s'écrivent sur la `key` du message, ou sur `createTranslator("fr").t(m)`.
- Les exceptions métier portent un `Message` (base `BlondelError`) ; `buildModel` continue de ne jamais lever et rend des `Message` dans `Model.errors`.
- Les comparaisons de texte dans le code (`startsWith("…")`) comparent désormais des clés.
- Le volume de clés (de 1 500 à 2 500) impose une migration par vagues : pendant la migration, des clés pouvaient être déclarées en attente (`PENDING_KEYS`, retiré à l'intégration de la vague 4 : le contrôle des clés orphelines est strict). Pendant une vague parallèle, chaque domaine écrit ses clés dans un fragment `locales/_wip/<domaine>.{fr,en}.json`, déclaré dans `locales/wip.ts` avant le lancement des agents : ses clés sont alors typées, traduites et contrôlées comme les autres ; `pnpm i18n:merge` les fusionne ensuite dans `fr.json` / `en.json`.

## Mise en œuvre dans core (vague 2)

### Types du `Model`

| Emplacement                                                                                                                                                                                                            | Type                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Model.errors` / `notes`, `Layout.errors`, `Stepping.notes`, `ComplianceReport.notes`, `ModelPrecheck.notes`, `StructureOutput.notes` / `errors`                                                                       | `readonly Message[]`                                                              |
| `Part.name`, `Part.section`, `FlatPattern.lines[].label`, `FlatPattern.reference.description`, `RuleResult.message` / `downgradeReason`, `Finding.message` / `severityReason`, `fail.reason` d'une `BalancingSolution` | `Message` (`textMessage(s)` pour un texte brut : repère, désignation « UPN 200 ») |
| `StructureKind.labelKey`, `BalancingStrategy.labelKey`                                                                                                                                                                 | `MessageKey` (`structure.<kind>.label`, `balancing.<méthode>.label`)              |

`RuleResult.description` et `PluginRuleSpec.description` n'existent plus : la description d'une règle est `ruleDescription(ruleId)` (clé `rules.<id>.description`). Restent des `string` : identifiants, repères (`Part.mark`), unités (`RuleResult.unit`), sources citées (`RuleResult.source`, `PluginRuleSpec.source`, non traduites pour l'instant) et textes saisis. `RuleDef.description` (rules.yaml) reste le texte français de référence ; pour un contrôle de plugin il vaut `""` et ne s'affiche jamais.

### Exceptions

`LayoutError`, `SteppingError`, `GuardError`, `StructureError`, `GeometryError` étendent `MessageError` : `.msg` est la donnée, `.message` la traduction française (les `toThrow(/texte fr/)` restent valables). `errorMessage(e)` rend le `.msg` d'une `MessageError`, sinon `textMessage(e.message)`. Les comparaisons de texte sont remplacées par des comparaisons de clés ou `messageEquals(a, b)` (égalité structurelle).

### Nombres dans les paramètres

- `dec(x, digits = 1)` remplace l'ancien `fmt` : rendu français identique à l'octet près (arrondi, zéros inutiles supprimés, sans séparateur de milliers) ; `dec(n, 0)` sert aussi de `count` d'un pluriel sans séparateur.
- `num(x, digits?, unit?)` : nombre localisé avec séparateur de milliers (remplace `toLocaleString("fr-FR")`).
- `x.toFixed(d)` ou `String(x)` passés en texte : rendu neutre inchangé. Un `count` passé en texte ne déclenche pas le pluriel.
- Pluriel : sous-clés `.one` / `.other` ; tant que le français doit rester identique, ses deux variantes gardent l'ancienne forme « (s) ».

### Préfixes de clés par domaine

`common.*`, `error.*`, `model.*`, `pipeline.*` (socle) ; `layout.*`, `stepping.*`, `balancing.*`, `headroom.*` ; `rules.*`, `compliance.*`, `ruleFamily.*` (dont `compliance.check.*`, boîte à outils des constats) ; `structure.<kind>.*`, `structure.common.*`, `structure.steel.*` ; `guard.*`, `part.*`, `catalog.*`, `geometry.*` ; `assistant.*`, `site.*`, `project.*`, `precheck.*`, `workshop.*`, `preset.*`. Les contrôles de plugin déclarent `rules.<ID>.description` (et leurs autres textes `rules.<ID>.*`).

### Tests

`packages/core/src/i18n.test-helpers.ts` fournit `fr(m)` et `frList(ms)` (traduction française) pour conserver les assertions textuelles ; on vérifie en plus la clé (`expect(m.key).toBe(…)`, `toContainEqual(msg(…))`) et au moins un rendu anglais (`translatorFor("en").t(m)`).

## Mise en œuvre dans exports (vague 3)

### Langue d'un export

- Toutes les options publiques étendent `LocaleOption` (`locale?: Locale`, français par défaut) : `PlanDrawingOptions` (donc `PlanSvgOptions`, `PlanDxfOptions`), `ElevationSvgOptions`, `FlatPatternSvgOptions`, `PartDxfOptions` / `PartsDxfOptions`, `CutListRowsOptions`, `CutListCsvOptions`, `CutSheetOptions`, `InstallationSheetOptions`, `GlbOptions`, `PdfLayoutOptions` (donc `PdfOptions`), `TemplateSheetOptions`. `ZipOptions` et `exportProjectJson` n'ont pas de texte visible.
- `src/i18n.ts` : `translatorOf(options)` en tête de chaque export public (`tx` quand `t` est déjà pris), paramètre `t: Translator` obligatoire dans les fonctions internes (un oubli ne compile pas), `...localeOption(t)` pour transmettre la langue à un export appelé (PDF → plan, élévation, développés, débit, fiche de pose ; `exportPartsDxf` → `exportPartDxf` ; `exportCutListCsv` → `cutListRows`). `tr` / `trOpt` traduisent les `Message` du `Model` (`Part.name`, `section`, libellés du développé, constats) ; `materialLabel` / `MATERIAL_KEYS` les matériaux ; `compareText` / `compareMarks` remplacent `localeCompare(…, "fr")`.
- Clés littérales dans le code (le test des clés orphelines scanne les littéraux) : tables `Record<…, MessageKey>` écrites en clair, jamais de clé construite par gabarit.
- Préfixes : `export.common.*` (dont `export.common.defaultName`, « Escalier » / « Staircase »), `material.*`, `pdf.*`, `drawing.*` (plan, élévation, développé, cartouche, annotations), `dxf.*` (dont `dxf.layer.*`), `csv.*`, `installation.*`, `gltf.*`, `template.family.*` (`templateFamily.*` est refusé : pas de majuscule dans le premier segment d'une clé).

### Nombres et formats

- `formatIn(t, v, { decimals, thousands, trimZeros })` remplace `formatFr` (rendu français identique ; l'alias `formatFr` est retiré en vague 4). `formatNum` (format machine SVG/DXF) est inchangé.
- Dessins (cotes, cartouches) : `drawingThousands(t)` garde l'espace simple historique en français (« 2 700 ») et prend le séparateur de la langue ailleurs (« 2,700 ») ; pas de séparateur de milliers dans les développés.
- CSV : `csvSeparator(locale)` (`CsvSeparator = ";" | ","`) ; anglais = `,` et point décimal, français inchangé (`;`, virgule, BOM, CRLF). `csvField` / `csvTextField` citent le séparateur de la langue (type fermé : `fields.map(csvField)` ne compile pas).
- Dates : `t.date` (JJ/MM/AAAA, AAAA-MM-JJ en anglais ; « — » pour une date invalide).

### Libellés publics dans la langue

Des fonctions de la langue (français par défaut) : `planLayers(t)`, `partLayers(t)` (noms traduits puis passés par `sanitizeLayerName`, mémoïsés par langue ; anglais OUTLINE, TREADS, NOSINGS, WALKLINE, OPENING, DIMENSIONS, TEXT, BEND, MARKING, MORTISE, TENON, ROLLING, JOINT, INFO), `cutListHeader(t)`, `massDensityNote(t)`, `templateFamilyLabel(f, t)`, `complianceDisclaimer(t)`. Les constantes françaises de compatibilité de la vague 3 (`PLAN_LAYERS`, `PART_LAYERS`, `CUT_LIST_HEADER`, `MASS_DENSITY_NOTE`, `TEMPLATE_FAMILY_LABELS`, `COMPLIANCE_DISCLAIMER`, `formatFr`) ne servaient plus qu'aux tests : elles sont retirées en vague 4, les tests appellent la fonction sans traducteur (français). Une `MassNote` reçoit le traducteur en second argument (une remarque personnalisée qui l'ignore reste dans sa langue).

### glTF et PDF

- glTF : nom de scène par défaut `export.common.defaultName` (le titre ou le nom du projet, s'il est donné, est repris tel quel), `extras` textuels traduits ; noms de nœuds = repères, inchangés.
- PDF : titres de pages, sommaire, cartouche, métadonnée `subject`, notes d'échelle, fiche de pose et contrôle de conception traduits ; unités en mots des règles (`marches`, `unite`) accordées par valeur en anglais (`.one` / `.other`, français inchangé). Les lignes de débit et libellés de points de pose arrivent déjà traduits des exports de données.

### Restent tels quels

Textes saisis (nom du projet, identifiants de murs), sources citées des règles (`RuleResult.source`), identifiants du contrôle de conception (profil, contextes, identifiants de règles), méthode de balancement (identifiant brut), messages `RangeError` internes (`zip.ts`, « Version DXF inconnue », branche inatteignable), symboles `√` / `∞` de `toWinAnsi`.

### Tests

- Français : instantanés, `examples/` et tests existants inchangés octet par octet ; `locale: "fr"` explicite = défaut.
- Anglais : `svg/english.test.ts` (dessins, DXF, calques), `data.en.test.ts` (CSV, débit, pose, glTF, instantané anglais de la liste de débit), `pdf/locale.test.ts` (dossier PDF) et `i18n.test.ts`, test transversal : chaque exemple de `examples/` × chaque format en anglais, sans texte français, clé brute, paramètre non rempli ni « [object Object] ». Heuristique partagée : `src/testing/french.ts` (`residualFrench`, lettres accentuées, mots outils en minuscules, vocabulaire du métier), textes repris exclus.
- Termes anglais **à valider** (glossaire) : « Installation sheet », « Sheet » (folio), « Flat pattern » pour tous les développés (le glossaire propose « development » pour un limon bois), « HR = » (échappée mesurée), « R » à la fois rayon et hauteur de marche dans un même cartouche.

## Mise en œuvre dans apps/web (vague 4)

### Langue de l'interface

- `AppState.locale` / `setLocale(locale)` (`store/projectStore.ts`) ; option `createProjectStore({ locale })` (défaut `"fr"` : tests).
- Démarrage : `initialLocale(storage, navigator.language)` (`i18n/locale.ts`) = choix mémorisé dans `localStorage` (`blondel.lang`), sinon `en*` → anglais, sinon français. `store/appStore.ts` reporte la langue sur `<html lang>` et la mémorise à chaque changement.
- Sélecteur `components/LanguageToggle.tsx` : liste « Langue / Language » (`common.language.*`), dans le groupe « Affichage » de la barre d'outils, à côté du thème.
- Changer de langue ne relance **aucun** calcul : la langue n'est jamais passée au job `build` ni au `Model` ; seuls les jobs `pdf` et `glb` la reçoivent (`model/protocol.ts`) et rendent leurs erreurs déjà traduites.

### Traduire

- Composants : `const t = useT()` (`i18n/useT.ts`, traducteur mémoïsé par langue : même objet tant qu'elle ne change pas) ; `t.t(clé | message, params?)`, `t.locale`. Aucune traduction au niveau du module ; `t` (ou `t.locale`) figure dans les dépendances des `useMemo` / `useEffect` qui produisent du texte. Attributs `title`, `aria-label`, `placeholder`, `alt` compris.
- Hors composants (`lib/`, `store/`, `model/`, `three/`), pas de langue globale : une fonction qui rend du texte reçoit un `Translator` (ou une `Locale` si elle ne formate que des nombres) en dernier paramètre, ou mieux rend des clés / `Message` que le composant traduit (`Text = Message | MessageKey`, `toMessage`, `joinMessages` dans `i18n/text.ts`). Ce qui tourne dans le worker (`runVariants`, `computeModel`, instantané) rend des `Message`.
- Notifications du store : `Notice = { kind, msg: Message, details?: readonly Message[] }`, traduites à l'affichage par `Toolbar` (un changement de langue les retraduit).
- Dictionnaires partagés de `lib/` (libellés de paramètres, garde-corps, familles de pièces, matériaux, gravités, typologies, méthodes de balancement, barème, accroche, exports, préréglages) : des `MessageKey`, affichées par `t.t(X[k])`.
- Nombres : `numberFormat(locale, options)` / `formatNumber(locale, value, options)` (`i18n/locale.ts`, `Intl.NumberFormat` mémoïsé, `fr-FR` ou `en-GB`), `lib/units.ts` (`formatInt`, `formatLength`, `formatDecimal`…) ; dans un message, un paramètre `{ num, digits, unit }` ou `t.num`. La saisie accepte la virgule **et** le point dans les deux langues.
- Exports et SVG affichés (ce sont ceux des exports) : `buildExport(id, project, model, deps, locale)`, `renderPlanForScreen` / `renderElevationForScreen` / `renderFlatPatternSvg` avec `locale` ; les noms des fichiers téléchargés suivent la langue (`ui.label.exportFile.*`).

### Clés

Préfixes : `ui.common.*`, `ui.label.*`, `ui.param.*`, `ui.language.*` (socle) ; `ui.notice.*`, `ui.worker.*`, `ui.lib.*` (lib, store, model) ; `ui.assistant.*`, `ui.params.*`, `ui.fields.*`, `ui.structure.*`, `ui.helical.*`, `ui.precheck.*`, `ui.compliance.*`, `ui.errors.*`, `ui.export.*`, `ui.import.*`, `ui.status.*`, `ui.toolbar.*`, `ui.underlay.*`, `ui.welcome.*`, `ui.workshop.*`, `ui.guards.*`, `ui.theme.*` (composants) ; `ui.view.*`, `ui.viewer3d.*`, `ui.plan.*`, `ui.bom.*`, `ui.compare.*`, `ui.flat.*`, `ui.three.*`, `ui.app.*` (vues). Une notion déjà affichée par le cœur ou les exports réutilise leur clé (`material.*`, `preset.*`, `rules.<id>.description`, `compliance.*`, `assistant.typology.*`, `structure.<kind>.label`, `pdf.bom.col.*`…). Toute clé est écrite en littéral (`Record<Id, MessageKey>`), jamais construite par gabarit.

### Garde-fous

- `apps/web/src/architecture.test.ts` : aucun texte JSX littéral contenant une lettre, ni attribut `title` / `aria-label` / `placeholder` / `alt` littéral, dans `components/`, `views/` et `App.tsx` (analyse syntaxique TSX, avec auto-test du détecteur) ; exceptions : « Blondel », unités, notation des Eurocodes du pré-dimensionnement. Aucun `toLocaleString("fr…")` ni `Intl.*("fr…")` écrit en dur dans `apps/web/src`.
- Tests de rendu anglais : `components/paramsPanel.i18n.test.ts`, `components/toolbar.i18n.test.ts` (aucune clé brute affichée).
- e2e : `openApp` (`e2e/support.ts`) impose le français (`startInLanguage`, contexte `fr-FR`) : les specs existantes vérifient les libellés français, identiques à ceux d'avant la migration. `e2e/i18n.spec.ts` démarre avec un navigateur `en-US` sans ce forçage : interface anglaise et `html[lang=en]`, passage en français par le sélecteur, persistance au rechargement, constat du contrôle de conception et export CSV en anglais.

### Restes connus

- Textes mis en chaîne au moment de l'action, qui ne suivent pas un changement de langue ultérieur : refus de schéma (`UpdateResult.issues`, `string[]` traduit au refus : `PlanSiteEditor`, `PlanSurveyForm`), erreurs de l'assistant et motifs de recalage, motifs d'une copie de sauvegarde refusée, erreurs brutes du worker de l'assistant.
- Le refus de schéma se lit désormais « chemin (libellé) : motif » en français au lieu du message zod brut ; la ligne méta d'une règle du contrôle de conception affiche « réglementaire · confiance élevée » (libellés traduits) au lieu des identifiants bruts.
- Restent affichés tels quels : profil et contextes du contrôle (identifiants), messages d'exception bruts du rendu des plans (`rendered.error`) et du calibrage.
- Termes anglais **à valider** : « steel » (famille métal), « building permit » (référence PC/DP), « PDF file » (dossier).
