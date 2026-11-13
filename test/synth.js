'use strict';
// Photos synthétiques de cibles ISSF tirées, pour éprouver target_scorer.js.
// Une caméra à sténopé regarde le plan de la cible (inclinaison, lacet, roulis,
// distance) : l'homographie est exacte, les trous ont la position voulue au
// micron près — c'est la vérité terrain contre laquelle on mesure l'outil.

const TS = require('../target_scorer.js');

function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
function mul3(A, B) {
    const C = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j];
    return C;
}

// Homographie mm (cible, v vers le bas) → pixels.
function cameraHomography(o) {
    const R = mul3(rotZ(o.roll || 0), mul3(rotY(o.yaw || 0), rotX(o.pitch || 0)));
    const f = o.pxPerMm * o.distance;
    const K = [f, 0, o.cx, 0, f, o.cy, 0, 0, 1];
    const M = [R[0], R[1], 0, R[3], R[4], 0, R[6], R[7], o.distance];
    return mul3(K, M);
}

function inv3(H) { return TS.hInv(H); }

// Couleur (0..255) du point (u, v) mm de la scène.
function makeScene(face, o) {
    const prof = TS._internal.buildProfile(face);
    const holes = o.holes || [];
    const holeR = (o.holeDiameter || face.gauge) / 2;
    const card = o.cardMM || face.rings[0] * 1.6;
    const cardW = o.cardW || card, cardH = o.cardH || card;
    // Plusieurs visuels sur un carton (cartons d'entraînement) : centres en mm. Les trous
    // sont donnés en coordonnées du carton.
    const centers = o.centers || [[0, 0]];
    const paper = o.paper || [235, 233, 225];
    const ink = o.ink || [22, 22, 26];
    const backing = o.backing || [70, 140, 60];
    const table = o.table || [120, 90, 60];
    // Chiffres : 6.3.4.4 « environ 5 mm de haut et 0,5 mm d'épaisseur » (tir rapide),
    // 6.3.4.5 « 10 mm, 1 mm » (précision 25 m) ; ailleurs, à la proportion de la planche.
    const digitH = o.digitHeight != null ? o.digitHeight : Math.min(10, TS.ringStep(face) * 0.55);
    const digitStroke = o.digitStroke != null ? o.digitStroke : Math.max(0.12, digitH * 0.1);
    const n = face.rings.length;
    const bands = [];
    for (let k = 0; k < n - 2; k++) bands.push({ r: (face.rings[k] + face.rings[k + 1]) / 4 });
    return function (u, v) {
        if (Math.abs(u) > cardW / 2 || Math.abs(v) > cardH / 2) {
            const t = 0.5 + 0.25 * Math.sin(u * 0.05) * Math.cos(v * 0.07);
            return [table[0] * (0.8 + 0.4 * t), table[1] * (0.8 + 0.4 * t), table[2] * (0.8 + 0.4 * t)];
        }
        for (let i = 0; i < holes.length; i++) {
            const d = Math.hypot(u - holes[i].u, v - holes[i].v);
            if (d < holeR) return backing;
        }
        let best = 0, bd = Infinity;
        for (let k = 0; k < centers.length; k++) {
            const dk = Math.hypot(u - centers[k][0], v - centers[k][1]);
            if (dk < bd) { bd = dk; best = k; }
        }
        u -= centers[best][0]; v -= centers[best][1];
        const r = Math.hypot(u, v);
        let col = TS._internal.profileColor(prof, r);
        if (face.bars) {
            const b = face.bars;
            if (Math.abs(v) <= b.width / 2 && Math.abs(u) >= b.from && Math.abs(u) <= b.to) col = 1;
        }
        // Chiffres simulés : un « 0 » (cadre) dans la bande de chaque zone, sur les axes.
        if (digitH > 0) {
            for (let k = 0; k < bands.length; k++) {
                const rb = bands[k].r;
                // Tir rapide : chiffres sur l'axe vertical seulement, les traits de
                // visée tiennent l'horizontale (6.3.4.4).
                const pts = face.bars ? [[0, rb], [0, -rb]] : [[rb, 0], [-rb, 0], [0, rb], [0, -rb]];
                for (let q = 0; q < pts.length; q++) {
                    const du = Math.abs(u - pts[q][0]), dv = Math.abs(v - pts[q][1]);
                    const hw = digitH * 0.3, hh = digitH / 2;
                    if (du <= hw && dv <= hh && (du >= hw - digitStroke || dv >= hh - digitStroke)) {
                        col = TS._internal.profileColor(prof, rb) === 1 ? 0 : 1;
                    }
                }
            }
        }
        return col ? paper : ink;
    };
}

function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function render(face, o) {
    const W = o.width, Hh = o.height;
    const G = cameraHomography(o.camera);
    const Gi = inv3(G);
    const scene = makeScene(face, o);
    const data = new Uint8ClampedArray(W * Hh * 4);
    const ss = o.supersample || 3;
    let seed = o.seed || 1;
    const rand = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const noise = o.noise != null ? o.noise : 4;
    for (let y = 0; y < Hh; y++) {
        for (let x = 0; x < W; x++) {
            let r = 0, g = 0, b = 0;
            for (let sy = 0; sy < ss; sy++) {
                for (let sx = 0; sx < ss; sx++) {
                    const uv = TS.hApply(Gi, x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
                    const c = scene(uv[0], uv[1]);
                    r += c[0]; g += c[1]; b += c[2];
                }
            }
            const k = ss * ss;
            const light = (o.light ? o.light(x / W, y / Hh) : 1);
            const p = (y * W + x) * 4;
            data[p] = r / k * light + noise * gaussian(rand);
            data[p + 1] = g / k * light + noise * gaussian(rand);
            data[p + 2] = b / k * light + noise * gaussian(rand);
            data[p + 3] = 255;
        }
    }
    return { image: { width: W, height: Hh, data: data }, G: G };
}

function writePPM(path, img) {
    const fs = require('fs');
    const head = Buffer.from('P6\n' + img.width + ' ' + img.height + '\n255\n');
    const body = Buffer.alloc(img.width * img.height * 3);
    for (let i = 0, j = 0; i < img.width * img.height; i++) {
        body[j++] = img.data[4 * i]; body[j++] = img.data[4 * i + 1]; body[j++] = img.data[4 * i + 2];
    }
    fs.writeFileSync(path, Buffer.concat([head, body]));
}

function readPPM(path) {
    const fs = require('fs');
    const buf = fs.readFileSync(path);
    let pos = 0;
    const tok = function () {
        while (buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09) pos++;
        if (buf[pos] === 0x23) { while (buf[pos] !== 0x0a) pos++; return tok(); }
        let s = '';
        while (!(buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09)) s += String.fromCharCode(buf[pos++]);
        return s;
    };
    const magic = tok(), w = +tok(), h = +tok(); tok();
    pos++;
    if (magic !== 'P6') throw new Error('PPM P6 attendu');
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        data[4 * i] = buf[pos++]; data[4 * i + 1] = buf[pos++]; data[4 * i + 2] = buf[pos++]; data[4 * i + 3] = 255;
    }
    return { width: w, height: h, data: data };
}

module.exports = { cameraHomography, render, writePPM, readPPM, makeScene };
