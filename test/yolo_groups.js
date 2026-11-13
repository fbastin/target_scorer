'use strict';
// Ventilation des résultats de test/yolo_eval.js (fichiers --json) par type d'image, avec
// intervalle de confiance à 95 % par rééchantillonnage des images (les trous d'une même
// image ne sont pas indépendants).
//   node test/yolo_groups.js res1.json [res2.json …] [--ci]
// Les types suivent les noms de fichiers du jeu de Butt et al. (Roboflow) :
//   « 2023MMJJ_hhmmss » ou « IMG_2023… » : photos datées ;
//   « N_hhmm-JJ-MM-AAAA_API_vK » : cartons photographiés tenus à la main ;
//   « NN_vK » : images générées (trous recollés par programme) ;
//   le reste (« N_N ») : autres photos.
// Rappel compté sur les trous de la cible (valeurs 1 à 10) ; précision sur tous les tirs
// annoncés par l'outil.

const fs = require('fs');

const args = process.argv.slice(2);
const files = args.filter(function (a) { return !a.startsWith('--'); });
if (!files.length) { console.error('usage : node test/yolo_groups.js res.json [res2.json …] [--ci]'); process.exit(2); }
let rows = [];
files.forEach(function (f) { rows = rows.concat(JSON.parse(fs.readFileSync(f, 'utf8')).rows); });

function groupOf(f) {
    const k = f.replace(/_(jpg|png|jpeg)\.rf\..*/i, '');
    if (/^\d+_v\d+$/.test(k)) return 'générées (NN_vK)';
    if (k.indexOf('_API_v') >= 0) return 'photos tenues à la main (…_API_vK)';
    if (/^(IMG_)?2023\d{4}_\d{6}/.test(k)) return 'photos datées (2023…)';
    return 'autres photos (N_N)';
}

function stats(rs) {
    const rel = rs.filter(function (r) { return r.reliable; });
    const count = function (lo, hi, found) {
        let n = 0;
        rel.forEach(function (r) { r.gtDetail.forEach(function (t) { if (t[0] >= lo && t[0] <= hi) n += found ? t[1] : 1; }); });
        return n;
    };
    const S = function (k) { return rel.reduce(function (a, r) { return a + r[k]; }, 0); };
    const err = rel.map(function (r) { return Math.abs(r.detTotal - r.gtTotal); }).sort(function (a, b) { return a - b; });
    const div = function (a, b) { return a / Math.max(1, b); };
    return {
        n: rs.length,
        found: div(rs.filter(function (r) { return r.found; }).length, rs.length),
        rel: div(rel.length, rs.length),
        holes: count(1, 10, false),
        rec: div(count(1, 10, true), count(1, 10, false)),
        noir: div(count(7, 10, true), count(7, 10, false)),
        blanc: div(count(1, 6, true), count(1, 6, false)),
        prec: div(S('matched'), S('det')),
        exact: div(S('exact'), S('matched')),
        pm1: div(S('exact') + S('off1'), S('matched')),
        med: err.length ? err[err.length >> 1] : NaN,
        p90: err.length ? err[Math.floor(0.9 * (err.length - 1))] : NaN
    };
}

// Générateur pseudo-aléatoire à graine fixe : les intervalles se reproduisent à l'identique.
function rng(seed) {
    let s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function bootstrap(rs, key, B) {
    const rand = rng(7), v = [];
    for (let b = 0; b < B; b++) {
        const sample = [];
        for (let i = 0; i < rs.length; i++) sample.push(rs[Math.floor(rand() * rs.length)]);
        v.push(stats(sample)[key]);
    }
    v.sort(function (a, b) { return a - b; });
    return [v[Math.floor(0.025 * B)], v[Math.floor(0.975 * B)]];
}

const groups = [['tout', rows], ['photos (tout sauf NN_vK)', rows.filter(function (r) { return groupOf(r.file) !== 'générées (NN_vK)'; })]];
const byName = {};
rows.forEach(function (r) { const g = groupOf(r.file); (byName[g] = byName[g] || []).push(r); });
Object.keys(byName).sort().forEach(function (g) { groups.push([g, byName[g]]); });

const pc = function (x) { return (100 * x).toFixed(1).padStart(6); };
console.log('groupe'.padEnd(38) + '     n   vis. fiab. trous rappel  noir  blanc  préc. exact    ±1  méd.  p90');
groups.forEach(function (g) {
    const s = stats(g[1]);
    console.log(g[0].padEnd(38) + String(s.n).padStart(6) + pc(s.found) + pc(s.rel) + String(s.holes).padStart(6) + pc(s.rec) + pc(s.noir) +
                pc(s.blanc) + pc(s.prec) + pc(s.exact) + pc(s.pm1) + String(s.med).padStart(5) + String(s.p90).padStart(5));
});
if (args.indexOf('--ci') >= 0) {
    console.log('\nIntervalle à 95 % (rééchantillonnage des images, 2000 tirages), « tout » :');
    [['rec', 'trous de la cible retrouvés'], ['noir', 'dans le noir'], ['blanc', 'dans le blanc'], ['prec', 'tirs qui sont de vrais trous'], ['exact', 'valeur identique']].forEach(function (k) {
        const ci = bootstrap(rows, k[0], 2000);
        console.log('  ' + k[1].padEnd(30) + (100 * stats(rows)[k[0]]).toFixed(1) + ' %  [' + (100 * ci[0]).toFixed(1) + ' – ' + (100 * ci[1]).toFixed(1) + ']');
    });
}
