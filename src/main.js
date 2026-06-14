import './styles.css';
import { runAccountJob } from './bsky.js';

const $ = (id) => document.getElementById(id);

const LS_ACCOUNTS = 'bsky-mgr.accounts';
const LS_SETTINGS = 'bsky-mgr.settings';

// Each account: { id, identifier, password, target, el, refs, cancel, running }
const accounts = [];
let running = false;

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function encode(s) {
  try { return btoa(unescape(encodeURIComponent(s || ''))); } catch { return ''; }
}
function decode(s) {
  try { return decodeURIComponent(escape(atob(s || ''))); } catch { return ''; }
}

function saveAccounts() {
  const data = accounts.map((a) => ({
    identifier: a.refs.id.value.trim(),
    password: encode(a.refs.pw.value),
    target: a.refs.target.value.trim(),
  }));
  try { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(data)); } catch { /* ignore */ }
}

function loadAccounts() {
  try {
    const raw = localStorage.getItem(LS_ACCOUNTS);
    if (!raw) return [];
    return JSON.parse(raw).map((a) => ({
      identifier: a.identifier || '',
      password: decode(a.password),
      target: a.target || '',
    }));
  } catch {
    return [];
  }
}

function saveSettings() {
  const s = {
    service: $('set-service').value,
    type: $('set-type').value,
    max: $('set-max').value,
    delayMode: $('set-delay-mode').value,
    delay: $('set-delay').value,
    delayMin: $('set-delay-min').value,
    delayMax: $('set-delay-max').value,
    skip: $('set-skip').checked,
  };
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null');
    if (!s) return;
    if (s.service) $('set-service').value = s.service;
    if (s.type) $('set-type').value = s.type;
    if (s.max) $('set-max').value = s.max;
    if (s.delayMode) $('set-delay-mode').value = s.delayMode;
    if (s.delay != null) $('set-delay').value = s.delay;
    if (s.delayMin != null) $('set-delay-min').value = s.delayMin;
    if (s.delayMax != null) $('set-delay-max').value = s.delayMax;
    $('set-skip').checked = s.skip !== false;
  } catch { /* ignore */ }
}

// Show fixed-delay field or min/max range depending on the chosen mode.
function syncDelayMode() {
  const random = $('set-delay-mode').value === 'random';
  $('field-fixed').classList.toggle('hidden', random);
  $('field-min').classList.toggle('hidden', !random);
  $('field-max').classList.toggle('hidden', !random);
}

// ---------------------------------------------------------------------------
// Account cards
// ---------------------------------------------------------------------------
function addAccount(data = {}) {
  const tpl = $('account-template').content.firstElementChild.cloneNode(true);
  const refs = {
    id: tpl.querySelector('.ac-id'),
    pw: tpl.querySelector('.ac-pw'),
    target: tpl.querySelector('.ac-target'),
    remove: tpl.querySelector('.ac-remove'),
    dot: tpl.querySelector('.ac-dot'),
    state: tpl.querySelector('.ac-state'),
    fill: tpl.querySelector('.progress-fill'),
    counts: tpl.querySelector('.ac-counts'),
    logToggle: tpl.querySelector('.ac-log-toggle'),
    log: tpl.querySelector('.ac-log'),
  };
  refs.id.value = data.identifier || '';
  refs.pw.value = data.password || '';
  refs.target.value = data.target || '';

  const acct = { id: uid(), el: tpl, refs, cancel: false, running: false };
  accounts.push(acct);

  [refs.id, refs.pw, refs.target].forEach((inp) =>
    inp.addEventListener('change', saveAccounts)
  );

  refs.remove.addEventListener('click', () => {
    if (acct.running) return;
    const i = accounts.indexOf(acct);
    if (i >= 0) accounts.splice(i, 1);
    tpl.remove();
    saveAccounts();
    updateGlobalSummary();
  });

  refs.logToggle.addEventListener('click', () => {
    refs.log.classList.toggle('hidden');
  });

  $('accounts').appendChild(tpl);
  updateGlobalSummary();
  return acct;
}

function setCardState(acct, state, text) {
  acct.refs.dot.className = 'ac-dot ' + state;
  acct.refs.state.textContent = text;
}

function setCardProgress(acct, done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  acct.refs.fill.style.width = pct + '%';
}

function setCardCounts(acct, r) {
  acct.refs.counts.textContent =
    `${r.success} followed · ${r.skipped} skipped · ${r.failed} failed` +
    (r.total ? ` / ${r.total}` : '');
}

function logLine(acct, d) {
  const line = document.createElement('div');
  line.className = 'log-line';
  if (d.status === 'followed') { line.classList.add('log-ok'); line.textContent = `✓ followed @${d.label}`; }
  else if (d.status === 'skipped') { line.classList.add('log-skip'); line.textContent = `– skipped @${d.label}`; }
  else { line.classList.add('log-err'); line.textContent = `✗ @${d.label}: ${d.message || 'failed'}`; }
  acct.refs.log.appendChild(line);
  acct.refs.log.scrollTop = acct.refs.log.scrollHeight;
}

// ---------------------------------------------------------------------------
// Run orchestration (all accounts in parallel)
// ---------------------------------------------------------------------------
async function startAll() {
  if (running) return;

  const settings = {
    service: $('set-service').value.trim(),
    type: $('set-type').value,
    maxFollowers: $('set-max').value,
    delayMode: $('set-delay-mode').value,
    delayMs: $('set-delay').value,
    delayMin: $('set-delay-min').value,
    delayMax: $('set-delay-max').value,
    skipExisting: $('set-skip').checked,
  };

  const jobs = accounts.filter(
    (a) => a.refs.id.value.trim() && a.refs.pw.value.trim() && a.refs.target.value.trim()
  );

  if (!jobs.length) {
    setGlobalSummary('Fill in handle, app password, and target profile for at least one account.', true);
    return;
  }

  running = true;
  setRunningUI(true);

  await Promise.all(
    jobs.map((acct) => {
      acct.cancel = false;
      acct.running = true;
      acct.refs.log.innerHTML = '';
      acct.refs.log.classList.remove('hidden');
      setCardProgress(acct, 0, 1);
      setCardState(acct, 'auth', 'Starting…');

      return runAccountJob(
        {
          identifier: acct.refs.id.value,
          password: acct.refs.pw.value,
          service: settings.service,
          target: acct.refs.target.value,
          type: settings.type,
          maxFollowers: settings.maxFollowers,
          delayMode: settings.delayMode,
          delayMs: settings.delayMs,
          delayMin: settings.delayMin,
          delayMax: settings.delayMax,
          skipExisting: settings.skipExisting,
        },
        {
          onStatus: (state, text) => setCardState(acct, state, text),
          onProgress: (d) => {
            setCardProgress(acct, d.done, d.total);
            setCardCounts(acct, d);
            logLine(acct, d);
            updateGlobalSummary();
          },
          shouldCancel: () => acct.cancel,
        }
      ).then((res) => {
        acct.running = false;
        if (!res.ok) {
          setCardState(acct, 'error', res.error);
        } else {
          const r = res.result;
          setCardProgress(acct, 1, 1);
          setCardCounts(acct, r);
          setCardState(acct, r.cancelled ? 'error' : 'done', r.cancelled ? 'Stopped' : 'Done');
        }
        updateGlobalSummary();
      });
    })
  );

  running = false;
  setRunningUI(false);
  updateGlobalSummary(true);
}

function stopAll() {
  for (const a of accounts) a.cancel = true;
  $('stop-all').disabled = true;
  setGlobalSummary('Stopping… finishing current requests.');
}

function setRunningUI(isRunning) {
  $('start-all').classList.toggle('hidden', isRunning);
  $('stop-all').classList.toggle('hidden', !isRunning);
  $('stop-all').disabled = false;
  $('add-account').disabled = isRunning;
  $('clear-all').disabled = isRunning;
  document.querySelectorAll('.settings-bar input, .settings-bar select').forEach((e) => (e.disabled = isRunning));
  document.querySelectorAll('.account-card input, .ac-remove').forEach((e) => (e.disabled = isRunning));
}

function updateGlobalSummary(finished) {
  if (running && !finished) {
    let followed = 0, skipped = 0, failed = 0, active = 0;
    for (const a of accounts) {
      if (a.running) active++;
    }
    // Aggregate from counts text is unreliable; just show active count.
    setGlobalSummary(`Running ${active} account(s)…`);
    return;
  }
  setGlobalSummary(`${accounts.length} account(s) configured.`);
}

function setGlobalSummary(text, isError) {
  const el = $('global-summary');
  el.textContent = text;
  el.style.color = isError ? '#ff9ba1' : '';
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------
$('add-account').addEventListener('click', () => { addAccount(); saveAccounts(); });
$('start-all').addEventListener('click', startAll);
$('stop-all').addEventListener('click', stopAll);
$('clear-all').addEventListener('click', () => {
  if (running) return;
  if (accounts.length && !confirm('Remove all accounts?')) return;
  accounts.splice(0).forEach((a) => a.el.remove());
  saveAccounts();
  addAccount();
  saveAccounts();
});

document.querySelectorAll('.settings-bar input, .settings-bar select').forEach((e) =>
  e.addEventListener('change', saveSettings)
);
$('set-delay-mode').addEventListener('change', syncDelayMode);

function init() {
  loadSettings();
  syncDelayMode();
  const saved = loadAccounts();
  if (saved.length) saved.forEach((a) => addAccount(a));
  else addAccount();
}

init();
