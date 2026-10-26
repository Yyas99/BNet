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

  // short: the popup's two-line preview; the long line is for the settings gallery tiles.
  function specimen(el, tid, seed, short) {
    el.textContent = '';
    if (short) el.append('A reply says ', mask(SAMPLE, tid, seed), ', and you read on.');
    else el.append('Scrolling past a reply that says ', mask(SAMPLE, tid, seed), ', and moving on.');
  }

  // Arrow keys move between items of a group (radios, tabs) the way native radio buttons do;
  // only the current item is in the Tab order, so the group is one Tab stop.
  function roving(container, selector, onPick) {
    container.addEventListener('keydown', e => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
      if (!(e.key in keys)) return;
      const items = [...container.querySelectorAll(selector)].filter(n => !n.disabled && n.offsetParent !== null);
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const k = keys[e.key];
      const next = k === 'first' ? items[0] : k === 'last' ? items[items.length - 1] : items[(i + k + items.length) % items.length];
      next.focus();
      onPick(next);
    });
  }
  function setRoving(items, current) {
    const list = [...items];
    const cur = list.includes(current) ? current : list[0];
    for (const n of list) n.tabIndex = n === cur ? 0 : -1;
  }

  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDate = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

    // Host name without www., or '' for anything that is not a web address.
  const siteOf = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '') : ''; } catch (e) { return ''; } };
  const plural = (n, one, many) => n.toLocaleString() + ' ' + (n === 1 ? one : many);

  root.BNetUI = { mask, specimen, roving, setRoving, siteOf, plural, SAMPLE, fmtTime, fmtDate };
})(globalThis);
