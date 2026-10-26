/* UI helpers shared by popup and settings. */
(function (root) {
  'use strict';
  const T = root.BNetTreatments;
  const SAMPLE = { text: 'these people are vermin', kind: 'claim', group: 'these people', groupAt: 0, pred: 'dehum' };

  function mask(sp, tid, seed, open) {
    const id = T.resolve(tid, seed || sp.text);
    const m = document.createElement('bnet-mask');
    m.className = 'bnet-t-' + id + (open ? ' bnet-open' : '');
    m.dataset.key = 'preview';
    m.setAttribute('role', 'button');
    m.setAttribute('tabindex', '0');
    m.title = 'Click to show';
    const o = document.createElement('span');
    o.className = 'bnet-o';
    o.textContent = sp.text;
    const a = document.createElement('span');
    a.className = 'bnet-a';
    a.textContent = T.render(id, sp, seed || sp.text).text;
    m.append(o, a);
    m.addEventListener('click', () => m.classList.toggle('bnet-open'));
    m.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); m.classList.toggle('bnet-open'); } });
    return m;
  }

  function specimen(el, tid, seed) {
    el.textContent = '';
    el.append('Scrolling past a reply that says ', mask(SAMPLE, tid, seed), ', and moving on.');
  }

  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDate = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

  root.BNetUI = { mask, specimen, SAMPLE, fmtTime, fmtDate };
})(globalThis);
