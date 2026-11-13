/*!
 * target_scorer_ui.js — interface de comptage des points sur photo de cible ISSF,
 * construite sur target_scorer.js. Sans dépendance.
 *
 *   <link rel="stylesheet" href="target_scorer.css">
 *   <script src="target_scorer.js"></script>
 *   <script src="target_scorer_ui.js"></script>
 *   <div id="scorer"></div>
 *   <script>const ui = TargetScorerUI.mount(document.getElementById('scorer'), { lang: 'fr' });</script>
 *
 * Options de mount : lang ('fr' | 'en'), face (cible par défaut), workerUrl (chemin de
 * target_scorer_worker.js ; déduit de l'adresse de ce script, null pour calculer sans
 * worker). Méthodes : setLang(lang), loadFile(file), loadImageData(imageData).
 *
 * La photo ne quitte jamais le navigateur : tout le calcul est local.
 *
 * Licence MIT.
 */
(function (root) {
'use strict';

const TS = root.TargetScorer;
const SCRIPT_URL = (typeof document !== 'undefined' && document.currentScript) ? document.currentScript.src : null;

const STR = {
    fr: {
        photo: 'Photo de la cible',
        choose: 'Choisir une photo…',
        face: 'Cible',
        gauge: 'Jauge',
        gaugeFace: 'celle de la cible',
        expected: 'Tirs tirés',
        expectedHint: 'facultatif — aide à séparer les trous communs',
        decimal: 'Dixièmes',
        advanced: 'Réglages avancés',
        threshold: 'Seuil de détection des trous',
        thresholdAuto: 'automatique',
        viewRect: 'Cible redressée',
        viewPhoto: 'Photo',
        designate: 'Désigner le visuel',
        designateHelp: 'Cliquez au milieu du visuel noir, sur la photo.',
        reanalyse: 'Relancer la détection',
        zoom: 'Zoom',
        deleteShot: 'Supprimer le tir',
        clearShots: 'Effacer tous les tirs',
        copy: 'Copier le tableau',
        copied: 'Tableau copié.',
        download: 'Image annotée (PNG)',
        bull: 'Visuel',
        analysing: 'Analyse en cours…',
        loading: 'Chargement de la photo…',
        empty: 'Choisissez une photo de cible tirée. Elle reste dans votre navigateur : rien n’est envoyé.',
        editHelp: 'Cliquez sur un trou oublié pour l’ajouter ; cliquez sur un tir pour le sélectionner, faites-le glisser pour le déplacer ; flèches du clavier : 0,1 mm ; Suppr : retirer.',
        noBull: 'Aucun visuel trouvé sur la photo. Utilisez « Désigner le visuel » puis cliquez au milieu du noir.',
        seedFailed: 'Le bord du visuel n’a pas été trouvé autour du point cliqué. Cliquez bien dans le noir, ou reprenez la photo plus droite et plus nette.',
        unreliable: 'Le dessin de la cible ne colle pas à la photo (corrélation {c}) : les trous n’ont pas été comptés. Vérifiez le type de cible, ou désignez le visuel.',
        ragged: 'Trou d’arrachement : {n} tirs attribués d’après sa surface, positions approximatives. Indiquez le nombre de tirs tirés pour les répartir.',
        mismatch: '{f} tirs trouvés pour {e} annoncés : vérifiez la photo, ajoutez ou retirez des tirs.',
        cut: '{n} trou(s) coupé(s) par le bord de la photo, non compté(s).',
        borderline: '{n} tir(s) à moins de {u} mm d’une limite de zone : la photo ne permet pas de trancher, vérifiez à la jauge.',
        unseen: 'Un trou n’apparaît que si ce qu’on voit à travers diffère du papier ET de l’encre : photographiez la cible posée sur un fond de couleur vive (feuille rouge, verte, bleue…).',
        quality: 'Recalage : corrélation {c} ; précision de position estimée ± {u} mm.',
        colN: 'N°', colValue: 'Points', colDecimal: 'Dixièmes', colX: 'Mouche', colPos: 'Position (mm)', colDist: 'Au centre (mm)', colNote: 'Remarque',
        noteManual: 'ajouté', noteMoved: 'déplacé', noteCheck: 'à vérifier', noteLimit: 'limite', noteRagged: 'arrachement', noteDark: 'trou sombre, à vérifier',
        total: 'Total', shots: 'Tirs', innerTens: 'Mouches', mpi: 'Point moyen', spread: 'Plus grand écart', meanRadius: 'Rayon moyen',
        right: 'à droite', left: 'à gauche', up: 'en haut', down: 'en bas',
        noShots: 'Aucun tir.',
        error: 'Erreur : {m}',
        time: 'Analyse en {s} s.'
    },
    en: {
        photo: 'Target photo',
        choose: 'Choose a photo…',
        face: 'Target',
        gauge: 'Gauge',
        gaugeFace: 'the target’s own',
        expected: 'Shots fired',
        expectedHint: 'optional — helps split shared holes',
        decimal: 'Decimals',
        advanced: 'Advanced settings',
        threshold: 'Hole detection threshold',
        thresholdAuto: 'automatic',
        viewRect: 'Rectified target',
        viewPhoto: 'Photo',
        designate: 'Point out the bull',
        designateHelp: 'Click the middle of the black aiming mark, on the photo.',
        reanalyse: 'Run detection again',
        zoom: 'Zoom',
        deleteShot: 'Delete shot',
        clearShots: 'Clear all shots',
        copy: 'Copy table',
        copied: 'Table copied.',
        download: 'Annotated image (PNG)',
        bull: 'Bull',
        analysing: 'Analysing…',
        loading: 'Loading the photo…',
        empty: 'Choose a photo of a shot target. It stays in your browser: nothing is uploaded.',
        editHelp: 'Click a missed hole to add it; click a shot to select it, drag it to move it; arrow keys: 0.1 mm; Delete: remove.',
        noBull: 'No bull found on the photo. Use “Point out the bull”, then click the middle of the black.',
        seedFailed: 'The edge of the bull was not found around the clicked point. Click well inside the black, or retake the photo squarer and sharper.',
        unreliable: 'The target drawing does not match the photo (correlation {c}): holes were not counted. Check the target type, or point out the bull.',
        ragged: 'Ragged hole: {n} shots assigned from its area, positions approximate. Enter the number of shots fired to share them out.',
        mismatch: '{f} shots found for {e} declared: check the photo, add or remove shots.',
        cut: '{n} hole(s) cut by the edge of the photo, not counted.',
        borderline: '{n} shot(s) within {u} mm of a ring boundary: the photo cannot decide, check with a gauge.',
        unseen: 'A hole only shows if what is seen through it differs from both paper AND ink: photograph the target on a brightly coloured background (red, green, blue sheet…).',
        quality: 'Registration: correlation {c}; estimated position accuracy ± {u} mm.',
        colN: 'No.', colValue: 'Score', colDecimal: 'Decimal', colX: 'Inner 10', colPos: 'Position (mm)', colDist: 'From centre (mm)', colNote: 'Note',
        noteManual: 'added', noteMoved: 'moved', noteCheck: 'check', noteLimit: 'borderline', noteRagged: 'ragged', noteDark: 'faint hole, check',
        total: 'Total', shots: 'Shots', innerTens: 'Inner tens', mpi: 'Mean point of impact', spread: 'Extreme spread', meanRadius: 'Mean radius',
        right: 'right', left: 'left', up: 'high', down: 'low',
        noShots: 'No shots.',
        error: 'Error: {m}',
        time: 'Analysed in {s} s.'
    }
};

function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
}

function fmt(lang, x, d) {
    const s = x.toFixed(d);
    return lang === 'fr' ? s.replace('.', ',') : s;
}

function fill(s, vars) {
    return s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
}

function ScorerUI(container, options) {
    this.opts = options || {};
    this.lang = this.opts.lang === 'en' ? 'en' : 'fr';
    this.root = container;
    this.image = null;          // ImageData de travail
    this.result = null;         // résultat (allégé) de TargetScorer.analyze
    this.bullIndex = 0;
    this.shots = [];            // par visuel : [{u, v, origin: 'auto'|'manual'|'moved', doubtful, ragged}]
    this.selected = -1;
    this.view = 'rect';
    this.zoom = 1;
    this.seedMode = false;
    this.busy = false;
    this.reqId = 0;
    this.faceId = this.opts.face && TS.FACES[this.opts.face] ? this.opts.face : 'issf_10m_rifle';
    this.gaugeChoice = '';      // '' = jauge de la cible
    this.decimal = TS.FACES[this.faceId].decimal;
    this.rendered = null;       // { key, canvas } : rendu redressé en cache
    this.worker = null;
    this.workerUrl = this.opts.workerUrl !== undefined ? this.opts.workerUrl
        : (SCRIPT_URL ? SCRIPT_URL.replace(/target_scorer_ui\.js(\?.*)?$/, 'target_scorer_worker.js$1') : null);
    this.build();
    this.setLang(this.lang);
}

ScorerUI.prototype.t = function (k) { return STR[this.lang][k] || STR.fr[k] || k; };

ScorerUI.prototype.build = function () {
    const self = this;
    this.root.classList.add('tsc');
    this.root.innerHTML = '';

    // Réglages.
    this.fileInput = el('input', { type: 'file', accept: 'image/*', class: 'tsc-file' });
    this.fileLabel = el('label', { class: 'tsc-button tsc-primary' }, [this.fileInput, el('span', { class: 'tsc-file-text' })]);
    this.faceSelect = el('select', { class: 'tsc-face' });
    Object.keys(TS.FACES).forEach(function (k) { self.faceSelect.appendChild(el('option', { value: k })); });
    this.faceSelect.value = this.faceId;
    this.gaugeSelect = el('select', { class: 'tsc-gauge' });
    this.gaugeSelect.appendChild(el('option', { value: '' }));
    TS.GAUGES.forEach(function (g) { self.gaugeSelect.appendChild(el('option', { value: String(g.d) })); });
    this.expectedInput = el('input', { type: 'number', min: '1', max: '200', step: '1', class: 'tsc-expected', inputmode: 'numeric' });
    this.decimalBox = el('input', { type: 'checkbox', class: 'tsc-decimal' });
    this.thresholdRange = el('input', { type: 'range', min: '0', max: '60', step: '1', value: '0', class: 'tsc-threshold' });
    this.thresholdValue = el('span', { class: 'tsc-threshold-value' });

    const field = function (labelKey, input, hintKey) {
        const lab = el('label', { class: 'tsc-field' }, [el('span', { class: 'tsc-label', 'data-k': labelKey }), input]);
        if (hintKey) lab.appendChild(el('span', { class: 'tsc-hint', 'data-k': hintKey }));
        return lab;
    };
    this.advanced = el('details', { class: 'tsc-advanced' }, [
        el('summary', { 'data-k': 'advanced' }),
        el('label', { class: 'tsc-field' }, [el('span', { class: 'tsc-label', 'data-k': 'threshold' }), this.thresholdRange, this.thresholdValue])
    ]);
    const controls = el('div', { class: 'tsc-controls' }, [
        el('div', { class: 'tsc-field tsc-photo' }, [el('span', { class: 'tsc-label', 'data-k': 'photo' }), this.fileLabel]),
        field('face', this.faceSelect),
        field('gauge', this.gaugeSelect),
        field('expected', this.expectedInput, 'expectedHint'),
        el('label', { class: 'tsc-field tsc-check' }, [this.decimalBox, el('span', { 'data-k': 'decimal' })])
    ]);

    // Barre de la vue.
    this.tabRect = el('button', { type: 'button', class: 'tsc-tab', 'data-k': 'viewRect' });
    this.tabPhoto = el('button', { type: 'button', class: 'tsc-tab', 'data-k': 'viewPhoto' });
    this.bullSelect = el('select', { class: 'tsc-bull', hidden: '' });
    this.zoomSelect = el('select', { class: 'tsc-zoom' });
    [1, 2, 3, 4].forEach(function (z) { self.zoomSelect.appendChild(el('option', { value: String(z), text: z + '×' })); });
    this.designateBtn = el('button', { type: 'button', class: 'tsc-button', 'data-k': 'designate' });
    this.reanalyseBtn = el('button', { type: 'button', class: 'tsc-button', 'data-k': 'reanalyse' });
    this.deleteBtn = el('button', { type: 'button', class: 'tsc-button', 'data-k': 'deleteShot', disabled: '' });
    this.clearBtn = el('button', { type: 'button', class: 'tsc-button', 'data-k': 'clearShots' });
    const bar = el('div', { class: 'tsc-bar' }, [
        el('div', { class: 'tsc-tabs', role: 'tablist' }, [this.tabRect, this.tabPhoto]),
        this.bullSelect,
        el('label', { class: 'tsc-inline' }, [el('span', { 'data-k': 'zoom' }), this.zoomSelect]),
        this.designateBtn, this.reanalyseBtn, this.deleteBtn, this.clearBtn
    ]);

    this.canvas = el('canvas', { class: 'tsc-canvas', tabindex: '0' });
    this.viewport = el('div', { class: 'tsc-viewport' }, [this.canvas]);
    this.status = el('div', { class: 'tsc-status', role: 'status', 'aria-live': 'polite' });
    this.messages = el('ul', { class: 'tsc-messages' });
    this.help = el('p', { class: 'tsc-help', 'data-k': 'editHelp' });

    this.summary = el('div', { class: 'tsc-summary' });
    this.table = el('table', { class: 'tsc-table' });
    this.copyBtn = el('button', { type: 'button', class: 'tsc-button', 'data-k': 'copy' });
    this.downloadBtn = el('button', { type: 'button', class: 'tsc-button', 'data-k': 'download' });
    const exportBar = el('div', { class: 'tsc-export' }, [this.copyBtn, this.downloadBtn]);

    this.root.appendChild(controls);
    this.root.appendChild(this.advanced);
    this.root.appendChild(bar);
    this.root.appendChild(this.status);
    this.root.appendChild(this.viewport);
    this.root.appendChild(this.help);
    this.root.appendChild(this.messages);
    this.root.appendChild(this.summary);
    this.root.appendChild(el('div', { class: 'tsc-table-wrap' }, [this.table]));
    this.root.appendChild(exportBar);

    // Évènements.
    this.fileInput.addEventListener('change', function () {
        if (self.fileInput.files && self.fileInput.files[0]) self.loadFile(self.fileInput.files[0]);
    });
    this.faceSelect.addEventListener('change', function () {
        self.faceId = self.faceSelect.value;
        self.decimal = TS.FACES[self.faceId].decimal;
        self.decimalBox.checked = self.decimal;
        self.refreshGaugeLabel();
        self.run({ full: true });
    });
    this.gaugeSelect.addEventListener('change', function () { self.gaugeChoice = self.gaugeSelect.value; self.run({ full: false }); });
    this.expectedInput.addEventListener('change', function () { self.run({ full: false }); });
    this.decimalBox.addEventListener('change', function () { self.decimal = self.decimalBox.checked; self.renderTable(); });
    this.thresholdRange.addEventListener('input', function () { self.refreshThresholdLabel(); });
    this.thresholdRange.addEventListener('change', function () { self.run({ full: false }); });
    this.tabRect.addEventListener('click', function () { self.setView('rect'); });
    this.tabPhoto.addEventListener('click', function () { self.setView('photo'); });
    this.bullSelect.addEventListener('change', function () { self.bullIndex = +self.bullSelect.value; self.selected = -1; self.rendered = null; self.draw(); self.renderTable(); });
    this.zoomSelect.addEventListener('change', function () { self.zoom = +self.zoomSelect.value; self.rendered = null; self.draw(); });
    this.designateBtn.addEventListener('click', function () {
        self.seedMode = !self.seedMode;
        self.designateBtn.classList.toggle('tsc-active', self.seedMode);
        if (self.seedMode) { self.setView('photo'); self.setStatus(self.t('designateHelp')); }
    });
    this.reanalyseBtn.addEventListener('click', function () { self.run({ full: true }); });
    this.deleteBtn.addEventListener('click', function () { self.deleteSelected(); });
    this.clearBtn.addEventListener('click', function () { self.shots[self.bullIndex] = []; self.selected = -1; self.draw(); self.renderTable(); });
    this.copyBtn.addEventListener('click', function () { self.copyTable(); });
    this.downloadBtn.addEventListener('click', function () { self.downloadImage(); });
    this.bindCanvas();
    if (typeof window !== 'undefined') {
        let pending = null;
        window.addEventListener('resize', function () {
            clearTimeout(pending);
            pending = setTimeout(function () { self.rendered = null; self.draw(); }, 150);
        });
    }
};

ScorerUI.prototype.setLang = function (lang) {
    const self = this;
    this.lang = lang === 'en' ? 'en' : 'fr';
    this.root.querySelectorAll('[data-k]').forEach(function (n) { n.textContent = self.t(n.getAttribute('data-k')); });
    this.root.querySelector('.tsc-file-text').textContent = this.t('choose');
    Array.prototype.forEach.call(this.faceSelect.options, function (o) { o.textContent = TS.FACES[o.value].name[self.lang]; });
    TS.GAUGES.forEach(function (g, i) { self.gaugeSelect.options[i + 1].textContent = g.name[self.lang]; });
    this.refreshGaugeLabel();
    this.refreshThresholdLabel();
    this.decimalBox.checked = this.decimal;
    this.setView(this.view);
    if (!this.image) this.setStatus(this.t('empty'));
    this.renderMessages();
    this.renderTable();
    this.draw();
};

ScorerUI.prototype.refreshGaugeLabel = function () {
    const face = TS.FACES[this.faceId];
    this.gaugeSelect.options[0].textContent = this.t('gaugeFace') + ' (' + fmt(this.lang, face.gauge, face.gauge % 1 ? 2 : 1) + ' mm)';
};

ScorerUI.prototype.refreshThresholdLabel = function () {
    const v = +this.thresholdRange.value;
    this.thresholdValue.textContent = v ? fmt(this.lang, v / 100, 2) : this.t('thresholdAuto');
};

ScorerUI.prototype.gauge = function () {
    return this.gaugeChoice ? +this.gaugeChoice : TS.FACES[this.faceId].gauge;
};

ScorerUI.prototype.setStatus = function (text, kind) {
    this.status.textContent = text || '';
    this.status.className = 'tsc-status' + (kind ? ' tsc-' + kind : '');
};

ScorerUI.prototype.setView = function (v) {
    this.view = v;
    this.tabRect.classList.toggle('tsc-active', v === 'rect');
    this.tabPhoto.classList.toggle('tsc-active', v === 'photo');
    this.tabRect.setAttribute('aria-selected', v === 'rect');
    this.tabPhoto.setAttribute('aria-selected', v === 'photo');
    this.rendered = null;
    this.draw();
};

// ---------------------------------------------------------------------------
// Chargement de la photo
// ---------------------------------------------------------------------------

ScorerUI.prototype.loadFile = function (file) {
    const self = this;
    this.setStatus(this.t('loading'));
    const done = function (source, w, h) {
        // Au-delà de 2600 px de côté, rien n'est gagné (l'analyse travaille à 2000).
        const k = Math.min(1, 2600 / Math.max(w, h));
        const cw = Math.round(w * k), ch = Math.round(h * k);
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        ctx.drawImage(source, 0, 0, cw, ch);
        self.loadImageData(ctx.getImageData(0, 0, cw, ch));
    };
    // createImageBitmap applique l'orientation EXIF (photo de téléphone tenu debout).
    if (typeof createImageBitmap === 'function') {
        createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) { done(bmp, bmp.width, bmp.height); })
            .catch(function () { self.loadViaImg(file, done); });
    } else {
        this.loadViaImg(file, done);
    }
};

ScorerUI.prototype.loadViaImg = function (file, done) {
    const self = this;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); done(img, img.naturalWidth, img.naturalHeight); };
    img.onerror = function () { URL.revokeObjectURL(url); self.setStatus(fill(self.t('error'), { m: 'image' }), 'error'); };
    img.src = url;
};

ScorerUI.prototype.loadImageData = function (imageData) {
    this.image = imageData;
    this.photoCanvas = document.createElement('canvas');
    this.photoCanvas.width = imageData.width; this.photoCanvas.height = imageData.height;
    this.photoCanvas.getContext('2d').putImageData(imageData, 0, 0);
    this.result = null;
    this.shots = [];
    this.selected = -1;
    this.bullIndex = 0;
    this.rendered = null;
    this.run({ full: true });
};

// ---------------------------------------------------------------------------
// Analyse (dans un worker si possible)
// ---------------------------------------------------------------------------

ScorerUI.prototype.compute = function (options) {
    const self = this;
    const image = { width: this.image.width, height: this.image.height, data: this.image.data };
    if (this.workerUrl && typeof Worker !== 'undefined' && this.worker !== false) {
        try {
            if (!this.worker) {
                this.worker = new Worker(this.workerUrl);
                this.workerWaiting = {};
                this.worker.onmessage = function (e) {
                    const w = self.workerWaiting[e.data.id];
                    if (!w) return;
                    delete self.workerWaiting[e.data.id];
                    if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data.result);
                };
                this.worker.onerror = function () {
                    // Worker indisponible (fichier local, politique de sécurité) : calcul
                    // dans la page.
                    self.worker = false;
                    Object.keys(self.workerWaiting).forEach(function (id) {
                        const w = self.workerWaiting[id];
                        delete self.workerWaiting[id];
                        self.computeInline(image, options).then(w.resolve, w.reject);
                    });
                };
            }
            const id = ++this.reqId;
            return new Promise(function (resolve, reject) {
                self.workerWaiting[id] = { resolve: resolve, reject: reject };
                self.worker.postMessage({ id: id, image: image, options: options });
            });
        } catch (err) {
            this.worker = false;
        }
    }
    return this.computeInline(image, options);
};

ScorerUI.prototype.computeInline = function (image, options) {
    return new Promise(function (resolve, reject) {
        // Laisser au navigateur le temps d'afficher « Analyse en cours… ».
        setTimeout(function () {
            try { resolve(TS.analyze(image, Object.assign({}, options, { slim: true }))); } catch (err) { reject(err); }
        }, 30);
    });
};

ScorerUI.prototype.run = function (how) {
    if (!this.image) return;
    const self = this;
    const full = how && how.full;
    const options = {
        face: this.faceId,
        gauge: this.gauge(),
        expectedShots: +this.expectedInput.value || undefined,
        threshold: +this.thresholdRange.value ? +this.thresholdRange.value / 100 : undefined
    };
    if (how && how.seeds) options.seeds = how.seeds;
    else if (!full && this.result && this.result.face === this.faceId && this.result.bulls.length) options.aligned = this.result.bulls;
    // Les tirs ajoutés ou déplacés à la main survivent à une nouvelle détection.
    const kept = this.shots.map(function (list) { return (list || []).filter(function (s) { return s.origin !== 'auto'; }); });
    const keepBull = options.aligned ? this.bullIndex : 0;
    this.busy = true;
    this.root.classList.add('tsc-busy');
    this.setStatus(this.t('analysing'));
    const t0 = Date.now();
    this.compute(options).then(function (res) {
        self.busy = false;
        self.root.classList.remove('tsc-busy');
        self.result = res;
        self.bullIndex = Math.min(keepBull, Math.max(0, res.bulls.length - 1));
        self.shots = res.bulls.map(function (b, i) {
            const auto = b.shots.map(function (s) {
                return { u: s.u, v: s.v, origin: 'auto', doubtful: s.doubtful, ragged: s.ragged, dark: s.dark };
            });
            return auto.concat(options.aligned && kept[i] ? kept[i] : []);
        });
        self.selected = -1;
        self.rendered = null;
        self.seedMode = false;
        self.designateBtn.classList.remove('tsc-active');
        self.fillBullSelect();
        self.setStatus(fill(self.t('time'), { s: fmt(self.lang, (Date.now() - t0) / 1000, 1) }));
        if (!res.bulls.length && self.view === 'rect') self.setView('photo');
        self.renderMessages();
        self.renderTable();
        self.draw();
    }).catch(function (err) {
        self.busy = false;
        self.root.classList.remove('tsc-busy');
        self.setStatus(fill(self.t('error'), { m: err.message || String(err) }), 'error');
    });
};

ScorerUI.prototype.fillBullSelect = function () {
    const self = this;
    const n = this.result ? this.result.bulls.length : 0;
    this.bullSelect.innerHTML = '';
    for (let i = 0; i < n; i++) this.bullSelect.appendChild(el('option', { value: String(i), text: self.t('bull') + ' ' + (i + 1) }));
    this.bullSelect.value = String(this.bullIndex);
    if (n > 1) this.bullSelect.removeAttribute('hidden'); else this.bullSelect.setAttribute('hidden', '');
};

// ---------------------------------------------------------------------------
// Tirs et notation
// ---------------------------------------------------------------------------

ScorerUI.prototype.bull = function () {
    return this.result && this.result.bulls[this.bullIndex] || null;
};

ScorerUI.prototype.currentShots = function () {
    return this.shots[this.bullIndex] || [];
};

// Tirs notés et triés (valeur décroissante) ; index = position dans currentShots().
ScorerUI.prototype.scored = function () {
    const face = TS.FACES[this.faceId], g = this.gauge();
    const b = this.bull();
    const unc = b ? b.positionUncertainty : 0;
    const list = this.currentShots().map(function (s, i) {
        const r = Math.hypot(s.u, s.v);
        const sc = TS.scoreShot(face, r, g);
        return { index: i, shot: s, r: r, x: s.u, y: -s.v, ring: sc.ring, decimal: sc.decimal, innerTen: sc.innerTen,
                 borderline: s.origin === 'auto' && sc.margin < unc };
    });
    list.sort(function (a, b2) { return (b2.decimal - a.decimal) || (a.r - b2.r); });
    list.forEach(function (o, k) { o.n = k + 1; });
    return list;
};

ScorerUI.prototype.deleteSelected = function () {
    if (this.selected < 0) return;
    this.currentShots().splice(this.selected, 1);
    this.selected = -1;
    this.draw();
    this.renderTable();
};

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

// Rayon (mm) montré dans la vue redressée : la cible entière, sauf si la photo n'en
// couvre qu'une partie — on cadre alors sur ce qui a été photographié.
ScorerUI.prototype.domain = function () {
    const face = TS.FACES[this.faceId];
    const full = face.rings[0] / 2 + 2 * this.gauge();
    const b = this.bull();
    if (!b || !this.image) return full;
    const Hi = TS.hInv(b.H), W = this.image.width, H = this.image.height;
    let far = 0;
    for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        [[t * W, 0], [t * W, H], [0, t * H], [W, t * H]].forEach(function (p) {
            const q = TS.hApply(Hi, p[0], p[1]);
            const r = Math.hypot(q[0], q[1]);
            if (r > far) far = r;
        });
    }
    return Math.max(0.3 * full, Math.min(full, far));
};

ScorerUI.prototype.canvasSize = function () {
    const w = Math.max(240, Math.min(this.viewport.clientWidth || 600, 900));
    return w;
};

ScorerUI.prototype.draw = function () {
    const ctx = this.canvas.getContext('2d');
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (!this.image) {
        const w = this.canvasSize();
        this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(w * 0.5 * dpr);
        this.canvas.style.width = w + 'px'; this.canvas.style.height = (w * 0.5) + 'px';
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.updateButtons();
        return;
    }
    if (this.view === 'rect' && this.bull()) this.drawRect(ctx, dpr);
    else this.drawPhoto(ctx, dpr);
    this.updateButtons();
};

ScorerUI.prototype.updateButtons = function () {
    const has = !!this.bull();
    this.deleteBtn.disabled = this.selected < 0;
    this.clearBtn.disabled = !has || !this.currentShots().length;
    this.copyBtn.disabled = !has;
    this.downloadBtn.disabled = !has;
    this.reanalyseBtn.disabled = !this.image || this.busy;
    this.designateBtn.disabled = !this.image;
    this.tabRect.disabled = !has;
    this.zoomSelect.disabled = this.view !== 'rect' || !has;
};

// Vue redressée : la cible de face, à l'échelle, sans perspective.
ScorerUI.prototype.drawRect = function (ctx, dpr) {
    const cssW = this.canvasSize() * this.zoom;
    const size = Math.round(cssW * dpr);
    const rDom = this.domain();
    const key = [this.bullIndex, size, rDom, this.result && this.result.ms].join('/');
    if (!this.rendered || this.rendered.key !== key) {
        const img = TS.renderRectified(this.image, this.bull(), size, rDom, size > 1600 ? 1 : 2);
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        c.getContext('2d').putImageData(new ImageData(img.data, size, size), 0, 0);
        this.rendered = { key: key, canvas: c };
    }
    this.canvas.width = size; this.canvas.height = size;
    this.canvas.style.width = cssW + 'px'; this.canvas.style.height = cssW + 'px';
    ctx.drawImage(this.rendered.canvas, 0, 0);
    this.ppm = size / (2 * rDom);                 // pixels (canevas) par mm
    this.drawOverlay(ctx, size, this.ppm, dpr);
};

ScorerUI.prototype.drawOverlay = function (ctx, size, ppm, dpr) {
    const face = TS.FACES[this.faceId], g = this.gauge();
    const c = size / 2;
    ctx.save();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.85)';
    face.rings.forEach(function (d) { ctx.beginPath(); ctx.arc(c, c, d / 2 * ppm, 0, 2 * Math.PI); ctx.stroke(); });
    if (face.innerTen && face.innerTen.kind === 'ring') {
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath(); ctx.arc(c, c, face.innerTen.diameter / 2 * ppm, 0, 2 * Math.PI); ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.moveTo(c - 6 * dpr, c); ctx.lineTo(c + 6 * dpr, c); ctx.moveTo(c, c - 6 * dpr); ctx.lineTo(c, c + 6 * dpr); ctx.stroke();
    const self = this;
    const list = this.scored();
    const font = Math.round(11 * dpr);
    ctx.font = 'bold ' + font + 'px system-ui, sans-serif';
    list.forEach(function (o) {
        const s = o.shot;
        const x = c + s.u * ppm, y = c + s.v * ppm, r = g / 2 * ppm;
        const sel = o.index === self.selected;
        const col = sel ? 'rgba(37, 99, 235, 1)' : (s.origin !== 'auto' ? 'rgba(124, 58, 237, 1)' : (s.doubtful || o.borderline ? 'rgba(245, 158, 11, 1)' : 'rgba(225, 29, 72, 1)'));
        ctx.lineWidth = (sel ? 3 : 2) * dpr;
        ctx.strokeStyle = col;
        ctx.fillStyle = col.replace(', 1)', ', 0.18)');
        if (s.doubtful || o.borderline) ctx.setLineDash([3 * dpr, 2 * dpr]);
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, y, 1.5 * dpr, 0, 2 * Math.PI); ctx.fillStyle = col; ctx.fill();
        if (s.ragged && !sel) return;          // trou d'arrachement : pas de numéros empilés
        const label = String(o.n);
        const tx = x + r * 0.75 + 2 * dpr, ty = y - r * 0.75 - 2 * dpr;
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeText(label, tx, ty);
        ctx.fillStyle = col; ctx.fillText(label, tx, ty);
    });
    ctx.restore();
};

// Vue photo : l'image d'origine, les anneaux projetés par le recalage.
ScorerUI.prototype.drawPhoto = function (ctx, dpr) {
    const W = this.image.width, H = this.image.height;
    const cssW = this.canvasSize();
    const k = cssW / W, cssH = H * k;
    this.canvas.width = Math.round(cssW * dpr); this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px'; this.canvas.style.height = cssH + 'px';
    const s = k * dpr;
    this.photoScale = s;
    ctx.drawImage(this.photoCanvas, 0, 0, W * s, H * s);
    if (!this.result) return;
    const face = TS.FACES[this.faceId], g = this.gauge();
    const self = this;
    this.result.bulls.forEach(function (b, bi) {
        ctx.save();
        ctx.lineWidth = Math.max(1, dpr);
        ctx.strokeStyle = bi === self.bullIndex ? 'rgba(0, 200, 255, 0.9)' : 'rgba(0, 200, 255, 0.45)';
        face.rings.forEach(function (d) {
            ctx.beginPath();
            for (let a = 0; a <= 96; a++) {
                const t = a / 96 * 2 * Math.PI, p = TS.hApply(b.H, Math.cos(t) * d / 2, Math.sin(t) * d / 2);
                if (a) ctx.lineTo(p[0] * s, p[1] * s); else ctx.moveTo(p[0] * s, p[1] * s);
            }
            ctx.stroke();
        });
        (self.shots[bi] || []).forEach(function (sh) {
            ctx.beginPath();
            for (let a = 0; a <= 24; a++) {
                const t = a / 24 * 2 * Math.PI, p = TS.hApply(b.H, sh.u + Math.cos(t) * g / 2, sh.v + Math.sin(t) * g / 2);
                if (a) ctx.lineTo(p[0] * s, p[1] * s); else ctx.moveTo(p[0] * s, p[1] * s);
            }
            ctx.strokeStyle = 'rgba(225, 29, 72, 1)';
            ctx.lineWidth = 2 * dpr;
            ctx.stroke();
        });
        ctx.restore();
    });
};

// ---------------------------------------------------------------------------
// Souris, doigt, clavier
// ---------------------------------------------------------------------------

ScorerUI.prototype.bindCanvas = function () {
    const self = this;
    let drag = null;
    const pos = function (e) {
        const r = self.canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * self.canvas.width / r.width, (e.clientY - r.top) * self.canvas.height / r.height];
    };
    const toMM = function (p) {
        const c = self.canvas.width / 2;
        return [(p[0] - c) / self.ppm, (p[1] - c) / self.ppm];
    };
    this.canvas.addEventListener('pointerdown', function (e) {
        if (!self.image || self.busy) return;
        const p = pos(e);
        if (self.view === 'photo') {
            if (self.seedMode) {
                const s = self.photoScale;
                self.run({ full: true, seeds: [{ x: p[0] / s, y: p[1] / s }] });
            }
            return;
        }
        if (!self.bull()) return;
        const mm = toMM(p);
        const shots = self.currentShots();
        const g = self.gauge();
        let hit = -1, best = Infinity;
        shots.forEach(function (s, i) {
            const d = Math.hypot(s.u - mm[0], s.v - mm[1]);
            if (d < best) { best = d; hit = i; }
        });
        const tol = Math.max(g / 2, 10 / self.ppm);
        if (hit >= 0 && best <= tol) {
            self.selected = hit;
            drag = { index: hit, start: mm, orig: [shots[hit].u, shots[hit].v], moved: false };
        } else {
            if (Math.hypot(mm[0], mm[1]) > self.domain()) return;
            if (!self.shots[self.bullIndex]) self.shots[self.bullIndex] = [];
            self.shots[self.bullIndex].push({ u: mm[0], v: mm[1], origin: 'manual' });
            self.selected = self.shots[self.bullIndex].length - 1;
            drag = { index: self.selected, start: mm, orig: mm.slice(), moved: false };
        }
        self.canvas.setPointerCapture(e.pointerId);
        self.canvas.focus({ preventScroll: true });
        self.draw();
        self.renderTable();
        e.preventDefault();
    });
    this.canvas.addEventListener('pointermove', function (e) {
        if (!drag) return;
        const mm = toMM(pos(e));
        const s = self.currentShots()[drag.index];
        if (!s) return;
        const du = mm[0] - drag.start[0], dv = mm[1] - drag.start[1];
        if (!drag.moved && Math.hypot(du, dv) * self.ppm < 3) return;
        drag.moved = true;
        s.u = drag.orig[0] + du; s.v = drag.orig[1] + dv;
        if (s.origin === 'auto') s.origin = 'moved';
        self.draw();
    });
    const end = function () { if (drag) { drag = null; self.renderTable(); } };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('keydown', function (e) {
        if (self.selected < 0) return;
        const s = self.currentShots()[self.selected];
        if (!s) return;
        const step = e.shiftKey ? 1 : 0.1;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            s.u += moves[e.key][0]; s.v += moves[e.key][1];
            if (s.origin === 'auto') s.origin = 'moved';
            self.draw(); self.renderTable();
            e.preventDefault();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            self.deleteSelected();
            e.preventDefault();
        } else if (e.key === 'Escape') {
            self.selected = -1; self.draw(); self.renderTable();
        }
    });
};

// ---------------------------------------------------------------------------
// Messages, tableau, bilan
// ---------------------------------------------------------------------------

ScorerUI.prototype.renderMessages = function () {
    const self = this;
    this.messages.innerHTML = '';
    const add = function (text, kind) { self.messages.appendChild(el('li', { class: 'tsc-msg' + (kind ? ' tsc-' + kind : ''), text: text })); };
    if (!this.result) return;
    const r = this.result;
    r.notes.forEach(function (n) {
        if (n.code === 'no-bull') add(self.t('noBull'), 'warn');
        if (n.code === 'seed-failed') add(self.t('seedFailed'), 'warn');
    });
    const b = this.bull();
    if (!b) return;
    if (!b.reliable) add(fill(this.t('unreliable'), { c: fmt(this.lang, b.quality.corr, 2) }), 'warn');
    b.blobs.forEach(function (bl) { if (bl.ragged) add(fill(self.t('ragged'), { n: bl.shots }), 'warn'); });
    const expected = +this.expectedInput.value;
    const found = this.currentShots().length;
    if (expected && found !== expected && b.reliable) add(fill(this.t('mismatch'), { f: found, e: expected }), 'warn');
    if (b.cutByFrame) add(fill(this.t('cut'), { n: b.cutByFrame }));
    const limit = this.scored().filter(function (o) { return o.borderline; }).length;
    if (limit) add(fill(this.t('borderline'), { n: limit, u: fmt(this.lang, b.positionUncertainty, 2) }));
    add(fill(this.t('quality'), { c: fmt(this.lang, b.quality.corr, 3), u: fmt(this.lang, b.positionUncertainty, 2) }), 'info');
    add(this.t('unseen'), 'info');
};

ScorerUI.prototype.renderTable = function () {
    const self = this;
    const L = this.lang;
    this.table.innerHTML = '';
    this.summary.innerHTML = '';
    const b = this.bull();
    if (!b) return;
    const list = this.scored();
    const head = el('tr', null, ['colN', 'colValue'].concat(this.decimal ? ['colDecimal'] : [], ['colX', 'colPos', 'colDist', 'colNote'])
        .map(function (k) { return el('th', { scope: 'col', text: self.t(k) }); }));
    this.table.appendChild(el('thead', null, [head]));
    const body = el('tbody');
    list.forEach(function (o) {
        const notes = [];
        if (o.shot.origin === 'manual') notes.push(self.t('noteManual'));
        if (o.shot.origin === 'moved') notes.push(self.t('noteMoved'));
        if (o.shot.ragged) notes.push(self.t('noteRagged'));
        else if (o.shot.dark && o.shot.origin === 'auto') notes.push(self.t('noteDark'));
        else if (o.shot.doubtful && o.shot.origin === 'auto') notes.push(self.t('noteCheck'));
        if (o.borderline) notes.push(self.t('noteLimit'));
        const cells = [String(o.n), String(o.ring)].concat(self.decimal ? [fmt(L, o.decimal, 1)] : [],
            [o.innerTen ? '✓' : '', fmt(L, o.x, 1) + ' ; ' + fmt(L, o.y, 1), fmt(L, o.r, 1), notes.join(', ')]);
        const tr = el('tr', { class: o.index === self.selected ? 'tsc-selected' : '' }, cells.map(function (c) { return el('td', { text: c }); }));
        tr.addEventListener('click', function () { self.selected = o.index; self.setView('rect'); self.renderTable(); });
        body.appendChild(tr);
    });
    if (!list.length) body.appendChild(el('tr', null, [el('td', { colspan: '7', text: this.t('noShots') })]));
    this.table.appendChild(body);

    const sum = TS.summarize(list.map(function (o) { return { x: o.x, y: o.y }; }), this.faceId, this.gauge());
    const dir = function (v, pos, neg) { return fmt(L, Math.abs(v), 1) + ' mm ' + self.t(v >= 0 ? pos : neg); };
    const items = [
        [this.t('total'), String(sum.total) + (this.decimal ? ' (' + fmt(L, sum.totalDecimal, 1) + ')' : '')],
        [this.t('shots'), String(sum.count)],
        [this.t('innerTens'), String(sum.innerTens)]
    ];
    if (sum.mpi) items.push([this.t('mpi'), dir(sum.mpi.x, 'right', 'left') + ', ' + dir(sum.mpi.y, 'up', 'down')]);
    if (sum.extremeSpread != null) items.push([this.t('spread'), fmt(L, sum.extremeSpread, 1) + ' mm']);
    if (sum.meanRadius != null && sum.count > 1) items.push([this.t('meanRadius'), fmt(L, sum.meanRadius, 1) + ' mm']);
    this.summary.appendChild(el('dl', null, [].concat.apply([], items.map(function (it) {
        return [el('dt', { text: it[0] }), el('dd', { text: it[1] })];
    }))));
    this.renderMessages();
    this.updateButtons();
};

ScorerUI.prototype.tableText = function () {
    const self = this, L = this.lang;
    const list = this.scored();
    const lines = [[this.t('colN'), this.t('colValue')].concat(this.decimal ? [this.t('colDecimal')] : [], [this.t('colX'), 'x (mm)', 'y (mm)', this.t('colDist')]).join('\t')];
    list.forEach(function (o) {
        lines.push([o.n, o.ring].concat(self.decimal ? [fmt(L, o.decimal, 1)] : [], [o.innerTen ? 'X' : '', fmt(L, o.x, 2), fmt(L, o.y, 2), fmt(L, o.r, 2)]).join('\t'));
    });
    const sum = TS.summarize(list.map(function (o) { return { x: o.x, y: o.y }; }), this.faceId, this.gauge());
    lines.push('');
    lines.push(this.t('total') + '\t' + sum.total + (this.decimal ? '\t' + fmt(L, sum.totalDecimal, 1) : ''));
    lines.push(this.t('innerTens') + '\t' + sum.innerTens);
    lines.push(TS.FACES[this.faceId].name[L] + '\t' + fmt(L, this.gauge(), 2) + ' mm');
    return lines.join('\n');
};

ScorerUI.prototype.copyTable = function () {
    const self = this;
    const text = this.tableText();
    const ok = function () { self.setStatus(self.t('copied')); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, function () { self.copyFallback(text); ok(); });
    } else {
        this.copyFallback(text); ok();
    }
};

ScorerUI.prototype.copyFallback = function (text) {
    const ta = el('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* rien */ }
    document.body.removeChild(ta);
};

ScorerUI.prototype.downloadImage = function () {
    if (!this.bull()) return;
    const size = 1200, rDom = this.domain();
    const img = TS.renderRectified(this.image, this.bull(), size, rDom, 2);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.putImageData(new ImageData(img.data, size, size), 0, 0);
    this.drawOverlay(ctx, size, size / (2 * rDom), 1.5);
    const sum = TS.summarize(this.scored().map(function (o) { return { x: o.x, y: o.y }; }), this.faceId, this.gauge());
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(0, 0, size, 44);
    ctx.fillStyle = 'rgba(17, 24, 39, 1)';
    ctx.fillText(TS.FACES[this.faceId].name[this.lang] + ' — ' + this.t('total') + ' ' + sum.total +
                 (this.decimal ? ' (' + fmt(this.lang, sum.totalDecimal, 1) + ')' : '') + ' — ' + sum.count + ' ' + this.t('shots').toLowerCase(), 12, 32);
    c.toBlob(function (blob) {
        const a = el('a', { href: URL.createObjectURL(blob), download: 'cible.png' });
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 1000);
    }, 'image/png');
};

root.TargetScorerUI = {
    mount: function (container, options) { return new ScorerUI(container, options); },
    STRINGS: STR
};
}(typeof self !== 'undefined' ? self : this));
