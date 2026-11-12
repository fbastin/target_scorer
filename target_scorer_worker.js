/*!
 * target_scorer_worker.js — l'analyse dans un Web Worker, pour que la page ne gèle pas
 * pendant les quelques secondes de calcul. Message reçu : { id, image: ImageData-like,
 * options } ; message rendu : { id, result } ou { id, error }. Licence MIT.
 */
/* global importScripts, TargetScorer */
// Le « ?v=… » de cache du worker est repassé à la bibliothèque.
importScripts('target_scorer.js' + (self.location.search || ''));

self.onmessage = function (e) {
    const msg = e.data || {};
    try {
        const options = Object.assign({}, msg.options || {}, { slim: true });
        const result = TargetScorer.analyze(msg.image, options);
        self.postMessage({ id: msg.id, result: result });
    } catch (err) {
        self.postMessage({ id: msg.id, error: String((err && err.message) || err) });
    }
};
