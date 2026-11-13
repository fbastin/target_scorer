'use strict';
// Évaluation sur un jeu de données annoté au format YOLO (export Roboflow, par exemple
// Butt et al. 2024) dont les classes de trous portent la VALEUR du tir (« 0 » … « 10 »).
//   node test/yolo_eval.js dossier_du_jeu face [jauge] [parties] [--json sortie.json] [--limit n]
//   ex. : node test/yolo_eval.js ~/…/v30/data issf_10m_pistol 4.5 valid,test --json res.json
// Le dossier contient data.yaml et, par partie, images/ et labels/. Décodage par
// ImageMagick (`convert`).
//
// Appariement : chaque trou annoté est apparié au tir trouvé le plus proche (dans la
// photo, en pixels) à moins de 0,75 fois le plus grand côté de sa boîte, appariement
// glouton par distance croissante. On mesure : visuel trouvé et fiable, rappel (trous
// annotés retrouvés), précision (tirs trouvés qui sont des trous annotés), accord des
// valeurs sur les paires, écart du total par image. Les valeurs annotées sont celles
// d'annotateurs humains : un désaccord n'est pas forcément une erreur de l'outil.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const TS = require('../target_scorer.js');

const args = process.argv.slice(2);
const opt = function (name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const pos = args.filter(function (a, i) { return !a.startsWith('--') && !(i > 0 && ['--json', '--limit'].indexOf(args[i - 1]) >= 0); });
const dir = pos[0], face = pos[1] || 'issf_10m_pistol', gauge = pos[2] ? +pos[2] : undefined;
const splits = (pos[3] || 'valid,test').split(',');
const limit = opt('--limit') ? +opt('--limit') : Infinity;
const jsonOut = opt('--json');
if (!dir) { console.error('usage : node test/yolo_eval.js dossier face [jauge] [parties]'); process.exit(2); }

// Noms des classes, lus dans data.yaml (liste « names: [...] » sur une ligne, ou en tirets).
const yaml = fs.readFileSync(path.join(dir, 'data.yaml'), 'utf8');
let names = null;
const inline = yaml.match(/names:\s*\[([^\]]*)\]/);
if (inline) names = inline[1].split(',').map(function (s) { return s.trim().replace(/^['"]|['"]$/g, ''); });
else names = (yaml.split('names:')[1] || '').split('\n').filter(function (l) { return /^\s*-\s/.test(l); }).map(function (l) { return l.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, ''); });
const valueOf = names.map(function (n) { const m = n.match(/^(?:bullet_?)?(\d+)$/i); return m ? +m[1] : null; });

function decode(file) {
    const buf = execFileSync('convert', [file, '-depth', '8', 'ppm:-'], { maxBuffer: 1 << 28 });
    let p = 0;
    const tok = function () {
        while (buf[p] === 0x20 || buf[p] === 0x0a || buf[p] === 0x0d || buf[p] === 0x09) p++;
        let s = '';
        while (!(buf[p] === 0x20 || buf[p] === 0x0a || buf[p] === 0x0d || buf[p] === 0x09)) s += String.fromCharCode(buf[p++]);
        return s;
    };
    tok(); const w = +tok(), h = +tok(); tok(); p++;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[4 * i] = buf[p++]; data[4 * i + 1] = buf[p++]; data[4 * i + 2] = buf[p++]; data[4 * i + 3] = 255; }
    return { width: w, height: h, data: data };
}

const kindOf = function (f) { return /^\d+_v\d+_(jpg|png|jpeg)\.rf\./i.test(f) ? 'générée' : 'photo'; };
const rows = [];
let n = 0;
splits.forEach(function (split) {
    const imgDir = path.join(dir, split, 'images'), labDir = path.join(dir, split, 'labels');
    if (!fs.existsSync(imgDir)) return;
    fs.readdirSync(imgDir).sort().forEach(function (f) {
        if (n++ >= limit) return;
        const img = decode(path.join(imgDir, f));
        const lab = fs.readFileSync(path.join(labDir, f.replace(/\.[^.]+$/, '.txt')), 'utf8').trim().split('\n').filter(Boolean);
        const gt = [];
        lab.forEach(function (l) {
            const t = l.trim().split(/\s+/).map(Number);
            const v = valueOf[t[0]];
            if (v == null) return;
            gt.push({ x: t[1] * img.width, y: t[2] * img.height, size: Math.max(t[3] * img.width, t[4] * img.height), value: v });
        });
        const res = TS.analyze(img, { face: face, gauge: gauge, slim: true, darkHoles: args.indexOf('--no-dark') < 0 });
        // Le visuel retenu : le plus fiable (le plus corrélé).
        const b = res.bulls.slice().sort(function (p, q) { return q.quality.corr - p.quality.corr; })[0];
        const det = b ? b.shots.map(function (s) { const q = TS.hApply(b.H, s.u, s.v); return { x: q[0], y: q[1], ring: s.ring, borderline: s.borderline, ragged: s.ragged }; }) : [];
        const cand = [];
        gt.forEach(function (g, gi) { det.forEach(function (d, di) { const dd = Math.hypot(g.x - d.x, g.y - d.y); if (dd <= 0.75 * g.size) cand.push([dd, gi, di]); }); });
        cand.sort(function (a, c) { return a[0] - c[0]; });
        const gU = new Set(), dU = new Set(), pairs = [];
        cand.forEach(function (c) { if (gU.has(c[1]) || dU.has(c[2])) return; gU.add(c[1]); dU.add(c[2]); pairs.push({ gt: gt[c[1]], det: det[c[2]], dist: c[0] }); });
        const detOf = new Map(pairs.map(function (p) { return [p.gt, p.det]; }));
        // Résolution effective : pixels par mm dans la direction la plus écrasée par la
        // perspective (plus petite valeur singulière du jacobien de H au centre).
        let ppmmMin = 0;
        if (b) {
            const e = 0.5, c0 = TS.hApply(b.H, 0, 0), cx = TS.hApply(b.H, e, 0), cy = TS.hApply(b.H, 0, e);
            const a = (cx[0] - c0[0]) / e, bb = (cy[0] - c0[0]) / e, c = (cx[1] - c0[1]) / e, dd = (cy[1] - c0[1]) / e;
            const s1 = a * a + bb * bb + c * c + dd * dd, det = Math.abs(a * dd - bb * c);
            ppmmMin = Math.sqrt(Math.max(0, (s1 - Math.sqrt(Math.max(0, s1 * s1 - 4 * det * det))) / 2));
        }
        const row = {
            file: f, split: split, kind: kindOf(f), bulls: res.bulls.length, found: !!b, reliable: !!(b && b.reliable), ppmmMin: ppmmMin,
            corr: b ? b.quality.corr : 0, gt: gt.length, det: det.length, matched: pairs.length,
            exact: pairs.filter(function (p) { return p.det.ring === p.gt.value; }).length,
            off1: pairs.filter(function (p) { return Math.abs(p.det.ring - p.gt.value) === 1; }).length,
            offBorderline: pairs.filter(function (p) { return p.det.ring !== p.gt.value && p.det.borderline; }).length,
            gtTotal: gt.reduce(function (a, g) { return a + g.value; }, 0),
            detTotal: det.reduce(function (a, d) { return a + d.ring; }, 0),
            ragged: det.filter(function (d) { return d.ragged; }).length,
            diffs: pairs.filter(function (p) { return p.det.ring !== p.gt.value; }).map(function (p) { return [p.gt.value, p.det.ring, p.det.borderline ? 1 : 0, Math.round(p.gt.x), Math.round(p.gt.y)]; }),
            // Par trou annoté : [valeur, retrouvé, valeur donnée par l'outil].
            gtDetail: gt.map(function (g) { const d = detOf.get(g); return [g.value, d ? 1 : 0, d ? d.ring : null]; }),
            ms: res.ms
        };
        rows.push(row);
        process.stderr.write('.');
    });
});
process.stderr.write('\n');

function report(label, rs) {
    if (!rs.length) return;
    const sum = function (k) { return rs.reduce(function (a, r) { return a + r[k]; }, 0); };
    const rel = rs.filter(function (r) { return r.reliable; });
    const sumR = function (k) { return rel.reduce(function (a, r) { return a + r[k]; }, 0); };
    const pct = function (a, b) { return b ? (100 * a / b).toFixed(1) + ' %' : '—'; };
    const totErr = rel.map(function (r) { return Math.abs(r.detTotal - r.gtTotal); }).sort(function (a, b) { return a - b; });
    const exactTotals = rel.filter(function (r) { return r.detTotal === r.gtTotal && r.det === r.gt; }).length;
    console.log('\n== ' + label + ' : ' + rs.length + ' images');
    console.log('  visuel trouvé ' + pct(rs.filter(function (r) { return r.found; }).length, rs.length) +
                ', fiable ' + pct(rel.length, rs.length));
    console.log('  sur les images fiables (' + rel.length + ') : trous annotés ' + sumR('gt') + ', tirs trouvés ' + sumR('det') +
                ', appariés ' + sumR('matched'));
    console.log('  rappel ' + pct(sumR('matched'), sumR('gt')) + ', précision ' + pct(sumR('matched'), sumR('det')) +
                ' (dont tirs d\'arrachement ' + sumR('ragged') + ')');
    console.log('  valeurs sur les paires : identiques ' + pct(sumR('exact'), sumR('matched')) + ', à ±1 ' + pct(sumR('exact') + sumR('off1'), sumR('matched')) +
                ' ; désaccords marqués « limite » : ' + sumR('offBorderline') + ' sur ' + (sumR('matched') - sumR('exact')));
    if (totErr.length) console.log('  total par image : identique (et même nombre de tirs) sur ' + pct(exactTotals, rel.length) +
                ' ; écart absolu médian ' + totErr[totErr.length >> 1] + ' points, 90e centile ' + totErr[Math.floor(0.9 * (totErr.length - 1))]);
    const byZone = function (lo, hi) {
        let g = 0, m = 0;
        rel.forEach(function (r) { (r.gtDetail || []).forEach(function (t) { if (t[0] >= lo && t[0] <= hi) { g++; m += t[1]; } }); });
        return pct(m, g) + ' (' + m + '/' + g + ')';
    };
    console.log('  rappel par zone : noir (7–10) ' + byZone(7, 10) + ', blanc (1–6) ' + byZone(1, 6) + ', hors cible (0) ' + byZone(0, 0));
    console.log('  temps moyen ' + (sum('ms') / rs.length / 1000).toFixed(1) + ' s');
}
report('tout', rows);
[[0, 1.5], [1.5, 3], [3, 1e9]].forEach(function (bin) {
    report('photos, résolution ' + bin[0] + '–' + (bin[1] > 1e8 ? '∞' : bin[1]) + ' px/mm (direction écrasée)',
           rows.filter(function (r) { return r.kind === 'photo' && r.ppmmMin >= bin[0] && r.ppmmMin < bin[1]; }));
});
report('photos', rows.filter(function (r) { return r.kind === 'photo'; }));
report('images générées', rows.filter(function (r) { return r.kind === 'générée'; }));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ dir: dir, face: face, gauge: gauge, names: names, rows: rows }, null, 1));
