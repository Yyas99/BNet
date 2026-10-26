/* On-device text recognition for images (Tesseract, English). One image at a time. */
'use strict';
let workerP = null;
function getWorker() {
  if (!workerP) {
    workerP = Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('lib/tesseract/core/tesseract-core-simd-lstm.wasm.js'),
      langPath: chrome.runtime.getURL('lib/tesseract/lang'),
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: () => {}
    }).catch(err => { workerP = null; throw err; });
  }
  return workerP;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function ocr(url) {
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('fetch ' + r.status);
  const blob = await r.blob();
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height;
  if (w < 60 || h < 40) { bmp.close(); return { ok: true, w, h, words: [] }; }
  const worker = await getWorker();
  // Pass 1: coloured text made bright (max of R,G,B), dark images flipped to dark-on-light, contrast stretched.
  const { canvas, scale } = prepare(bmp);
  bmp.close();
  const pre = await canvas.convertToBlob({ type: 'image/png' });
  let words = await read(worker, pre, scale);
  // Pass 2 (only if pass 1 found little): the untouched image.
  if (words.length < 3) {
    const plain = await read(worker, blob, 1);
    if (plain.length > words.length) words = plain;
  }
  return { ok: true, w, h, words };
}

function prepare(bmp) {
  const scale = bmp.width < 900 ? 2 : 1;
  const W = Math.round(bmp.width * scale), H = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(d[i], d[i + 1], d[i + 2]);
    d[i] = v; hist[v]++; sum += v;
  }
  const n = d.length / 4;
  const invert = sum / n < 110;
  // 1% cut-off contrast stretch
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < n * 0.01) hi--;
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let v = Math.min(255, Math.max(0, (d[i] - lo) * 255 / span));
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, scale };
}

async function read(worker, image, scale) {
  const { data } = await withTimeout(worker.recognize(image, {}, { text: true, blocks: true }), 25000);
  const words = [];
  let line = 0;
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    for (const wd of l.words || []) {
      const t = (wd.text || '').trim();
      if (!t || wd.confidence < 55) continue;
      words.push({ text: t, b: [wd.bbox.x0 / scale, wd.bbox.y0 / scale, wd.bbox.x1 / scale, wd.bbox.y1 / scale], line });
    }
    line++;
  }
  return words;
}

let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'ocr') return;
  queue = queue.then(() => ocr(msg.url)).then(sendResponse, err => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true;
});
