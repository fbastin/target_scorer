'use strict';
// Validation sur un corpus d'images réelles décrit par un manifeste JSON. Les images
// restent hors du dépôt (licences, photos de tiers) : le manifeste dit où elles sont,
// d'où elles viennent et ce qu'on en attend.
//   node test/corpus.test.js chemin/vers/corpus.json
// Décodage des images par ImageMagick (`convert`), qui doit être installé.
//
// Format d'une entrée :
//   { id, file (relatif au manifeste), face, gauge?, source, licence, note,
//     expect: { bulls?, bull? ('left'|'right'|index), reliable?, shots?, scores?,
//               extraAllowed?, borderlineTolerance?, maxRadius?, noReliableBull? } }
// scores : valeurs attendues des tirs (ordre indifférent) ; extraAllowed : faux tirs
// tolérés ; borderlineTolerance : écart permis sur un tir que l'outil marque « limite ».

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const TS = require('../target_scorer.js');

const manifestPath = process.argv[2];
if (!manifestPath) { console.error('usage : node test/corpus.test.js corpus.json'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const base = path.dirname(path.resolve(manifestPath));

function decode(file) {
    const buf = execFileSync('convert', [file, '-background', 'white', '-flatten', '-depth', '8', 'ppm:-'], { maxBuffer: 1 << 28 });
    let pos = 0;
    const tok = function () {
        while (buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09) pos++;
        if (buf[pos] === 0x23) { while (buf[pos] !== 0x0a) pos++; return tok(); }
        let s = '';
        while (!(buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09)) s += String.fromCharCode(buf[pos++]);
        return s;
    };
    const magic = tok(), w = +tok(), h = +tok(); tok(); pos++;
    if (magic !== 'P6') throw new Error('PPM P6 attendu');
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[4 * i] = buf[pos++]; data[4 * i + 1] = buf[pos++]; data[4 * i + 2] = buf[pos++]; data[4 * i + 3] = 255; }
    return { width: w, height: h, data: data };
}

// Appariement des valeurs : chaque valeur attendue prend une valeur trouvée égale, ou
// voisine d'au plus `tol` si le tir est marqué « limite ».
function matchScores(expected, shots, tol) {
    const left = shots.map(function (s) { return { ring: s.ring, borderline: s.borderline, used: false }; });
    let missing = 0;
    expected.slice().sort(function (a, b) { return b - a; }).forEach(function (v) {
        let hit = left.find(function (s) { return !s.used && s.ring === v; });
        if (!hit && tol) hit = left.find(function (s) { return !s.used && s.borderline && Math.abs(s.ring - v) <= tol; });
        if (hit) hit.used = true; else missing++;
    });
    return { missing: missing, extra: left.filter(function (s) { return !s.used; }).length };
}

let fails = 0;
manifest.entries.forEach(function (e) {
    const file = path.join(base, e.file);
    const x = e.expect || {};
    const problems = [];
    let summary = '';
    if (!fs.existsSync(file)) {
        console.log('ABSENT ' + e.id + ' (' + e.file + ')');
        fails++;
        return;
    }
    const img = decode(file);
    const res = TS.analyze(img, { face: e.face, gauge: e.gauge, slim: true, darkHoles: process.argv.indexOf('--no-dark') < 0 });
    const bulls = res.bulls.slice().sort(function (a, b) { return TS.hApply(a.H, 0, 0)[0] - TS.hApply(b.H, 0, 0)[0]; });
    if (x.bulls != null && bulls.length !== x.bulls) problems.push(bulls.length + ' visuel(s) au lieu de ' + x.bulls);
    if (x.noReliableBull && bulls.some(function (b) { return b.reliable; })) problems.push('un visuel jugé fiable');
    let b = null;
    if (bulls.length && x.bulls !== 0 && !x.noReliableBull) {
        b = x.bull === 'right' ? bulls[bulls.length - 1] : x.bull === 'left' ? bulls[0] : bulls[x.bull || 0];
        if (x.reliable != null && b.reliable !== x.reliable) problems.push('fiable = ' + b.reliable + ' (corrélation ' + b.quality.corr.toFixed(3) + ')');
        if (x.shots != null && b.shots.length !== x.shots) problems.push(b.shots.length + ' tir(s) au lieu de ' + x.shots);
        if (x.scores) {
            const m = matchScores(x.scores, b.shots, x.borderlineTolerance || 0);
            if (m.missing) problems.push(m.missing + ' valeur(s) attendue(s) non trouvée(s)');
            if (m.extra > (x.extraAllowed || 0)) problems.push(m.extra + ' tir(s) en trop (tolérés : ' + (x.extraAllowed || 0) + ')');
        }
        if (x.maxRadius != null) {
            const far = b.shots.filter(function (s) { return s.r > x.maxRadius; }).length;
            if (far) problems.push(far + ' tir(s) au-delà de ' + x.maxRadius + ' mm');
        }
        summary = 'corrélation ' + b.quality.corr.toFixed(3) + ', ' + b.shots.length + ' tir(s), total ' + TS.summarize(b.shots, e.face, e.gauge).total +
                  (b.shots.some(function (s) { return s.ragged; }) ? ' (dont arrachement)' : '');
    } else {
        summary = bulls.length + ' visuel(s)' + (bulls.length ? ', corrélation ' + bulls.map(function (q) { return q.quality.corr.toFixed(2); }).join('/') : '');
    }
    const ok = !problems.length;
    if (!ok) fails++;
    console.log((ok ? 'OK    ' : 'ÉCHEC ') + e.id + ' — ' + summary + ' (' + res.ms + ' ms)');
    problems.forEach(function (p) { console.log('       ' + p); });
});
console.log((manifest.entries.length - fails) + '/' + manifest.entries.length + ' cas du corpus conformes');
process.exitCode = fails ? 1 : 0;
