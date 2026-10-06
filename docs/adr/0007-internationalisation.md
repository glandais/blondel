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

### Restes traités (vague 5)

- **Plus aucun texte figé dans la langue du moment** : tout motif conservé dans un état (store, `useState`, notification) est un `Message`, traduit au rendu ; un changement de langue le retraduit.
  - `UpdateResult.issues` : `readonly Message[]` (« chemin (libellé) : motif », `projectIssueMessage`) ; les champs (`fields.tsx`), `PlanSiteEditor`, `PlanSurveyForm`, `PlanExpertEditor`, `UnderlayImport`, `ErrorsBar`, `CompliancePanel` (surcharge refusée) et `StructureSection` gardent le `Message`. Plusieurs motifs : `listMessages` (`i18n/text.ts`, clé `ui.common.joinList`, « a ; b » / « a; b »), ex. recalage refusé (`ui.params.realign.failed`).
  - Assistant : `formOpening` et `assistantInput` rendent des `Message` (plus de paramètre `Translator`) ; la fenêtre garde `Message[]` et l'échec de la recherche en `Message` (`errorMessageOf`). Le worker de l'assistant poste `error: Message` (`errorMessage`, clonable) ; le client lève une `MessageError`.
  - Worker de calcul : `PdfResult.error` / `GlbResult.error` sont des `Message` (plus traduits dans la langue du job) ; `workerClient` lève une `MessageError`, que `ExportMenu` affiche par `errorMessage(e)`.
  - Autosauvegarde refusée et copie de secours : `reason` / `details` en `Message` ; la restauration refusée reprend les `Message` d'`apply` (plus de `textMessage` d'un texte déjà traduit).
  - Rendus SVG de l'écran (`renderWith`) et calibrage du calque : `errorMessage(e)` (le `Message` d'une exception métier, sinon le texte brut de l'exception en paramètre d'une clé traduite).
  - Restent en texte brut (`textMessage`) : repères, désignations (« UPN 200 », « Ø42 »), saisies, identifiants inconnus (repli), notation technique des zones balancées, texte d'une exception JavaScript inattendue (toujours en paramètre d'une clé traduite, ex. « Erreur de l'assistant : {detail} »).
- Nom commun des tronçons (`FlatPatternView`) : `segmentedPartName` (`lib/joints.ts`) choisit sur la **clé** du `Part.name` (`structure.steelCurved.part.segment` → `structure.steelCurved.part.outerString`), plus d'expression sur le texte français ou anglais.
- Nom d'un projet neuf dans la langue de l'interface : démarrage sans autosauvegarde, préréglage (`loadPreset`), démo (`loadDemo`) ; import d'un fichier **sans** `name` : `ui.lib.project.untitled` (« Sans titre » / « Untitled », option `untitledName` d'`importProjectText`). L'assistant et le changement de type de tracé gardent le nom courant. Le cœur garde ses noms français par défaut (`examples/` inchangés).
- Taille du bloc principal : les dictionnaires (`packages/i18n/src/locales/*.json`, ≈ 450 ko minifiés) sont dans leur propre morceau `i18n-locales` (`build.rolldownOptions.output.codeSplitting.groups`, `apps/web/vite.config.ts`), chargé au démarrage ; limite d'avertissement inchangée (1 200 ko). Les workers (bundles séparés) embarquent toujours leurs dictionnaires.
- Textes français **volontairement changés** par la migration (plus lisibles, conservés) : le refus d'une modification se lit « chemin (libellé) : motif » au lieu du message zod brut ; la ligne méta d'une règle du contrôle de conception affiche « réglementaire · confiance élevée » (libellés traduits) au lieu des identifiants bruts. Aucun test e2e ni unitaire ne dépend de l'ancienne forme (vérifié : les e2e contrôlent la présence de l'alerte ou des libellés de champ, pas le texte zod).

- Revue de complétude : paramètres d'un plugin refusés par son schéma (`resolveStructureParams`, `pipeline/build.ts`) analysés avec la carte d'erreurs du cœur (`projectErrorMap`, `reportInput`) et rendus en `Message` (« chemin (libellé) : motif », joints par `common.list`), au lieu des textes anglais bruts de zod ; section hors catalogue de `steel-profile` : `structure.steelProfile.issue.unknownSection` (dans `params.message` de l'issue) ; export indisponible (`buildExport`) : `MessageError` au lieu d'un texte traduit à la levée ; « R int » (abréviation française) retiré des libellés anglais du débillardé (« inner R »).

### Documentation

`docs/ARCHITECTURE.md` (section « Internationalisation » et point d'extension « une langue »), `CLAUDE.md` (invariant : aucun texte affiché écrit en dur), `docs/ACCEPTATION.md` (critère n° 6) et `docs/QUESTIONS.md` (A26 : termes anglais et textes restés en français ; B12 : relecture du glossaire ; D6 : pluriels « (s) »).

### Restes connus

Restent, suivis dans `docs/QUESTIONS.md` :

- En français : noms par défaut du cœur (« Sans titre », préréglages) quand l'interface ne fournit pas de nom (A26). Messages d'erreurs de programmation (`RangeError` / `Error` internes de core, geometry, exports, du worker et de `main.tsx`) : voulu, ils n'atteignent l'utilisateur qu'en paramètre d'une clé traduite (« Export impossible : {error} »).
- Pluriels « (s) » dans quelques textes anglais : `drawing.common.complianceSummary`, `pdf.compliance.summary`, `pdf.toc.templateTiles`, `stepping.perAngleZones*` (D6).
- Termes anglais **à valider** par un anglophone du métier : tout le glossaire (B12). Les termes en suspens de A26 sont tranchés par l'utilisateur le 2026-10-06 : « Installation sheet », « Sheet », « HR = », « steel », « building permit », « PDF file » gardés.

Levés le 2026-10-06 (décision A26 de l'utilisateur) :

- Développés : « Development » pour un limon ou une crémaillère en bois, « Flat pattern » pour la tôle et l'acier ; français « Développé » inchangé (clés `*.titleDevelopment`, `*.development*` au texte français identique ; choix unique dans `packages/exports/src/flatTerms.ts` : `isTimberDevelopment`, `flatTermKeys`, `flatDrawingTitle`, `pdfFlatTitle`). Libellés génériques sans pièce (onglet, menu d'export) inchangés.
- « R » réservé au rayon dans les cartouches anglais du plan et de l'élévation : hauteur de marche écrite « rise » (« 15 rises of 175.0 mm », « 2 × rise + going = … », « First rise = … ») ; français inchangé (h pour la hauteur, R pour le rayon). Glossaire, section « Notations des cartouches ».
- Sources citées traduites : `source_en` pour chacune des 103 règles de `rules.yaml` (champ obligatoire du schéma, `RuleDefSchema`) ; `RuleResult.sourceMessage` pour les contrôles hors table (plugins, garde-corps, prédimensionnement, profil d'atelier ; `sourceSpec` / `ruleDefSource` dérivent la chaîne française du message : `RuleResult.source` inchangée) ; `SteelSection.sourceMessage` (« consulté le » / « accessed », date ISO) et `StairLoads.sourceMessage` (notes du prédimensionnement). Affichage unique : `ruleSourceText(result, t)` et `ruleDefSourceText(def, t)` (`packages/core/src/rules/sources.ts`), utilisés par le dossier PDF, la fiche de pose et l'inspecteur Règle. Titres de normes dans leur langue (glossaire, Conventions).
- Profil du contrôle : libellé traduit dans le dossier PDF (`profileLabel`, « Profil souple » / « Profile Lenient ») ; l'interface l'affichait déjà par `ui.params.compliance.profile.*`.
- Test anglais transversal : `packages/exports/src/testing/french.ts` ne retire plus les sources citées ; seule une liste blanche (`CITED_FRENCH_REFERENCES` : « Arrêté(s) », « arrêté », « Légifrance ») est permise ; dossier PDF anglais de **tous** les `examples/` contrôlé (`pdf/locale.test.ts`), sources de tous les résultats des exemples (`packages/core/src/rules/sources.test.ts`).
