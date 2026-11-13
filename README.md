# target_scorer — comptage des points sur photo de cible ISSF

Bibliothèque JavaScript sans dépendance qui lit la photo d'une cible ISSF tirée,
retrouve les impacts et les note selon le règlement. Elle tourne entièrement dans le
navigateur (ou sous Node) : la photo n'est envoyée nulle part.

*Scores the shots on a photo of an ISSF paper target, in the browser, with no
dependencies. The photo never leaves the device.*

## Cibles prises en charge

| Identifiant          | Cible (règlement ISSF 2025, 2ᵉ tirage 07/2026) | Jauge par défaut |
|----------------------|-------------------------------------------------|------------------|
| `issf_10m_rifle`     | carabine 10 m — 6.3.4.3                         | 4,5 mm           |
| `issf_10m_pistol`    | pistolet 10 m — 6.3.4.6                         | 4,5 mm           |
| `issf_50m_rifle`     | carabine 50 m — 6.3.4.2                         | 5,6 mm           |
| `issf_25m_precision` | pistolet 25 m précision et 50 m — 6.3.4.5       | 5,6 mm           |
| `issf_25m_rapid`     | pistolet 25 m tir rapide — 6.3.4.4              | 5,6 mm           |
| `issf_300m`          | carabine 300 m — 6.3.4.1                        | 8,00 mm          |

Jauges proposées : 4,5 mm (air comprimé), 5,6 mm (.22 LR), 8,00 mm (300 m),
9,65 mm (percussion centrale à 25 m) — annexe « Rules for Paper Target Scoring », 1.4.

## Règles de notation appliquées

- Diamètres des anneaux pris **au bord extérieur** du trait (annexe, 1.1.2).
- Un tir vaut la zone la plus haute que **touche** le trou de la jauge réglementaire
  centrée sur l'impact (annexe, 5.2.1).
- Mouche : le trou touche l'anneau de mouche ; à la carabine 10 m, le point du 10 doit
  être entièrement emporté — jauge extérieure du pistolet 10 m (11,5 mm) qui ne déborde
  pas l'anneau 7 (annexe, 1.4.5), soit un centre à 2,0 mm au plus.
- Décimales : chaque zone est partagée en dix couronnes égales, de x,0 à x,9 (6.3.3.1),
  le 10 plafonné à 10,9. Exact quand le 10 a la largeur d'une zone (carabine 10 m et
  50 m, pistolet 10 m) ; ailleurs, une convention d'affichage. Le règlement ne note en
  décimales que la carabine 10 m et la carabine 50 m couché en qualification.

## Méthode

1. **Visuel noir** : composantes sombres dont la surface, une fois bouchée, est une
   ellipse ; à défaut (une arme posée qui touche le noir), ellipse par RANSAC sur le bord,
   couverte sur 60 % de son pourtour au moins. Repli : l'utilisateur clique dans le noir,
   l'outil cherche le bord par rayons.
2. **Recalage** : homographie entre le dessin de la cible et la photo, par Gauss-Newton
   robuste (Tukey) du flou au net, avec un modèle d'éclairage (gain et niveau du noir en
   plans). Les deux paramètres de perspective, que le seul bord du noir ne fixe pas, sont
   cherchés à part en balayant l'image du vrai centre (transformations qui conservent le
   cercle) contre les traits des anneaux. Les échantillons dont le voisinage n'a pas la
   couleur de leur zone (objet posé sur la cible, déchirure) sont écartés.
3. **Trous** : la cible est redressée (vue de face, en mm) ; on garde ce qui s'écarte
   du papier ou de l'encre attendus — niveaux et teintes ajustés par zone —, puis une
   ouverture morphologique efface ce qui est plus étroit que 0,6 calibre (traits,
   chiffres).
4. **Tirs** : un, deux… disques du diamètre observé sont placés dans chaque tache ; un
   tir de plus doit expliquer au moins 30 % d'un trou. Le nombre de tirs annoncé départage
   les trous communs. Au-delà de 6 trous d'aire, la tache est un trou d'arrachement : le
   nombre de tirs y est estimé, les positions sont approximatives et signalées.
5. **Garde-fous** : sous 0,7 de corrélation entre photo et dessin recalé, les trous ne
   sont pas comptés. Un candidat visuel de rayon inférieur à 2 % du petit côté de l'image
   est écarté (c'est un trou ou une lettre). Avec plusieurs visuels, chacun ne cherche ses
   trous que dans la région la plus proche de son centre. Une tache d'arrachement doit être
   pleine et ramassée (un trait au feutre, un cercle tracé n'en sont pas). Un tir dont la
   marge à une limite de zone est sous l'incertitude estimée est marqué « limite » ; une
   tache coupée par le bord de la photo n'est pas notée.
6. **Trous sombres du noir** : quand le fond vu à travers le trou est aussi sombre que
   l'encre, un second détecteur cherche, dans le noir seulement, un disque de la taille d'un
   trou un peu plus sombre que l'encre autour (centre moins couronne) ; ses tirs sont
   marqués « à vérifier » (`darkHoles: false` pour s'en passer).

## Ce qui a été mesuré

**Photos synthétiques** (`test/synthetic.test.js`) : caméra à sténopé inclinée jusqu'à
25° et 15°, à 18 cm d'une cible de 10 m, roulis de 30°, éclairage inégal, bruit, trous
qui se chevauchent, trous à cheval sur le bord du noir, carton à deux visuels. Sur les huit
cas : tous les trous retrouvés, aucun en trop, centre de la cible à moins de 0,003 mm,
position des trous à 0,01–0,11 mm en moyenne (0,21 mm au pire), aucun point faux.

**Photos annotées trou par trou** — jeu public de Butt et al. (2024, CC BY 4.0) : photos
de téléphone de cartons de pistolet 10 m tirés, souvent prises très en biais, en 640 × 640
étirés, chaque trou encadré avec sa valeur. Mise au point sur la partie validation (202
images), mesure finale sur la partie test (113 images) sans retouche après coup
(`test/yolo_eval.js`), jauge réglementaire de 4,5 mm :

| test (113 images) | |
|---|---|
| visuel trouvé / recalage fiable | 99 % / 97 % |
| trous de la cible retrouvés | 67 % — 82 % dans le blanc, 54 % dans le noir |
| tirs annoncés qui sont de vrais trous | 80 % |
| valeur identique à l'annotation | 83 % des paires ; à un point près : 100 % |
| écart du total par image | 6 points en médiane, 25 au 90ᵉ centile |

Les trous annotés hors des anneaux (valeur 0, 15 % des annotations) ne sont pas comptés :
l'outil ne cherche pas au-delà de la zone 1. Les trous manqués du noir sont ceux où l'on
voit à travers un fond aussi sombre que l'encre : seuls ressortent les bords déchirés. Les
écarts de valeur vont surtout dans un sens : l'annotateur note plus haut. Sur 60 photos de
la validation, les centres des cadres annotés, notés avec une jauge de 5,5 mm, retrouvent
l'annotation à 90 % et les écarts deviennent symétriques : les annotateurs jugent la touche
sur le trou déchiré, plus large que la jauge. Ce n'est pas un biais de position : le centre
trouvé et celui du cadre annoté ne s'écartent radialement que de −0,01 mm en moyenne.

**Images réelles** — corpus de dix cas (`test/corpus.test.js`, images hors dépôt), tous
conformes au 2026-11-12 :

- quatre cibles vierges de carabine et de pistolet 10 m (Wikimedia Commons, jusqu'à
  171 × 166 px) : zéro tir, recalage fiable ;
- deux cartons Krüger de 25 m scannés côte à côte (Commons) : les deux visuels trouvés ;
  sur celui de droite, les 10 trous retrouvés avec les valeurs lues à l'œil (total 87),
  plus un faux tir sur le symbole « № » imprimé ;
- une cible de pistolet 10 m homologuée prise de face (jeu de données publié sur Hugging
  Face) : les six trous trouvés ; cinq valeurs identiques à la lecture à l'œil, la sixième
  exactement sur la ligne et marquée « limite » ;
- une photo serrée dont le visuel sort du cadre : aucun visuel annoncé (les trous ne sont
  plus pris pour des visuels) ;
- trois photos d'un forum : carton de 25 m cadré serré (recalage à 0,985) ; carton pris de
  biais avec un pistolet et une boîte posés dessus (objets ignorés) ; visuel à moitié hors
  champ et masqué par une carabine (l'outil refuse de compter, corrélation 0,33).

Sur une vingtaine d'autres photos de téléphone du même jeu (cibles de pistolet 10 m,
640 × 640 px), regardées une à une : recalage fiable partout où le visuel est entier ; trous
du blanc et trous clairs du noir trouvés ; trous du noir sur fond sombre manqués, comme
attendu. Aucune de ces vérifications n'est une vérité terrain indépendante : c'est la
lecture d'un œil humain, sur des images peu nombreuses. **Contrôlez le résultat à
l'écran** : l'interface est faite pour corriger.

### Sources de validation repérées

- Butt et al., *Application of YOLOv8 and Detectron2 for Bullet Hole Detection and Score
  Calculation from Shooting Cards*, AI 5 (1), 2024 — 1 243 photos de cartons de pistolet
  10 m tirés à Haarlem, chaque trou annoté avec sa valeur ; licence CC BY 4.0. Hébergé sur
  Roboflow Universe (`project-bat-bullet-hole-detection/bullet-hole-object-detection`,
  version 30 utilisée : parties validation et test sans augmentation) ; l'export demande
  une clé d'API. Une partie des images (29 sur 315) porte des trous recollés par programme.
- `mohamedAli4722/SHOOTING_TARGET_DATASET` (Hugging Face) : réexport de quatre jeux
  Roboflow, dont le précédent ; photos utilisables, mais aucune étiquette n'y porte le nom
  d'une image — les annotations ne peuvent pas être rattachées.
- Wikimedia Commons, catégories *Air pistol targets*, *Air rifle targets*, *Bullseye
  targets* : surtout des cibles vierges, utiles comme témoins négatifs.

## Conseils de prise de vue

- Un trou ne se voit que si ce qu'on aperçoit à travers diffère **du papier et de
  l'encre** : posez la cible sur un fond de couleur vive (feuille rouge, verte, bleue).
  Sur fond blanc, les trous du blanc disparaissent ; sur fond noir, ceux du noir.
- La cible entière dans le cadre, à plat, éclairée sans ombre portée ; de face autant que
  possible (le biais est corrigé, mais il réduit la résolution).

## Utilisation

```html
<link rel="stylesheet" href="target_scorer.css">
<script src="target_scorer.js"></script>
<script src="target_scorer_ui.js"></script>
<div id="scorer"></div>
<script>
  const ui = TargetScorerUI.mount(document.getElementById('scorer'), { lang: 'fr' });
  // ui.setLang('en'), ui.loadFile(file), ui.loadImageData(imageData)
</script>
```

L'interface calcule dans un Web Worker (`target_scorer_worker.js`, à côté de
`target_scorer_ui.js`) ; option `workerUrl: null` pour calculer dans la page.

### API de la bibliothèque

```js
const res = TargetScorer.analyze(imageData, {
  face: 'issf_10m_rifle',  // cible
  gauge: 4.5,              // jauge (mm), par défaut celle de la cible
  expectedShots: 10,       // facultatif
  seeds: [{ x, y }],       // facultatif : visuel désigné d'un clic (pixels)
  aligned: prev.bulls,     // facultatif : reprendre le recalage d'une analyse précédente
  slim: true               // résultat sans les images de travail
});
// res.bulls[i].shots : { x, y (mm, y vers le haut), r, ring, decimal, innerTen,
//                        doubtful, borderline, ragged }
// res.bulls[i].H : homographie mm → pixels de la photo ; .quality.corr ; .reliable

TargetScorer.scoreShot('issf_10m_pistol', 4.75, 4.5);  // { ring: 10, decimal, innerTen: true, margin }
TargetScorer.summarize(shots, 'issf_10m_pistol');       // total, mouches, point moyen, groupement
```

## Tests

```
npm test          # node test/scoring.test.js && node test/synthetic.test.js
node test/synthetic.test.js --dump dossier   # écrit les photos synthétiques (PPM)
node test/corpus.test.js corpus.json          # images réelles décrites par un manifeste
node test/yolo_eval.js dossier issf_10m_pistol 4.5 test   # jeu annoté au format YOLO
```

Le corpus réel n'est pas dans le dépôt (licences, photos de tiers). Son manifeste dit pour
chaque image d'où elle vient, sous quelle licence, et ce qu'on en attend (nombre de
visuels, recalage fiable, nombre de tirs ou valeurs des tirs) ; le format est décrit en
tête de `test/corpus.test.js`. Le décodage passe par ImageMagick.

## Licence

MIT. Les cotes des cibles sont celles du règlement ISSF ; le règlement lui-même n'est pas
redistribué.
