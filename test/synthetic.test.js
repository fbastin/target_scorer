'use strict';
// Épreuve de bout en bout sur photos synthétiques : position des trous retrouvés
// (en mm, contre la vérité terrain), centre de la cible, points attribués.
//   node test/synthetic.test.js [--dump dossier]   (PPM de chaque cas pour inspection)

const TS = require('../target_scorer.js');
const SY = require('./synth.js');

const args = process.argv.slice(2);
const dumpDir = args.indexOf('--dump') >= 0 ? args[args.indexOf('--dump') + 1] : null;
const only = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1] : null;

function deg(d) { return d * Math.PI / 180; }

// Rotation (autour du centre) qui superpose au mieux les tirs trouvés à la vérité.
function bestRotation(det, gt) {
    if (!det.length) return 0;
    const cost = function (phi) {
        const c = Math.cos(phi), s = Math.sin(phi);
        let sum = 0;
        gt.forEach(function (g) {
            let m = Infinity;
            det.forEach(function (d) {
                const u = c * d.u - s * d.v, v = s * d.u + c * d.v;
                m = Math.min(m, Math.hypot(u - g.u, v - g.v));
            });
            sum += Math.min(m, 5);
        });
        return sum;
    };
    let best = 0, bc = Infinity;
    for (let a = -180; a < 180; a += 1) { const c = cost(deg(a)); if (c < bc) { bc = c; best = a; } }
    for (let a = best - 1; a <= best + 1; a += 0.02) { const c = cost(deg(a)); if (c < bc) { bc = c; best = a; } }
    return deg(best);
}

function matchShots(det, gt, tol) {
    const phi = bestRotation(det, gt);
    const c = Math.cos(phi), s = Math.sin(phi);
    const rd = det.map(function (d) { return { u: c * d.u - s * d.v, v: s * d.u + c * d.v, d: d }; });
    const pairs = [];
    const used = new Set();
    const cand = [];
    gt.forEach(function (g, gi) { rd.forEach(function (d, di) { cand.push([Math.hypot(d.u - g.u, d.v - g.v), gi, di]); }); });
    cand.sort(function (a, b) { return a[0] - b[0]; });
    const gUsed = new Set();
    cand.forEach(function (c2) {
        if (c2[0] > tol || gUsed.has(c2[1]) || used.has(c2[2])) return;
        gUsed.add(c2[1]); used.add(c2[2]);
        pairs.push({ err: c2[0], gt: gt[c2[1]], det: rd[c2[2]].d });
    });
    return { pairs: pairs, missed: gt.length - pairs.length, extra: det.length - pairs.length, phi: phi };
}

const CASES = [
    {
        name: 'carabine 10 m, de face, fond gris',
        face: 'issf_10m_rifle', width: 1200, height: 1000,
        camera: { pxPerMm: 16, distance: 400, cx: 600, cy: 500 },
        backing: [128, 128, 128],
        holes: [[0.3, -0.2], [1.8, 0.9], [-2.6, 1.1], [4.0, -3.5], [-7.5, -6.0], [10.5, 2.0], [0.0, 13.0], [-16.0, 3.0]]
    },
    {
        name: 'carabine 10 m, prise de biais (25° / 15°), proche, fond vert, éclairage inégal',
        face: 'issf_10m_rifle', width: 1400, height: 1100,
        camera: { pxPerMm: 18, distance: 180, cx: 640, cy: 560, pitch: deg(25), yaw: deg(15) },
        light: function (x, y) { return 0.75 + 0.35 * x - 0.1 * y; },
        holes: [[0.6, 0.4], [-1.9, 2.2], [3.3, -0.4], [-5.1, -4.4], [8.2, 6.0], [-12.4, 0.5], [2.0, -17.5]]
    },
    {
        name: 'carabine 10 m, roulis 30°, trous qui se chevauchent, nombre annoncé',
        face: 'issf_10m_rifle', width: 1200, height: 1100,
        camera: { pxPerMm: 15, distance: 260, cx: 600, cy: 540, pitch: deg(-12), yaw: deg(8), roll: deg(30) },
        holes: [[0.5, 0.2], [1.6, 0.9], [-3.0, -3.0], [-3.2, -1.2], [6.5, 1.0], [6.0, 3.5]],
        expected: 6
    },
    {
        name: 'pistolet 10 m, groupement serré de 10, fond orange',
        face: 'issf_10m_pistol', width: 1400, height: 1400,
        camera: { pxPerMm: 7, distance: 500, cx: 700, cy: 700, pitch: deg(10), yaw: deg(-12) },
        backing: [220, 120, 40],
        holes: [[1, 2], [6, -3], [-8, 4], [12, 10], [-4, -12], [20, -6], [-15, 18], [3, 26], [30, 30], [-40, -10]],
        expected: 10
    },
    {
        name: 'carabine 50 m, .22, trous à cheval sur le bord du noir',
        face: 'issf_50m_rifle', width: 1500, height: 1300,
        camera: { pxPerMm: 6, distance: 700, cx: 760, cy: 640, pitch: deg(18), yaw: deg(5) },
        holeDiameter: 5.2,
        backing: [150, 110, 70],
        holes: [[1, 1], [-4, 6], [9, -2], [54, 10], [-20, -52], [0, 30], [-36, -36], [60, -30]]
    },
    {
        name: 'pistolet 25 m précision, fond gris foncé',
        face: 'issf_25m_precision', width: 1500, height: 1500,
        camera: { pxPerMm: 2.2, distance: 1200, cx: 750, cy: 750, pitch: deg(8), yaw: deg(14) },
        holeDiameter: 5.4,
        backing: [80, 80, 80],
        holes: [[3, 5], [-20, 14], [40, -30], [-60, -70], [95, 10], [120, 120], [-150, 40], [0, -200]]
    },
    {
        // Carton à deux visuels : chacun ne cherche ses trous que dans sa moitié. Avant,
        // le domaine de l'un recouvrait le noir de l'autre.
        name: 'pistolet 10 m, carton à deux visuels, de biais',
        face: 'issf_10m_pistol', width: 1600, height: 1000,
        camera: { pxPerMm: 4.0, distance: 900, cx: 800, cy: 500, pitch: deg(12), yaw: deg(-8) },
        cardW: 380, cardH: 200, centers: [[-90, 0], [90, 0]],
        backing: [200, 60, 60],
        holes: [[-92, 3], [-80, -20], [-120, 25], [-60, 40], [95, -2], [104, 12], [70, -35], [130, 20], [88, 60]]
    },
    {
        name: 'pistolet 25 m tir rapide, traits de visée',
        face: 'issf_25m_rapid', width: 1400, height: 1400,
        camera: { pxPerMm: 2.0, distance: 1500, cx: 700, cy: 700, pitch: deg(6), yaw: deg(-9) },
        holeDiameter: 5.4,
        backing: [200, 200, 60],
        holes: [[10, 20], [-40, 30], [150, 1], [-170, -2], [0, -120], [80, 160]]
    }
];

let failures = 0;
const results = [];
CASES.forEach(function (tc, idx) {
    if (only && String(idx) !== only) return;
    const face = TS.FACES[tc.face];
    const holes = tc.holes.map(function (h) { return { u: h[0], v: h[1] }; });
    const t0 = Date.now();
    const sc = SY.render(face, {
        width: tc.width, height: tc.height, camera: tc.camera, holes: holes,
        holeDiameter: tc.holeDiameter, backing: tc.backing, light: tc.light, seed: idx + 1,
        cardW: tc.cardW, cardH: tc.cardH, centers: tc.centers
    });
    const tRender = Date.now() - t0;
    if (dumpDir) SY.writePPM(dumpDir + '/case' + idx + '.ppm', sc.image);
    const res = TS.analyze(sc.image, { face: tc.face, expectedShots: tc.expected, darkHoles: args.indexOf('--no-dark') < 0 });
    const out = { name: tc.name, ms: res.ms, render: tRender };
    if (!res.bulls.length) {
        out.error = 'aucun visuel trouvé';
        failures++;
        results.push(out);
        return;
    }
    // Chaque visuel vrai est apparié au visuel trouvé dont le centre en est le plus
    // proche ; ses trous sont ceux qui sont plus près de lui que des autres.
    const centers = tc.centers || [[0, 0]];
    const ppmmC = tc.camera.pxPerMm;
    out.found = 0; out.expected = holes.length; out.missed = 0; out.extra = 0;
    out.centreErrMM = 0; out.corr = 1; out.wrongScores = 0;
    let errs = [];
    if (res.bulls.length !== centers.length) out.bullCount = res.bulls.length + '/' + centers.length;
    centers.forEach(function (c, ci) {
        const cTrue = TS.hApply(sc.G, c[0], c[1]);
        let b = null, bd = Infinity;
        res.bulls.forEach(function (bb) {
            const p = TS.hApply(bb.H, 0, 0), d = Math.hypot(p[0] - cTrue[0], p[1] - cTrue[1]);
            if (d < bd) { bd = d; b = bb; }
        });
        const mine = holes.filter(function (h) {
            let k0 = 0, dk = Infinity;
            centers.forEach(function (cc, k) { const d = Math.hypot(h.u - cc[0], h.v - cc[1]); if (d < dk) { dk = d; k0 = k; } });
            return k0 === ci;
        }).map(function (h) { return { u: h.u - c[0], v: h.v - c[1] }; });
        if (!b) { out.missed += mine.length; return; }
        out.centreErrMM = Math.max(out.centreErrMM, bd / ppmmC);
        out.corr = Math.min(out.corr, b.quality.corr);
        const m = matchShots(b.shots, mine, face.gauge);
        out.found += b.shots.length; out.missed += m.missed; out.extra += m.extra;
        errs = errs.concat(m.pairs.map(function (p) { return p.err; }));
        m.pairs.forEach(function (p) {
            const t = TS.scoreShot(face, Math.hypot(p.gt.u, p.gt.v));
            if (t.ring !== p.det.ring && !p.det.borderline) out.wrongScores++;
        });
    });
    out.maxErrMM = errs.length ? Math.max.apply(null, errs) : null;
    out.meanErrMM = errs.length ? errs.reduce(function (a, c) { return a + c; }, 0) / errs.length : null;
    const wrong = out.wrongScores;
    const ok = !out.bullCount && out.missed === 0 && out.extra === 0 && out.maxErrMM < 0.08 * face.gauge + 0.6 / ppmmC && out.centreErrMM < 0.03 * face.gauge + 0.5 / ppmmC && wrong === 0;
    out.ok = ok;
    if (!ok) failures++;
    results.push(out);
});

results.forEach(function (r) {
    console.log((r.ok ? 'OK   ' : 'ÉCHEC') + ' ' + r.name);
    if (r.error) { console.log('      ' + r.error); return; }
    console.log('      ' + (r.bullCount ? 'VISUELS ' + r.bullCount + ' ; ' : '') + 'trouvés ' + r.found + '/' + r.expected + ' (manqués ' + r.missed + ', en trop ' + r.extra + ')' +
        ' ; erreur max ' + (r.maxErrMM == null ? '—' : r.maxErrMM.toFixed(3)) + ' mm, moyenne ' + (r.meanErrMM == null ? '—' : r.meanErrMM.toFixed(3)) +
        ' ; centre ' + r.centreErrMM.toFixed(3) + ' mm ; corrélation ' + r.corr.toFixed(3) +
        ' ; points faux ' + r.wrongScores + ' ; ' + r.ms + ' ms');
});
process.exitCode = failures ? 1 : 0;
