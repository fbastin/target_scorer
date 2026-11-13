/*!
 * target_scorer.js — comptage des points sur la photo d'une cible ISSF.
 *
 * Bibliothèque autonome, sans dépendance : elle tourne dans le navigateur (balise
 * <script> classique, l'objet global `TargetScorer`) comme sous Node (`require`).
 * Elle ne travaille que sur des pixels (un objet de la forme d'un ImageData :
 * { width, height, data: RGBA }) : le décodage de l'image appartient à l'appelant.
 *
 * Chaîne de traitement (analyze) :
 *   1. repérer le visuel noir — une ellipse, puisque la photo est prise de biais ;
 *      RANSAC sur son bord quand un objet le touche ; ou désigné d'un clic ;
 *   2. recaler le dessin de la cible sur la photo par une HOMOGRAPHIE, en confrontant
 *      tous les anneaux à l'image (Gauss-Newton robuste, du flou au net, affine
 *      d'abord) ; les deux paramètres de perspective, que le bord du noir ne fixe
 *      pas, sont cherchés à part sur les traits fins : le centre trouvé n'est pas
 *      celui de l'ellipse ;
 *   3. redresser la cible (vue de face, à l'échelle en mm), soustraire ce que l'on
 *      s'attend à y voir (papier, encre, par zone) et garder ce qui reste et qui a la
 *      taille d'un trou ;
 *   4. placer un ou plusieurs disques du diamètre observé dans chaque tache — deux
 *      plombs dans le même trou font une tache plus grande qu'un seul ;
 *   5. noter chaque tir selon les règles ISSF (ci-dessous) ; refuser de compter si le
 *      dessin recalé ne colle pas à la photo (corrélation < MIN_CORR).
 *
 * Règles appliquées — règlement ISSF, édition 2025 (2e tirage 07/2026) :
 *   - cotes des cibles : 6.3.4.1 à 6.3.4.6 ; les diamètres sont pris AU BORD
 *     EXTÉRIEUR des anneaux (annexe « Rules for Paper Target Scoring », 1.1.2) ;
 *   - un tir vaut la zone la plus haute que le trou TOUCHE (annexe, 5.2.1) : le
 *     trou est celui de la jauge réglementaire centrée sur l'impact (4,5 mm air
 *     comprimé, 5,6 mm .22 LR, 8,00 mm 300 m, 9,65 mm percussion centrale à 25 m —
 *     annexe, 1.4.1 à 1.4.9) ;
 *   - mouche (« inner ten ») : le trou touche l'anneau de mouche, sauf à la carabine
 *     10 m où le point du 10 doit être entièrement emporté — jauge extérieure du
 *     pistolet 10 m (11,5 mm) qui ne déborde pas l'anneau 7 (annexe, 1.4.5) ;
 *   - décimales : chaque zone est partagée en dix couronnes égales, de x,0 à x,9
 *     (6.3.3.1). La largeur prise est le pas des anneaux ; le 10 est plafonné à 10,9.
 *     Exact pour les cibles où le 10 a la largeur d'une zone (carabine 10 m et 50 m,
 *     pistolet 10 m) ; ailleurs, une convention d'affichage.
 *
 * Ce que l'outil ne fait pas : il ne remplace pas la jauge pour un tir limite (il
 * signale ceux dont la marge est sous sa propre incertitude), et il ne voit pas un
 * trou que le fond de la photo rend invisible (trou blanc sur papier blanc). D'où
 * l'interface de correction, et le conseil de photographier la cible posée sur un
 * fond de couleur vive.
 *
 * Licence MIT.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TargetScorer = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const VERSION = '0.1.0';

// ===========================================================================
// 1. Cibles et jauges
// ===========================================================================

// rings : diamètres (mm) des anneaux, de la zone extérieure au 10, au bord
// extérieur du trait. firstValue : valeur de la zone extérieure. black : diamètre du
// visuel noir. line : épaisseur du trait (milieu de la fourchette du règlement).
// innerTenPrinted : l'anneau de mouche est imprimé (il est dessiné dans les planches
// du règlement pour toutes ces cibles sauf la carabine 10 m, dont le 10 est un point).
const FACES = {
    issf_10m_rifle: {
        rule: '6.3.4.3',
        name: { fr: 'Carabine 10 m', en: '10 m air rifle' },
        rings: [45.5, 40.5, 35.5, 30.5, 25.5, 20.5, 15.5, 10.5, 5.5, 0.5],
        firstValue: 1,
        black: 30.5,
        line: 0.15,
        tenDot: true,
        innerTen: { kind: 'gauge', gauge: 11.5, ringValue: 7 },
        innerTenPrinted: false,
        gauge: 4.5,
        decimal: true
    },
    issf_10m_pistol: {
        rule: '6.3.4.6',
        name: { fr: 'Pistolet 10 m', en: '10 m air pistol' },
        rings: [155.5, 139.5, 123.5, 107.5, 91.5, 75.5, 59.5, 43.5, 27.5, 11.5],
        firstValue: 1,
        black: 59.5,
        line: 0.15,
        innerTen: { kind: 'ring', diameter: 5.0 },
        innerTenPrinted: true,
        gauge: 4.5,
        decimal: false
    },
    issf_50m_rifle: {
        rule: '6.3.4.2',
        name: { fr: 'Carabine 50 m', en: '50 m rifle' },
        rings: [154.4, 138.4, 122.4, 106.4, 90.4, 74.4, 58.4, 42.4, 26.4, 10.4],
        firstValue: 1,
        black: 112.4,
        line: 0.25,
        innerTen: { kind: 'ring', diameter: 5.0 },
        innerTenPrinted: true,
        gauge: 5.6,
        decimal: false
    },
    issf_25m_precision: {
        rule: '6.3.4.5',
        name: { fr: 'Pistolet 25 m précision / 50 m', en: '25 m precision / 50 m pistol' },
        rings: [500, 450, 400, 350, 300, 250, 200, 150, 100, 50],
        firstValue: 1,
        black: 200,
        line: 0.35,
        innerTen: { kind: 'ring', diameter: 25 },
        innerTenPrinted: true,
        gauge: 5.6,
        decimal: false
    },
    issf_25m_rapid: {
        rule: '6.3.4.4',
        name: { fr: 'Pistolet 25 m tir rapide', en: '25 m rapid-fire pistol' },
        rings: [500, 420, 340, 260, 180, 100],
        firstValue: 5,
        black: 500,
        line: 0.75,
        innerTen: { kind: 'ring', diameter: 50 },
        innerTenPrinted: true,
        // Traits de visée blancs à gauche et à droite du centre, 125 × 5 mm (6.3.4.4) ;
        // la planche les fait partir du bord du visuel.
        bars: { from: 125, to: 250, width: 5 },
        gauge: 5.6,
        decimal: false
    },
    issf_300m: {
        rule: '6.3.4.1',
        name: { fr: 'Carabine 300 m', en: '300 m rifle' },
        rings: [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
        firstValue: 1,
        black: 600,
        line: 0.75,
        innerTen: { kind: 'ring', diameter: 50 },
        innerTenPrinted: true,
        gauge: 8.0,
        decimal: false
    }
};
Object.keys(FACES).forEach(function (k) { FACES[k].id = k; });

// Diamètres des jauges (annexe « Rules for Paper Target Scoring », 1.4).
const GAUGES = [
    { id: 'air', d: 4.5, name: { fr: '4,5 mm — air comprimé', en: '4.5 mm — air' }, ref: '1.4.4, 1.4.7, 1.4.9' },
    { id: 'rimfire', d: 5.6, name: { fr: '5,6 mm — .22 LR', en: '5.6 mm — .22 LR' }, ref: '1.4.3' },
    { id: 'rifle300', d: 8.0, name: { fr: '8,00 mm — carabine 300 m', en: '8.00 mm — 300 m rifle' }, ref: '1.4.2' },
    { id: 'centrefire', d: 9.65, name: { fr: '9,65 mm — percussion centrale 25 m', en: '9.65 mm — 25 m centre-fire' }, ref: '1.4.1' }
];

function getFace(face) {
    if (typeof face === 'string') {
        if (!FACES[face]) throw new Error('Cible inconnue : ' + face);
        return FACES[face];
    }
    return face;
}

function ringStep(face) {
    const n = face.rings.length;
    return (face.rings[0] - face.rings[n - 1]) / (2 * (n - 1));
}

// ===========================================================================
// 2. Notation d'un tir
// ===========================================================================

// r : distance (mm) du centre du trou au centre de la cible ; gauge : diamètre de la
// jauge (mm). Renvoie { ring, decimal, innerTen, margin } — margin = distance (mm) du
// centre du trou à la limite de notation la plus proche (zone ou mouche) : c'est elle
// qu'on compare à l'incertitude de la mesure pour signaler un tir « à jauger ».
function scoreShot(face, r, gauge) {
    face = getFace(face);
    const g = gauge || face.gauge;
    const half = g / 2;
    const n = face.rings.length;
    const step = ringStep(face);
    const EPS = 1e-9;

    let ring = 0, idx = -1;
    for (let k = n - 1; k >= 0; k--) {           // du 10 vers l'extérieur
        if (r - half <= face.rings[k] / 2 + EPS) { ring = face.firstValue + k; idx = k; break; }
    }

    let decimal = 0;
    if (ring > 0) {
        const bound = face.rings[idx] / 2 + half;
        decimal = ring + Math.floor(10 * (bound - r) / step + EPS) / 10;
        if (decimal > ring + 0.9) decimal = ring + 0.9;
        decimal = Math.round(decimal * 10) / 10;
    }

    let innerTen = false, xBound = null;
    const it = face.innerTen;
    if (it && it.kind === 'ring') {
        xBound = it.diameter / 2 + half;
        innerTen = r <= xBound + EPS;
    } else if (it && it.kind === 'gauge') {
        // Jauge extérieure de diamètre it.gauge centrée sur le trou, qui ne doit pas
        // déborder l'anneau de valeur it.ringValue.
        const ringR = face.rings[it.ringValue - face.firstValue] / 2;
        xBound = ringR - it.gauge / 2;
        innerTen = r <= xBound + EPS;
    }
    if (ring < face.firstValue + n - 1) innerTen = false;

    let margin = Infinity;
    for (let k = 0; k < n; k++) margin = Math.min(margin, Math.abs(r - (face.rings[k] / 2 + half)));
    if (xBound !== null) margin = Math.min(margin, Math.abs(r - xBound));

    return { ring: ring, decimal: decimal, innerTen: innerTen, margin: margin };
}

// Bilan d'une série : total, mouches, point moyen d'impact (mm, x à droite, y en
// haut), plus grand écart centre à centre et rayon moyen autour du point moyen.
function summarize(shots, face, gauge) {
    face = getFace(face);
    const res = { count: shots.length, total: 0, totalDecimal: 0, innerTens: 0,
                  mpi: null, extremeSpread: null, meanRadius: null };
    if (!shots.length) return res;
    let sx = 0, sy = 0, dec = 0;
    shots.forEach(function (s) {
        const sc = scoreShot(face, Math.hypot(s.x, s.y), gauge);
        res.total += sc.ring;
        dec += sc.decimal;
        if (sc.innerTen) res.innerTens++;
        sx += s.x; sy += s.y;
    });
    res.totalDecimal = Math.round(dec * 10) / 10;
    const mx = sx / shots.length, my = sy / shots.length;
    res.mpi = { x: mx, y: my };
    let es = 0, mr = 0;
    for (let i = 0; i < shots.length; i++) {
        mr += Math.hypot(shots[i].x - mx, shots[i].y - my);
        for (let j = i + 1; j < shots.length; j++) {
            es = Math.max(es, Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y));
        }
    }
    res.extremeSpread = shots.length > 1 ? es : null;
    res.meanRadius = mr / shots.length;
    return res;
}

// ===========================================================================
// 3. Algèbre
// ===========================================================================

// Homographies : tableaux de 9 nombres, ligne par ligne.
function hApply(H, u, v) {
    const d = H[6] * u + H[7] * v + H[8];
    return [(H[0] * u + H[1] * v + H[2]) / d, (H[3] * u + H[4] * v + H[5]) / d];
}

function hMul(A, B) {
    const C = new Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
        }
    }
    return C;
}

function hInv(H) {
    const a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7], i = H[8];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    const inv = [A, -(b * i - c * h), b * f - c * e,
                 B, a * i - c * g, -(a * f - c * d),
                 C, -(a * h - b * g), a * e - b * d];
    for (let k = 0; k < 9; k++) inv[k] /= det;
    return inv;
}

function hNormalize(H) {
    const s = H[8];
    return H.map(function (x) { return x / s; });
}

// Mise à l'échelle des coordonnées image : x' = s·x.
function hScaleImage(H, s) {
    return [H[0] * s, H[1] * s, H[2] * s, H[3] * s, H[4] * s, H[5] * s, H[6], H[7], H[8]];
}

// Pixels par unité de la cible au point (u, v) : racine du déterminant du jacobien.
function hLocalScale(H, u, v) {
    const e = 1e-3;
    const p = hApply(H, u, v), px = hApply(H, u + e, v), py = hApply(H, u, v + e);
    const a = (px[0] - p[0]) / e, b = (py[0] - p[0]) / e, c = (px[1] - p[1]) / e, d = (py[1] - p[1]) / e;
    return Math.sqrt(Math.abs(a * d - b * c));
}

// Résolution d'un système symétrique défini positif (Cholesky), A de taille n×n.
function solveSPD(A, b, n) {
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let s = A[i * n + j];
            for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
            if (i === j) {
                if (s <= 0) return null;
                L[i * n + i] = Math.sqrt(s);
            } else {
                L[i * n + j] = s / L[j * n + j];
            }
        }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let s = b[i];
        for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
        y[i] = s / L[i * n + i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let s = y[i];
        for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
        x[i] = s / L[i * n + i];
    }
    return x;
}

function median(arr) {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr).sort();
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
}

// Fonction de répartition de la loi normale (Abramowitz-Stegun 7.1.26, |ε| < 1,5e-7).
function normCdf(x) {
    const z = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * z);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

// Générateur pseudo-aléatoire déterministe (mulberry32) : deux analyses de la même
// photo donnent le même résultat.
function rng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ===========================================================================
// 4. Images (niveaux de gris en flottants 0..1)
// ===========================================================================
// Convention : le pixel (i, j) couvre [i, i+1) × [j, j+1) ; son centre est (i+½, j+½).

function makeImage(w, h) { return { w: w, h: h, d: new Float32Array(w * h) }; }

// Sous-échantillonne (moyenne par blocs) pour que le plus grand côté tienne dans
// maxDim, et sépare luminance et chroma (max − min des trois canaux).
function prepare(imageData, maxDim) {
    const W = imageData.width, H = imageData.height, src = imageData.data;
    const f = Math.max(1, Math.ceil(Math.max(W, H) / (maxDim || 2000)));
    const w = Math.floor(W / f), h = Math.floor(H / f);
    const gray = makeImage(w, h), chroma = makeImage(w, h);
    const n = f * f * 255;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sg = 0, sc = 0;
            for (let dy = 0; dy < f; dy++) {
                let p = ((y * f + dy) * W + x * f) * 4;
                for (let dx = 0; dx < f; dx++, p += 4) {
                    const r = src[p], g = src[p + 1], b = src[p + 2];
                    sg += 0.299 * r + 0.587 * g + 0.114 * b;
                    sc += Math.max(r, g, b) - Math.min(r, g, b);
                }
            }
            gray.d[y * w + x] = sg / n;
            chroma.d[y * w + x] = sc / n;
        }
    }
    return { gray: gray, chroma: chroma, factor: f, srcWidth: W, srcHeight: H };
}

// Flou [1 2 1]/4 séparable, bords répliqués.
function blur121(img) {
    const w = img.w, h = img.h, s = img.d;
    const t = new Float32Array(w * h), o = makeImage(w, h);
    for (let y = 0; y < h; y++) {
        const r = y * w;
        for (let x = 0; x < w; x++) {
            const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
            t[r + x] = 0.25 * s[r + xm] + 0.5 * s[r + x] + 0.25 * s[r + xp];
        }
    }
    for (let y = 0; y < h; y++) {
        const ym = (y > 0 ? y - 1 : 0) * w, yp = (y < h - 1 ? y + 1 : h - 1) * w, r = y * w;
        for (let x = 0; x < w; x++) o.d[r + x] = 0.25 * t[ym + x] + 0.5 * t[r + x] + 0.25 * t[yp + x];
    }
    return o;
}

function downsample2(img) {
    const w = img.w >> 1, h = img.h >> 1, s = img.d, W = img.w;
    const o = makeImage(w, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = 2 * y * W + 2 * x;
            o.d[y * w + x] = 0.25 * (s[p] + s[p + 1] + s[p + W] + s[p + W + 1]);
        }
    }
    return o;
}

function gradients(img) {
    const w = img.w, h = img.h, s = img.d;
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            gx[p] = 0.5 * (s[p + 1] - s[p - 1]);
            gy[p] = 0.5 * (s[p + w] - s[p - w]);
        }
    }
    return { gx: gx, gy: gy };
}

// Pyramide gaussienne : niveau k = image divisée par 2^k, adoucie, avec ses gradients
// (calculés sur une copie adoucie : le niveau lui-même reste net pour le redressement).
function buildPyramid(gray, chroma, minSize) {
    const levels = [];
    let g = gray, c = chroma;
    for (;;) {
        const sm = blur121(g);
        const gr = gradients(sm);
        levels.push({ img: g, smooth: sm, gx: gr.gx, gy: gr.gy, chroma: c, w: g.w, h: g.h });
        if (Math.min(g.w, g.h) < 2 * (minSize || 48)) break;
        g = downsample2(sm);
        c = downsample2(blur121(c));
    }
    return levels;
}

// Interpolation bilinéaire en coordonnées continues ; NaN hors de l'image.
function sample(arr, w, h, x, y) {
    const fx = x - 0.5, fy = y - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= w - 1 || iy >= h - 1) return NaN;
    const ax = fx - ix, ay = fy - iy, p = iy * w + ix;
    return (arr[p] * (1 - ax) + arr[p + 1] * ax) * (1 - ay) + (arr[p + w] * (1 - ax) + arr[p + w + 1] * ax) * ay;
}

// ===========================================================================
// 5. Recherche du visuel noir
// ===========================================================================

function otsu(img) {
    const hist = new Float64Array(256);
    const d = img.d;
    for (let i = 0; i < d.length; i++) hist[Math.max(0, Math.min(255, Math.round(d[i] * 255)))]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    const total = d.length;
    for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += t * hist[t];
        const mB = sumB / wB, mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; thr = t; }
    }
    return (thr + 0.5) / 255;
}

// Composantes connexes (8-connexité) d'un masque binaire.
function components(mask, w, h) {
    const label = new Int32Array(w * h).fill(-1);
    const comps = [];
    const stack = new Int32Array(w * h);
    for (let start = 0; start < w * h; start++) {
        if (!mask[start] || label[start] >= 0) continue;
        const id = comps.length;
        let sp = 0, n = 0, x0 = w, x1 = -1, y0 = h, y1 = -1, border = false;
        stack[sp++] = start;
        label[start] = id;
        while (sp) {
            const p = stack[--sp];
            n++;
            const x = p % w, y = (p - x) / w;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    const q = yy * w + xx;
                    if (mask[q] && label[q] < 0) { label[q] = id; stack[sp++] = q; }
                }
            }
        }
        comps.push({ id: id, area: n, x0: x0, x1: x1, y0: y0, y1: y1, border: border });
    }
    return { label: label, comps: comps };
}

// Ellipse d'une composante une fois ses trous bouchés (les anneaux blancs imprimés
// dans le noir, les impacts) : moments d'ordre 2 de la surface pleine.
function ellipseOfComponent(label, w, h, c) {
    const bw = c.x1 - c.x0 + 3, bh = c.y1 - c.y0 + 3;
    const inside = new Uint8Array(bw * bh);        // 1 = composante
    for (let y = c.y0; y <= c.y1; y++) {
        for (let x = c.x0; x <= c.x1; x++) {
            if (label[y * w + x] === c.id) inside[(y - c.y0 + 1) * bw + (x - c.x0 + 1)] = 1;
        }
    }
    // Remplissage depuis le bord de la boîte : ce qui n'est pas atteint est plein.
    const outside = new Uint8Array(bw * bh);
    const stack = new Int32Array(bw * bh);
    let sp = 0;
    stack[sp++] = 0; outside[0] = 1;
    while (sp) {
        const p = stack[--sp];
        const x = p % bw, y = (p - x) / bw;
        const nb = [p - 1, p + 1, p - bw, p + bw];
        const ok = [x > 0, x < bw - 1, y > 0, y < bh - 1];
        for (let k = 0; k < 4; k++) {
            if (!ok[k]) continue;
            const q = nb[k];
            if (!outside[q] && !inside[q]) { outside[q] = 1; stack[sp++] = q; }
        }
    }
    let m00 = 0, mx = 0, my = 0;
    for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
            if (!outside[y * bw + x]) { m00++; mx += x; my += y; }
        }
    }
    mx /= m00; my /= m00;
    let mu20 = 0, mu02 = 0, mu11 = 0;
    const boundary = [];
    for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
            const p = y * bw + x;
            if (outside[p]) continue;
            const dx = x - mx, dy = y - my;
            mu20 += dx * dx; mu02 += dy * dy; mu11 += dx * dy;
            if (outside[p - 1] || outside[p + 1] || outside[p - bw] || outside[p + bw]) boundary.push(dx, dy);
        }
    }
    mu20 = mu20 / m00 + 1 / 12; mu02 = mu02 / m00 + 1 / 12; mu11 /= m00;
    const tr = mu20 + mu02, det = mu20 * mu02 - mu11 * mu11;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (l2 <= 0) return null;
    const a = 2 * Math.sqrt(l1), b = 2 * Math.sqrt(l2);
    const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    // Rayon normalisé des pixels de bord : 1 sur une ellipse parfaite.
    const i20 = mu02 / det, i02 = mu20 / det, i11 = -mu11 / det;
    const rad = [];
    for (let k = 0; k < boundary.length; k += 2) {
        const dx = boundary[k], dy = boundary[k + 1];
        rad.push(Math.sqrt((i20 * dx * dx + 2 * i11 * dx * dy + i02 * dy * dy) / 4));
    }
    const medR = median(rad);
    const dev = median(rad.map(function (r) { return Math.abs(r - medR); }));
    return {
        cx: mx + c.x0 - 1 + 0.5, cy: my + c.y0 - 1 + 0.5,     // coordonnées continues
        a: a, b: b, theta: theta,
        fill: m00 / (Math.PI * a * b),
        solidity: c.area / m00,
        roughness: dev / medR,
        area: m00,
        // Bord de la surface pleine, en coordonnées continues (pour l'ajustement robuste).
        boundary: boundary.map(function (v, i) { return v + (i % 2 ? my + c.y0 - 1 + 0.5 : mx + c.x0 - 1 + 0.5); })
    };
}

// Conique A x² + B xy + C y² + D x + E y + F d'une ellipse (cx, cy, a, b, θ).
function ellipseConic(e) {
    const s = Math.sin(e.theta), c = Math.cos(e.theta), a2 = e.a * e.a, b2 = e.b * e.b;
    const A = a2 * s * s + b2 * c * c, B = 2 * (b2 - a2) * s * c, C = a2 * c * c + b2 * s * s;
    return [A, B, C, -2 * A * e.cx - B * e.cy, -B * e.cx - 2 * C * e.cy,
            A * e.cx * e.cx + B * e.cx * e.cy + C * e.cy * e.cy - a2 * b2];
}

// Distance de Sampson (approximation au premier ordre de la distance géométrique).
function sampsonDist(k, x, y) {
    const q = k[0] * x * x + k[1] * x * y + k[2] * y * y + k[3] * x + k[4] * y + k[5];
    const gx = 2 * k[0] * x + k[1] * y + k[3], gy = k[1] * x + 2 * k[2] * y + k[4];
    return Math.abs(q) / Math.max(1e-12, Math.hypot(gx, gy));
}

// Ellipse ajustée par RANSAC à des points de bord (x0, y0, x1, y1, …) dont une partie
// seulement est sur le bord du visuel : le reste longe ce qui le masque ou le touche
// (une arme posée sur la cible, une boîte, une main). Renvoie l'ellipse, la part du
// pourtour couverte par des points conformes et le nombre de ces points.
function ransacEllipse(pts, rand, opts) {
    const accept = opts && opts.accept;
    const n = pts.length / 2;
    if (n < 20) return null;
    const iters = (opts && opts.iters) || 400;
    let best = null, bestIn = 0;
    const tolOf = function (e) { return Math.max(1.0, 0.012 * Math.sqrt(e.a * e.b)); };
    for (let it = 0; it < iters; it++) {
        const sample = [];
        for (let k = 0; k < 5; k++) { const i = Math.floor(rand() * n); sample.push([pts[2 * i], pts[2 * i + 1]]); }
        const e = fitEllipse(sample);
        if (!e || !(e.a > 0) || e.b / e.a < 0.3) continue;
        const k6 = ellipseConic(e), tol = tolOf(e);
        let inl = 0;
        for (let i = 0; i < n; i += 2) if (sampsonDist(k6, pts[2 * i], pts[2 * i + 1]) < tol) inl++;
        if (inl > bestIn && (!accept || accept(e))) { bestIn = inl; best = e; }
    }
    if (!best) return null;
    // Raffinement : réajustement sur les points conformes, deux fois.
    for (let r = 0; r < 2; r++) {
        const k6 = ellipseConic(best), tol = tolOf(best);
        const inl = [];
        for (let i = 0; i < n; i++) if (sampsonDist(k6, pts[2 * i], pts[2 * i + 1]) < tol) inl.push([pts[2 * i], pts[2 * i + 1]]);
        const e = fitEllipse(inl);
        if (!e || !(e.a > 0)) break;
        best = e;
    }
    const k6 = ellipseConic(best), tol = tolOf(best);
    const bins = new Uint8Array(72);
    let count = 0;
    const c = Math.cos(best.theta), s = Math.sin(best.theta);
    for (let i = 0; i < n; i++) {
        const x = pts[2 * i], y = pts[2 * i + 1];
        if (sampsonDist(k6, x, y) >= tol) continue;
        count++;
        const dx = x - best.cx, dy = y - best.cy;
        const ang = Math.atan2((-s * dx + c * dy) / best.b, (c * dx + s * dy) / best.a);
        bins[Math.min(71, Math.floor((ang + Math.PI) / (2 * Math.PI) * 72))] = 1;
    }
    let cov = 0;
    for (let i = 0; i < 72; i++) cov += bins[i];
    return { ellipse: best, coverage: cov / 72, inliers: count };
}

// Cherche les visuels noirs : composantes sombres, pleines une fois bouchées, au bord
// elliptique. Plusieurs seuils, parce qu'un Otsu global se laisse parfois tirer par
// un fond sombre ; les doublons sont fusionnés.
function detectBulls(level) {
    const img = level.smooth, w = img.w, h = img.h;
    const t0 = otsu(img);
    const rand = rng(4242);
    const found = [];
    [t0, 0.8 * t0, 0.6 * t0, Math.min(0.95, 1.15 * t0)].forEach(function (t) {
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = img.d[i] < t ? 1 : 0;
        const cc = components(mask, w, h);
        const minArea = Math.max(40, 0.0003 * w * h);
        cc.comps.forEach(function (c) {
            if (c.area < minArea) return;
            const e = ellipseOfComponent(cc.label, w, h, c);
            if (!e) return;
            const tolerance = 0.03 + 1.2 / Math.sqrt(e.a * e.b);
            const clean = !c.border && e.b / e.a >= 0.3 && e.fill >= 0.88 && e.fill <= 1.08 &&
                          e.roughness <= tolerance && e.solidity >= 0.4;
            if (clean) {
                e.score = Math.sqrt(e.a * e.b) * (1 - e.roughness) * Math.min(1, e.solidity + 0.3);
                e.coverage = 1;
                found.push(e);
                return;
            }
            // Composante qui n'est pas une ellipse : peut-être un visuel touché ou masqué
            // par autre chose de sombre. On y cherche une ellipse qui en épouse au moins
            // 60 % du pourtour et dont l'intérieur est sombre.
            if (c.area < 6 * minArea) return;
            const R = ransacEllipse(e.boundary, rand, { iters: 300 });
            if (!R || R.coverage < 0.6) return;
            const el = R.ellipse;
            if (el.b / el.a < 0.3 || el.a > Math.max(w, h)) return;
            // L'intérieur doit appartenir à CETTE composante : un trait d'anneau est un
            // cercle parfait dont l'intérieur est sombre aussi (c'est le noir qu'il
            // entoure) — sans ce critère, il passait pour un visuel plus grand que le vrai.
            let inD = 0, inN = 0;
            const cs = Math.cos(el.theta), sn = Math.sin(el.theta);
            const x0 = Math.max(0, Math.floor(el.cx - el.a)), x1 = Math.min(w - 1, Math.ceil(el.cx + el.a));
            const y0 = Math.max(0, Math.floor(el.cy - el.a)), y1 = Math.min(h - 1, Math.ceil(el.cy + el.a));
            for (let y = y0; y <= y1; y += 2) {
                for (let x = x0; x <= x1; x += 2) {
                    const dx = x + 0.5 - el.cx, dy = y + 0.5 - el.cy;
                    const q = ((cs * dx + sn * dy) / el.a) ** 2 + ((-sn * dx + cs * dy) / el.b) ** 2;
                    if (q < 0.9) { inN++; if (cc.label[y * w + x] === c.id) inD++; }
                }
            }
            if (!inN || inD / inN < 0.6) return;
            el.coverage = R.coverage;
            el.solidity = inD / inN;
            el.roughness = 0;
            el.score = Math.sqrt(el.a * el.b) * R.coverage * 0.9;
            found.push(el);
        });
    });
    // Fusion des doublons (même centre, même taille).
    const merged = [];
    found.sort(function (p, q) { return q.score - p.score; });
    found.forEach(function (e) {
        const dup = merged.some(function (m) {
            // 8 % : l'anneau voisin d'un visuel est 10 à 20 % plus grand ; plus large, la
            // fusion avalait le vrai visuel dans un anneau soudé au noir.
            return Math.hypot(m.cx - e.cx, m.cy - e.cy) < 0.1 * Math.sqrt(m.a * m.b) &&
                   Math.abs(Math.sqrt(m.a * m.b) / Math.sqrt(e.a * e.b) - 1) < 0.08;
        });
        if (!dup) merged.push(e);
    });
    // Un visuel n'est pas minuscule : sous 2 % du petit côté de l'image (rayon), c'est un
    // trou, une pastille ou une lettre. Sur une photo de téléphone dont le vrai visuel
    // sortait du cadre, quatre trous de 1,5 % passaient pour quatre visuels, et le dessin
    // recalé sur un trou atteignait 0,97 de corrélation.
    const minR = 0.02 * Math.min(w, h);
    for (let i = merged.length - 1; i >= 0; i--) if (Math.sqrt(merged[i].a * merged[i].b) < minR) merged.splice(i, 1);
    if (!merged.length) return [];
    // Les visuels d'un même carton ont la même taille : on écarte ce qui est nettement
    // plus petit que le plus grand (une pastille, un chiffre plein).
    const big = Math.max.apply(null, merged.map(function (e) { return Math.sqrt(e.a * e.b); }));
    const kept = merged.filter(function (e) { return Math.sqrt(e.a * e.b) >= 0.6 * big; });
    // Deux candidats emboîtés : l'un est faux. Au seuil le plus haut, le flou peut
    // souder au noir un trait d'anneau par les chiffres, et la composante bouchée
    // devient un disque plus grand que le visuel. On garde le plus uniformément
    // sombre — le vrai visuel —, pas le plus grand.
    return kept.filter(function (e) {
        return !kept.some(function (o) {
            if (o === e) return false;
            const nested = Math.hypot(o.cx - e.cx, o.cy - e.cy) < Math.max(Math.sqrt(o.a * o.b), Math.sqrt(e.a * e.b));
            if (!nested) return false;
            return o.solidity > e.solidity + 0.02 || (Math.abs(o.solidity - e.solidity) <= 0.02 && o.score > e.score);
        });
    }).sort(function (p, q) { return (p.cy - q.cy) || (p.cx - q.cx); });
}

// Ajustement d'une ellipse à des points (Halir & Flusser 1998, moindres carrés
// directs) — pour le mode manuel, où l'on clique des points sur le bord du noir.
function fitEllipse(points) {
    if (points.length < 5) return null;
    let mx = 0, my = 0;
    points.forEach(function (p) { mx += p[0]; my += p[1]; });
    mx /= points.length; my /= points.length;
    let sc = 0;
    points.forEach(function (p) { sc += Math.hypot(p[0] - mx, p[1] - my); });
    sc = sc / points.length || 1;
    const S1 = [0, 0, 0, 0, 0, 0, 0, 0, 0], S2 = [0, 0, 0, 0, 0, 0, 0, 0, 0], S3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    points.forEach(function (p) {
        const x = (p[0] - mx) / sc, y = (p[1] - my) / sc;
        const d1 = [x * x, x * y, y * y], d2 = [x, y, 1];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                S1[3 * i + j] += d1[i] * d1[j];
                S2[3 * i + j] += d1[i] * d2[j];
                S3[3 * i + j] += d2[i] * d2[j];
            }
        }
    });
    const S3i = hInv(S3);
    const T = hMul(hMul(S3i, transpose3(S2)), [1, 0, 0, 0, 1, 0, 0, 0, 1]).map(function (v) { return -v; });
    const M0 = matAdd(S1, hMul(S2, T));
    // M = C1^-1 M0, C1^-1 = [[0,0,1/2],[0,-1,0],[1/2,0,0]]
    const M = [M0[6] / 2, M0[7] / 2, M0[8] / 2, -M0[3], -M0[4], -M0[5], M0[0] / 2, M0[1] / 2, M0[2] / 2];
    const ev = eigenvectors3(M);
    let a1 = null;
    ev.forEach(function (v) {
        if (4 * v[0] * v[2] - v[1] * v[1] > 0) a1 = v;
    });
    if (!a1) return null;
    const a2 = [T[0] * a1[0] + T[1] * a1[1] + T[2] * a1[2],
                T[3] * a1[0] + T[4] * a1[1] + T[5] * a1[2],
                T[6] * a1[0] + T[7] * a1[1] + T[8] * a1[2]];
    return conicToEllipse([a1[0], a1[1], a1[2], a2[0], a2[1], a2[2]], mx, my, sc);
}

function transpose3(A) { return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]; }
function matAdd(A, B) { return A.map(function (v, i) { return v + B[i]; }); }

// Vecteurs propres réels d'une matrice 3×3 quelconque (racines du polynôme
// caractéristique, puis produit vectoriel de deux lignes de M − λI).
function eigenvectors3(M) {
    const a = M[0], b = M[1], c = M[2], d = M[3], e = M[4], f = M[5], g = M[6], h = M[7], i = M[8];
    const p2 = -(a + e + i);
    const p1 = a * e + a * i + e * i - b * d - c * g - f * h;
    const p0 = -(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g));
    const roots = cubicRoots(p2, p1, p0);
    return roots.map(function (l) {
        const r0 = [a - l, b, c], r1 = [d, e - l, f], r2 = [g, h, i - l];
        const cands = [cross(r0, r1), cross(r0, r2), cross(r1, r2)];
        let best = cands[0], bn = 0;
        cands.forEach(function (v) {
            const n = Math.hypot(v[0], v[1], v[2]);
            if (n > bn) { bn = n; best = v; }
        });
        return bn ? best.map(function (x) { return x / bn; }) : [0, 0, 0];
    });
}

function cross(u, v) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; }

function cubicRoots(a, b, c) {               // x³ + a x² + b x + c = 0, racines réelles
    const q = (a * a - 3 * b) / 9, r = (2 * a * a * a - 9 * a * b + 27 * c) / 54;
    if (r * r < q * q * q) {
        const t = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(q * q * q))));
        const s = -2 * Math.sqrt(q);
        return [s * Math.cos(t / 3) - a / 3, s * Math.cos((t + 2 * Math.PI) / 3) - a / 3, s * Math.cos((t - 2 * Math.PI) / 3) - a / 3];
    }
    const A = -Math.sign(r) * Math.cbrt(Math.abs(r) + Math.sqrt(r * r - q * q * q));
    const B = A ? q / A : 0;
    return [A + B - a / 3];
}

// Conique A x² + B xy + C y² + D x + E y + F = 0 (coordonnées réduites) → ellipse.
function conicToEllipse(k, mx, my, sc) {
    const A = k[0], B = k[1], C = k[2], D = k[3], E = k[4], F = k[5];
    const den = B * B - 4 * A * C;
    if (den >= 0) return null;
    const x0 = (2 * C * D - B * E) / den, y0 = (2 * A * E - B * D) / den;
    const F0 = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 + F;
    const tr = A + C, dt = Math.sqrt((A - C) * (A - C) + B * B);
    const l1 = (tr + dt) / 2, l2 = (tr - dt) / 2;
    const s1 = -F0 / l1, s2 = -F0 / l2;
    if (s1 <= 0 || s2 <= 0) return null;
    let ax = Math.sqrt(s1), bx = Math.sqrt(s2);          // demi-axes selon les directions propres
    let theta = 0.5 * Math.atan2(B, A - C);               // direction de la valeur propre l1
    if (ax < bx) { const t = ax; ax = bx; bx = t; theta += Math.PI / 2; }
    return { cx: mx + x0 * sc, cy: my + y0 * sc, a: ax * sc, b: bx * sc, theta: theta };
}

// ===========================================================================
// 6. Recalage du dessin de la cible sur la photo
// ===========================================================================

// Profil radial du dessin : 1 = blanc, 0 = noir, en fonction de la distance au
// centre (mm). Renvoie les marches { r, delta } et la valeur au centre.
function buildProfile(face) {
    const Rb = face.black / 2, w = face.line;
    const paints = [];                                   // [r0, r1, couleur], dans l'ordre
    paints.push([0, Rb, 0]);
    face.rings.forEach(function (d, k) {
        const R = d / 2;
        const isTen = k === face.rings.length - 1;
        if (isTen && face.tenDot) { paints.push([0, R, 1]); return; }
        if (Math.abs(R - Rb) < w) return;                // le bord du noir est l'anneau
        paints.push([Math.max(0, R - w), R, R < Rb ? 1 : 0]);
    });
    if (face.innerTenPrinted && face.innerTen && face.innerTen.kind === 'ring') {
        const R = face.innerTen.diameter / 2;
        paints.push([Math.max(0, R - w), R, R < Rb ? 1 : 0]);
    }
    const cuts = [0];
    paints.forEach(function (p) { cuts.push(p[0], p[1]); });
    cuts.sort(function (a, b) { return a - b; });
    const colorAt = function (r) { return profileColor({ paints: paints }, r); };
    const steps = [];
    let prev = colorAt(0);
    const f0 = prev;
    for (let k = 1; k < cuts.length; k++) {
        const r = cuts[k];
        if (r <= cuts[k - 1]) continue;
        const c = colorAt(r + 1e-9);
        if (c !== prev) { steps.push({ r: r, delta: c - prev }); prev = c; }
    }
    // Pas de fonction dans l'objet : le résultat d'une analyse doit pouvoir passer
    // d'un Web Worker à la page (clonage structuré).
    return { f0: f0, steps: steps, paints: paints };
}

// Couleur nette du dessin à la distance r (1 blanc, 0 noir).
function profileColor(prof, r) {
    let c = 1;
    const pt = prof.paints;
    for (let k = 0; k < pt.length; k++) if (r >= pt[k][0] && r < pt[k][1]) c = pt[k][2];
    return c;
}

function profileValue(prof, r, sigma) {
    let v = prof.f0;
    const st = prof.steps;
    for (let k = 0; k < st.length; k++) v += st[k].delta * normCdf((r - st[k].r) / sigma);
    return v;
}

function profileSlope(prof, r, sigma) {
    let v = 0;
    const st = prof.steps, c = 1 / (sigma * Math.sqrt(2 * Math.PI));
    for (let k = 0; k < st.length; k++) {
        const z = (r - st[k].r) / sigma;
        v += st[k].delta * c * Math.exp(-0.5 * z * z);
    }
    return v;
}

// Points d'échantillonnage du dessin pour un niveau : grille en coordonnées réduites
// (mm / Rn), tous les points proches d'un bord du dessin, un sur huit ailleurs.
function buildSamples(face, prof, Rn, ppmm, sigmaMM, budget, rand, rLimit) {
    let rMax = face.rings[0] / 2 + Math.max(3 * sigmaMM, 0.25 * ringStep(face));
    if (rLimit) rMax = Math.min(rMax, rLimit);
    const rMin = 1.5 * sigmaMM;
    const stepMM = 0.75 / ppmm;
    const nSide = Math.ceil(rMax / stepMM);
    const us = [], vs = [], fs = [];
    const slopeMax = 1 / (sigmaMM * Math.sqrt(2 * Math.PI));
    // Profil et pente tabulés en r (pas d'un huitième de σ) : ces deux fonctions
    // dominaient le temps de calcul, évaluées sur toute la grille.
    const lutStep = Math.min(stepMM / 4, sigmaMM / 8), lutN = Math.ceil(rMax / lutStep) + 2;
    const lutV = new Float64Array(lutN), lutS = new Float64Array(lutN);
    for (let q = 0; q < lutN; q++) { lutV[q] = profileValue(prof, q * lutStep, sigmaMM); lutS[q] = Math.abs(profileSlope(prof, q * lutStep, sigmaMM)); }
    let k = 0;
    for (let j = -nSide; j <= nSide; j++) {
        for (let i = -nSide; i <= nSide; i++, k++) {
            const u = (i + rand() - 0.5) * stepMM, v = (j + rand() - 0.5) * stepMM;
            const r = Math.hypot(u, v);
            if (r > rMax || r < rMin) continue;
            const li = Math.min(lutN - 1, Math.round(r / lutStep));
            const near = lutS[li] > 0.02 * slopeMax;
            if (!near && (k % 8)) continue;
            us.push(u / Rn); vs.push(v / Rn); fs.push(lutV[li]);
        }
    }
    let idx = us.map(function (_, i) { return i; });
    if (idx.length > budget) {
        for (let i = idx.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
        }
        idx = idx.slice(0, budget);
    }
    return {
        n: idx.length,
        u: Float64Array.from(idx, function (i) { return us[i]; }),
        v: Float64Array.from(idx, function (i) { return vs[i]; }),
        f: Float64Array.from(idx, function (i) { return fs[i]; })
    };
}

// Gauss-Newton amorti (Levenberg-Marquardt), pondération robuste. Paramètres :
// p[0..7] homographie (h33 = 1) des coordonnées réduites vers les pixels du niveau,
// p[8..10] gain lumineux (plan), p[11..13] niveau du noir (plan). Le modèle est
// I(x) = gain(u)·f(u) + noir(u) : un éclairage inégal ne fausse pas le recalage.
const NP = 14;

function evalResiduals(L, S, p, out) {
    const w = L.w, h = L.h, img = L.smooth.d;
    let n = 0;
    for (let i = 0; i < S.n; i++) {
        const u = S.u[i], v = S.v[i];
        const D = p[6] * u + p[7] * v + 1;
        const x = (p[0] * u + p[1] * v + p[2]) / D, y = (p[3] * u + p[4] * v + p[5]) / D;
        const I = sample(img, w, h, x, y);
        if (I !== I) { out[i] = NaN; continue; }
        const model = (p[8] + p[9] * u + p[10] * v) * S.f[i] + p[11] + p[12] * u + p[13] * v;
        out[i] = I - model;
        n++;
    }
    return n;
}

function robustScale(res, floor) {
    const a = [];
    for (let i = 0; i < res.length; i++) if (res[i] === res[i]) a.push(Math.abs(res[i]));
    return Math.max(1.4826 * median(a), floor);
}

function rhoWeight(e, c, tukey) {
    const a = Math.abs(e);
    if (tukey) {
        if (a >= c) return [c * c / 6, 0];
        const t = 1 - (e / c) * (e / c);
        return [c * c / 6 * (1 - t * t * t), t * t];
    }
    if (a <= c) return [0.5 * e * e, 1];
    return [c * (a - 0.5 * c), c / a];
}

function costOf(res, c, tukey) {
    let s = 0, n = 0;
    for (let i = 0; i < res.length; i++) {
        if (res[i] !== res[i]) continue;
        s += rhoWeight(res[i], c, tukey)[0];
        n++;
    }
    return n ? s / n : Infinity;
}

// Ajuste d'abord les seuls paramètres de lumière, l'homographie fixée (moindres
// carrés linéaires, repondérés).
function fitPhotometric(L, S, p) {
    const w = L.w, h = L.h, img = L.smooth.d;
    let c = Infinity;
    for (let it = 0; it < 4; it++) {
        const A = new Float64Array(36), b = new Float64Array(6);
        const res = [];
        for (let i = 0; i < S.n; i++) {
            const u = S.u[i], v = S.v[i];
            const D = p[6] * u + p[7] * v + 1;
            const x = (p[0] * u + p[1] * v + p[2]) / D, y = (p[3] * u + p[4] * v + p[5]) / D;
            const I = sample(img, w, h, x, y);
            if (I !== I) continue;
            const f = S.f[i];
            const row = [f, f * u, f * v, 1, u, v];
            let wt = 1;
            if (it > 0) {
                const e = I - ((p[8] + p[9] * u + p[10] * v) * f + p[11] + p[12] * u + p[13] * v);
                wt = rhoWeight(e, c, false)[1];
                res.push(e);
            }
            for (let r = 0; r < 6; r++) {
                b[r] += wt * row[r] * I;
                for (let q = 0; q <= r; q++) A[r * 6 + q] += wt * row[r] * row[q];
            }
        }
        for (let r = 0; r < 6; r++) for (let q = 0; q < r; q++) A[q * 6 + r] = A[r * 6 + q];
        for (let r = 0; r < 6; r++) A[r * 6 + r] += 1e-9;
        const x = solveSPD(A, b, 6);
        if (!x) break;
        for (let k = 0; k < 6; k++) p[8 + k] = x[k];
        // Échelle robuste des résidus pour l'itération suivante.
        const r2 = new Float64Array(S.n);
        evalResiduals(L, S, p, r2);
        c = 1.5 * robustScale(r2, 0.01);
    }
}

function alignLevel(L, S, p, opts) {
    const res = new Float64Array(S.n);
    let lambda = 1e-2;
    const tukey = opts.tukey;
    const test = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let it = 0; it < opts.maxIter; it++) {
        evalResiduals(L, S, p, res);
        const sigma = robustScale(res, 0.004 + 0.01 * Math.abs(p[8]));
        const c = (tukey ? 4.685 : 1.345) * sigma;
        const cost0 = costOf(res, c, tukey);
        // Équations normales.
        const A = new Float64Array(NP * NP), g = new Float64Array(NP);
        const J = new Float64Array(NP);
        const w = L.w, h = L.h, gxA = L.gx, gyA = L.gy;
        for (let i = 0; i < S.n; i++) {
            const e = res[i];
            if (e !== e) continue;
            const wt = rhoWeight(e, c, tukey)[1];
            if (!wt) continue;
            const u = S.u[i], v = S.v[i], f = S.f[i];
            const D = p[6] * u + p[7] * v + 1;
            const x = (p[0] * u + p[1] * v + p[2]) / D, y = (p[3] * u + p[4] * v + p[5]) / D;
            const gx = sample(gxA, w, h, x, y), gy = sample(gyA, w, h, x, y);
            if (gx !== gx || gy !== gy) continue;
            const iD = 1 / D;
            J[0] = gx * u * iD; J[1] = gx * v * iD; J[2] = gx * iD;
            J[3] = gy * u * iD; J[4] = gy * v * iD; J[5] = gy * iD;
            J[6] = -(gx * x + gy * y) * u * iD; J[7] = -(gx * x + gy * y) * v * iD;
            J[8] = -f; J[9] = -f * u; J[10] = -f * v; J[11] = -1; J[12] = -u; J[13] = -v;
            for (let r = 0; r < NP; r++) {
                const jr = wt * J[r];
                g[r] += jr * e;
                for (let q = 0; q <= r; q++) A[r * NP + q] += jr * J[q];
            }
        }
        for (let r = 0; r < NP; r++) for (let q = 0; q < r; q++) A[q * NP + r] = A[r * NP + q];
        if (opts.fixPersp) {
            // Perspective figée : lignes et colonnes 6 et 7 neutralisées.
            for (let r = 0; r < NP; r++) { A[6 * NP + r] = A[r * NP + 6] = 0; A[7 * NP + r] = A[r * NP + 7] = 0; }
            A[6 * NP + 6] = A[7 * NP + 7] = 1; g[6] = g[7] = 0;
        }
        let accepted = false, moved = 0;
        for (let tries = 0; tries < 8 && !accepted; tries++) {
            const M = Float64Array.from(A);
            for (let r = 0; r < NP; r++) M[r * NP + r] += lambda * A[r * NP + r] + 1e-12;
            const neg = g.map(function (x) { return -x; });
            const d = solveSPD(M, neg, NP);
            if (!d) { lambda *= 10; continue; }
            const q = Array.from(p);
            for (let k = 0; k < NP; k++) q[k] += d[k];
            const r2 = new Float64Array(S.n);
            evalResiduals(L, S, q, r2);
            const cost1 = costOf(r2, c, tukey);
            if (cost1 < cost0) {
                moved = 0;
                test.forEach(function (t) {
                    const a = hApply([p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], 1], t[0], t[1]);
                    const b = hApply([q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], 1], t[0], t[1]);
                    moved = Math.max(moved, Math.hypot(a[0] - b[0], a[1] - b[1]));
                });
                for (let k = 0; k < NP; k++) p[k] = q[k];
                lambda = Math.max(1e-4, lambda / 4);
                accepted = true;
            } else {
                lambda *= 6;
            }
        }
        if (!accepted || moved < opts.tol) break;
    }
    return p;
}

// Corrélation entre la photo et le dessin recalé : un indice de confiance.
function alignmentScore(L, S, p) {
    const w = L.w, h = L.h, img = L.smooth.d;
    let n = 0, sI = 0, sM = 0, sII = 0, sMM = 0, sIM = 0;
    for (let i = 0; i < S.n; i++) {
        const u = S.u[i], v = S.v[i];
        const D = p[6] * u + p[7] * v + 1;
        const x = (p[0] * u + p[1] * v + p[2]) / D, y = (p[3] * u + p[4] * v + p[5]) / D;
        const I = sample(img, w, h, x, y);
        if (I !== I) continue;
        const m = (p[8] + p[9] * u + p[10] * v) * S.f[i] + p[11] + p[12] * u + p[13] * v;
        n++; sI += I; sM += m; sII += I * I; sMM += m * m; sIM += I * m;
    }
    if (n < 10) return { corr: 0, coverage: 0 };
    const cov = sIM / n - sI * sM / n / n;
    const vI = sII / n - sI * sI / n / n, vM = sMM / n - sM * sM / n / n;
    return { corr: cov / Math.sqrt(Math.max(1e-12, vI * vM)), coverage: n / S.n };
}

// Écarte les échantillons dont le voisinage, vu très flou, n'a pas la couleur de leur
// zone : sombre dans le blanc (une arme, une boîte, une main posée sur la cible),
// clair dans le noir (déchirure, papier arraché). Les traits fins des anneaux
// disparaissent à ce flou ; un objet de la taille d'une zone, non — et ses bords
// francs imitent des traits d'anneau assez bien pour qu'aucune pondération robuste
// ne les reconnaisse : sur une photo du forum, un pistolet posé sur le blanc tirait le
// centre de 55 pixels.
function consistentSamples(pyr, k, Hfull, S, face, Rn, phot) {
    const kc = Math.min(pyr.length - 1, k + 2);
    const Lc = pyr[kc], sc = 1 / (1 << kc);
    const Hc = hScaleImage(Hfull, sc);
    const Rb = face.black / 2;
    const band = 3 * (1 << kc) / (hLocalScale(Hfull, 0, 0) / Rn);   // 3 pixels du niveau grossier, en mm
    const keep = [];
    for (let i = 0; i < S.n; i++) {
        const u = S.u[i], v = S.v[i];
        const r = Math.hypot(u, v) * Rn;
        if (Math.abs(r - Rb) < band) { keep.push(i); continue; }
        const x = hApply(Hc, u, v);
        const I = sample(Lc.smooth.d, Lc.w, Lc.h, x[0], x[1]);
        if (I !== I) { keep.push(i); continue; }
        const K = phot[3] + phot[4] * u + phot[5] * v, G = phot[0] + phot[1] * u + phot[2] * v;
        const mid = K + 0.5 * G;
        const white = r > Rb;
        if (white ? I < mid : I > mid) continue;
        keep.push(i);
    }
    return {
        n: keep.length,
        u: Float64Array.from(keep, function (i) { return S.u[i]; }),
        v: Float64Array.from(keep, function (i) { return S.v[i]; }),
        f: Float64Array.from(keep, function (i) { return S.f[i]; }),
        dropped: S.n - keep.length
    };
}

// Recherche de la perspective. Le bord du noir, seul cercle franc du dessin, fixe une
// ellipse : 5 des 8 paramètres. Restent la rotation (sans effet) et deux paramètres
// de perspective, que ce bord ne voit pas : ils déplacent l'image du VRAI centre à
// l'intérieur de l'ellipse et décentrent les autres anneaux — de plusieurs mm sur une
// cible de 25 m photographiée de biais. Ce sont les traits fins des anneaux qui les
// fixent, signal faible qu'un objet posé sur la cible suffit à couvrir dans un
// ajustement global. On les cherche donc à part : on balaie la position c de l'image
// du centre (en unités du rayon du noir) par les transformations projectives qui
// conservent le cercle unité (« boosts » de Lorentz), et l'on garde celle qui aligne le
// mieux les anneaux, bord du noir exclu.
// Décalage du centre projeté ≈ (rayon du noir / distance) × sin(inclinaison) : 0,15
// couvre une cible de 25 m prise à 60 cm sous 50° ; au-delà, la recherche trouve des
// configurations dégénérées (anneaux tassés contre le bord) qui trompent la corrélation.
const PERSP_MAX = 0.15;

// Corrélation minimale entre photo et dessin recalé pour compter les trous. Mesurée :
// 0,97–0,99 sur les photos synthétiques et le carton net du forum, 0,89 sur la photo
// sombre au pistolet posé dessus, 0,32 quand la détection s'était accrochée ailleurs.
const MIN_CORR = 0.7;

function boostMatrix(cx, cy) {
    const t = Math.hypot(cx, cy);
    if (t < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const eta = Math.atanh(Math.min(0.95, t));
    const ch = Math.cosh(eta), sh = Math.sinh(eta);
    const c = cx / t, s = cy / t;
    // R(φ)·B(η)·R(−φ)
    const B = [ch, 0, sh, 0, 1, 0, sh, 0, ch];
    const R = [c, -s, 0, s, c, 0, 0, 0, 1], Ri = [c, s, 0, -s, c, 0, 0, 0, 1];
    return hMul(hMul(R, B), Ri);
}

function perspectiveSearch(L, Hl, face, prof, Rn, sigmaMM, ppmm, rand, center0, span, step, filter) {
    const Rb = face.black / 2, k = Rb / Rn;
    const S = [k, 0, 0, 0, k, 0, 0, 0, 1], Si = [1 / k, 0, 0, 0, 1 / k, 0, 0, 0, 1];
    const img = L.smooth.d, w = L.w, h = L.h;
    const Hc = function (cx, cy) { return hMul(hMul(hMul(Hl, S), boostMatrix(cx, cy)), Si); };
    const H0 = Hc(center0[0], center0[1]);
    // Échantillons près des traits, hors de la bande du bord du noir, et qui restent
    // dans l'image avec une marge suffisante pour tous les candidats : un candidat ne
    // doit pas pouvoir « gagner » en poussant hors de l'image ce qui le gêne.
    const margin = 2 + 2 * (span + 0.02) * hLocalScale(H0, 0, 0) * k;    // pixels
    let all = buildSamples(face, prof, Rn, ppmm, sigmaMM, 30000, rand);
    if (filter) all = filter(all);
    const us = [], vs = [], fs = [];
    for (let i = 0; i < all.n; i++) {
        const r = Math.hypot(all.u[i], all.v[i]) * Rn;
        if (Math.abs(r - Rb) < 4 * sigmaMM) continue;
        const x = hApply(H0, all.u[i], all.v[i]);
        if (x[0] < margin || x[1] < margin || x[0] > w - margin || x[1] > h - margin) continue;
        us.push(all.u[i]); vs.push(all.v[i]); fs.push(all.f[i]);
    }
    const m = us.length;
    if (m < 200) return null;
    const vals = new Float64Array(m);
    // Coût robuste : gain et niveau ajustés au candidat (moindres carrés repondérés),
    // résidus pesés par Tukey avec une échelle fixée sur le départ.
    let cTukey = null;
    const costOf = function (H) {
        for (let i = 0; i < m; i++) {
            const x = hApply(H, us[i], vs[i]);
            vals[i] = sample(img, w, h, x[0], x[1]);
        }
        let g = 0.6, b0 = 0.15;
        for (let it = 0; it < 3; it++) {
            let s00 = 0, s01 = 0, s11 = 0, t0 = 0, t1 = 0;
            for (let i = 0; i < m; i++) {
                const I = vals[i];
                if (I !== I) continue;
                let wt = 1;
                if (it > 0 && cTukey) {
                    const e = I - (g * fs[i] + b0);
                    if (Math.abs(e) >= cTukey) continue;
                    const t = 1 - (e / cTukey) * (e / cTukey); wt = t * t;
                }
                const f = fs[i];
                s00 += wt * f * f; s01 += wt * f; s11 += wt; t0 += wt * f * I; t1 += wt * I;
            }
            const det = s00 * s11 - s01 * s01;
            if (Math.abs(det) < 1e-12) break;
            g = (t0 * s11 - t1 * s01) / det; b0 = (s00 * t1 - s01 * t0) / det;
        }
        if (!cTukey) {
            const r = [];
            for (let i = 0; i < m; i++) if (vals[i] === vals[i]) r.push(Math.abs(vals[i] - (g * fs[i] + b0)));
            cTukey = 4.685 * Math.max(0.01, 1.4826 * median(r));
        }
        let cost = 0;
        for (let i = 0; i < m; i++) {
            const I = vals[i];
            if (I !== I) { cost += cTukey * cTukey / 6; continue; }
            cost += rhoWeight(I - (g * fs[i] + b0), cTukey, true)[0];
        }
        return cost / m;
    };
    let best = center0.slice(), bc = costOf(H0);
    const c0 = bc;
    for (let y = -span; y <= span + 1e-9; y += step) {
        for (let x = -span; x <= span + 1e-9; x += step) {
            const cx = center0[0] + x, cy = center0[1] + y;
            if (Math.hypot(cx, cy) > PERSP_MAX) continue;
            const c = costOf(Hc(cx, cy));
            if (c < bc) { bc = c; best = [cx, cy]; }
        }
    }
    return { H: Hc(best[0], best[1]), c: best, cost: bc, cost0: c0 };
}

// Homographie initiale : l'ellipse du noir est l'image d'un cercle de rayon
// black/2. On prend la racine symétrique de sa matrice de forme : la cible n'est pas
// tournée, le « haut » reste celui de la photo.
function homographyFromEllipse(e, face, Rn) {
    const Rb = face.black / 2;
    const c = Math.cos(e.theta), s = Math.sin(e.theta);
    const m11 = e.a * c * c + e.b * s * s, m22 = e.a * s * s + e.b * c * c, m12 = (e.a - e.b) * c * s;
    const k = Rn / Rb;
    return [m11 * k, m12 * k, e.cx, m12 * k, m22 * k, e.cy, 0, 0, 1];
}

// Recalage complet, du niveau le plus flou au plus net. H : coordonnées réduites
// (mm / Rn) → pixels du niveau 0.
function alignBull(pyr, ellipse0, face, opts) {
    const prof = buildProfile(face);
    const Rn = face.rings[0] / 2;
    const Rb = face.black / 2;
    let H = homographyFromEllipse(ellipse0, face, Rn);
    const blackPx0 = Math.sqrt(ellipse0.a * ellipse0.b);
    let top = Math.max(0, Math.floor(Math.log2(blackPx0 / 14)));
    top = Math.min(top, pyr.length - 1);
    let phot = null;
    const rand = rng(12345);
    let lastScore = null, lastLevel = null, lastS = null, lastP = null;
    // Du flou au net, et du simple au complet : aux deux niveaux les plus flous, une
    // transformation affine seulement, et le seul voisinage du noir (le visuel y fait
    // une vingtaine de pixels ; une arme ou une boîte posée sur le blanc y pèserait
    // autant que tous les anneaux) ; ensuite la perspective et toute la cible.
    // Pondération de Tukey partout : ce qui ne ressemble pas au dessin ne compte pas.
    const ell0 = ellipseConic(ellipse0);
    let perspDone = false;
    const edgeDev = function (Hc) {
        // Écart moyen (pixels du niveau 0) entre le bord du noir projeté et l'ellipse
        // détectée, rapporté au rayon : garde-fou contre une divergence.
        let sdev = 0;
        for (let a = 0; a < 64; a++) {
            const t = a / 64 * 2 * Math.PI;
            const q = hApply(Hc, Math.cos(t) * Rb / Rn, Math.sin(t) * Rb / Rn);
            sdev += sampsonDist(ell0, q[0], q[1]);
        }
        return sdev / 64 / blackPx0;
    };
    for (let k = top; k >= 0; k--) {
        const L = pyr[k];
        const s = 1 / (1 << k);
        const Hl = hScaleImage(H, s);
        const ppmm = hLocalScale(Hl, 0, 0) / Rn;          // pixels du niveau par mm
        const sigmaMM = Math.max(1.0 / ppmm, 0.5 * face.line);
        // (le niveau 0 n'est jamais « grossier » : la perspective doit y être libre)
        const coarse = top > 0 && k >= Math.max(1, top - 1);
        const rLimit = coarse ? Math.min(face.rings[0] / 2, 1.3 * Rb + 3 * sigmaMM) : 0;
        let S = buildSamples(face, prof, Rn, ppmm, sigmaMM, opts.budget || 120000, rand, rLimit);
        if (phot) S = consistentSamples(pyr, k, H, S, face, Rn, phot);
        const p = [Hl[0], Hl[1], Hl[2], Hl[3], Hl[4], Hl[5], Hl[6], Hl[7]];
        if (phot) {
            for (let i = 0; i < 6; i++) p.push(phot[i]);
        } else {
            p.push(0.6, 0, 0, 0.15, 0, 0);
            fitPhotometric(L, S, p);
        }
        const prevH = H;
        // Au premier niveau où la perspective est libre : recherche explicite d'abord.
        if (!coarse && !perspDone) {
            const Hfix = H, photFix = phot || p.slice(8, 14);
            const filt = function (SS) { return consistentSamples(pyr, k, Hfix, SS, face, Rn, photFix); };
            const P1 = perspectiveSearch(L, Hl, face, prof, Rn, sigmaMM, ppmm, rand, [0, 0], PERSP_MAX, 0.01, filt);
            if (P1) {
                const L1 = pyr[Math.max(0, k - 1)], s1 = 1 / (1 << Math.max(0, k - 1));
                const Hl1 = hScaleImage(hScaleImage(P1.H, 1 / s), s1);
                const ppmm1 = hLocalScale(Hl1, 0, 0) / Rn;
                // Affinage au niveau plus net, autour du meilleur point, avec le H d'origine.
                const P2 = perspectiveSearch(L1, hScaleImage(hScaleImage(Hl, 1 / s), s1), face, prof, Rn,
                                             Math.max(1.0 / ppmm1, 0.5 * face.line), ppmm1, rand, P1.c, 0.03, 0.004, filt);
                const best = P2 ? hScaleImage(hScaleImage(P2.H, 1 / s1), s) : P1.H;
                const Hn = hNormalize(best);
                for (let i = 0; i < 8; i++) p[i] = Hn[i];
                if (opts.trace) opts.trace({ level: k, perspective: P2 ? P2.c : P1.c, score: P2 ? P2.cost : P1.cost, score0: P1.cost0 });
            }
            perspDone = true;
        }
        alignLevel(L, S, p, { maxIter: k === top ? 40 : 25, tol: 0.02, tukey: k < top, fixPersp: coarse });
        H = hScaleImage([p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], 1], 1 / s);
        // L'ellipse détectée est sûre à quelques pour cent : un recalage qui en éloigne
        // le bord du noir de plus de 6 % du rayon a divergé ; on revient au précédent.
        if (edgeDev(H) > (ellipse0.approximate ? 0.2 : 0.06) && edgeDev(prevH) < edgeDev(H)) {
            H = prevH;
            if (opts.trace) opts.trace({ level: k, rejected: true, dev: edgeDev(hScaleImage([p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], 1], 1 / s)), dev0: edgeDev(prevH) });
            continue;
        }
        phot = p.slice(8, 14);
        lastLevel = L; lastS = S; lastP = p;
        if (opts.trace) opts.trace({ level: k, H: H.slice(), phot: phot.slice(), score: alignmentScore(L, S, p), samples: S.n });
    }
    // Tous les niveaux rejetés par le garde-fou : pas de recalage digne de ce nom. On le
    // dit (corrélation nulle, donc pas de comptage) au lieu de planter.
    lastScore = lastLevel ? alignmentScore(lastLevel, lastS, lastP) : { corr: 0, coverage: 0 };
    if (!phot) phot = [0.6, 0, 0, 0.15, 0, 0];
    return { H: H, phot: phot, Rn: Rn, profile: prof, quality: lastScore };
}

// Fait tourner le repère de la cible pour que son « haut » soit celui de la photo
// (un dessin à symétrie de révolution ne fixe pas la rotation).
function uprightFrame(bull) {
    const H = bull.H, Hi = hInv(H);
    const c = hApply(H, 0, 0);
    const up = hApply(Hi, c[0], c[1] - 10);
    const ang = Math.atan2(up[0], -up[1]);              // angle du haut photo dans la cible
    return rotateFrame(bull, ang);
}

// Rotation du repère cible d'un angle a : u_nouveau = R(−a)·u_ancien.
function rotateFrame(bull, a) {
    const c = Math.cos(a), s = Math.sin(a);
    // u_ancien = R(a)·u_nouveau
    const R = [c, -s, 0, s, c, 0, 0, 0, 1];
    bull.H = hMul(bull.H, R);
    const ph = bull.phot;
    // gain(u_ancien) = g0 + [g1 g2]·R(a)·u_nouveau
    const g1 = ph[1] * c + ph[2] * s, g2 = -ph[1] * s + ph[2] * c;
    const b1 = ph[4] * c + ph[5] * s, b2 = -ph[4] * s + ph[5] * c;
    bull.phot = [ph[0], g1, g2, ph[3], b1, b2];
    return bull;
}

// ===========================================================================
// 7. Redressement et recherche des trous
// ===========================================================================

// others : centres (pixels de travail) des AUTRES visuels de la photo. Un pixel plus
// proche d'un autre visuel que du sien lui appartient : il est écarté (other = 1). Sans
// cela, le domaine d'une cible de 25 m (rayon 258 mm) recouvrait le carton voisin, dont
// le noir et les trous devenaient de faux tirs.
function rectify(pyr, bull, face, gauge, opts, others) {
    const Rn = bull.Rn;
    const rDom = face.rings[0] / 2 + 1.5 * gauge;
    const native = hLocalScale(bull.H, 0, 0) / Rn;       // pixels photo par mm
    let ppmm = Math.min(28 / gauge, (opts.maxRect || 1400) / (2 * rDom));
    ppmm = Math.min(ppmm, 1.25 * native);
    const size = Math.ceil(2 * rDom * ppmm);
    // Niveau de pyramide dont la résolution approche celle du redressement.
    let lev = Math.max(0, Math.floor(Math.log2(native / ppmm / 1.2)));
    lev = Math.min(lev, pyr.length - 1);
    const L = pyr[lev], s = 1 / (1 << lev);
    const Hl = hScaleImage(bull.H, s);
    const gray = new Float32Array(size * size), chroma = new Float32Array(size * size);
    const valid = new Uint8Array(size * size), other = new Uint8Array(size * size);
    const half = size / 2;
    const own = hApply(bull.H, 0, 0);
    const oth = (others || []).map(function (c) { return [c[0] * s, c[1] * s]; });
    const ownL = [own[0] * s, own[1] * s];
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const u = (i + 0.5 - half) / ppmm, v = (j + 0.5 - half) / ppmm;
            // Seul le disque de la cible compte : au-delà, les coins du carré
            // redressé peuvent déborder du carton (fond, table, autre visuel).
            if (u * u + v * v > rDom * rDom) continue;
            const x = hApply(Hl, u / Rn, v / Rn);
            if (oth.length) {
                const d0 = (x[0] - ownL[0]) * (x[0] - ownL[0]) + (x[1] - ownL[1]) * (x[1] - ownL[1]);
                let mine = true;
                for (let k = 0; k < oth.length && mine; k++) {
                    if ((x[0] - oth[k][0]) * (x[0] - oth[k][0]) + (x[1] - oth[k][1]) * (x[1] - oth[k][1]) < d0) mine = false;
                }
                if (!mine) { other[j * size + i] = 1; continue; }
            }
            if (x[0] < 2 || x[1] < 2 || x[0] > L.w - 2 || x[1] > L.h - 2) continue;
            const g = sample(L.img.d, L.w, L.h, x[0], x[1]);
            const c = sample(L.chroma.d, L.w, L.h, x[0], x[1]);
            if (g !== g) continue;
            gray[j * size + i] = g; chroma[j * size + i] = c; valid[j * size + i] = 1;
        }
    }
    return { size: size, ppmm: ppmm, native: native, gray: gray, chroma: chroma, valid: valid, other: other, rDom: rDom };
}

// Distance euclidienne exacte au carré (Felzenszwalb & Huttenlocher) : pour chaque
// pixel, distance au plus proche pixel où feature vaut 1.
function edt(feature, w, h) {
    const INF = 1e20;
    const d = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = feature[i] ? 0 : INF;
    const n = Math.max(w, h);
    const f = new Float64Array(n), out = new Float64Array(n), z = new Float64Array(n + 1);
    const vv = new Int32Array(n);
    const pass = function (len) {
        let k = 0;
        vv[0] = 0; z[0] = -INF; z[1] = INF;
        for (let q = 1; q < len; q++) {
            let s;
            for (;;) {
                const r = vv[k];
                s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
                if (s <= z[k]) { k--; if (k < 0) { k = 0; break; } } else break;
            }
            k++;
            vv[k] = q; z[k] = s; z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < len; q++) {
            while (z[k + 1] < q) k++;
            const r = vv[k];
            out[q] = (q - r) * (q - r) + f[r];
        }
    };
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = d[y * w + x];
        pass(h);
        for (let y = 0; y < h; y++) d[y * w + x] = out[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = d[y * w + x];
        pass(w);
        for (let x = 0; x < w; x++) d[y * w + x] = out[x];
    }
    return d;
}

// Ouverture morphologique par un disque de rayon r : efface tout ce qui est plus
// étroit que 2r (traits des anneaux, chiffres), garde la forme de ce qui est plus large.
function openDisc(mask, w, h, r) {
    const inv = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
    const dBg = edt(inv, w, h);
    const eroded = new Uint8Array(w * h);
    const r2 = r * r;
    for (let i = 0; i < w * h; i++) eroded[i] = (mask[i] && dBg[i] > r2) ? 1 : 0;
    const dEr = edt(eroded, w, h);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = dEr[i] <= r2 ? 1 : 0;
    return out;
}

// Surface de degré 2 ajustée à des valeurs prises en des points (u, v) réduits :
// niveau du papier, de l'encre, de leur teinte. Suit un éclairage inégal ou un
// vignetage mieux qu'un plan. Départ par la médiane, puis moindres carrés repondérés
// de Tukey : les traits et chiffres blancs imprimés dans le noir (10 % de la zone,
// parfois) n'y pèsent rien — avec Huber, ils relevaient le niveau du noir.
function fitSurface(us, vs, vals) {
    const m = vals.length;
    if (m < 30) return [median(vals), 0, 0, 0, 0, 0];
    const nb = m < 300 ? 3 : 6;
    let coef = [median(vals), 0, 0, 0, 0, 0];
    const resid = function () {
        const r = new Float64Array(m);
        for (let i = 0; i < m; i++) r[i] = vals[i] - evalSurface(coef, us[i], vs[i]);
        return r;
    };
    for (let it = 0; it < 5; it++) {
        const res = resid();
        const sc = Math.max(2e-3, 1.4826 * median(Array.from(res, Math.abs)));
        const c = 4.685 * sc;
        const A = new Float64Array(nb * nb), b = new Float64Array(nb);
        for (let i = 0; i < m; i++) {
            const e = res[i];
            if (Math.abs(e) >= c) continue;
            const t = 1 - (e / c) * (e / c), w = t * t;
            const u = us[i], v = vs[i];
            const row = [1, u, v, u * u, u * v, v * v];
            for (let r = 0; r < nb; r++) {
                b[r] += w * row[r] * vals[i];
                for (let q = 0; q <= r; q++) A[r * nb + q] += w * row[r] * row[q];
            }
        }
        for (let r = 0; r < nb; r++) { for (let q = 0; q < r; q++) A[q * nb + r] = A[r * nb + q]; A[r * nb + r] += 1e-9; }
        const x = solveSPD(A, b, nb);
        if (!x) break;
        coef = [0, 0, 0, 0, 0, 0];
        for (let k = 0; k < nb; k++) coef[k] = x[k];
    }
    return coef;
}

function evalSurface(c, u, v) { return c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * u * v + c[5] * v * v; }

// Carte d'« anomalie » : écart à ce qu'on attend de la ZONE (papier ou encre), en
// fraction du contraste local papier/encre, ou écart de teinte. On compare à la zone,
// pas au dessin complet : un trait d'anneau devient une anomalie fine que l'ouverture
// efface, alors que comparé au trait lissé, un trou gris s'y confondait et sortait
// coupé en morceaux. Les niveaux et la teinte de chaque zone sont des surfaces
// ajustées sur la photo elle-même — une encre bleu marine n'est pas une anomalie, un
// fond orange vu par un trou en est une. Un trou ne se voit que si ce qu'on aperçoit
// à travers diffère du papier ou de l'encre autour : d'où le conseil du fond coloré.
function anomalyMap(rect, bull, face) {
    const n = rect.size, ppmm = rect.ppmm, half = n / 2, Rn = bull.Rn;
    const rb = face.black / 2;
    const sigma = 0.9 / ppmm;
    const bars = face.bars;
    const zoneOf = function (u, v, r) {
        if (bars && Math.abs(v) <= bars.width / 2 && Math.abs(u) >= bars.from && Math.abs(u) <= bars.to) return 1;
        return r < rb ? 0 : 1;
    };
    // Échantillons de chaque zone, loin du bord du noir (3 pixels).
    const S = [[[], [], [], []], [[], [], [], []]];      // zone → [u, v, gris, chroma]
    const margin = 3 / ppmm;
    const stride = Math.max(1, Math.round(n / 300));
    for (let j = 0; j < n; j += stride) {
        for (let i = 0; i < n; i += stride) {
            const p = j * n + i;
            if (!rect.valid[p]) continue;
            const u = (i + 0.5 - half) / ppmm, v = (j + 0.5 - half) / ppmm;
            const r = Math.hypot(u, v);
            if (Math.abs(r - rb) < margin) continue;
            const z = zoneOf(u, v, r);
            S[z][0].push(u / Rn); S[z][1].push(v / Rn); S[z][2].push(rect.gray[p]); S[z][3].push(rect.chroma[p]);
        }
    }
    const lev = [fitSurface(S[0][0], S[0][1], S[0][2]), fitSurface(S[1][0], S[1][1], S[1][2])];
    const tint = [fitSurface(S[0][0], S[0][1], S[0][3]), fitSurface(S[1][0], S[1][1], S[1][3])];
    // Sans zone blanche visible (tir rapide recadré serré), le contraste vient du
    // recalage.
    const ph = bull.phot;
    const lutStep = 0.25 / ppmm, lutN = Math.ceil(rect.rDom * 1.5 / lutStep) + 2;
    const lutF = new Float32Array(lutN);
    const prof = { f0: 0, steps: [{ r: rb, delta: 1 }] };
    for (let k = 0; k < lutN; k++) lutF[k] = profileValue(prof, k * lutStep, sigma);
    const A = new Float32Array(n * n), R = new Float32Array(n * n), C = new Float32Array(n * n);
    // Contraste de référence : médiane de papier − encre sur la cible. Le contraste
    // local n'en descend pas sous 60 % : là où une ombre (celle d'une arme posée sur
    // la cible) fait plonger la surface du papier, diviser par un contraste presque
    // nul transformait le grain de l'encre en « trous ».
    const Wat = function (un, vn) { return S[1][2].length >= 30 ? evalSurface(lev[1], un, vn) : ph[0] + ph[3] + (ph[1] + ph[4]) * un + (ph[2] + ph[5]) * vn; };
    const Kat = function (un, vn) { return S[0][2].length >= 30 ? evalSurface(lev[0], un, vn) : ph[3] + ph[4] * un + ph[5] * vn; };
    const gains = [];
    for (let t = 0; t < 64; t++) {
        for (let q = 1; q <= 4; q++) {
            const rr = q / 4 * rect.rDom / Rn;
            gains.push(Wat(rr * Math.cos(t / 64 * 2 * Math.PI), rr * Math.sin(t / 64 * 2 * Math.PI)) - Kat(rr * Math.cos(t / 64 * 2 * Math.PI), rr * Math.sin(t / 64 * 2 * Math.PI)));
        }
    }
    const gainRef = Math.max(0.05, median(gains));
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!rect.valid[p]) continue;
            const u = (i + 0.5 - half) / ppmm, v = (j + 0.5 - half) / ppmm;
            const r = Math.hypot(u, v);
            let f = lutF[Math.min(lutN - 1, Math.round(r / lutStep))];
            if (zoneOf(u, v, r) === 1 && r < rb) f = 1;            // trait de visée
            const un = u / Rn, vn = v / Rn;
            const W = Wat(un, vn);
            const K = Kat(un, vn);
            const gain = Math.max(0.6 * gainRef, W - K);
            const model = K + gain * f;
            R[p] = (rect.gray[p] - model) / gain;
            const cref = evalSurface(tint[0], un, vn) * (1 - f) + evalSurface(tint[1], un, vn) * f;
            C[p] = Math.max(0, rect.chroma[p] - cref) / gain * 1.6;
        }
    }
    for (let i = 0; i < n * n; i++) { const a = Math.abs(R[i]); A[i] = a > C[i] ? a : C[i]; }
    return { A: A, R: R };
}

// Placement de k disques de rayon rr dans une tache (pixels du masque) : on maximise
// (pixels de la tache couverts) − (pixels hors tache couverts), recouvrement doux d'un
// pixel. Départs : k-moyennes amorcées par le point le plus éloigné, puis par tirages
// pondérés (k-means++) ; chacun est poli par une descente par motifs ; on garde le
// meilleur. Un amas en trèfle a des optimums locaux : un seul départ s'y prend.
function fitDiscs(pixels, maskFn, k, rr, rand) {
    const n = pixels.length / 2;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += pixels[2 * i]; cy += pixels[2 * i + 1]; }
    cx /= n; cy /= n;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
        x0 = Math.min(x0, pixels[2 * i]); x1 = Math.max(x1, pixels[2 * i]);
        y0 = Math.min(y0, pixels[2 * i + 1]); y1 = Math.max(y1, pixels[2 * i + 1]);
    }
    const pad = Math.ceil(rr) + 3;
    x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
    const ww = x1 - x0 + 1, hh = y1 - y0 + 1;
    const sign = new Int8Array(ww * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) sign[y * ww + x] = maskFn(x + x0, y + y0) ? 1 : -1;
    const score = function (cs) {
        let s = 0;
        for (let y = 0; y < hh; y++) {
            const py = y + y0 + 0.5;
            for (let x = 0; x < ww; x++) {
                const px = x + x0 + 0.5;
                let cov = 0;
                for (let j = 0; j < cs.length; j++) {
                    const dx = px - cs[j][0], dy = py - cs[j][1];
                    const c = rr + 0.5 - Math.sqrt(dx * dx + dy * dy);
                    if (c > cov) { cov = c >= 1 ? 1 : c; if (cov >= 1) break; }
                }
                if (cov > 0) s += cov * sign[y * ww + x];
            }
        }
        return s;
    };
    const kmeans = function (init) {
        let centers = init;
        for (let it = 0; it < 12; it++) {
            const acc = centers.map(function () { return [0, 0, 0]; });
            for (let i = 0; i < n; i++) {
                let best = 0, bd = Infinity;
                for (let j = 0; j < centers.length; j++) {
                    const d = (pixels[2 * i] - centers[j][0]) ** 2 + (pixels[2 * i + 1] - centers[j][1]) ** 2;
                    if (d < bd) { bd = d; best = j; }
                }
                acc[best][0] += pixels[2 * i]; acc[best][1] += pixels[2 * i + 1]; acc[best][2]++;
            }
            centers = centers.map(function (c, j) { return acc[j][2] ? [acc[j][0] / acc[j][2], acc[j][1] / acc[j][2]] : c; });
        }
        return centers;
    };
    // Descente par motifs, incrémentale : pour déplacer le disque j, on ne réévalue
    // que la fenêtre qui l'entoure, les autres disques y étant figés (couverture
    // « autres » calculée une fois par disque et par pas).
    const other = new Float32Array(ww * hh);
    const polish = function (centers) {
        centers = centers.map(function (c) { return [c[0] + 0.5, c[1] + 0.5]; });
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        [4, 2, 1, 0.5, 0.25].forEach(function (st) {
            let improved = true, guard = 0;
            while (improved && guard++ < 30) {
                improved = false;
                for (let j = 0; j < centers.length; j++) {
                    const R = rr + 1.5 + st;
                    const bx0 = Math.max(0, Math.floor(centers[j][0] - R - x0)), bx1 = Math.min(ww - 1, Math.ceil(centers[j][0] + R - x0));
                    const by0 = Math.max(0, Math.floor(centers[j][1] - R - y0)), by1 = Math.min(hh - 1, Math.ceil(centers[j][1] + R - y0));
                    for (let y = by0; y <= by1; y++) {
                        const py = y + y0 + 0.5;
                        for (let x = bx0; x <= bx1; x++) {
                            const px = x + x0 + 0.5;
                            let cov = 0;
                            for (let q = 0; q < centers.length; q++) {
                                if (q === j) continue;
                                const dx = px - centers[q][0], dy = py - centers[q][1];
                                const c = rr + 0.5 - Math.sqrt(dx * dx + dy * dy);
                                if (c > cov) { cov = c >= 1 ? 1 : c; if (cov >= 1) break; }
                            }
                            other[y * ww + x] = cov;
                        }
                    }
                    const gainAt = function (cxj, cyj) {
                        let g = 0;
                        for (let y = by0; y <= by1; y++) {
                            const dy = y + y0 + 0.5 - cyj;
                            for (let x = bx0; x <= bx1; x++) {
                                const dx = x + x0 + 0.5 - cxj;
                                let c = rr + 0.5 - Math.sqrt(dx * dx + dy * dy);
                                if (c <= 0) continue;
                                if (c > 1) c = 1;
                                const o = other[y * ww + x];
                                if (c > o) g += (c - o) * sign[y * ww + x];
                            }
                        }
                        return g;
                    };
                    // Le meilleur des huit voisins, un seul pas : la fenêtre ne couvre
                    // qu'un pas autour de la position de départ.
                    let g0 = gainAt(centers[j][0], centers[j][1]), bestPos = null;
                    for (let q = 0; q < dirs.length; q++) {
                        const nx = centers[j][0] + dirs[q][0] * st, ny = centers[j][1] + dirs[q][1] * st;
                        const g = gainAt(nx, ny);
                        if (g > g0 + 1e-9) { g0 = g; bestPos = [nx, ny]; }
                    }
                    if (bestPos) { centers[j] = bestPos; improved = true; }
                }
            }
        });
        return { centers: centers, score: score(centers) };
    };
    if (k === 1) return polish([[cx, cy]]);
    const inits = [];
    // Départ 1 : point le plus éloigné du centre, puis le plus éloigné des choisis.
    {
        let far = 0, fd = -1;
        for (let i = 0; i < n; i++) {
            const d = Math.hypot(pixels[2 * i] - cx, pixels[2 * i + 1] - cy);
            if (d > fd) { fd = d; far = i; }
        }
        const c = [[pixels[2 * far], pixels[2 * far + 1]]];
        while (c.length < k) {
            let bi = 0, bd = -1;
            for (let i = 0; i < n; i++) {
                let dmin = Infinity;
                c.forEach(function (q) { dmin = Math.min(dmin, Math.hypot(pixels[2 * i] - q[0], pixels[2 * i + 1] - q[1])); });
                if (dmin > bd) { bd = dmin; bi = i; }
            }
            c.push([pixels[2 * bi], pixels[2 * bi + 1]]);
        }
        inits.push(c);
    }
    // Départs suivants : k-means++.
    for (let r = 0; r < 3; r++) {
        const c = [];
        const i0 = Math.floor(rand() * n);
        c.push([pixels[2 * i0], pixels[2 * i0 + 1]]);
        while (c.length < k) {
            const d2 = new Float64Array(n);
            let tot = 0;
            for (let i = 0; i < n; i++) {
                let dmin = Infinity;
                c.forEach(function (q) { dmin = Math.min(dmin, (pixels[2 * i] - q[0]) ** 2 + (pixels[2 * i + 1] - q[1]) ** 2); });
                d2[i] = dmin; tot += dmin;
            }
            let t = rand() * tot, pick = n - 1;
            for (let i = 0; i < n; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
            c.push([pixels[2 * pick], pixels[2 * pick + 1]]);
        }
        inits.push(c);
    }
    let bestFit = null;
    inits.forEach(function (init) {
        const f = polish(kmeans(init));
        if (!bestFit || f.score > bestFit.score) bestFit = f;
    });
    return bestFit;
}

// Masque des trous : anomalie au-dessus du seuil de la zone. Exception : la bande de
// transition du bord du noir (± 1,5 pixel), où le modèle lissé vaut entre papier et
// encre et où un trou gris ne ressort donc pas. On n'y juge pas le pixel lui-même :
// on regarde de part et d'autre du bord. Un trou qui le traverse est trou des deux
// côtés, la bande est recousue ; un trou qui le longe ne l'est que d'un côté. Même
// traitement pour les bords des traits de visée du tir rapide. Les traits fins des
// anneaux, eux, ne coupent pas un trou (on compare à la zone, pas au dessin) : les
// recoudre de même entaillait les trous là où un anneau croise leur bord, et une
// fermeture aveugle soudait au trou le trait voisin, en croissant que l'ouverture gardait.
function buildHoleMask(rect, bull, face, A, tauZone) {
    const n = rect.size, ppmm = rect.ppmm, half = n / 2;
    const rb = face.black / 2;
    const delta = 1.5 / ppmm;
    const bands = [[Math.max(0, rb - delta), rb + delta]];
    const bandOf = function (r) {
        for (let k = 0; k < bands.length; k++) if (r >= bands[k][0] && r <= bands[k][1]) return k;
        return -1;
    };
    const bars = face.bars;
    const inBarEdge = function (u, v) {
        if (!bars || Math.abs(u) < bars.from - delta || Math.abs(u) > bars.to + delta) return false;
        return Math.abs(Math.abs(v) - bars.width / 2) <= delta;
    };
    const raw = new Uint8Array(n * n), isBand = new Int16Array(n * n).fill(-1);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!rect.inner[p]) continue;
            const u = (i + 0.5 - half) / ppmm, v = (j + 0.5 - half) / ppmm;
            const r = Math.hypot(u, v);
            const b = bandOf(r);
            if (b >= 0) { isBand[p] = b; continue; }
            if (inBarEdge(u, v)) { isBand[p] = 10000; continue; }
            raw[p] = A[p] > tauZone[r < rb ? 0 : 1] ? 1 : 0;
        }
    }
    const at = function (u, v) {
        const i = Math.floor(u * ppmm + half), j = Math.floor(v * ppmm + half);
        if (i < 0 || j < 0 || i >= n || j >= n) return 0;
        return raw[j * n + i];
    };
    const mask = Uint8Array.from(raw);
    const step = 1 / ppmm;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            const b = isBand[p];
            if (b < 0) continue;
            const u = (i + 0.5 - half) / ppmm, v = (j + 0.5 - half) / ppmm;
            if (b === 10000) {
                // Bord d'un trait de visée : regarder au-dessus et au-dessous.
                const s = v >= 0 ? 1 : -1, e = Math.abs(v);
                const lo = bars.width / 2 - delta - step, hi = bars.width / 2 + delta + step;
                mask[p] = (at(u, s * lo) && at(u, s * hi) && Math.abs(e - bars.width / 2) <= delta) ? 1 : 0;
                continue;
            }
            const r = Math.hypot(u, v);
            if (r < 1e-9) { mask[p] = 0; continue; }
            const r0 = Math.max(0, bands[b][0] - step), r1 = bands[b][1] + step;
            const cu = u / r, cv = v / r;
            const inner = r0 <= 0 ? 1 : at(cu * r0, cv * r0);
            mask[p] = (inner && at(cu * r1, cv * r1)) ? 1 : 0;
        }
    }
    return mask;
}

// Aire de l'enveloppe convexe d'un ensemble de pixels (x0, y0, x1, y1, …), coins des
// pixels compris (chaîne monotone d'Andrew).
function hullArea(px) {
    const pts = [];
    for (let i = 0; i < px.length; i += 2) {
        pts.push([px[i], px[i + 1]], [px[i] + 1, px[i + 1]], [px[i], px[i + 1] + 1], [px[i] + 1, px[i + 1] + 1]);
    }
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    const cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    const lower = [], upper = [];
    for (let i = 0; i < pts.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
        lower.push(pts[i]);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
        upper.push(pts[i]);
    }
    const h = lower.slice(0, -1).concat(upper.slice(0, -1));
    let a = 0;
    for (let i = 0; i < h.length; i++) { const j = (i + 1) % h.length; a += h[i][0] * h[j][1] - h[j][0] * h[i][1]; }
    return Math.abs(a) / 2;
}

// k-moyennes (k-means++ déterministe) sur des pixels ; centres en coordonnées
// continues (centre de pixel).
function kmeansCenters(pixels, k, rand) {
    const n = pixels.length / 2;
    const c = [];
    const i0 = Math.floor(rand() * n);
    c.push([pixels[2 * i0], pixels[2 * i0 + 1]]);
    const d2 = new Float64Array(n).fill(Infinity);
    while (c.length < k) {
        const last = c[c.length - 1];
        let tot = 0;
        for (let i = 0; i < n; i++) {
            d2[i] = Math.min(d2[i], (pixels[2 * i] - last[0]) ** 2 + (pixels[2 * i + 1] - last[1]) ** 2);
            tot += d2[i];
        }
        let t = rand() * tot, pick = n - 1;
        for (let i = 0; i < n; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
        c.push([pixels[2 * pick], pixels[2 * pick + 1]]);
    }
    let centers = c;
    for (let it = 0; it < 20; it++) {
        const acc = centers.map(function () { return [0, 0, 0]; });
        for (let i = 0; i < n; i++) {
            let best = 0, bd = Infinity;
            for (let j = 0; j < centers.length; j++) {
                const d = (pixels[2 * i] - centers[j][0]) ** 2 + (pixels[2 * i + 1] - centers[j][1]) ** 2;
                if (d < bd) { bd = d; best = j; }
            }
            acc[best][0] += pixels[2 * i]; acc[best][1] += pixels[2 * i + 1]; acc[best][2]++;
        }
        centers = centers.map(function (q, j) { return acc[j][2] ? [acc[j][0] / acc[j][2], acc[j][1] / acc[j][2]] : q; });
    }
    return centers.map(function (q) { return [q[0] + 0.5, q[1] + 0.5]; });
}

// Trous du noir sur fond sombre : à travers le trou, on voit la table, à peine plus
// noire que l'encre ; seules les fibres blanches arrachées dépassent le seuil, et
// l'ouverture les efface (constaté sur la moitié des photos du jeu de Butt et al. où le
// noir porte des trous). On cherche ici, dans le noir seulement, un disque de la taille
// d'un trou un peu plus SOMBRE que l'encre : moyenne de l'écart sur le disque moins sa
// moyenne sur une couronne autour (une ombre large s'annule), seuil réglé sur le bruit
// de l'image. Le sens « plus sombre » écarte les chiffres et les anneaux blancs.
function darkHolesInBlack(rect, face, R, rr, gPx, existing) {
    const n = rect.size, ppmm = rect.ppmm, half = n / 2;
    const rb = face.black / 2 * ppmm - 1.5 - 0.6 * gPx;          // noir, loin de son bord (pixels)
    const bars = face.bars, barMargin = (2 + 0.6 * gPx) / ppmm;
    if (rb <= 2 * rr) return [];
    const d = new Float32Array(n * n), w = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const p = j * n + i;
            if (!rect.inner[p]) continue;
            if (Math.hypot(i + 0.5 - half, j + 0.5 - half) > rb) continue;
            if (bars) {
                // Traits de visée blancs du tir rapide : leur bord flou paraît « plus sombre
                // que prévu » ; on n'y cherche pas (35 faux trous sur la cible synthétique).
                const u = Math.abs(i + 0.5 - half) / ppmm, v = Math.abs(j + 0.5 - half) / ppmm;
                if (v <= bars.width / 2 + barMargin && u >= bars.from - barMargin && u <= bars.to + barMargin) continue;
            }
            d[p] = R[p] < 0 ? -R[p] : 0;
            w[p] = 1;
        }
    }
    // Images intégrales (somme et compte).
    const I = new Float64Array((n + 1) * (n + 1)), C = new Float64Array((n + 1) * (n + 1));
    for (let j = 0; j < n; j++) {
        let sr = 0, cr = 0;
        for (let i = 0; i < n; i++) {
            sr += d[j * n + i]; cr += w[j * n + i];
            I[(j + 1) * (n + 1) + i + 1] = I[j * (n + 1) + i + 1] + sr;
            C[(j + 1) * (n + 1) + i + 1] = C[j * (n + 1) + i + 1] + cr;
        }
    }
    const box = function (A, x0, y0, x1, y1) {
        x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(n, x1); y1 = Math.min(n, y1);
        if (x1 <= x0 || y1 <= y0) return 0;
        return A[y1 * (n + 1) + x1] - A[y0 * (n + 1) + x1] - A[y1 * (n + 1) + x0] + A[y0 * (n + 1) + x0];
    };
    const a = Math.max(1, Math.round(0.7 * rr)), b = Math.max(a + 2, Math.round(2.2 * rr));
    const score = new Float32Array(n * n);
    const vals = [];
    for (let j = b; j < n - b; j++) {
        for (let i = b; i < n - b; i++) {
            const p = j * n + i;
            if (!w[p]) continue;
            const cc = box(C, i - a, j - a, i + a + 1, j + a + 1);
            const ct = box(C, i - b, j - b, i + b + 1, j + b + 1);
            if (cc < 0.8 * (2 * a + 1) * (2 * a + 1) || ct - cc < 0.5 * ((2 * b + 1) * (2 * b + 1) - (2 * a + 1) * (2 * a + 1))) continue;
            const sc = box(I, i - a, j - a, i + a + 1, j + a + 1), st = box(I, i - b, j - b, i + b + 1, j + b + 1);
            score[p] = sc / cc - (st - sc) / (ct - cc);
            if ((i + j) % 3 === 0) vals.push(score[p]);
        }
    }
    if (vals.length < 50) return [];
    const med = median(vals), mad = 1.4826 * median(vals.map(function (v) { return Math.abs(v - med); }));
    const tau = Math.max(0.06, med + 7 * mad);
    const cand = [];
    for (let j = b; j < n - b; j++) {
        for (let i = b; i < n - b; i++) {
            const p = j * n + i, v = score[p];
            if (v <= tau) continue;
            let isMax = true;
            for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && score[p + dy * n + dx] > v) { isMax = false; break; }
            if (isMax) cand.push([v, i, j]);
        }
    }
    cand.sort(function (p, q) { return q[0] - p[0]; });
    const taken = existing.map(function (s) { return [s.u * ppmm + half, s.v * ppmm + half]; });
    const out = [];
    cand.forEach(function (c) {
        const x = c[1] + 0.5, y = c[2] + 0.5;
        if (taken.some(function (t) { return Math.hypot(t[0] - x, t[1] - y) < 0.8 * gPx; })) return;
        // Centre affiné : barycentre de l'écart sur le disque.
        let sx = 0, sy = 0, sw = 0;
        for (let dy = -Math.ceil(rr); dy <= Math.ceil(rr); dy++) {
            for (let dx = -Math.ceil(rr); dx <= Math.ceil(rr); dx++) {
                if (dx * dx + dy * dy > rr * rr) continue;
                const q = (c[2] + dy) * n + (c[1] + dx);
                if (q < 0 || q >= n * n) continue;
                sx += d[q] * (x + dx); sy += d[q] * (y + dy); sw += d[q];
            }
        }
        const pc = sw > 0 ? [sx / sw, sy / sw] : [x, y];
        taken.push(pc);
        out.push(pc);
    });
    return out;
}

function detectHoles(rect, bull, face, gauge, opts) {
    const n = rect.size, ppmm = rect.ppmm;
    const gPx = gauge * ppmm;
    // Bord de la photo : une bande d'un demi-calibre est écartée — un trou coupé par
    // le cadre ne se note pas, et le vignetage des coins y imite des trous.
    {
        // Pixels hors de la photo mais DANS le disque de la cible : c'est le cadre de la
        // photo. (Hors du disque, c'est la limite du domaine, pas un bord de photo.)
        const half0 = n / 2, rd = rect.rDom * ppmm;
        const frame = new Uint8Array(n * n);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                const p = j * n + i;
                if (!rect.valid[p] && !rect.other[p] && Math.hypot(i + 0.5 - half0, j + 0.5 - half0) <= rd + 1) frame[p] = 1;
            }
        }
        const d = edt(frame, n, n), r2 = (0.5 * gPx) * (0.5 * gPx);
        rect.inner = new Uint8Array(n * n);
        for (let i = 0; i < n * n; i++) if (rect.valid[i]) rect.inner[i] = d[i] > r2 ? 1 : 0;
    }
    const am = anomalyMap(rect, bull, face);
    // Seuil : fixé par l'appelant, sinon 6 écarts-types du bruit de la zone (noir et
    // blanc séparément — l'encre est souvent plus bruitée que le papier), borné entre
    // 0,18 et 0,5 du contraste. Les trous sont rares : la médiane ne les voit pas.
    const tauZone = [0, 0];
    if (opts.threshold != null) {
        tauZone[0] = tauZone[1] = opts.threshold;
    } else {
        const vals = [[], []];
        const half0 = n / 2, rb = face.black / 2;
        for (let j = 0; j < n; j += 2) {
            for (let i = 0; i < n; i += 2) {
                const p = j * n + i;
                if (!rect.valid[p]) continue;
                const r = Math.hypot(i + 0.5 - half0, j + 0.5 - half0) / ppmm;
                vals[r < rb ? 0 : 1].push(am.A[p]);
            }
        }
        for (let z = 0; z < 2; z++) {
            const m = median(vals[z]);
            const mad = median(vals[z].map(function (a) { return Math.abs(a - m); }));
            tauZone[z] = Math.max(0.18, Math.min(0.5, m + 6 * 1.4826 * mad));
        }
    }
    const mask = buildHoleMask(rect, bull, face, am.A, tauZone);
    // Objets posés sur la cible (arme, boîte, main) : une région brute d'un seul tenant
    // de plus de 60 trous d'aire n'est pas un groupement — on l'efface, elle et ses
    // abords, avant l'ouverture qui l'aurait débitée en dizaines de « trous ».
    {
        const raw = components(mask, n, n);
        const Anom0 = Math.PI * gPx * gPx / 4;
        const big = new Uint8Array(n * n);
        let any = false;
        raw.comps.forEach(function (c) {
            if (c.area <= 60 * Anom0) return;
            any = true;
            for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (raw.label[y * n + x] === c.id) big[y * n + x] = 1;
        });
        if (any) {
            const d = edt(big, n, n), r2 = (0.6 * gPx) * (0.6 * gPx);
            for (let i = 0; i < n * n; i++) if (d[i] <= r2) mask[i] = 0;
        }
    }
    const opened = openDisc(mask, n, n, 0.3 * gPx);
    const cc = components(opened, n, n);
    const Anom = Math.PI * gPx * gPx / 4;
    const blobs = [];
    const nearFrame = function (x, y) {
        // Pixel voisin du cadre de la photo (valide mais hors de la zone intérieure).
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
                const q = yy * n + xx;
                if (rect.valid[q] && !rect.inner[q]) return 1;
                if (rect.other[q]) return 2;
            }
        }
        return 0;
    };
    let cutByFrame = 0, notHoleShape = 0;
    cc.comps.forEach(function (c) {
        if (c.area < 0.25 * Anom) return;
        const px = [];
        let touches = 0;
        for (let y = c.y0; y <= c.y1; y++) {
            for (let x = c.x0; x <= c.x1; x++) {
                if (cc.label[y * n + x] !== c.id) continue;
                px.push(x, y);
                if (!touches) touches = nearFrame(x, y);
            }
        }
        // Une tache coupée par le cadre de la photo ne se note pas (et le vignetage
        // des coins en fabrique) ; une tache à la frontière d'un autre visuel est à lui.
        if (touches === 1) { cutByFrame++; return; }
        if (touches === 2) return;
        // Allongement : rapport des moments principaux.
        let mx = 0, my = 0;
        for (let i = 0; i < px.length; i += 2) { mx += px[i]; my += px[i + 1]; }
        mx /= c.area; my /= c.area;
        let a = 0, b = 0, d = 0;
        for (let i = 0; i < px.length; i += 2) { const dx = px[i] - mx, dy = px[i + 1] - my; a += dx * dx; b += dy * dy; d += dx * dy; }
        const tr = (a + b) / c.area, det = (a * b - d * d) / (c.area * c.area);
        const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
        const ratio = (tr / 2 - disc) / Math.max(1e-9, tr / 2 + disc);
        blobs.push({ comp: c, pixels: px, area: c.area, ratio: ratio, cx: mx, cy: my });
    });
    // Aire d'un trou isolé, apprise sur les taches rondes de taille plausible.
    const single = blobs.filter(function (b) { return b.ratio > 0.6 && b.area > 0.35 * Anom && b.area < 1.5 * Anom; })
                        .map(function (b) { return b.area; });
    // À défaut de tache isolée, l'aire nominale de la jauge : un trou propre de plomb
    // la vaut à peu près ; une .22 fait souvent un peu moins, la tache le dira.
    const Aref = single.length ? Math.max(0.5 * Anom, Math.min(1.2 * Anom, median(single))) : 0.95 * Anom;
    const rr = Math.sqrt(Aref / Math.PI);
    const rand = rng(777);
    // Chaque tache ne compte que ses propres pixels : sinon un disque « de plus »
    // va couvrir la tache voisine qui dépasse dans la fenêtre.
    const maskOf = function (id) {
        return function (x, y) { return x >= 0 && y >= 0 && x < n && y < n && cc.label[y * n + x] === id; };
    };
    // Un tir de plus doit expliquer au moins 30 % d'un trou : deux trous décalés d'un
    // quart de calibre l'expliquent (la réunion fait 1,3 trou), les croissants laissés
    // par un rayon un peu faux ne l'expliquent pas.
    const penalty = 0.3 * Aref;
    // Au-delà de 6 trous d'aire, la tache est un trou d'arrachement (groupement serré,
    // papier déchiré) : sa forme ne dit plus combien de balles y sont passées. On
    // l'estime par l'aire — une réunion de trous qui se chevauchent couvre moins que
    // leur somme, d'où le facteur 0,75 — ou par le nombre de tirs annoncé, et l'on
    // marque ces tirs à vérifier : leurs positions ne sont qu'une répartition plausible.
    const RAGGED = 6;
    blobs.forEach(function (b) {
        b.fits = [];
        if (b.area > 60 * Aref) { b.rejected = 'trop grande'; return; }
        if (b.area > RAGGED * Aref) {
            // Un trou d'arrachement est une plage pleine et ramassée. Un trait au feutre,
            // un cercle tracé autour d'un tir, une flèche, la jointure de deux scans n'en
            // ont pas la forme ; sans ce critère, chacun comptait pour 9 à 12 « tirs ».
            const sol = b.area / Math.max(1, hullArea(b.pixels));
            if (sol < 0.6 || b.ratio < 0.2) { b.rejected = 'forme'; notHoleShape++; return; }
            b.ragged = true;
            b.k = Math.max(RAGGED, Math.round(b.area / (0.75 * Aref)));
            return;
        }
        const kMax = Math.max(1, Math.min(8, Math.round(1.4 * b.area / Aref)));
        b.kMax = kMax;
        let bestK = 1, bestV = -Infinity;
        for (let k = 1; k <= kMax; k++) {
            const fit = fitDiscs(b.pixels, maskOf(b.comp.id), k, rr, rand);
            b.fits[k] = fit;
            const v = fit.score - penalty * (k - 1);
            if (v > bestV) { bestV = v; bestK = k; }
            else if (k >= bestK + 2) break;              // deux disques de plus sans gain
        }
        b.k = bestK;
    });
    const live = blobs.filter(function (b) { return !b.rejected; });
    const fitOf = function (b, k) {
        if (!b.fits[k]) b.fits[k] = fitDiscs(b.pixels, maskOf(b.comp.id), k, rr, rand);
        return b.fits[k];
    };
    // Nombre de tirs annoncé. Les trous d'arrachement absorbent d'abord l'écart (au
    // prorata de leur aire) ; sinon on ajoute des tirs aux taches qui l'expliquent le
    // mieux (deux plombs dans le même trou), sans jamais supprimer une tache.
    const expected = opts.expectedShots;
    if (expected) {
        const ragged = live.filter(function (b) { return b.ragged; });
        const fixed = live.filter(function (b) { return !b.ragged; }).reduce(function (s, b) { return s + b.k; }, 0);
        if (ragged.length && expected - fixed >= ragged.length) {
            const area = ragged.reduce(function (s, b) { return s + b.area; }, 0);
            let left = expected - fixed;
            ragged.forEach(function (b, i) {
                b.k = i === ragged.length - 1 ? left : Math.max(1, Math.round((expected - fixed) * b.area / area));
                left -= b.k;
            });
        }
        let total = live.reduce(function (s, b) { return s + b.k; }, 0);
        let guard = 0;
        while (total < expected && guard++ < 50 && live.length) {
            let best = null, gain = -Infinity;
            live.forEach(function (b) {
                if (b.ragged || b.k + 1 > b.kMax + 2) return;
                const gn = fitOf(b, b.k + 1).score - fitOf(b, b.k).score;
                if (gn > gain) { gain = gn; best = b; }
            });
            if (!best) break;
            best.k++; total++;
        }
        while (total > expected && guard++ < 100) {
            let best = null, loss = Infinity;
            live.forEach(function (b) {
                if (b.ragged || b.k < 2) return;
                const ls = fitOf(b, b.k).score - fitOf(b, b.k - 1).score;
                if (ls < loss) { loss = ls; best = b; }
            });
            if (!best) break;
            best.k--; total--;
        }
    }
    const half = n / 2;
    const shots = [];
    live.forEach(function (b, bi) {
        // Trou d'arrachement : k-moyennes sur ses pixels, sans affinage (la position
        // de chaque balle n'y est de toute façon pas lisible).
        const centers = b.ragged ? kmeansCenters(b.pixels, b.k, rand) : fitOf(b, b.k).centers;
        centers.forEach(function (c) {
            const u = (c[0] - half) / ppmm, v = (c[1] - half) / ppmm;
            shots.push({
                u: u, v: v,                       // repère cible, mm, v vers le bas
                x: u, y: -v,                      // mm, y vers le haut
                blob: bi, blobShots: b.k, ragged: !!b.ragged,
                doubtful: b.ragged || b.k > 1 || b.ratio < 0.45
            });
        });
    });
    // Trous sombres dans le noir (darkHoles: false pour s'en passer). Sur la validation
    // du jeu de Butt et al. (202 photos), rappel dans le noir de 38,7 à 56,7 %, précision
    // de 82,6 à 80,4 % : deux de ces tirs sur trois sont de vrais trous, d'où la mention
    // « à vérifier ».
    if (opts.darkHoles !== false) {
        darkHolesInBlack(rect, face, am.R, rr, gPx, shots).forEach(function (c) {
            const u = (c[0] - half) / ppmm, v = (c[1] - half) / ppmm;
            shots.push({ u: u, v: v, x: u, y: -v, blob: -1, blobShots: 1, ragged: false, dark: true, doubtful: true });
        });
    }
    return { shots: shots, blobs: live, anomaly: am, mask: opened, Aref: Aref, holePx: 2 * rr, cutByFrame: cutByFrame,
             notHoleShape: notHoleShape,
             threshold: { black: tauZone[0], white: tauZone[1] } };
}

// Cercle par RANSAC (trois points), même contrat que ransacEllipse. Tolérance large
// (4 % du rayon) : le cercle n'est ici qu'une approximation de l'ellipse vue de biais.
function ransacCircle(pts, rand, iters, maxR, seed, accept) {
    const n = pts.length / 2;
    if (n < 10) return null;
    const circ = function (a, b, c) {
        const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(d) < 1e-9) return null;
        const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
        const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
        return [ux, uy, Math.hypot(ax - ux, ay - uy)];
    };
    let best = null, bestIn = 0;
    for (let it = 0; it < iters; it++) {
        const p = [0, 1, 2].map(function () { const i = Math.floor(rand() * n); return [pts[2 * i], pts[2 * i + 1]]; });
        const c = circ(p[0], p[1], p[2]);
        // Rayon borné (sinon un cercle quasi infini, tolérance comprise, avale tous les
        // points) ; le point cliqué doit être dedans.
        if (!c || c[2] < 5 || c[2] > maxR) continue;
        if (seed && Math.hypot(seed[0] - c[0], seed[1] - c[1]) > c[2]) continue;
        const tol = Math.max(1, 0.04 * c[2]);
        let inl = 0;
        for (let i = 0; i < n; i++) if (Math.abs(Math.hypot(pts[2 * i] - c[0], pts[2 * i + 1] - c[1]) - c[2]) < tol) inl++;
        if (inl > bestIn && (!accept || accept({ cx: c[0], cy: c[1], a: c[2], b: c[2], theta: 0 }))) { bestIn = inl; best = c; }
    }
    if (!best) return null;
    // Raffinement algébrique (Kåsa) sur les points conformes.
    for (let r = 0; r < 2; r++) {
        const tol = Math.max(1, 0.04 * best[2]);
        let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0, m = 0;
        for (let i = 0; i < n; i++) {
            const x = pts[2 * i], y = pts[2 * i + 1];
            if (Math.abs(Math.hypot(x - best[0], y - best[1]) - best[2]) >= tol) continue;
            const z = x * x + y * y;
            sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; m++;
        }
        if (m < 5) break;
        const A = [sxx, sxy, sx, sxy, syy, sy, sx, sy, m];
        const sol = solveSPD(Float64Array.from(A), Float64Array.from([sxz, syz, sz]), 3);
        if (!sol) break;
        const cx = sol[0] / 2, cy = sol[1] / 2;
        best = [cx, cy, Math.sqrt(Math.max(1, sol[2] + cx * cx + cy * cy))];
    }
    const tol = Math.max(1, 0.04 * best[2]);
    const bins = new Uint8Array(72);
    let count = 0;
    for (let i = 0; i < n; i++) {
        const x = pts[2 * i], y = pts[2 * i + 1];
        if (Math.abs(Math.hypot(x - best[0], y - best[1]) - best[2]) >= tol) continue;
        count++;
        bins[Math.min(71, Math.floor((Math.atan2(y - best[1], x - best[0]) + Math.PI) / (2 * Math.PI) * 72))] = 1;
    }
    let cov = 0;
    for (let i = 0; i < 72; i++) cov += bins[i];
    return { ellipse: { cx: best[0], cy: best[1], a: best[2], b: best[2], theta: 0 }, coverage: cov / 72, inliers: count };
}

// Visuel désigné par un clic (repli quand la détection automatique échoue) : depuis
// le point cliqué, 360 rayons ; sur chacun, la première sortie du sombre vers un clair
// qui DURE (un trait d'anneau blanc dans le noir ne dure pas) ; une ellipse par RANSAC
// sur ces points — ceux qui longent une arme ou une main posée là sont rejetés.
function ellipseFromSeed(level, sx, sy, rand) {
    const img = level.smooth, w = img.w, h = img.h, d = img.d;
    const win = [];
    const R0 = Math.max(3, Math.round(0.01 * Math.max(w, h)));
    for (let y = Math.max(0, Math.floor(sy - R0)); y <= Math.min(h - 1, Math.floor(sy + R0)); y++) {
        for (let x = Math.max(0, Math.floor(sx - R0)); x <= Math.min(w - 1, Math.floor(sx + R0)); x++) win.push(d[y * w + x]);
    }
    win.sort(function (a, b) { return a - b; });
    const K = win[Math.floor(0.3 * (win.length - 1))];
    const all = Array.from(d).sort(function (a, b) { return a - b; });
    const W = all[Math.floor(0.9 * (all.length - 1))];
    if (W - K < 0.1) return null;
    const t = 0.5 * (K + W);
    const L = Math.max(4, Math.round(0.02 * Math.min(w, h)));
    const pts = [];
    for (let k = 0; k < 360; k++) {
        const a = k / 360 * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
        let inDark = false, runStart = -1;
        for (let r = 1; ; r += 0.5) {
            const x = sx + ca * r, y = sy + sa * r;
            if (x < 1 || y < 1 || x > w - 2 || y > h - 2) break;
            const v = sample(d, w, h, x, y);
            if (!inDark) { if (v < t) inDark = true; continue; }
            if (v >= t) {
                if (runStart < 0) runStart = r;
                if (r - runStart >= L) {
                    // Point de passage au seuil, interpolé entre les deux échantillons.
                    const rb = runStart - 0.5;
                    const v0 = sample(d, w, h, sx + ca * rb, sy + sa * rb), v1 = sample(d, w, h, sx + ca * runStart, sy + sa * runStart);
                    const f = v1 !== v0 ? Math.max(0, Math.min(1, (t - v0) / (v1 - v0))) : 0.5;
                    const re = rb + 0.5 * f;
                    pts.push(sx + ca * re, sy + sa * re);
                    break;
                }
            } else {
                runStart = -1;
            }
        }
    }
    // Une ellipse candidate doit être sombre dedans (45 % des pixels visibles) : sinon
    // le bord rectiligne d'une arme posée devant, partie d'un très grand cercle, gagne.
    const darkInside = function (e) {
        const c = Math.cos(e.theta), sn = Math.sin(e.theta);
        let nIn = 0, nDark = 0;
        for (let k = 0; k < 400; k++) {
            const rr = Math.sqrt((k + 0.5) / 400) * 0.9, a = k * 2.399963;     // spirale de Fermat
            const ex = rr * Math.cos(a) * e.a, ey = rr * Math.sin(a) * e.b;
            const x = e.cx + c * ex - sn * ey, y = e.cy + sn * ex + c * ey;
            const v = sample(d, w, h, x, y);
            if (v !== v) continue;
            nIn++;
            if (v < t) nDark++;
        }
        // Centre dans la photo (à 10 % près) : l'utilisateur a cliqué DANS le visuel.
        if (e.cx < -0.1 * w || e.cy < -0.1 * h || e.cx > 1.1 * w || e.cy > 1.1 * h) return false;
        return nIn >= 40 && nDark >= 0.45 * nIn;
    };
    let R = ransacEllipse(pts, rand, { iters: 600, accept: darkInside });
    // 35 % du pourtour suffit ici : c'est l'utilisateur qui désigne le visuel, souvent
    // coupé par le cadre ou masqué par l'arme posée devant. En deçà, deux arcs ne
    // fixent pas une ellipse (5 paramètres) mais fixent un cercle (3) : on part d'un
    // cercle, que le recalage sur les anneaux intérieurs déformera ensuite.
    if (!R || R.coverage < 0.35) {
        const C = ransacCircle(pts, rand, 800, 0.6 * Math.max(w, h), [sx, sy], darkInside);
        if (!C || C.coverage < 0.15) return null;
        R = C;
    }
    const e = R.ellipse;
    if (e.b / e.a < 0.3) return null;
    // Le point cliqué doit être dans l'ellipse.
    const c = Math.cos(e.theta), sn = Math.sin(e.theta), dx = sx - e.cx, dy = sy - e.cy;
    if (((c * dx + sn * dy) / e.a) ** 2 + ((-sn * dx + c * dy) / e.b) ** 2 > 1) return null;
    e.coverage = R.coverage;
    return e;
}

// ===========================================================================
// 8. Analyse complète
// ===========================================================================

// Options :
//   face          identifiant de cible (FACES) ou objet de même forme ;
//   gauge         diamètre de la jauge, mm (par défaut celui de la cible) ;
//   expectedShots nombre de tirs annoncé (sert à départager les trous communs) ;
//   threshold     seuil des trous en fraction du contraste noir/blanc (par défaut,
//                 adapté au bruit de la photo) ;
//   maxDim        plus grand côté de travail (2000 px par défaut) ;
//   seeds         [{x, y}] : visuels désignés d'un clic (pixels de l'image d'origine) ;
//   ellipses      [{cx, cy, a, b, theta}] : visuels donnés tels quels (idem) ;
//   aligned       visuels d'une analyse précédente de la MÊME image et de la même cible
//                 (result.bulls) : le recalage est repris tel quel, seuls les trous sont
//                 recherchés à nouveau (autre nombre de tirs, autre jauge, autre seuil) ;
//   slim          true : résultat allégé (sans les images de travail), à transmettre
//                 depuis un Web Worker.
function analyze(imageData, options) {
    const opts = options || {};
    const face = getFace(opts.face || 'issf_10m_rifle');
    const gauge = opts.gauge || face.gauge;
    const t0 = Date.now();
    const prep = prepare(imageData, opts.maxDim || 2000);
    const pyr = buildPyramid(prep.gray, prep.chroma, 40);
    // Niveau de détection : le premier dont le grand côté tient dans 700 px.
    let det = 0;
    while (det < pyr.length - 1 && Math.max(pyr[det].w, pyr[det].h) > 700) det++;
    const sDet = 1 << det;
    const notes = [];
    let aligned = null;
    if (opts.aligned && opts.aligned.length && opts.aligned.every(function (b) { return b._bull && b._bull.face === face.id && b._bull.factor === prep.factor; })) {
        aligned = opts.aligned.map(function (b) { return b._bull; });
    }
    let ellipses = [];
    if (aligned) {
        ellipses = aligned.map(function (b) { return b.ellipse; });
    } else if (opts.ellipses && opts.ellipses.length) {
        ellipses = opts.ellipses.map(function (e) {
            return { cx: e.cx / prep.factor, cy: e.cy / prep.factor, a: e.a / prep.factor, b: e.b / prep.factor, theta: e.theta };
        });
    } else if (opts.seeds && opts.seeds.length) {
        const k = prep.factor * sDet, rnd = rng(99);
        opts.seeds.forEach(function (p, i) {
            const e = ellipseFromSeed(pyr[det], p.x / k, p.y / k, rnd);
            if (!e) { notes.push({ code: 'seed-failed', seed: i }); return; }
            ellipses.push({ cx: e.cx * sDet, cy: e.cy * sDet, a: e.a * sDet, b: e.b * sDet, theta: e.theta, roughness: 0,
                            coverage: e.coverage, approximate: e.coverage < 0.5 });
        });
    } else {
        ellipses = detectBulls(pyr[det]).map(function (e) {
            return { cx: e.cx * sDet, cy: e.cy * sDet, a: e.a * sDet, b: e.b * sDet, theta: e.theta, roughness: e.roughness };
        });
    }
    // Première passe : recaler chaque visuel. Seconde passe (plus bas) : chercher les
    // trous de chacun en sachant où sont les autres.
    const recaled = ellipses.map(function (e, bi) {
        if (aligned) {
            const b0 = aligned[bi];
            return { ellipse: b0.ellipse, H: b0.H.slice(), phot: b0.phot.slice(), Rn: b0.Rn, profile: b0.profile, quality: b0.quality };
        }
        const al = alignBull(pyr, e, face, opts);
        const bull = { ellipse: e, H: al.H, phot: al.phot, Rn: al.Rn, profile: al.profile, quality: al.quality };
        uprightFrame(bull);
        return bull;
    });
    const centres = recaled.map(function (b) { return hApply(b.H, 0, 0); });
    const bulls = recaled.map(function (bull, bi) {
        const others = centres.filter(function (_, k) { return k !== bi; });
        // Garde-fou : sous MIN_CORR entre la photo et le dessin recalé, le recalage
        // n'est pas fiable (mauvaise cible choisie, visuel mal trouvé, photo floue) ;
        // on ne compte pas les trous, on le dit.
        const reliable = bull.quality.corr >= MIN_CORR;
        let rect = rectify(pyr, bull, face, gauge, opts, others);
        if (face.bars && !aligned) {
            const phi = barsAngle(rect, face);
            if (Math.abs(phi) > 1e-4) {
                rotateFrame(bull, phi);
                rect = rectify(pyr, bull, face, gauge, opts, others);
            }
        }
        const holes = reliable ? detectHoles(rect, bull, face, gauge, opts) : { shots: [], blobs: [], skipped: true };
        // Incertitude de position d'un centre (heuristique) : 1,5 pixel de la photo, plus
        // un terme du recalage — le défaut de corrélation fois un demi-pas d'anneau. Sur
        // une photo du forum où les anneaux tracés s'écartaient de 2 à 3 mm des anneaux
        // imprimés (corrélation 0,89, pas de 25 mm), il vaut 1,4 mm ; sur une photo nette,
        // quelques centièmes.
        const sigmaPos = 1.5 / rect.native + (1 - Math.min(1, bull.quality.corr)) * 0.5 * ringStep(face);
        holes.shots.forEach(function (s) {
            const r = Math.hypot(s.x, s.y);
            const sc = scoreShot(face, r, gauge);
            s.r = r; s.ring = sc.ring; s.decimal = sc.decimal; s.innerTen = sc.innerTen;
            s.margin = sc.margin;
            s.borderline = sc.margin < sigmaPos;
        });
        bull.face = face.id;
        bull.factor = prep.factor;
        const half = rect.size / 2;
        const out = {
            ellipse: bull.ellipse,
            // Homographie mm (repère cible, v vers le bas) → pixels de l'image d'origine.
            H: toSourceH(bull, prep.factor),
            quality: bull.quality,
            reliable: reliable,
            shots: holes.shots,
            // Taches retenues, en mm : aire (en trous), tirs attribués, trou d'arrachement.
            blobs: (holes.blobs || []).map(function (b) {
                return { u: (b.cx + 0.5 - half) / rect.ppmm, v: (b.cy + 0.5 - half) / rect.ppmm,
                         areaHoles: b.area / holes.Aref, shots: b.k, ragged: !!b.ragged };
            }),
            cutByFrame: holes.cutByFrame || 0,
            notHoleShape: holes.notHoleShape || 0,
            threshold: holes.threshold || null,
            holeDiameterSeen: holes.holePx ? holes.holePx / rect.ppmm : null,
            positionUncertainty: sigmaPos,
            photoPxPerMm: rect.native,
            _bull: bull
        };
        if (!opts.slim) { out.rect = rect; out.holes = holes; }
        return out;
    });
    if (!bulls.length) notes.push({ code: 'no-bull' });
    return {
        version: VERSION,
        face: face.id,
        gauge: gauge,
        width: prep.srcWidth,
        height: prep.srcHeight,
        bulls: bulls,
        notes: notes,
        ms: Date.now() - t0
    };
}

function toSourceH(bull, factor) {
    const Rn = bull.Rn;
    // mm → coordonnées réduites → pixels de travail → pixels d'origine.
    const S = [1 / Rn, 0, 0, 0, 1 / Rn, 0, 0, 0, 1];
    return hNormalize(hScaleImage(hMul(bull.H, S), factor));
}

// Tir rapide 25 m : les traits de visée blancs fixent la rotation de la cible. On
// cherche l'angle (à ±15°, et au quart de tour près si la photo est couchée) qui met
// le plus de clair dans la bande des traits et le plus de noir de part et d'autre.
function barsAngle(rect, face) {
    const n = rect.size, ppmm = rect.ppmm, half = n / 2, b = face.bars;
    const at = function (u, v) {
        const i = Math.floor(u * ppmm + half), j = Math.floor(v * ppmm + half);
        if (i < 0 || j < 0 || i >= n || j >= n || !rect.valid[j * n + i]) return NaN;
        return rect.gray[j * n + i];
    };
    const score = function (phi) {
        const c = Math.cos(phi), s = Math.sin(phi);
        let sb = 0, nb = 0, so = 0, no = 0;
        for (let t = b.from + 5; t <= b.to - 5; t += 1 / ppmm) {
            for (let side = -1; side <= 1; side += 2) {
                const ub = side * t;
                for (let q = -b.width / 4; q <= b.width / 4 + 1e-9; q += b.width / 4) {
                    const g = at(c * ub - s * q, s * ub + c * q);
                    if (g === g) { sb += g; nb++; }
                }
                for (let q = -1; q <= 1; q += 2) {
                    const vq = q * (b.width / 2 + 3);
                    const g = at(c * ub - s * vq, s * ub + c * vq);
                    if (g === g) { so += g; no++; }
                }
            }
        }
        return nb && no ? sb / nb - so / no : -Infinity;
    };
    let best = 0, bs = -Infinity;
    [0, Math.PI / 2].forEach(function (base) {
        for (let d = -15; d <= 15; d += 0.5) {
            const sc = score(base + d * Math.PI / 180);
            if (sc > bs) { bs = sc; best = base + d * Math.PI / 180; }
        }
    });
    for (let d = -0.5; d <= 0.5; d += 0.05) {
        const sc = score(best + d * Math.PI / 180);
        if (sc > bs) { bs = sc; best = best + d * Math.PI / 180; d = -0.5; }
    }
    return best;
}

// Rendu couleur de la cible redressée (pour l'affichage), à partir de l'image
// d'origine : size pixels de côté, couvrant ±rDom mm ; supersample² échantillons
// par pixel (2 par défaut).
function renderRectified(imageData, bullResult, size, rDom, supersample) {
    const W = imageData.width, Hh = imageData.height, src = imageData.data;
    const H = bullResult.H;
    const out = new Uint8ClampedArray(size * size * 4);
    const ppmm = size / (2 * rDom);
    const half = size / 2;
    const ss = supersample || 2;
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            let r = 0, g = 0, b = 0, c = 0;
            for (let sy = 0; sy < ss; sy++) {
                for (let sx = 0; sx < ss; sx++) {
                    const u = (i + (sx + 0.5) / ss - half) / ppmm, v = (j + (sy + 0.5) / ss - half) / ppmm;
                    const x = hApply(H, u, v);
                    const fx = x[0] - 0.5, fy = x[1] - 0.5;
                    const ix = Math.floor(fx), iy = Math.floor(fy);
                    if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= Hh - 1) continue;
                    const ax = fx - ix, ay = fy - iy;
                    const p = (iy * W + ix) * 4;
                    const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
                    r += src[p] * w00 + src[p + 4] * w10 + src[p + 4 * W] * w01 + src[p + 4 * W + 4] * w11;
                    g += src[p + 1] * w00 + src[p + 5] * w10 + src[p + 4 * W + 1] * w01 + src[p + 4 * W + 5] * w11;
                    b += src[p + 2] * w00 + src[p + 6] * w10 + src[p + 4 * W + 2] * w01 + src[p + 4 * W + 6] * w11;
                    c++;
                }
            }
            const q = (j * size + i) * 4;
            if (c) { out[q] = r / c; out[q + 1] = g / c; out[q + 2] = b / c; out[q + 3] = 255; }
            else { out[q] = 128; out[q + 1] = 128; out[q + 2] = 128; out[q + 3] = 255; }
        }
    }
    return { width: size, height: size, data: out };
}

// Ellipse (pixels de l'image d'origine) cliquée à la main → objet accepté par
// analyze({ ellipses }).
function ellipseFromPoints(points) {
    const e = fitEllipse(points);
    if (!e) return null;
    return { cx: e.cx, cy: e.cy, a: e.a, b: e.b, theta: e.theta };
}

return {
    VERSION: VERSION,
    FACES: FACES,
    GAUGES: GAUGES,
    getFace: getFace,
    ringStep: ringStep,
    scoreShot: scoreShot,
    summarize: summarize,
    analyze: analyze,
    renderRectified: renderRectified,
    ellipseFromPoints: ellipseFromPoints,
    hApply: hApply,
    hInv: hInv,
    // Exposés pour les tests.
    _internal: {
        prepare: prepare, buildPyramid: buildPyramid, detectBulls: detectBulls, alignBull: alignBull,
        buildProfile: buildProfile, profileValue: profileValue, profileColor: profileColor, fitEllipse: fitEllipse, edt: edt,
        openDisc: openDisc, fitDiscs: fitDiscs, otsu: otsu, homographyFromEllipse: homographyFromEllipse,
        perspectiveSearch: perspectiveSearch, boostMatrix: boostMatrix, ellipseConic: ellipseConic, sampsonDist: sampsonDist,
        ellipseFromSeed: ellipseFromSeed, ransacCircle: ransacCircle, ransacEllipse: ransacEllipse, buildSamples: buildSamples, rng: rng,
        hScaleImage: hScaleImage, hLocalScale: hLocalScale
    }
};
}));
