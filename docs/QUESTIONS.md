# Questions ouvertes — liste consolidée

> 2026-09-30. Consolidation des 250 points non cochés de `docs/LEDGER.md` §2, vérifiés un par un sur le code du commit 861d00d (lecture, recherche, sondes de test), et des questions encore ouvertes de `docs/SPEC.md` §7. Cette liste remplace la lecture du §2 du ledger, qui reste l'historique (ajouts seulement). Les points vérifiés comme résolus y sont cochés « résolu (vérifié 2026-09-30) ».

Bilan de la vérification : 250 points examinés ; 43 résolus ou sans objet (cochés dans le ledger) ; 207 encore ouverts, en tout ou en partie, regroupés ici en 25 décisions (A), 11 thèmes de validation (B), 12 questions de normes ou juridiques (C) et une liste de dette technique (D). Un même point du ledger peut alimenter plusieurs entrées.

Conventions :

- « l. N » renvoie à la ligne N de `docs/LEDGER.md` (numérotation au 2026-09-30), suivie du jalon et de l'agent d'origine.
- Chemins de code relatifs à `packages/core/src/` sauf mention contraire (`apps/web/…`, `packages/exports/…`, `packages/geometry/…`).
- « Proposition » = ce qui serait appliqué si la question n'est pas tranchée autrement ; « Aujourd'hui » = comportement du code actuel.

## A. Décisions à prendre par l'utilisateur

Classées de la plus impactante (violation bloquante ou résultat faux sur un cas courant) à la moins impactante (présentation). Répondre « oui » à une entrée revient à valider sa proposition.

### A1. Hauteur du garde-corps sur un palier

Sur la partie horizontale d'un palier, faut-il rehausser automatiquement la main courante à la hauteur exigée pour un palier (1 000 mm en 1988, h(E) en 2024) ?

- Proposition : oui, rehausse automatique sur la partie horizontale, avec un raccord incliné sur un giron de part et d'autre.
- Aujourd'hui : la hauteur du rampant (`flight.height`, 900 mm) est gardée ; le préréglage « quart tournant avec palier » muni de garde-corps sort `GC_HAUTEUR_2024` **bloquant** (vérifié à H 2 500, 2 700 et 2 900).
- Réf. : l. 158 (J4, core:guards), l. 194 (J4, core:project) ; `guards/compute.ts`.
- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30** — paramètre : `guards.flight.landing` (`raise`, défaut `true` ; `height`, défaut 1 000 mm, GC_HAUTEUR_PALIER_1988 et h(E ≤ 250) de GC_HAUTEUR_2024 ; `ramp`, défaut `auto` = un giron, à valider). Le préréglage « quart tournant avec palier » avec garde-corps ne sort plus de violation bloquante à H 2 500, 2 700 et 2 900 (régimes 1988 et 2024) ; `raise: false` rend l'ancien comportement.

### A2. Main courante des deux côtés en ERP et en parties communes

Faut-il que `handrail.wallSides` passe automatiquement à « les deux côtés » quand un contexte ERP ou BHC est actif ?

- Proposition : oui (la valeur `auto` en tient compte ; l'utilisateur garde la main).
- Aujourd'hui : `auto` ignore le contexte ; tout escalier ERP / BHC sort `MC_DEUX_COTES` en violation tant que l'utilisateur ne choisit pas `both`, y compris depuis l'assistant.
- Réf. : l. 162 (J4, core:guards) ; `guards/spec.ts`, `guards/compute.ts`, `apps/web/src/lib/assistant.ts`.
- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30** — paramètre : `guards.handrail.wallSides` ; `auto` pose les deux côtés quand MC_DEUX_COTES s'applique (ERP neuf, parties communes de BHC), sauf exception de l'hélicoïdal ERP neuf à fût de Ø ≤ 400 mm et sauf surcharge « ignore » de la règle ; toute valeur explicite est respectée (`guards/handrailSides.ts`). L'assistant web en hérite : il ajoute `GuardsSpecSchema.parse({})`, donc `wallSides: auto` (`apps/web/src/lib/assistant.ts`, vérifié à l'intégration de la vague H). La remarque « posée des deux côtés » n'est émise que si les deux côtés reçoivent effectivement une main courante (sinon remarque explicite : côté jour sans mur ni garde-corps) ; changer le contexte réglementaire recalcule les mains courantes `auto` (clé de cache du pipeline).

### A3. Poteau d'angle et main courante

Quand un garde-corps longe le jour, le poteau d'angle doit-il monter au-dessus de la main courante ?

- Proposition : oui, hauteur du poteau = max(plus haut élément reçu + 150 mm, main courante + 50 mm).
- Aujourd'hui : aucun lien entre structure et garde-corps ; sur l'exemple bois avec garde-corps, le poteau s'arrête à 1 238 mm et la main courante passe à 1 791 mm, environ 550 mm au-dessus.
- Réf. : l. 159 (J4, core:guards), l. 135 (J3a, core:structures) ; `structures/newel.ts`, `guards/compute.ts`.
- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30** — paramètre : `guards.posts.newelOverrun` (défaut 50 mm, à valider ; `off` = ancien comportement) avec le dépassement du plugin (`newel.topExtension`, 150 mm en bois, 0 en acier) : sommet du poteau = max(plus haut élément reçu + `topExtension`, dessus de main courante dans l'emprise du poteau + `newelOverrun`), pour `wood-housed`, `steel-flat` et `steel-profile`. Exemple bois avec garde-corps : poteau monté au-dessus de la main courante (remarque dans le modèle).

### A4. Jour vif ou poteau par défaut dans les préréglages tournants

Les préréglages tournants doivent-ils poser un poteau d'angle de 100 mm dès qu'une structure qui l'exige est choisie ?

- Proposition : oui, appliquer la correction `jour-newel` automatiquement au choix d'une structure de `NEWEL_REQUIRED_STRUCTURES` (bois à la française, plat laser, profilés), avec une remarque ; garder le jour vif sans structure.
- Aujourd'hui : jour vif dans tous les préréglages ; le choix d'une de ces structures produit une erreur « jour à angle vif… » et un bouton de correction. Jours du U (400 mm) et du demi-tournant (240 mm) choisis par balayage du collet, sans source.
- Réf. : l. 41 (J2, core:project), l. 192 (J3b, integration), l. 136 (J3a, core:structures), l. 196 (J3b, core:project) ; `project/presets.ts`, `project/fixes.ts`.
- **Décision de l'utilisateur (2026-09-30)** : poteau automatique au choix d'une structure qui l'exige (jour → poteau 100 mm, modification annulable, remarque affichée) ; jour vif conservé sans structure.
- Implémenté le 2026-09-30 — paramètre : `DEFAULT_NEWEL_SIZE` = 100 mm (C §1.9, confiance faible, à valider) ; cœur `applyStructureChoice(project, kind, params)` (`packages/core/src/project/structureChoice.ts`) → `{ project, notes }`, qui passe les jours vifs en poteau pour `NEWEL_REQUIRED_STRUCTURES` (même poteau que la correction `jour-newel`), laisse les jours en arc et les autres structures intacts, et garde le jour vif si le tracé refuse le poteau (remarque). Interface : le changement de structure passe par cette fonction (`apps/web/src/lib/structureChoice.ts`), une seule entrée d'annulation, remarque dans le bandeau d'information. Assistant : même poteau (`expectedNewel`). Tests : `structureChoice.test.ts`, `apps/web/e2e/structure-choice.spec.ts`.

### A5. Giron au collet d'un hélicoïdal à fût

La règle `G_COLLET_MIN` (100 mm) doit-elle s'appliquer aux hélicoïdaux à fût central ?

- Proposition : non pour un fût (la DIN 18065 admet 0 mm au noyau, A §1.9) ; oui pour un hélicoïdal à jour central.
- Aujourd'hui : avertissement sur toutes les marches du préréglage hélicoïdal (collet ≈ 37 mm ; 100 mm exigerait un fût de plus de Ø 400).
- Réf. : l. 210 (J5a, core:j5a), l. 249 (J5a, core:project) ; `rules/evaluators/going.ts`.

### A6. Masses affichées

Faut-il afficher partout la masse calculée (`mass_kg`), y compris pour le bois dont les masses volumiques sont « à valider » ?

- Proposition : oui, dans la liste de débit CSV, la fiche de débit PDF et la nomenclature, avec la mention « masse volumique à valider » pour le bois.
- Aujourd'hui : seul le comparateur somme `mass_kg`. Les exports lisent la clé `mass`, que plus aucun plugin ne remplit : la colonne masse est vide et le total « incomplet », **y compris pour l'acier**.
- Réf. : l. 139 (J3a, core:structures), l. 86 (J3, exports), l. 240 (J6, exports:j6) ; `packages/exports/src/csv/cutlist.ts`, `packages/exports/src/cutsheet.ts`, `structures/quantities.ts`.
- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30** — paramètre : option `massNote` de `cutListRows`, `exportCutListCsv`, `cutSheet` et `renderPdf` / `exportPdf` (`packages/exports/src/csv/cutlist.ts`) ; défaut `massNoteFor(project.workshop)` : mention « masse volumique à valider » pour toute essence de bois dont le profil d'atelier du projet ne renseigne pas la masse volumique (`defaultMassNote` sans projet). Masse lue dans `mass_kg`, à défaut `mass` (`partMassKg`) ; colonne « Remarque masse » ajoutée au CSV, colonne « Masse (kg) » ajoutée à la nomenclature PDF, renvois « * » dans le PDF et la nomenclature de l'interface.
- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30**, partie cœur — paramètre : masses volumiques du profil d'atelier (`workshop.wood.densities`, `workshop.metal.density`, nouveau `workshop.densities` pour l'inox 7 900, le verre 2 500 et le béton 2 400 kg/m³, tous « à valider ») ; `mass_kg` est renseignée pour toutes les pièces qui ont un volume (`ensureMass` dans le pipeline, pièces de garde-corps en acier, inox et verre comprises). Affichage dans les exports : voir `packages/exports` (agent exports).

### A7. Échappée sur la largeur des marches

Faut-il une règle `ECHAPPEE_LARGEUR` (avertissement) et un affichage dédié de l'échappée sur la largeur et de la « trémie couvrante » ?

- Proposition : oui ; règle en avertissement avec pour seuil le plus grand minimum des règles `ECHAPPEE_*` bloquantes actives ; barre d'état « Échappée largeur » et « échappée non limitée » quand la trémie couvre tout l'escalier.
- Aujourd'hui : grandeur calculée (`Model.headroomWidth`) mais seulement citée dans une remarque ; rien n'est affiché quand la trémie couvre la ligne de foulée.
- Réf. : l. 104 (J2, core:pipeline), l. 105 (J2, core:pipeline), l. 113 (J1, integration), l. 144 (J3a, integration) ; `pipeline/build.ts`, `docs/research/rules.yaml`, `apps/web/src/components/StatusBar.tsx`.

### A8. Marge d'échappée exigée par l'assistant

Une solution dont l'échappée égale exactement le minimum (marge nulle) doit-elle être rejetée par l'assistant ?

- Proposition : non, la garder mais pénalisée (comportement actuel), la marge visée de 50 mm étant un réglage. Garder aussi la dalle de 200 mm du cas d'acceptation n° 1.
- Aujourd'hui : l'escalier droit du cas n° 1 passe à g = 240 avec une marge nulle, classé après les quarts tournants (score 50 contre 27). Avec une dalle de 250 mm il serait rejeté.
- Réf. : l. 226 (G8, core:assistant), l. 267 (G8, core:assistant), l. 107 (J2, core:pipeline), l. 42 (J1, core:project) ; `assistant/defaults.ts`, `assistant/score.ts`, `examples/acceptance-01-quart-tournant.blondel.json`.

### A9. Débord de nez par défaut

Faut-il ramener le débord de nez par défaut du modèle de 30 mm à 10 mm ?

- Proposition : oui, 10 mm (valeur recommandée de `DEBORD_NEZ_LOGEMENT`, déjà celle des préréglages et exemples).
- Aujourd'hui : 30 mm dans le schéma (`treads.nosing`), 10 mm dans les préréglages ; un projet créé sans préréglage sort un avertissement.
- Réf. : l. 45 (J1, review:project), l. 71 (J1, review:rules) ; `model/project.ts`, `project/presets.ts`.
- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30** — paramètre : `stair.treads.nosing` (défaut du schéma 10 mm). Sans migration : `serializeProject` écrit toujours `treads.nosing`, tous les exemples et projets enregistrés le portent (30 mm relus tels quels, test `parse.test.ts`) ; seul un JSON écrit à la main sans ce champ prend 10 mm au lieu de 30 mm.

### A10. Jour étroit et garde-corps de jour

Sous 110 mm (sphère T1), le jour exige-t-il encore un garde-corps ? Entre 110 mm et 140 mm, faut-il contrôler le chevauchement des poteaux des deux garde-corps de jour ?

- Proposition : sous 110 mm, pas de garde-corps de jour, `GC_OBLIGATOIRE` en conseil et correction « côté jour → mur » proposée seulement si le jour est fermé ; entre 110 et 140 mm, contrôle de collision des poteaux en avertissement.
- Aujourd'hui : sous 110 mm, garde-corps non généré, erreur lisible et `GC_OBLIGATOIRE` ; au-dessus, deux garde-corps produits même si leurs poteaux se chevauchent.
- Réf. : l. 195 (J4, core:guards), l. 175 (J4, review:guards), l. 206 (J4, review:core-fixes) ; `guards/compute.ts`, `guards/jour.ts`, `project/fixes.ts`.

### A11. Contremarches et marches en tôle

Avec des marches en tôle, faut-il retirer les contremarches bois de base et, pour les marches pliées en Z, faire la contremarche d'arrivée en tôle ?

- Proposition : oui aux deux : `helical-core` retire les contremarches bois sous ses tôles (et `VIDE_ENTRE_MARCHES` est alors évalué) ; contremarche d'arrivée des Z en plat plié fixé au chevêtre.
- Aujourd'hui : `helical-core` laisse les contremarches bois sous les tôles ; en Z, la contremarche d'arrivée reste en bois (seules `riser-1` à `riser-(n−1)` sont retirées).
- Réf. : l. 250 (J5a, core:structures), l. 275 (J3b, review-fix:geometrie) ; `structures/helicalCore.ts`, `structures/steelFlat.ts`.

### A12. Porte-à-faux sur le fût sans justification

Un hélicoïdal à marches en porte-à-faux sur le fût, sans justification saisie, doit-il être bloqué ?

- Proposition : non, avertissement avec champ de justification repris dans le dossier (même traitement que le lamellé en plis minces, décision Q10).
- Aujourd'hui : avertissement `HELICOIDAL_PORTE_A_FAUX` ; C §1.8 propose « bloquant sans justification ».
- Réf. : l. 211 (J5a, core:j5a), l. 248 (J5a, core:structures) ; `structures/helicalCore.ts`.

### A13. Limons en profilé sur un quart tournant balancé

Comment traiter un limon en profilé (UPN, IPE…) sur un quart tournant balancé, où la ligne des nez est brisée ?

- Proposition : limon coudé par pièce d'angle soudée (V1) ; en attendant, un paramètre « côté du poteau pour profilés » (par défaut largeur d'aile + 2 × 20 mm) et, dans le comparateur, la variante UPN de référence contre ce poteau élargi.
- Aujourd'hui : barre droite sur la corde des nez, aucune section UPN ne passe sur le cas n° 1 (UPN 260 retenue avec erreur), onglets disjoints de 100 à 200 mm (`FAB_ONGLET_RACCORD`), `FAB_POTEAU_RECEPTION` en avertissement (aile de 90 à 135 mm sur un poteau de 100). La comparaison UPN 529 kg / débillardé 308 kg porte donc sur une variante UPN non validée.
- Réf. : l. 178 (J3c, core:structures), l. 191 (J3c, integration), l. 223 (J5, integration:vague-e), l. 203 (J5b, core:structures) ; `structures/steelProfile.ts`, `structures/compare.ts`.
- **Décision de l'utilisateur (2026-09-30)** : tout de suite, poteau élargi pour profilés (largeur d'aile + 2 × 20 mm, à valider) recevant chaque volée en barre droite, et variante UPN de référence du comparateur sur ce poteau ; limon coudé par pièce d'angle soudée en V1.
- Implémenté le 2026-09-30 — paramètre : `steel-profile.newel.size` (« côté du poteau pour profilés », `auto` = largeur d'aile de la section retenue + 2 × `newel.clearance`, ou valeur imposée) et `steel-profile.newel.clearance` (jeu de 20 mm, à valider). Pour que la face du poteau reçoive l'aile avec 20 mm de chaque côté, le poteau est **décalé vers le jour** (nouveau champ facultatif `offset` du jour « poteau », δ = ⌈a/2 − 20⌉ : il n'entame les marches que d'environ 20 mm) ; un poteau centré de b + 40 ne recevrait pas l'aile (`FAB_POTEAU_RECEPTION` : b ≤ a/2 + δ). Posé par `applyStructureChoice` (section automatique résolue sur le modèle, poteau existant trop étroit remplacé), proposé par la correction `newel-profile`, signalé par le plugin sinon. Chaque limon de jour est une barre droite reçue par le poteau, coupe d'aplomb contre sa face (inchangé : la corde des nez s'arrête déjà au poteau côté jour). Cas n° 1 en profilés (`j3c-acceptance-01-upn`) : poteau 125 mm décalé de 43 mm (aile de l’UPN 240 retenu + 2 × 20), **UPN 240 passe** (hauteur d'âme et prédimensionnement), sans erreur. Comparateur (j5b) : variante UPN sur ce poteau, 525,5 kg, 57 pièces, EXC1 ; elle reste en erreur à cause du limon **mural** LE2 (corde des nez à travers le tournant : 340 mm d'âme nécessaires), que seul le limon coudé (V1) résoudra.

### A14. Saisie du barème d'atelier

Faut-il un écran de saisie du profil d'atelier (taux horaire, temps unitaires, prix matière, finition) dans l'interface ?

- Proposition : oui, panneau « Profil d'atelier » séparé du projet (décision A8 du challenge), sans valeur par défaut ; les euros restent masqués tant qu'il est incomplet.
- Aujourd'hui : aucun barème par défaut, saisie seulement dans le JSON ; le coût du comparateur n'apparaît donc jamais pour un utilisateur.
- Réf. : l. 223 (J5, integration:vague-e), l. 266 (tous, integration:vague-f), l. 180 (J3c, core:structures) ; `workshop/costs.ts`, `apps/web/src/views/CompareView.tsx`.

### A15. Giron côté mur hors ERP (K9)

Faut-il un conseil « giron côté mur trop grand » hors ERP, en reprenant le seuil ERP de 420 mm ?

- Proposition : non ; la seule valeur sourcée est ERP, une règle hors ERP serait inventée (critère d'acceptation n° 5 : toute règle traçable). Clore le point.
- Aujourd'hui : `G_EXT_MAX_ERP_TOURNANT` évalué en ERP tournant ; rien hors ERP.
- Réf. : l. 35 (J2, orchestrateur), l. 116 (J2, core:rules) ; `rules/evaluators/going.ts`.

### A16. Ligne de foulée d'un escalier droit large

Pour un escalier droit de plus de 1 200 mm, de quel bord mesurer les 600 mm de la ligne de foulée ?

- Proposition : du côté de la main courante principale (côté vide s'il y a un garde-corps, sinon côté mur) ; à défaut, bord gauche.
- Aujourd'hui : toujours le bord gauche (`innerSide = "left"`), ce qui déplace la ligne de mesure de conformité.
- Réf. : l. 78 (J2, review:layout) ; `layout/layout.ts`, `layout/resolve.ts`.

### A17. Typologies proposées par l'assistant

L'assistant doit-il énumérer le S / Z et les jours en arc (seuls à permettre un débillardé) ?

- Proposition : pas le S / Z (il n'a de sens que contre deux murs opposés, accessible par préréglage) ; jours en arc en V1, ce qui donnera des propositions `steel-curved`.
- Aujourd'hui : ni S / Z ni jour en arc ; seule l'arrivée est calée sur la trémie ; `steel-curved` n'a jamais de proposition.
- Réf. : l. 287 (vague G, integration:vague-g), l. 228 (G8, core:assistant), l. 229 (G8, core:assistant:relecture) ; `assistant/types.ts`, `assistant/shapes.ts`.

### A18. Recalage et édition dans l'interface

Faut-il (a) un bouton « Recaler volées et trémie » après modification de H, E ou de la dalle, (b) l'édition des surcharges de règles avec justification, (c) l'édition du placement de l'escalier dans le plan ?

- Proposition : (a) oui, via le préréglage du cœur ; (b) oui, justification obligatoire reprise dans le dossier ; (c) V1.
- Aujourd'hui : (a) ajustement manuel ou assistant ; (b) surcharges comptées, non éditables ; (c) import seulement. Les préréglages n'ont pas de murs (l'assistant en ajoute).
- Réf. : l. 81 (J1, web), l. 83 (J1, web), l. 43 (J1, core:project) ; `apps/web/src/components/ParamsPanel.tsx`, `project/presets.ts`.

### A19. Angle imposé dans une zone balancée (mode expert)

Un nez à angle imposé doit-il devenir une borne de zone (voisins rebalancés autour de lui) ?

- Proposition : oui en V1, avec l'édition libre de la ligne de foulée ; d'ici là, comportement actuel.
- Aujourd'hui : angle appliqué après le calcul de la zone, K5 / K3 seulement signalés ; poignée bornée à ± 80° ; remarque « collet minimal » calculée avant les angles imposés ; mode indisponible sur un hélicoïdal.
- Réf. : l. 101 (J2, review:stepping), l. 260 (J2, web:app), l. 262 (J2, review:web-app) ; `stepping/stepping.ts`, `apps/web/src/lib/expert.ts`.

### A20. Volume du dossier PDF

Le dossier PDF « complet » doit-il continuer à inclure les gabarits 1:1 de toutes les pièces (jusqu'à environ 440 pages) ?

- Proposition : oui pour « complet », et ajouter un filtre des gabarits par famille (limons, marches, garde-corps) ; recouvrement des cases fixe à 10 mm, sans réglage dans l'interface.
- Aujourd'hui : quatre entrées (complet A4, complet A3, sans gabarits, fiche de pose seule), pas de filtre.
- Réf. : l. 238 (J6, exports:j6), l. 261 (J6, web:app) ; `apps/web/src/lib/exportFiles.ts`.

### A21. Comportement pendant un calcul

(a) Garder le modèle précédent affiché pendant un calcul ? (b) Chien de garde qui termine et relance le worker après un délai ? (c) Afficher « – » pour une variante du comparateur en échec ?

- Proposition : (a) oui ; (b) oui, 20 s ; (c) oui.
- Aujourd'hui : (a) modèle précédent et « Calcul… » ; (b) aucun, un calcul bloqué laisse « Calcul… » indéfiniment ; (c) 0 kg, 0 m², 0 pièce.
- Réf. : l. 184 (J4, web), l. 188 (J4, review:web-j4), l. 189 (J4, review:web-j4) ; `apps/web/src/model/workerClient.ts`, `apps/web/src/lib/variants.ts`.
- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30** — paramètre : `createJobExec(factory, { watchdogMs, watchdogRetries, watchdogJobs })` (`apps/web/src/model/workerClient.ts`) ; défauts `watchdogMs` = 20 000 ms (`DEFAULT_WATCHDOG_MS`, 0 = désactivé), une relance, demandes `build` et `compare` surveillées (exports PDF et glTF non surveillés). (a) déjà le cas (modèle précédent affiché, « Calcul… ») ; (b) délai dépassé : worker terminé, recréé, demande relancée, puis rejet explicite « Calcul interrompu : aucune réponse en 20 s… » sans repli sur le fil principal ; le délai court à partir du moment où la demande est en tête de file du worker (un calcul demandé pendant un export PDF long n'est pas surveillé avant la fin de l'export) ; un échec n'est pas mis en cache (annuler / rétablir relance le calcul) ; (c) variante en échec (`VariantRow.failed`, `markFailedVariants`) : comparaison levée, modèle vide, ou erreur de génération propre à la variante (structure en échec : le cœur garde les pièces de base, masse et coût partiels) ; « – » pour les grandeurs mesurées (`apps/web/src/lib/variants.ts`), aucun paramètre ; une erreur commune à toutes les variantes ne rend aucune variante en échec.

### A22. Autosauvegarde refusée

Faut-il signaler au démarrage suivant une copie de secours restante, et ouvrir en lecture seule une autosauvegarde d'un format plus récent ?

- Proposition : bandeau au démarrage tant qu'une copie existe ; pas de lecture seule (téléchargement du texte brut seulement).
- Aujourd'hui : rappel pendant la session du refus seulement ; la copie reste dans le stockage et occupe le quota.
- Réf. : l. 279 (J7, review-fix:web) ; `apps/web/src/store/persistence.ts`.
- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30** — paramètre : `createProjectStore({ reportBackupCopy })` (`apps/web/src/store/projectStore.ts`), défaut vrai : bandeau « Copie de secours d'autosauvegarde » à chaque démarrage tant que `blondel.autosave.rejected` existe, avec « Restaurer » (actif seulement si le cœur sait relire la copie, remplacement annulable puis suppression de la copie), « Exporter » (texte brut) et « Supprimer » ; aucune ouverture en lecture seule.

### A23. Comparateur et marqueurs 3D

Faut-il laisser choisir les variantes du comparateur, et filtrer les marqueurs 3D par famille de règles ?

- Proposition : liste fixe au MVP ; filtre des marqueurs par famille (géométrie, fabrication, garde-corps).
- Aujourd'hui : variantes fixes ; toute violation localisée teinte sa pièce (ex. `FAB_MARCHE_PORTEE` teinte toutes les marches d'un escalier sans limon de jour).
- Réf. : l. 187 (J4, web) ; `apps/web/src/lib/variants.ts`.

### A24. Conventions d'interface mineures

À valider en bloc : un seul curseur α (M2) pour tout l'escalier, pas de 0,5° (α) et 0,1 (λ, p) ; murs tracés à l'axe par défaut (convention `WallSchema`), et tracé « au nu » par un 3e clic du côté du mur plutôt que la liste gauche / droite ; apparence 3D par famille non persistée (aperçu seulement) ; valeurs provisoires de l'interface (repères de 45 mm, sortie de « auto » = borne minimale, section conservée ronde ↔ rectangulaire).

- Proposition : garder tout, sauf le tracé au nu (3e clic).
- Aujourd'hui : comme décrit.
- Réf. : l. 285 (vague G, integration:vague-g), l. 245 (J7, web:site), l. 185 (J4, web), l. 259 (J6, web:app), l. 186 (J4, web), l. 82 (J1, web) ; `apps/web/src/lib/balancingForm.ts`, `apps/web/src/views/PlanSiteEditor.tsx`, `apps/web/src/lib/appearance.ts`.

### A25. Rendu à valider visuellement

Valider à l'œil : teintes et veinage des essences, lamelles de 40 mm, vernis, éclaté de 400 mm, verre de 10 mm en 3D, couleurs d'aperçu (acier peint #3a3f45, verre opacité 0,3), bordure des champs (`--control-border`), rendu logiciel sans ombres ni texture fine.

- Proposition : valeurs actuelles, sauf l'épaisseur du verre, qui doit suivre celle du remplissage.
- Aujourd'hui : valeurs fixes de présentation, sans source.
- Réf. : l. 254 (J6, web:3d), l. 257 (J6, review:web-3d), l. 186 (J4, web), l. 281 (J7, review-fix:web), l. 213 (J4, web:e2e), l. 255 (J6, web:3d) ; `apps/web/src/three/materials.ts`, `apps/web/src/three/proceduralTextures.ts`, `apps/web/src/styles.css`, `apps/web/src/three/quality.ts`.

## B. Validations par un atelier ou un professionnel

Valeurs et conventions « à valider » : toutes sont des paramètres modifiables (profil d'atelier ou paramètres de plugin), jamais des constantes cachées. « Aucune » = aucune source dans `docs/research/`. SPEC §7.3 (Q13 à Q20) reste le cadre : aucune donnée publique de temps d'atelier, capacités machines propres à chaque atelier.

### B1. Balancement et découpage

| Paramètre ou convention                                                                      | Valeur actuelle                                                                                                                                                                         | Fichier                                          | Source                                                | Réf. ledger                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------- |
| Choix de la zone balancée : zone minimale atteignant le collet cible, ou zone plus régulière | le moins de nez balancés atteignant `targetCollet` (100 mm), sinon collet maximal ; compte des nez balancés et non des marches non droites ; quart du préréglage : zone 1 → 6, 102,5 mm | `stepping/zones.ts` (`pickZone`)                 | CHALLENGE G3 corrigé ; aucune pour la marge           | l. 150, l. 164                                |
| Tolérance d'égalité du collet                                                                | 1 mm                                                                                                                                                                                    | `stepping/zones.ts`, `model/project.ts`          | aucune                                                | l. 150                                        |
| Étendue maximale du balancement (K7) et sa mesure                                            | 3,5 girons, mesurés sur Γ depuis le nez fixe encadrant                                                                                                                                  | `stepping/zones.ts` (`MAX_BALANCED_EXTENT`)      | DIN 18065 (étrangère, secondaire)                     | l. 151                                        |
| Extrémités libres                                                                            | M3 cubique F'' = 0, quintique F''' = F'''' = 0 ; M1 : palier de collets égaux                                                                                                           | `balancing/profile.ts`, `m1.ts`, `m3.ts`         | aucune ([ANALYSE])                                    | l. 96                                         |
| Spline prolongée aux bornes libres dans la partie tournante                                  | prolongée jusqu'au premier nez droit, repli F'' = 0 si non monotone ; préférence éventuelle pour les zones prolongées d'un débillardé                                                   | `stepping/zones.ts`                              | [ANALYSE] K4                                          | l. 247, l. 204                                |
| M1 asymétrique                                                                               | apex α = (N + 1)·(σ_A − σ_a)/L borné à [1 ; N]                                                                                                                                          | `balancing/m1.ts`                                | aucune ([ANALYSE])                                    | l. 98                                         |
| Collet et K3 au droit d'un poteau                                                            | développement sur jour virtuel, collet mesuré sur le contour du poteau ; zones par angle si K3 rompu ; demi-tournant à poteaux : rupture K3 à H 2 500 et 2 700                          | `stepping/zones.ts`, `rules/evaluators/going.ts` | [ANALYSE] B §3.1, K6                                  | l. 97, l. 190, l. 193, l. 205, l. 246, l. 252 |
| Position du poteau d'angle                                                                   | centré sur l'intersection des faces internes des limons, côté 100 mm ; Γ identique au jour vif                                                                                          | `model/project.ts`, `layout/layout.ts`           | C §1.9 (90 à 100 mm, faible)                          | l. 75, l. 44                                  |
| Palier d'angle                                                                               | nez aux bords du palier ; g = Γ hors paliers / (n − 1 − paliers) ; girons au plus fort reste ; au-delà du carré E × E sur un jour en arc                                                | `stepping/positions.ts`                          | aucune                                                | l. 39, l. 76, l. 94                           |
| Conventions de mesure du découpage                                                           | collet en corde sur C_i ; giron côté mur le long du mur ; marche prolongée du débord ; angle signé                                                                                      | `stepping/stepping.ts`, `stepping/treads.ts`     | aucune                                                | l. 99                                         |
| M2 (herse)                                                                                   | α = 20° ; bissectrice « au prorata » en cas d'asymétrie                                                                                                                                 | `balancing/m2.ts`                                | trepedia [4] (B §3.4) pour α ; aucune pour le prorata | l. 271                                        |
| M6 (rotation)                                                                                | poids sur les incréments de rotation ; λ = 2 girons, p = 2 ; bornes λ ≤ 50, p ≤ 20                                                                                                      | `balancing/m6.ts`, `model/project.ts`            | aucune                                                | l. 272, l. 274                                |
| Transition de la ligne de foulée d'un S / Z                                                  | raccord linéaire sur la partie droite intermédiaire, anguleux, sans angle maximal (45° constatés : profondeur 0,71 g)                                                                   | `layout/layout.ts`                               | aucune (DTU muet)                                     | l. 34, l. 269, l. 273                         |
| Partie droite minimale entre deux tournants opposés                                          | 1 giron                                                                                                                                                                                 | `stepping/stepping.ts`                           | aucune (analogie avec le U)                           | l. 270                                        |
| Préréglages U, demi-tournant, S                                                              | U : 2 girons, jour 400 ; demi-tournant : 3,5 girons, jour 240 ; indépendants de E (collet sous 100 mm pour E ≥ 1 000)                                                                   | `project/presets.ts`                             | aucune (balayage du collet)                           | l. 115, l. 153, l. 125                        |

### B2. Hypothèses de mesure des règles

| Convention                                                                  | Choix actuel                                                                                                                                                            | Fichier                                               | Source                             | Réf. ledger |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- | ----------- |
| Hauteurs, Blondel, giron d'échelle, vide entre marches, dimension de palier | H_MAX_* contrôlent la 1re hauteur ; tolérance comparée à H/n ; valeurs nominales ; giron (et non profondeur) ; vide = h − épaisseur ; palier = largeur minimale en plan | `rules/evaluators/rise.ts`, `nosing.ts`, `flights.ts` | aucune (choix Blondel)             | l. 52       |
| Contremarches ajourées                                                      | assimilées à « sans contremarche » pour le débord et le recouvrement                                                                                                    | `rules/evaluators/nosing.ts`                          | aucune                             | l. 72       |
| `VOLEE_MAX_ERP` en ERP tournant ; tolérance de 1re hauteur hors bois        | non évaluée ; `H_TOLERANCE_DTU` contrôle la 1re hauteur                                                                                                                 | `rules/evaluators/flights.ts`, `rise.ts`              | A §2.1, CO 56                      | l. 74       |
| Échappée sur un palier                                                      | ligne de pente = dessus du palier, saut au nez suivant                                                                                                                  | `headroom/profile.ts`                                 | aucune                             | l. 103      |
| Échappée sous le tour supérieur d'un hélicoïdal                             | au-dessus de la ligne de pente (une hauteur de marche de moins que la forme « n·h − e »)                                                                                | `headroom/helical.ts`                                 | décision Q4, interprétée           | l. 208      |
| Ligne de foulée d'un hélicoïdal                                             | règle DTU (milieu si E ≤ 1 200), contrôlée contre 600 mm du fût                                                                                                         | `layout/helical.ts`, `rules/evaluators/stair.ts`      | B §2.2 [24] ; annexe A DTU non lue | l. 207      |

### B3. Bois : profil d'atelier, limons, pièces de base

| Paramètre                                         | Valeur actuelle                                                                                                                                                        | Fichier                                                 | Source                                                         | Réf. ledger            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- | ---------------------- |
| Épaisseurs de plateaux                            | 27, 34, 41, 54, 65, 80 mm                                                                                                                                              | `workshop/profile.ts`                                   | aucune                                                         | l. 131                 |
| Largeurs de débit, longueur de plateau            | 150 à 500 mm (pas de 50), 4 000 mm                                                                                                                                     | `workshop/profile.ts`                                   | aucune                                                         | l. 131                 |
| Sections de poteau                                | 80, 100, 120, 150 mm                                                                                                                                                   | `workshop/profile.ts`                                   | C §1.9 (90 à 100, faible)                                      | l. 131                 |
| Surcote de corroyage, surlongueur                 | 5 mm, 20 mm                                                                                                                                                            | `workshop/profile.ts`                                   | aucune                                                         | l. 131                 |
| Profondeur d'encastrement                         | 15 mm                                                                                                                                                                  | `workshop/profile.ts`                                   | NF EN 16481 § 5.4.2 (≥ 14 mm)                                  | l. 131                 |
| Jeu d'assemblage, joue mini, bois entre mortaises | 1 mm, 20 mm, 30 mm                                                                                                                                                     | `workshop/profile.ts`                                   | aucune (RC 10 du DTU non lu) ; G6 pour le bois entre mortaises | l. 131                 |
| Largeur perpendiculaire mini, d_h mini            | 150 mm, 50 mm                                                                                                                                                          | `workshop/profile.ts`                                   | CHALLENGE G6 ; B §4.1 (sans valeur)                            | l. 131                 |
| Masses volumiques                                 | chêne, hêtre, frêne 700 ; pin 500 ; lamellé-collé 450 kg/m³                                                                                                            | `workshop/profile.ts`                                   | aucune                                                         | l. 131, l. 139         |
| Limon, rayon de nez                               | 45 mm ; 10 mm                                                                                                                                                          | `structures/woodHoused.ts`                              | C §1.4 (faible) ; C §1.7 (maximum XP P21-211)                  | l. 132                 |
| Tenon, épaulements, poteau                        | 30 mm × e/3 ; 20 mm ; + 150 mm au-dessus du plus haut élément reçu, pendant à 50 mm                                                                                    | `structures/woodHoused.ts`, `structures/newel.ts`       | aucune                                                         | l. 132, l. 135         |
| Crémaillère                                       | reste sous entaille 180 mm, retrait 0, sous les marches ; classes C30 (pin) / D40 (feuillus) ; domaine FCBA : droit, H ≤ 2 700, projection ≤ 3 456 mm                  | `structures/woodCut.ts`, `structures/fcba.ts`           | FCBA (tableau) ; domaine : aucune                              | l. 132, l. 136, l. 137 |
| Tracé du limon à la française                     | ligne des nez sur C_i / C_e ; rives à d_h / d_b verticaux constants par côté ; arrivée : aplomb + niveau à d_h au-dessus du sol fini ; zone des queues à l'angle mural | `structures/development.ts`, `structures/woodHoused.ts` | C §1.4, C §1.9, B §4.1 interprétés                             | l. 133, l. 141         |
| d_b constant ou largeur perpendiculaire constante | d_b constant par côté (cas n° 1 : 310 / 270 mm, limon de jour 45 × 304)                                                                                                | `structures/development.ts`                             | C §1.4 (arasement)                                             | l. 134, l. 144         |
| Ligne des nez sur un palier                       | de niveau puis montée sur un giron mesuré sur le bord du limon ; palier d'arrivée : montée sur toute sa profondeur                                                     | `structures/development.ts`                             | aucune                                                         | l. 276, l. 289         |
| Pièces de base                                    | fil selon le giron ; chêne par défaut ; contremarche de z_(k−1) − e à z_k − e ; palier en une pièce ; contremarche coupée sur la ligne du nez suivant                  | `parts/basic.ts`                                        | aucune                                                         | l. 106, l. 108         |

### B4. Métal : pliage, laser, roulage

| Paramètre                                | Valeur actuelle                                                                                                | Fichier                                           | Source                                 | Réf. ledger    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------- | -------------- |
| Loi de pli, facteur K                    | K = 0,33 (DIN 6935 donnerait 0,35 à r/t = 1,3)                                                                 | `workshop/metal.ts`                               | aucune                                 | l. 36, l. 165  |
| Rayons et ailes mini                     | table r_int / L_int pour t de 1 à 10 mm                                                                        | `workshop/metal.ts`                               | C §2.6 [17] (moyenne)                  | l. 165         |
| Presse plieuse                           | 2 980 mm / 8 mm ; seule la longueur de pli est comparée (pas la largeur de pièce)                              | `workshop/metal.ts`                               | C-M-04 [18]                            | l. 165, l. 173 |
| Laser : épaisseur maxi ; formats de tôle | 20 mm ; 3 000 × 1 500, 4 000 × 2 000, 6 000 × 2 000                                                            | `workshop/metal.ts`                               | aucune ; C §4.3 « à confirmer »        | l. 165         |
| Masse volumique de l'acier               | 7 850 kg/m³                                                                                                    | `workshop/metal.ts`                               | aucune (valeur usuelle)                | l. 165         |
| Marches pliées Z / U                     | Z : retour sous la marche précédente ; plis à 90° ; pas d'entaille de décharge ; bord mini = partie droite + r | `structures/folded.ts`                            | aucune                                 | l. 168         |
| Rouleuse                                 | rayon intérieur mini 150 mm (face concave r_j − e), rouleaux 2 000 mm, épaisseur 12 mm                         | `workshop/metal.ts`                               | C §2.4 [16] (r_min ≈ 0,65 Ø seulement) | l. 198         |
| Cintrage des profilés                    | rayons pour la section maximale ; HEA sans donnée ; limon de jour cintré jamais généré                         | `workshop/metal.ts`, `structures/steelProfile.ts` | C §2.3 [15] (moyenne)                  | l. 179         |

### B5. Métal : limons, supports, débillardé

| Paramètre                                   | Valeur actuelle                                                                                                                                            | Fichier                                               | Source                                     | Réf. ledger    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ | -------------- |
| Limon en plat                               | 8 mm ; d_h 50 ; d_b `auto` ≥ d_h ; départ 50 / arrivée 0 mm                                                                                                | `structures/steelFlat.ts`                             | C §2.2 [20] pour 8 mm ; aucune sinon       | l. 167, l. 173 |
| Supports                                    | cornière L 40 × 40 × 4, plat 40 × 8, perçage Ø 11, 2 boulons, marges 10, appui mini 50 mm ; un par marche et par face porteuse                             | `structures/steelFlat.ts`, `structures/supports.ts`   | C §2.6 [20] (consoles 8 mm) ; aucune sinon | l. 167         |
| Platines, tube de poteau, jeu latéral       | 10 mm (120 × 150, débord 40) ; paroi 4 mm ; jeu marche / limon 10 mm                                                                                       | `structures/steelFlat.ts`                             | C §2.3 [58] (faible) pour le jeu           | l. 167         |
| Tôle pliée                                  | 5 mm ; ailes du U 40 ; retour du Z 40                                                                                                                      | `structures/steelFlat.ts`                             | C §2.6 [62] (4 à 6 mm)                     | l. 167         |
| Appui des balancées contre le poteau        | souvent < 50 mm (5 avertissements sur l'exemple en Z) ; console soudée sur le poteau ou retour du Z raccourci ?                                            | `structures/steelCommon.ts`, `structures/supports.ts` | aucune                                     | l. 170, l. 173 |
| Poteau acier « plat »                       | section pleine a × a                                                                                                                                       | `structures/steelFlat.ts`                             | aucune                                     | l. 171         |
| Aboutage soudé                              | éclisses et perçages non dessinés                                                                                                                          | `structures/steelFlat.ts`                             | aucune                                     | l. 173         |
| Profilés                                    | corde des nez ; d_h 50 ; UPN âme côté marches ; cornières rognées ; appui 20 mm ; trait de scie 3 mm ; onglet 1 mm ; pas de platines                       | `structures/steelProfile.ts`                          | aucune                                     | l. 178         |
| Portée d'un profilé au prédimensionnement   | Δu horizontal de la ligne du plugin (et non rive haute × cos α)                                                                                            | `structures/steelProfile.ts`, `Model.precheck`        | aucune                                     | l. 282         |
| Débillardé soudé                            | joints à 100 mm des naissances, 20 mm des supports ; tronçon mini 200 ; pas des rives 5 ; lignes de roulage tous les 50 ; largeur perpendiculaire mini 150 | `structures/steelCurved.ts`                           | B §5.2 « ex. » ; aucune sinon              | l. 199         |
| Supports côté jour du débillardé            | cornières droites tangentes (écart ≈ c²/8r) ; alternative : consoles radiales de 8 mm                                                                      | `structures/steelCurved.ts`                           | C §2.4 [20] pour les consoles              | l. 200         |
| Substitutions du comparateur « même épure » | poteau de 100 mm à la place d'un jour en arc ; jour en arc = rayon mini de roulage + e, arrondi à 10                                                       | `structures/compare.ts`                               | C §1.9 (bois) ; aucune                     | l. 203, l. 196 |

### B6. Garde-corps et mains courantes

| Paramètre                                          | Valeur actuelle                                                                                                            | Fichier                             | Source             | Réf. ledger            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------ | ---------------------- |
| Balustres                                          | entraxe maxi 140 mm, 40 × 40                                                                                               | `guards/spec.ts`                    | aucune             | l. 156                 |
| Lisses, câbles                                     | 5 lisses 40 × 30 ; 8 câbles Ø 6                                                                                            | `guards/spec.ts`                    | aucune             | l. 156                 |
| Verre, tôle perforée, panneau                      | 18 mm ; 3 mm (Ø 10) ; 20 mm ; jeu 20 mm                                                                                    | `guards/spec.ts`                    | aucune             | l. 156                 |
| Vide sous le remplissage                           | 50 mm                                                                                                                      | `guards/spec.ts`                    | aucune             | l. 156                 |
| Poteaux                                            | 80 × 80, entraxe maxi 1 500, poteau d'angle au-delà de 30°                                                                 | `guards/spec.ts`                    | aucune             | l. 156                 |
| Implantation                                       | axe à 30 mm du bord de l'emmarchement, 50 mm du nu de trémie ; murs détectés à 100 mm, 5°                                  | `guards/spec.ts`, `guards/sides.ts` | aucune             | l. 156                 |
| Jeu latéral de trémie des préréglages              | 100 mm                                                                                                                     | `project/presets.ts`                | aucune             | l. 194                 |
| Prolongement à l'arrivée                           | assuré par le garde-corps de trémie (mesuré à 1 000 mm)                                                                    | `guards/compute.ts`                 | A §1.12 interprété | l. 160                 |
| Nez dans le retrait de l'onglet d'un angle concave | report au niveau le plus haut : main courante jusqu'à 2 hauteurs de marche au-dessus du nez le plus bas (jour vif balancé) | `guards/compute.ts`                 | aucune             | l. 176, l. 265, l. 253 |

### B7. Hélicoïdal

| Paramètre                         | Valeur actuelle                                                                      | Fichier                     | Source                                  | Réf. ledger    |
| --------------------------------- | ------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------- | -------------- |
| Préréglage                        | R_e 900 ; fût r_f 70 ; palier d'arrivée ≤ 90° par pas de 5° ; aucun N pour H ≥ 2 900 | `project/presetHelical.ts`  | [51] (gamme Ø 1 400 à 3 800)            | l. 209         |
| Fût, marches, limons              | paroi 5 ; tôle 8 ; limons 250 × 8, rive + 50 (intérieur = extérieur)                 | `structures/helicalCore.ts` | C §2.2 [50][20] (faible, moyen)         | l. 209, l. 248 |
| Main courante                     | Ø 42 à 900 mm                                                                        | `structures/helicalCore.ts` | C §2.2 [50] ; `GC_HAUTEUR_RAMPANT_2024` | l. 209         |
| Fixation marche / fût, raidissage | non modélisés                                                                        | `structures/helicalCore.ts` | —                                       | l. 211, l. 248 |

### B8. Site et relevé

| Paramètre                                    | Valeur actuelle                                                                                                              | Fichier                                  | Source | Réf. ledger    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------ | -------------- |
| Tolérance de cohérence du relevé             | 5 mm                                                                                                                         | `site/survey.ts`                         | aucune | l. 230         |
| Nombre de mesures du relevé                  | 4 côtés + 2 diagonales (une seule redondante : 10 mm d'erreur sur un petit côté ne donnent que 0,8 mm d'écart) ; 7e mesure ? | `site/survey.ts`                         | aucune | l. 244         |
| Épaisseur proposée d'un mur tracé            | 200 mm                                                                                                                       | `apps/web/src/views/planSiteGeometry.ts` | aucune | l. 234, l. 258 |
| Usage → contextes réglementaires (assistant) | maison ou logement → logement ; collectif → BHC ; ERP → ERP + sécurité ; « autre » → règles générales                        | `apps/web/src/lib/assistant.ts`          | aucune | l. 258         |

### B9. Assistant

| Paramètre              | Valeur actuelle                                                                                                                                                                                   | Fichier                 | Source                            | Réf. ledger            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------- | ---------------------- |
| Poids du score         | 1 par mm d'écart au module, 0,2 par mm de collet manquant, 0,05 par mm d'échappée, 0,2 par mm de marge d'échappée sous 50 mm, 2 par marche balancée, 1 par mm d'irrégularité, 5 par avertissement | `assistant/defaults.ts` | aucune                            | l. 224, l. 267         |
| Exploration            | pas du giron 5 mm ; E minimal, recommandé, + 100, + 200 ; 180 modèles, 1,5 s ; 3 par groupe, 1 par forme ; part d'énumération 0,8                                                                 | `assistant/defaults.ts` | aucune                            | l. 224, l. 229, l. 267 |
| Dégagement à l'arrivée | E du candidat                                                                                                                                                                                     | `assistant/defaults.ts` | analogie `PALIER_LONGUEUR_METIER` | l. 229                 |
| Emmarchement de repli  | 800 mm                                                                                                                                                                                            | `assistant/defaults.ts` | aucune                            | l. 229                 |

### B10. Coûts et prédimensionnement

| Paramètre                                       | Valeur actuelle                                                                | Fichier                                      | Source                          | Réf. ledger    |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------- | -------------- |
| Barème (taux, temps unitaires, matières)        | aucun défaut ; test d'acceptation avec un barème fictif (60 €/h, 1,5 €/kg…)    | `workshop/costs.ts`                          | aucune (Q13)                    | l. 223, l. 266 |
| Formule de temps                                | minutes par coupe, par mètre de cordon, par pli, par perçage, par pièce unique | `workshop/costs.ts`, `structures/compare.ts` | C §5.4 (structure, sans valeur) | l. 180         |
| Galvanisation                                   | tarifée au m² comme la peinture ; finition bois non chiffrée                   | `workshop/costs.ts`                          | C §5.1 la donne au kg (Q20)     | l. 182         |
| Coefficients et matériaux du prédimensionnement | voir C6                                                                        | `precheck/settings.ts`                       | —                               | l. 177         |

### B11. Exports et documents d'atelier

| Paramètre ou convention | Valeur actuelle                                                                                            | Fichier                                                 | Source                      | Réf. ledger |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------- | ----------- |
| Essai réel des DXF      | aucun essai de découpe, pliage ou roulage ; aucun essai de l'assistant par un utilisateur réel             | `packages/exports/src/dxf/`                             | —                           | l. 266      |
| En-tête DXF R12         | `$INSUNITS` = 4, `$MEASUREMENT`, `$DWGCODEPAGE` = ANSI_1252 hors spécification AC1009                      | `packages/exports/src/dxf/r12.ts`                       | audit ezdxf seulement (Q18) | l. 88       |
| Calques d'usinage       | `MORTAISE` (ACI 6), `TENON` (ACI 30)                                                                       | `packages/exports/src/dxf/part.ts`                      | aucune                      | l. 118      |
| Cotes du plan           | arrondi au mm (giron au 0,1 mm) ; lignes + textes, pas d'entité DIMENSION                                  | `packages/exports/src/plan/drawing.ts`                  | aucune                      | l. 87       |
| Mise en page PDF        | échelles normalisées (1:1 à 1:500), plus grande qui tient ; A4 paysage ; texte 2,2 à 4,2 mm ; marges 10 mm | `packages/exports/src/pdf/document.ts`, `pdf/layout.ts` | aucune                      | l. 119      |
| Gabarits 1:1 tuilés     | recouvrement 10 mm, mires, cases lettres × chiffres, règle de 100 mm                                       | `packages/exports/src/pdf/tiles.ts`                     | aucune                      | l. 237      |
| Fiche de pose           | cotes aux nus des murs, diagonales de contrôle, épure des nez ; marge 300 mm                               | `packages/exports/src/pdf/installation.ts`              | aucune (poseur)             | l. 239      |
| Fiche de débit          | par épaisseur (plaques, tout le bois) ou par section (profilés, tubes)                                     | `packages/exports/src/cutsheet.ts`                      | aucune                      | l. 243      |
| Arrondis d'affichage    | PDF à 0,01 (ratio, mm/m, kN) ; CSV au cm³ exprimé en m³                                                    | `packages/exports/src/csv/cutlist.ts`                   | aucune (ADR-0003)           | l. 278      |

## C. Normes non lues et questions juridiques

Décision du 2026-09-28 (SPEC §7bis) : pas d'achat de normes, règles à source secondaire marquées `source_secondaire` avec profil `strict` ou `souple`. Les points ci-dessous restent donc ouverts **par construction** ; ils se lèvent par la lecture d'un texte ou un avis, pas par du code.

| #   | Question                                                                                                                                                                                                                                   | Texte à lire                                                            | Aujourd'hui                                               | Réf.                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| C1  | Garde-corps 2024 : hypothèses de mesure (hauteur de chute, vides perpendiculaires à la pente, gabarit B sur les rampants, épaisseur E de h(E)), `GC_DENIVELES_2024` (formule non lue), « 5 cm sous la 1re lisse » et tôle perforée en 1988 | NF P01-012:2024, NF P01-013:2024 (SPEC Q2)                              | hypothèses Blondel ; `GC_DENIVELES_2024` non évaluée      | l. 161 (J4, core:guards) ; `guards/checks.ts`                                                                          |
| C2  | Régime garde-corps selon la date : distinguer permis (seuil 2025-06-01) et marché (2026-01-01) ?                                                                                                                                           | arrêté et NF P01-012:2024                                               | seuil unique 2025-06-01 ; sans date, 2024 supposé         | l. 49 (J1, core:rules) ; `rules/contexts.ts`                                                                           |
| C3  | Exceptions de mains courantes : côté de l'unique main courante d'un ERP à fût Ø ≤ 400 ; hélicoïdal assimilé à un tournant pour `MC_UP_ERP`                                                                                                 | arrêté ERP, CO 56 §3                                                    | côté non imposé ; assimilation appliquée                  | l. 277 (J4, review-fix:regles) ; `rules/evaluators/guards.ts`                                                          |
| C4  | Tables de règles à relire : « volées non contrariées » à 90° ; forme du nez (vive / arrondie) ; `PALIER_LARGEUR_ERP` comparé à E ; `H_MAX_HELICOIDAL_DTU` appliqué aussi au métal ; règles d'échelle à marches rattachées à `industriel`   | A §1.9, A §2.1, arrêté ERP, NF DTU 36.3 (Q1)                            | lectures prudentes, souvent `non-evaluee`                 | l. 54, l. 55, l. 73 (J1, core:rules / review:rules) ; `rules/evaluators/flights.ts`, `docs/research/rules.yaml`        |
| C5  | Hélicoïdal : position de la ligne de foulée et collet (annexe A)                                                                                                                                                                           | NF DTU 36.3 P3 annexe A (Q1)                                            | voir A5 et B2                                             | l. 207, l. 210 (J5a, core:j5a)                                                                                         |
| C6  | Prédimensionnement : γ_G 1,35, γ_Q 1,5, γ_M0 1,0, γ_M bois 1,3, k_mod 0,8, C24 (E 11 000, f_m,k 24 MPa), f_m,k C30 / D40, part de charge reprise par un limon = 1 ; modèle de poutre inclinée ; déversement et torsion non vérifiés        | EN 1990, EN 1993-1-1, EN 1995-1-1 et leurs AN, EN 338 ; bureau d'études | indicatif, libellé « ne remplace pas une note de calcul » | l. 177 (J3c, core:precheck), l. 181 (J3c, review:structures-profile) ; `precheck/settings.ts`, `precheck/stringers.ts` |
| C7  | Débillardé : chaque tronçon prédimensionné comme une poutre indépendante ; à traiter comme un limon continu en plan courbe (torsion)                                                                                                       | EN 1993-1-1 ; bureau d'études                                           | tronçons séparés                                          | l. 202 (J5b, core:structures) ; `precheck/stringers.ts`                                                                |
| C8  | Loi de pli DIN 6935 : k appliqué à t/2 (K équivalent k/2)                                                                                                                                                                                  | DIN 6935 (étrangère)                                                    | interprétation Blondel                                    | l. 166 (J3b, core:structures) ; `workshop/metal.ts`                                                                    |
| C9  | Classe d'exécution : cordons d'angle mur / limon comptés en EXC1 en S235 ; SC2 (escalier de secours) ignoré                                                                                                                                | EN 1090-2, CNC2M N0169                                                  | EXC1 sauf aboutage bout à bout (EXC2)                     | l. 169 (J3b, core:structures) ; `structures/steelCommon.ts`                                                            |
| C10 | STEP et XLSX : obligations LGPL du wasm OCCT servi au navigateur (Q21) ; acceptation d'un AP242 « DIS » (Q19)                                                                                                                              | avis juridique ; essais chez des sous-traitants                         | STEP et XLSX non livrés (CSV seulement)                   | l. 242 (J6, exports:j6) ; `packages/exports/package.json`                                                              |
| C11 | Questions de SPEC §7.4 sans suite dans le code : Q22 (annexes nationales de seconde génération), Q23 (code du travail, escaliers de service), Q24 (brevet US6845595 avant M5)                                                              | veille réglementaire, recherche d'antériorité                           | M5 non implémentée ; aucune règle de code du travail      | SPEC §7.4                                                                                                              |
| C12 | Questions de SPEC §7.3 non encore couvertes par un atelier : Q15 (joints de débillardé), Q16 (raccord clothoïde, roulage à rayon variable), Q17 (couronne des plats hélicoïdaux), Q18 (DXF des FAO bois)                                   | ateliers pilotes                                                        | voir B4, B5, B11 ; clothoïdes non prises en charge        | SPEC §7.3                                                                                                              |

Sans objet désormais : Q25 (three.js retenu, ADR-0001) ; Q4 à Q12 tranchées le 2026-09-28 (SPEC §7bis).

## D. Dette technique et améliorations connues (non bloquantes)

### D1. Anomalies constatées pendant la vérification

| Constat                                                                                                                                                                                               | Fichier                                                     | Réf.          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------- |
| Fiche de débit : la même pièce `BA1` de `j4-acceptance-01` apparaît sur trois lignes (14 / 2 / 1) pour des longueurs de 808 mm à 2e-13 près ; clé de regroupement sur la longueur brute, non arrondie | `packages/exports/src/cutsheet.ts`                          | l. 240, l. 92 |
| Liste de débit et fiche de débit : colonne masse vide pour toutes les pièces, acier compris (clé `mass` jamais remplie) — voir A6                                                                     | `packages/exports/src/csv/cutlist.ts`                       | l. 86         |
| Import d'un calque quand le modèle est en échec : le fichier reste en file sans message                                                                                                               | `apps/web/src/App.tsx`, `apps/web/src/store/importQueue.ts` | l. 263        |
| Assistant : avec `maxCandidates = 0`, message trompeur « Aucune proposition sans bloquant » ; `selectDiverse` ne valide pas ses options                                                               | `assistant/propose.ts`, `assistant/select.ts`               | l. 268        |
| `G_COLLET_MONOTONE` ne contrôle jamais une marche balancée isolée hors zone déclarée (marche du poteau entre deux zones par angle)                                                                    | `rules/evaluators/going.ts`                                 | l. 252        |
| Préréglages U et demi-tournant : collet sous 100 mm dès E ≥ 1 000 (position du tournant indépendante de E)                                                                                            | `project/presets.ts`                                        | l. 125        |

- Appliqué par défaut le 2026-09-30 (commit 0aaaf7d), **validé par l’utilisateur le 2026-09-30**, partie cœur — fiche de débit : les pièces de garde-corps de même repère ont désormais exactement le même débit et les mêmes grandeurs (celles de la première pièce du repère, `guards/parts.ts`), plus d'écart de 2e-13 mm sur `BA1` ; la tolérance de regroupement de la fiche elle-même relève de `packages/exports`. Assistant : avec `maxCandidates = 0`, diagnostic « Liste vide : N proposition(s) sans bloquant trouvée(s) mais non affichée(s) » ; `selectDiverse` valide ses options (`RangeError`). Paramètre : `limits.maxCandidates` (inchangé).

- Import d'un calque quand le modèle est en échec — appliqué par défaut le 2026-09-30 (commit à venir), à confirmer — paramètre : aucun ; la demande reste en file et un message explicite s'affiche à la place de l'attente silencieuse (« … ne peut pas être importé(e) tant que le modèle est en échec… », ou « … sera importé(e) dès la fin du calcul du modèle » pendant un calcul), avec un bouton « Abandonner l'import » ; l'import reprend seul dès que le modèle est rétabli (`queuedImportMessage`, `cancelUnderlayImport` dans `apps/web/src/store/importQueue.ts`, affichage dans `apps/web/src/App.tsx`, au-dessus de toutes les vues, comparateur compris) ; modèle rétabli mais plan « Site et saisie » fermé (autre onglet choisi entre-temps) : message « … sera importé(e) à l'ouverture de l'onglet Plan, mode « Site et saisie » » et bouton pour l'ouvrir.

### D2. Moteur de règles et `rules.yaml`

| Sujet                                                                                                                                                                                                                                               | Fichier                                                                        | Réf.                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| Sémantique des listes de contextes (disjonction, `tournant` / `helicoidal` qualifiants) à écrire dans `rules.yaml` et ADR-0004                                                                                                                      | `rules/contexts.ts`, `docs/adr/0004-moteur-de-regles.md`                       | l. 47                         |
| Constantes lues dans les formules ou les descriptions (seuil 1 200 des LF_*, recouvrement 50 mm, table h(E), charges, tableau FCBA, seuil E > 1 200 des limons) : champs structurés à ajouter                                                       | `rules/formula-constants.ts`, `structures/fcba.ts`, `structures/woodHoused.ts` | l. 51, l. 137, l. 142, l. 163 |
| Contrôles hors table à ajouter à `rules.yaml` : `LIMON_ENTAILLE_MIN`, `GC_CABLES_DETENTE` ; section résiduelle sous entailles non implémentée                                                                                                       | `structures/checks.ts`, `guards/checks.ts`                                     | l. 138, l. 163                |
| Lignes de mesure réglementaires distinctes de la ligne de conception (SPEC X9) non implémentées                                                                                                                                                     | `rules/evaluators/stair.ts`                                                    | l. 50, l. 99                  |
| 12 règles sans évaluateur : `MC_INTERMEDIAIRE_ERP`, `TREMIE_LONGUEUR`, `TREMIE_TOLERANCE`, `HAUTEUR_ETAGE_TOLERANCE`, `NEZ_CONTRASTE`, `BANDE_EVEIL`, 3 × `CHARGE_*`, `LIMON_EPAISSEUR_MIN_DTU`, `CREMAILLERE_REGLE_MOYENS`, `DEFORMATION_CINTRAGE` | `rules/engine.ts`                                                              | l. 56                         |
| `LARGEUR_UP_ERP` non évaluée ; `LARGEUR_MIN_LOGEMENT` ignore les mains courantes saillantes                                                                                                                                                         | `rules/evaluators/stair.ts`                                                    | l. 53                         |

### D3. Géométrie et tracé

| Sujet                                                                                                                                                                     | Fichier                                                             | Réf.                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------- |
| Maillage en float32 dans le repère monde (≈ 0,25 mm à 5 m), repris tel quel par le glTF                                                                                   | `packages/geometry/src/mesh.ts`, `packages/exports/src/gltf/glb.ts` | l. 62, l. 241       |
| Angle de lissage 0° pour les extrusions (poteau rond facetté) ; proposition : 30° pour les sections rondes                                                                | `packages/geometry/src/options.ts`                                  | l. 63               |
| Balayage : orientation de section non documentée dans `SolidDesc` ; pas de champ `up` / `frame` ; virage proche de 180° sans limite ; pas de contrôle d'auto-intersection | `packages/geometry/src/sweep.ts`, `model/derived.ts`                | l. 64, l. 67, l. 68 |
| `ruled` : sections plates en bout de limon non vérifiées ; extrusion de profondeur nulle rendue vide sans erreur                                                          | `packages/geometry/src/ruled.ts`, `extrude.ts`                      | l. 69, l. 70        |
| Emprises dégénérées non signalées (demi-tournant à jour nul, trois tournants de même sens qui se superposent, C_i de longueur nulle)                                      | `layout/layout.ts`                                                  | l. 77               |
| Borne de zone dans la courte partie droite d'une zone de 180° déclarée libre                                                                                              | `stepping/zones.ts`                                                 | l. 126              |
| Trémie circulaire absente du schéma (polygone inscrit) ; emprise d'un hélicoïdal de plus d'un tour sans trou                                                              | `model/project.ts`, `headroom/helical.ts`                           | l. 212              |

### D4. Structures

| Sujet                                                                                                                                                                                                                                         | Fichier                                                                                | Réf.                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| Solides 3D approchés : limons pleins sans mortaises, tenon extrudé sur toute l'épaisseur (volume surestimé), marches pliées balancées réduites au dessus, pas de `Joint`                                                                      | `structures/woodHoused.ts`, `structures/steelFlat.ts`                                  | l. 140, l. 142, l. 171         |
| Capacités déclarées dans des listes et non par les plugins : `NEWEL_REQUIRED_STRUCTURES`, `HELICAL_STRUCTURES`, `LATERAL_STRINGER_STRUCTURES` ; épaisseurs hors emprise de `steel-profile` et du limon extérieur de `helical-core` comptées 0 | `project/fixes.ts`, `apps/web/src/lib/layoutKind.ts`, `assistant/propose.ts`           | l. 196, l. 220, l. 227, l. 229 |
| `steel-profile` et `steel-curved` ne traitent pas les paliers                                                                                                                                                                                 | `structures/steelProfile.ts`, `structures/steelCurved.ts`                              | l. 276                         |
| Cornières comptées avant rognage dans le choix automatique de section                                                                                                                                                                         | `structures/steelProfile.ts`                                                           | l. 182                         |
| Structures et garde-corps sur un S / Z vérifiés seulement « sans exception » (jours à poteaux non testés)                                                                                                                                     | `structures/*.test.ts`                                                                 | l. 288                         |
| Contrôle « dalle haute » de l'assistant partiel (rive haute des limons, about contre le chevêtre, prolongements non contrôlés)                                                                                                                | `assistant/placement.ts`                                                               | l. 225                         |
| Préréglage hélicoïdal : le cœur ne pose pas `helical-core` et n'a pas de repli quand aucun N ne passe (l'interface utilise 12 marches par tour)                                                                                               | `project/presetHelical.ts`, `apps/web/src/lib/layoutKind.ts`                           | l. 218, l. 219                 |
| Fonctions géantes à découper : `buildSteelFlat` (951 lignes), `buildCurvedStringer` (829), `buildSteelProfile` (808), `proposeDesigns` (711)                                                                                                  | `structures/steelFlat.ts`, `steelCurved.ts`, `steelProfile.ts`, `assistant/propose.ts` | l. 283                         |

### D5. Pipeline, performance, tests

| Sujet                                                                                                                                                                           | Fichier                                                            | Réf.                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------- |
| Premier calcul à froid 17 à 31 ms (budget 15 ms, ADR-0006), régime établi 1,4 à 6,3 ms ; mesures « 40 / 54 ms » à reconfirmer sur GitHub Pages                                  | `pipeline/bench.test.ts`, `apps/web/src/model/model.worker.ts`     | l. 148, l. 155, l. 183 |
| Mémoïsation trop large : changer l'épaisseur de contremarche recalcule le découpage ; toucher au calque recalcule structure, garde-corps et échappée                            | `pipeline/build.ts`                                                | l. 124, l. 233         |
| `wood-housed` est l'étape la plus coûteuse (2 à 4 ms) ; `Math.hypot` environ 3 fois plus lent                                                                                   | `geom2d/vec.ts`                                                    | l. 154                 |
| `Model` ne porte ni la trémie ni la dalle (les exports lisent l'option `project`)                                                                                               | `packages/exports/src/plan/drawing.ts`                             | l. 84                  |
| Budget e2e de 200 ms fragile sous charge (212 à 325 ms relevés) ; replis possibles : `dpr` 0,8 ou pas de texture en rendu logiciel                                              | `apps/web/e2e/long-tasks.spec.ts`, `apps/web/src/three/quality.ts` | l. 215, l. 251, l. 255 |
| Couverture e2e : onglets mesurés seulement avec `wood-housed` pour le métal ; critère n° 1 règle le côté extérieur par « Mur » ; essai d'annulation de l'assistant conditionnel | `apps/web/e2e/`                                                    | l. 217, l. 262         |
| Aucun essai manuel dans un navigateur réel par l'utilisateur                                                                                                                    | —                                                                  | l. 145                 |
| Un modèle est construit pour le croquis de chaque variante affichée par l'assistant (3 à 6 ms chacune) ; croquis à la demande si besoin                                         | `apps/web/src/model/assistantJob.ts`                               | l. 290                 |

### D6. Interface, site et exports

| Sujet                                                                                                                                                 | Fichier                                                                     | Réf.           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------- |
| Surlignage marche ↔ pièce et familles de pièces reconnus par convention d'identifiant (`tread-N`, `guard-…`) ; champ explicite à ajouter              | `apps/web/src/lib/compliance.ts`, `apps/web/src/lib/appearance.ts`          | l. 80, l. 259  |
| Valeurs provisoires de l'interface à remplacer par celles du cœur (`DEFAULT_NEWEL_SIZE`, jeu de trémie des préréglages)                               | `apps/web/src/components/ParamsPanel.tsx`, `apps/web/src/lib/layoutEdit.ts` | l. 82          |
| Formulaire générique : entier deviné d'après le défaut ; champ facultatif sans défaut (`maxSlopeBreak`) jamais affiché                                | `apps/web/src/lib/structureForm.ts`                                         | l. 127, l. 221 |
| Deux tables de couleurs PBR (web et glTF) à tenir alignées                                                                                            | `apps/web/src/three/materials.ts`, `packages/exports/src/gltf/materials.ts` | l. 241         |
| Vue 3D : coupe sans remplissage, mesure sans accrochage, repères du contrôle ni éclatés ni coupés, écartement des limons d'hélicoïdal peu parlant     | `apps/web/src/views/Viewer3D.tsx`, `apps/web/src/three/explode.ts`          | l. 256, l. 257 |
| Calque DXF : SPLINE, ELLIPSE, HATCH, textes ignorés ; bornes de taille (5 000 entités, image 1,5 M caractères) à revoir si le projet passe dans l'URL | `site/dxf.ts`, `site/schema.ts`                                             | l. 231, l. 232 |
| Relevé : seuil de détection linéarisé (écart > 25 % sur un quadrilatère mal conditionné) ; pas de calage sur deux points du DXF                       | `site/survey.ts`, `apps/web/src/views/PlanSurveyForm.tsx`                   | l. 235, l. 264 |
| Quota `localStorage` non remesuré dans le navigateur                                                                                                  | `apps/web/src/store/persistence.test.ts`                                    | l. 280         |
