const { createWorker } = require('tesseract.js');

/* Genuine, open-source OCR (Tesseract, via tesseract.js) — no API key, no
 * signup, runs fully offline after its first model download. It is built
 * and tuned for printed text, not handwriting: expect frequent misreads,
 * dropped/merged characters and low confidence on real handwritten answer
 * sheets, especially cursive or messy writing. That limitation is real and
 * is never hidden from the response — low confidence is reported honestly
 * (see grading.js), not smoothed over. See ../README.md for sources.
 */
let workerPromise = null;
function getWorker() {
  if (!workerPromise) workerPromise = createWorker('eng');
  return workerPromise;
}

async function recognizeImages(buffers) {
  const worker = await getWorker();
  const results = [];
  for (const buf of buffers) {
    const { data } = await worker.recognize(buf);
    results.push({
      text: (data.text || '').trim(),
      confidence: typeof data.confidence === 'number' ? data.confidence / 100 : 0,
    });
  }
  return results;
}

async function terminateWorker() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}

module.exports = { recognizeImages, terminateWorker };
