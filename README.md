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
   sont pas comptés. Un tir dont la marge à une limite de zone est sous l'incertitude
   estimée est marqué « limite » ; une tache coupée par le bord de la photo n'est pas
   notée.

## Ce qui a été mesuré

**Photos synthétiques** (`test/synthetic.test.js`) : caméra à sténopé inclinée jusqu'à
25° et 15°, à 18 cm d'une cible de 10 m, roulis de 30°, éclairage inégal, bruit, trous
qui se chevauchent, trous à cheval sur le bord du noir. Sur les sept cas : tous les trous
retrouvés, aucun en trop, centre de la cible à moins de 0,003 mm, position des trous à
0,01–0,17 mm en moyenne (0,54 mm au pire, cible de 500 mm), aucun point faux.

**Photos réelles** (pièces jointes d'un forum, 640 × 480 à 1600 × 1200) :

- carton de pistolet 25 m net, cadré serré : recalage à 0,985 de corrélation, trous
  isolés retrouvés ; la déchirure centrale d'un groupement est comptée comme trou
  d'arrachement, au nombre estimé ;
- carton photographié de biais sous une lampe, pistolet et boîte de cartouches posés
  dessus : objets ignorés, recalage juste à quelques pixels près (0,89) ; les trous du
  noir, sombres sur fond sombre, ne sont pas vus ;
- visuel à moitié hors champ et masqué par une carabine : l'outil refuse de compter
  (corrélation 0,49) plutôt que de donner un faux score.

Le synthétique est idéalisé ; ces trois photos sont peu nombreuses. **Contrôlez le
résultat à l'écran** : l'interface est faite pour corriger.

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
```

## Licence

MIT. Les cotes des cibles sont celles du règlement ISSF ; le règlement lui-même n'est pas
redistribué.
