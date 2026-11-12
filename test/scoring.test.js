'use strict';
// Notation : cas limites calculés à la main depuis le règlement ISSF (édition 2025,
// 2e tirage 07/2026). Un tir vaut la zone la plus haute que touche le trou de la jauge
// (annexe « Rules for Paper Target Scoring », 5.2.1) ; diamètres au bord extérieur des
// anneaux (1.1.2) ; décimales en dixièmes de zone (6.3.3.1).
//   node test/scoring.test.js

const TS = require('../target_scorer.js');

let fail = 0, n = 0;
function eq(label, got, want) {
    n++;
    const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want;
    if (!ok) { fail++; console.log('ÉCHEC ' + label + ' : obtenu ' + got + ', attendu ' + want); }
}
function score(face, r, g) { return TS.scoreShot(face, r, g); }

// Carabine 10 m (6.3.4.3), plomb 4,5 : le 10 est un point de 0,5 mm.
eq('C10 r=0 décimal', score('issf_10m_rifle', 0).decimal, 10.9);
eq('C10 r=0,25 → 10,9', score('issf_10m_rifle', 0.25).decimal, 10.9);
eq('C10 r=0,26 → 10,8', score('issf_10m_rifle', 0.26).decimal, 10.8);
eq('C10 r=2,5 touche le point → 10', score('issf_10m_rifle', 2.5).ring, 10);
eq('C10 r=2,5 → 10,0', score('issf_10m_rifle', 2.5).decimal, 10.0);
eq('C10 r=2,51 → 9', score('issf_10m_rifle', 2.51).ring, 9);
eq('C10 r=2,6 → 9,9', score('issf_10m_rifle', 2.6).decimal, 9.9);
// Mouche : jauge extérieure pistolet (11,5) qui ne déborde pas l'anneau 7 (15,5) :
// r ≤ 7,75 − 5,75 = 2,0 (annexe 1.4.5) — soit le point du 10 entièrement emporté.
eq('C10 mouche r=2,0', score('issf_10m_rifle', 2.0).innerTen, true);
eq('C10 pas de mouche r=2,01', score('issf_10m_rifle', 2.01).innerTen, false);
eq('C10 r=25,0 touche l\'anneau 1', score('issf_10m_rifle', 25.0).ring, 1);
eq('C10 r=25,01 → 0', score('issf_10m_rifle', 25.01).ring, 0);

// Pistolet 10 m (6.3.4.6) : 10 = 11,5 ; mouche 5,0 (r ≤ 2,5 + 2,25 = 4,75, soit la jauge
// de mouche de 18 mm qui ne déborde pas le 9 de 27,5 : 13,75 − 9 = 4,75, annexe 1.4.6).
eq('P10 r=8,0 → 10', score('issf_10m_pistol', 8.0).ring, 10);
eq('P10 r=8,01 → 9', score('issf_10m_pistol', 8.01).ring, 9);
eq('P10 mouche r=4,75', score('issf_10m_pistol', 4.75).innerTen, true);
eq('P10 pas de mouche r=4,76', score('issf_10m_pistol', 4.76).innerTen, false);
eq('P10 r=0 → 10,9 (plafond)', score('issf_10m_pistol', 0).decimal, 10.9);
eq('P10 r=80,0 → 1', score('issf_10m_pistol', 80.0).ring, 1);

// Carabine 50 m (6.3.4.2), .22 (5,6) : 10 = 10,4 ; mouche 5,0.
eq('C50 r=8,0 → 10', score('issf_50m_rifle', 8.0).ring, 10);
eq('C50 r=8,01 → 9', score('issf_50m_rifle', 8.01).ring, 9);
eq('C50 mouche r=5,3', score('issf_50m_rifle', 5.3).innerTen, true);
eq('C50 r=12,0 → 9,5', score('issf_50m_rifle', 12.0).decimal, 9.5);

// Pistolet 25 m précision / 50 m (6.3.4.5) : 10 = 50 ; mouche 25.
eq('P25 .22 r=27,8 → 10', score('issf_25m_precision', 27.8).ring, 10);
eq('P25 .22 r=27,81 → 9', score('issf_25m_precision', 27.81).ring, 9);
eq('P25 .22 mouche r=15,3', score('issf_25m_precision', 15.3).innerTen, true);
eq('P25 9,65 r=29,825 → 10', score('issf_25m_precision', 29.825, 9.65).ring, 10);
eq('P25 .22 r=252,8 → 1', score('issf_25m_precision', 252.8).ring, 1);

// Tir rapide 25 m (6.3.4.4) : zones 5 à 10 seulement.
eq('TR r=252,8 → 5', score('issf_25m_rapid', 252.8).ring, 5);
eq('TR r=252,81 → 0', score('issf_25m_rapid', 252.81).ring, 0);
eq('TR r=52,8 → 10', score('issf_25m_rapid', 52.8).ring, 10);
eq('TR mouche r=27,8', score('issf_25m_rapid', 27.8).innerTen, true);

// Carabine 300 m (6.3.4.1), jauge 8,00 : 10 = 100 ; mouche 50.
eq('C300 r=54 → 10', score('issf_300m', 54).ring, 10);
eq('C300 r=54,01 → 9', score('issf_300m', 54.01).ring, 9);
eq('C300 mouche r=29', score('issf_300m', 29).innerTen, true);

// Pas des anneaux.
eq('pas C10', TS.ringStep(TS.FACES.issf_10m_rifle), 2.5);
eq('pas P10', TS.ringStep(TS.FACES.issf_10m_pistol), 8);
eq('pas TR', TS.ringStep(TS.FACES.issf_25m_rapid), 40);

// Bilan.
const sum = TS.summarize([{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 0.5, y: 0 }], 'issf_10m_rifle');
eq('bilan total', sum.total, 30);
eq('bilan mouches', sum.innerTens, 3);
eq('bilan plus grand écart', sum.extremeSpread, 2);
eq('bilan point moyen x', sum.mpi.x, 0.5 / 3);

console.log((n - fail) + '/' + n + ' cas de notation justes');
process.exitCode = fail ? 1 : 0;
