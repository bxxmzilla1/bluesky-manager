import './styles.css';
import { bsky } from './bsky.js';

const $ = (id) => document.getElementById(id);

// In-memory list of target users keyed by DID.
const targets = new Map();

// ----------------------------------------------------------------------------
// View switching
// ----------------------------------------------------------------------------
function showApp(profile) {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  renderAccount(profile);
}

function showLogin() {
  $('app-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
}

function renderAccount(p) {
  if (!p) return;
  $('acct-avatar').src = p.avatar || '';
  $('acct-name').textContent = p.displayName || p.handle;
  $('acct-handle').textContent = '@' + p.handle;
  $('stat-followers').textContent = fmt(p.followersCount);
  $('stat-follows').textContent = fmt(p.followsCount);
  $('stat-posts').textContent = fmt(p.postsCount);
}

const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString());

// ----------------------------------------------------------------------------
// Login
// ----------------------------------------------------------------------------
async function init() {
  const saved = bsky.getSaved();
  if (saved.hasSaved) {
    $('identifier').value = saved.identifier || '';
    if (saved.service) $('service').value = saved.service;
    $('remember').checked = true;
    if (saved.canResume) {
      setLoginBusy(true, 'Restoring session…');
      const res = await bsky.autoLogin();
      setLoginBusy(false);
      if (res.ok) {
        showApp(res.profile);
        return;
      }
    }
  }
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const identifier = $('identifier').value.trim();
  const password = $('password').value.trim();
  const service = $('service').value.trim();
  const remember = $('remember').checked;
  hideLoginError();
  if (!identifier || !password) {
    showLoginError('Please enter your handle/email and app password.');
    return;
  }
  setLoginBusy(true, 'Signing in…');
  const res = await bsky.login({ identifier, password, service, remember });
  setLoginBusy(false);
  if (res.ok) {
    $('password').value = '';
    showApp(res.profile);
  } else {
    showLoginError(res.error || 'Login failed.');
  }
});

function setLoginBusy(busy, text) {
  const btn = $('login-btn');
  btn.disabled = busy;
  btn.textContent = busy ? text || 'Working…' : 'Sign in';
}
function showLoginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideLoginError() {
  $('login-error').classList.add('hidden');
}

$('logout-btn').addEventListener('click', async () => {
  const forget = confirm('Sign out?\n\nClick OK to also forget saved credentials, or Cancel to keep them.');
  await bsky.logout({ forget });
  targets.clear();
  renderTargets();
  showLogin();
});

// ----------------------------------------------------------------------------
// Source tabs
// ----------------------------------------------------------------------------
$('source-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('#source-tabs .tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  const name = tab.dataset.tab;
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.panel !== name);
  });
});

function setSourceStatus(msg, isError) {
  const el = $('source-status');
  el.textContent = msg || '';
  el.style.color = isError ? '#ff9ba1' : '';
}

// ----------------------------------------------------------------------------
// Add targets from the three sources
// ----------------------------------------------------------------------------
function mergeUsers(users) {
  let added = 0;
  for (const u of users) {
    if (!u.did) continue;
    if (!targets.has(u.did)) {
      targets.set(u.did, { ...u, selected: true, state: null });
      added++;
    }
  }
  renderTargets();
  return added;
}

$('paste-add').addEventListener('click', async () => {
  const lines = $('paste-input').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return setSourceStatus('Nothing to add.', true);
  setSourceStatus(`Resolving ${lines.length} handle(s)…`);
  const res = await bsky.resolveUsers(lines);
  if (!res.ok) return setSourceStatus(res.error, true);
  const added = mergeUsers(res.resolved);
  let msg = `Added ${added} user(s).`;
  if (res.failed.length) msg += ` ${res.failed.length} could not be resolved.`;
  setSourceStatus(msg);
  $('paste-input').value = '';
});

$('conn-fetch').addEventListener('click', async () => {
  const actor = $('conn-actor').value.trim();
  const type = $('conn-type').value;
  const max = $('conn-max').value;
  if (!actor) return setSourceStatus('Enter an account handle.', true);
  setSourceStatus(`Fetching ${type} of @${actor.replace(/^@/, '')}…`);
  const res = await bsky.fetchConnections(actor, type, max);
  if (!res.ok) return setSourceStatus(res.error, true);
  const added = mergeUsers(res.users);
  setSourceStatus(`Fetched ${res.users.length}, added ${added} new.`);
});

$('search-go').addEventListener('click', async () => {
  const q = $('search-input').value.trim();
  const max = $('search-max').value;
  if (!q) return setSourceStatus('Enter a search term.', true);
  setSourceStatus(`Searching for “${q}”…`);
  const res = await bsky.searchUsers(q, max);
  if (!res.ok) return setSourceStatus(res.error, true);
  const added = mergeUsers(res.users);
  setSourceStatus(`Found ${res.users.length}, added ${added} new.`);
});

// ----------------------------------------------------------------------------
// Target list rendering
// ----------------------------------------------------------------------------
function renderTargets() {
  const hideFollowing = $('hide-following').checked;
  const list = $('target-list');
  $('target-count').textContent = targets.size;

  const arr = [...targets.values()];
  if (!arr.length) {
    list.innerHTML = '<p class="empty-state">No targets yet. Add some from the left panel.</p>';
    updateSelectedCount();
    return;
  }

  list.innerHTML = '';
  for (const u of arr) {
    const row = document.createElement('div');
    row.className = 'target-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = u.selected && !(hideFollowing && u.viewerFollowing);
    cb.disabled = hideFollowing && u.viewerFollowing;
    cb.addEventListener('change', () => {
      u.selected = cb.checked;
      updateSelectedCount();
    });

    const img = document.createElement('img');
    img.src = u.avatar || '';
    img.alt = '';

    const meta = document.createElement('div');
    meta.className = 'tr-meta';
    const name = document.createElement('span');
    name.className = 'tr-name';
    name.textContent = u.displayName || u.handle;
    const handle = document.createElement('span');
    handle.className = 'tr-handle';
    handle.textContent = '@' + u.handle;
    meta.appendChild(name);
    meta.appendChild(handle);

    row.appendChild(cb);
    row.appendChild(img);
    row.appendChild(meta);

    const tag = tagFor(u);
    if (tag) row.appendChild(tag);

    list.appendChild(row);
  }
  updateSelectedCount();
}

function tagFor(u) {
  const span = document.createElement('span');
  if (u.state === 'followed') { span.className = 'tag done'; span.textContent = 'followed'; return span; }
  if (u.state === 'error') { span.className = 'tag err'; span.textContent = 'failed'; return span; }
  if (u.state === 'skipped') { span.className = 'tag skip'; span.textContent = 'skipped'; return span; }
  if (u.viewerFollowing) { span.className = 'tag following'; span.textContent = 'following'; return span; }
  return null;
}

function selectedTargets() {
  const hideFollowing = $('hide-following').checked;
  return [...targets.values()].filter(
    (u) => u.selected && !(hideFollowing && u.viewerFollowing)
  );
}

function updateSelectedCount() {
  $('run-selected').textContent = `${selectedTargets().length} selected`;
}

$('hide-following').addEventListener('change', renderTargets);

$('select-all').addEventListener('click', () => {
  for (const u of targets.values()) u.selected = true;
  renderTargets();
});
$('select-none').addEventListener('click', () => {
  for (const u of targets.values()) u.selected = false;
  renderTargets();
});
$('clear-targets').addEventListener('click', () => {
  if (targets.size && !confirm('Clear all targets?')) return;
  targets.clear();
  renderTargets();
});

// ----------------------------------------------------------------------------
// Mass follow run
// ----------------------------------------------------------------------------
$('follow-btn').addEventListener('click', async () => {
  const list = selectedTargets();
  if (!list.length) return setSourceStatus('Select at least one target to follow.', true);

  const delayMs = parseInt($('delay-input').value, 10) || 0;
  const skipExisting = $('hide-following').checked;

  for (const u of list) u.state = null;

  setRunning(true);
  $('run-log').classList.remove('hidden');
  $('run-log').innerHTML = '';
  $('progress-wrap').classList.remove('hidden');
  setProgress(0, list.length, '');

  const byLabel = new Map();
  for (const u of list) byLabel.set(u.handle || u.did, u);

  const onProgress = (d) => {
    setProgress(d.done, d.total, `${d.done}/${d.total} · ${d.success} followed · ${d.skipped} skipped · ${d.failed} failed`);
    const u = byLabel.get(d.label);
    if (u) {
      if (d.status === 'followed') { u.state = 'followed'; u.viewerFollowing = true; }
      else if (d.status === 'skipped') u.state = 'skipped';
      else if (d.status === 'error') u.state = 'error';
      renderTargets();
    }
    logLine(d);
  };

  const payload = list.map((u) => ({ did: u.did, handle: u.handle, viewerFollowing: u.viewerFollowing }));
  const res = await bsky.startFollow(payload, delayMs, skipExisting, onProgress);

  setRunning(false);

  if (!res.ok) {
    setSourceStatus(res.error, true);
  } else {
    const s = res.summary;
    setProgress(s.total, s.total,
      `Done${s.cancelled ? ' (stopped)' : ''}: ${s.success} followed, ${s.skipped} skipped, ${s.failed} failed.`);
  }
});

$('stop-btn').addEventListener('click', () => {
  $('stop-btn').disabled = true;
  bsky.stopFollow();
});

function setRunning(running) {
  $('follow-btn').classList.toggle('hidden', running);
  $('stop-btn').classList.toggle('hidden', !running);
  document.querySelectorAll('#source-tabs .tab, .panel button').forEach((b) => {
    if (b.id !== 'stop-btn') b.disabled = running;
  });
  $('stop-btn').disabled = false;
}

function setProgress(done, total, text) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('progress-fill').style.width = pct + '%';
  $('progress-text').textContent = text;
}

function logLine(d) {
  const log = $('run-log');
  const line = document.createElement('div');
  line.className = 'log-line';
  if (d.status === 'followed') { line.classList.add('log-ok'); line.textContent = `✓ followed @${d.label}`; }
  else if (d.status === 'skipped') { line.classList.add('log-skip'); line.textContent = `– skipped @${d.label} (already following)`; }
  else { line.classList.add('log-err'); line.textContent = `✗ @${d.label}: ${d.message || 'failed'}`; }
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

init();
