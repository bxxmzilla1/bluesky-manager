import { AtpAgent } from '@atproto/api';

// Browser-side AT Protocol client. Bluesky's XRPC endpoints support CORS,
// so all calls run directly from the browser with no backend required.
//
// This module supports MULTIPLE independent accounts at once: every job
// creates its own AtpAgent + session, so accounts run fully isolated and in
// parallel (Bluesky rate limits are per-account).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.error && err.message) return `${err.error}: ${err.message}`;
  return err.message || String(err);
}

function userView(p) {
  return {
    did: p.did,
    handle: p.handle,
    displayName: p.displayName || '',
    viewerFollowing: !!(p.viewer && p.viewer.following),
  };
}

function cleanTarget(actor) {
  let a = String(actor || '').trim().replace(/^@/, '');
  const m = a.match(/bsky\.app\/profile\/([^/?#]+)/i);
  if (m) a = m[1];
  return a;
}

// Fetch the followers OR following list of a target account (paginated).
async function fetchConnections(agent, actor, type, max) {
  const limitMax = Math.min(Math.max(parseInt(max, 10) || 1000, 1), 25000);
  const isFollowers = type === 'followers';
  const method = isFollowers ? 'getFollowers' : 'getFollows';
  const key = isFollowers ? 'followers' : 'follows';
  const out = [];
  let cursor;
  do {
    const { data } = await agent.app.bsky.graph[method]({
      actor: cleanTarget(actor),
      limit: 100,
      cursor,
    });
    for (const p of data[key]) {
      out.push(userView(p));
      if (out.length >= limitMax) break;
    }
    cursor = data.cursor;
  } while (cursor && out.length < limitMax);
  return out;
}

/**
 * Run a full job for one account:
 *   1. log in with its own credentials
 *   2. fetch the followers (or following) of the assigned target profile
 *   3. follow them, with rate-limit-friendly delay + back-off
 *
 * @param {object} cfg   { identifier, password, service, target, type,
 *                         maxFollowers, delayMs, skipExisting }
 * @param {object} hooks { onStatus(state, text), onProgress(detail),
 *                         shouldCancel() => boolean }
 */
export async function runAccountJob(cfg, hooks = {}) {
  const {
    identifier,
    password,
    service,
    target,
    type = 'followers',
    maxFollowers,
    delayMs,
    skipExisting = true,
  } = cfg;
  const onStatus = hooks.onStatus || (() => {});
  const onProgress = hooks.onProgress || (() => {});
  const shouldCancel = hooks.shouldCancel || (() => false);

  const result = { success: 0, skipped: 0, failed: 0, total: 0, cancelled: false };

  try {
    if (!identifier || !password) throw new Error('Missing handle/email or password.');
    if (!target) throw new Error('Missing target profile.');

    onStatus('auth', 'Signing in…');
    const agent = new AtpAgent({ service: (service && service.trim()) || 'https://bsky.social' });
    await agent.login({ identifier: identifier.trim(), password: password.trim() });

    if (shouldCancel()) {
      result.cancelled = true;
      return { ok: true, result };
    }

    const tgt = cleanTarget(target);
    onStatus('fetch', `Fetching ${type} of @${tgt}…`);
    const users = await fetchConnections(agent, tgt, type, maxFollowers);
    result.total = users.length;

    if (!users.length) {
      onStatus('done', `No ${type} found for @${tgt}.`);
      return { ok: true, result };
    }

    const delay = Math.min(Math.max(parseInt(delayMs, 10) || 1000, 0), 60000);
    onStatus('run', `Following ${users.length} ${type}…`);

    for (let i = 0; i < users.length; i++) {
      if (shouldCancel()) {
        result.cancelled = true;
        break;
      }
      const u = users[i];
      const label = u.handle || u.did;

      if (skipExisting && u.viewerFollowing) {
        result.skipped++;
        onProgress({ done: i + 1, total: users.length, status: 'skipped', label, ...result });
        continue;
      }

      try {
        await agent.follow(u.did);
        result.success++;
        onProgress({ done: i + 1, total: users.length, status: 'followed', label, ...result });
      } catch (err) {
        result.failed++;
        const msg = parseError(err);
        onProgress({ done: i + 1, total: users.length, status: 'error', label, message: msg, ...result });
        if (/rate ?limit/i.test(msg)) await sleep(Math.max(delay, 5000));
      }

      if (i < users.length - 1 && delay > 0 && !shouldCancel()) await sleep(delay);
    }

    onStatus('done', result.cancelled ? 'Stopped' : 'Done');
    return { ok: true, result };
  } catch (err) {
    const msg = parseError(err);
    onStatus('error', msg);
    return { ok: false, error: msg, result };
  }
}
