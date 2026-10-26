/* On-device text recognition for images (Tesseract, English). One image at a time.
 * The Tesseract worker holds 100+ MB, so it is shut down after a minute without work and this page
 * asks the background to close it; the next picture starts both again. */
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

const withTimeout = (p, ms) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
};
const MAX_BYTES = 15e6, FETCH_MS = 15000, IDLE_MS = 60000;

async function fetchImage(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { credentials: 'omit', signal: ac.signal });
    if (!r.ok) throw new Error('fetch ' + r.status);
    if (Number(r.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('image too large');
    const blob = await r.blob();
    if (blob.size > MAX_BYTES) throw new Error('image too large');
    return blob;
  } finally { clearTimeout(t); }
}

async function ocr(url) {
  const blob = await fetchImage(url);
  const bmp = await createImageBitmap(blob);
  // A decoded 40-megapixel picture alone is 160 MB; such images are photos, not memes.
  if (bmp.width * bmp.height > 40e6) { bmp.close(); return { ok: true, w: bmp.width, h: bmp.height, words: [] }; }
  const w = bmp.width, h = bmp.height;
  if (w < 60 || h < 40) { bmp.close(); return { ok: true, w, h, words: [] }; }
  const worker = await getWorker();
  // Pass 1: coloured text made bright (max of R,G,B), dark images flipped to dark-on-light, contrast stretched.
  const { canvas, scale } = prepare(bmp);
  bmp.close();
  const pre = await canvas.convertToBlob({ type: 'image/png' });
  let words = await read(worker, pre, scale);
  // Pass 2 (only if pass 1 found little and the picture is small enough to be cheap): the untouched image.
  if (words.length < 3 && w * h <= 1400000) {
    const plain = await read(worker, blob, 1);
    if (plain.length > words.length) words = plain;
  }
  return { ok: true, w, h, words };
}

function prepare(bmp) {
  // Small pictures are enlarged for legibility; big ones are shrunk to about 1.6 megapixels, which keeps
  // meme-sized text readable and stops a 4K photo from tying up the CPU.
  const px = bmp.width * bmp.height;
  const scale = bmp.width < 900 && px < 600000 ? 2 : Math.min(1, Math.sqrt(1600000 / px));
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

let queue = Promise.resolve(), pending = 0, idleTimer = null;
function idleLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (pending) return;
    const w = workerP;
    workerP = null;
    if (w) { try { await (await w).terminate(); } catch (e) {} }
    if (!pending) chrome.runtime.sendMessage({ type: 'offscreen:idle' }).catch(() => {});
  }, IDLE_MS);
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'ocr') return;
  pending++;
  clearTimeout(idleTimer);
  // A recognition that never settles (worker crash) must not block the pictures behind it.
  queue = queue.then(() => withTimeout(ocr(msg.url), 70000))
    .then(sendResponse, err => {
      if (String(err && err.message) === 'timeout') { const w = workerP; workerP = null; if (w) w.then(x => x.terminate()).catch(() => {}); }
      sendResponse({ ok: false, error: String(err && err.message || err) });
    })
    .finally(() => { if (--pending === 0) idleLater(); });
  return true;
});
idleLater();
