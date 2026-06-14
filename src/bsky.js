import { AtpAgent } from '@atproto/api';

// Browser-side AT Protocol client. Bluesky's XRPC endpoints support CORS,
// so all calls run directly from the browser with no backend required.

const LS_SESSION = 'bsky-mgr.session';
const LS_CREDS = 'bsky-mgr.creds';

let agent = null;
let currentProfile = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.error && err.message) return `${err.error}: ${err.message}`;
  return err.message || String(err);
}

function profileSummary(p) {
  if (!p) return null;
  return {
    did: p.did,
    handle: p.handle,
    displayName: p.displayName || '',
    avatar: p.avatar || '',
    followersCount: p.followersCount ?? null,
    followsCount: p.followsCount ?? null,
    postsCount: p.postsCount ?? null,
  };
}

function userView(p) {
  return {
    did: p.did,
    handle: p.handle,
    displayName: p.displayName || '',
    avatar: p.avatar || '',
    viewerFollowing: !!(p.viewer && p.viewer.following),
  };
}

// ---- session / credential persistence -------------------------------------

function makeAgent(service) {
  return new AtpAgent({
    service: service || 'https://bsky.social',
    persistSession: (_evt, sess) => {
      try {
        if (sess) {
          localStorage.setItem(
            LS_SESSION,
            JSON.stringify({ service: service || 'https://bsky.social', session: sess })
          );
        } else {
          localStorage.removeItem(LS_SESSION);
        }
      } catch {
        /* storage may be unavailable */
      }
    },
  });
}

function saveCreds(identifier, password, service) {
  try {
    localStorage.setItem(
      LS_CREDS,
      JSON.stringify({ identifier, service, password: btoa(unescape(encodeURIComponent(password))) })
    );
  } catch {
    /* ignore */
  }
}

function loadCreds() {
  try {
    const raw = localStorage.getItem(LS_CREDS);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return { identifier: c.identifier, service: c.service, password: decodeURIComponent(escape(atob(c.password))) };
  } catch {
    return null;
  }
}

function clearCreds() {
  localStorage.removeItem(LS_CREDS);
}

async function refreshProfile() {
  const { data } = await agent.getProfile({ actor: agent.session.did });
  currentProfile = profileSummary(data);
  return currentProfile;
}

function requireAgent() {
  if (!agent || !agent.session) throw new Error('Not logged in. Please sign in first.');
}

function normalizeActors(actors) {
  const seen = new Set();
  const out = [];
  for (const raw of actors || []) {
    if (!raw) continue;
    let a = String(raw).trim().replace(/^@/, '');
    if (!a) continue;
    const m = a.match(/bsky\.app\/profile\/([^/?#]+)/i);
    if (m) a = m[1];
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ---- public API (mirrors the old window.bsky surface) ----------------------

let followJob = { running: false, cancel: false };

export const bsky = {
  getSaved() {
    const c = loadCreds();
    const sess = (() => {
      try {
        return JSON.parse(localStorage.getItem(LS_SESSION) || 'null');
      } catch {
        return null;
      }
    })();
    if (c) return { hasSaved: true, identifier: c.identifier, service: c.service, canResume: !!sess };
    if (sess) return { hasSaved: true, identifier: '', service: sess.service, canResume: true };
    return { hasSaved: false };
  },

  async login({ identifier, password, service, remember }) {
    try {
      const svc = service && service.trim() ? service.trim() : 'https://bsky.social';
      agent = makeAgent(svc);
      await agent.login({ identifier: identifier.trim(), password: password.trim() });
      await refreshProfile();
      if (remember) saveCreds(identifier.trim(), password.trim(), svc);
      else clearCreds();
      return { ok: true, profile: currentProfile, service: svc };
    } catch (err) {
      return { ok: false, error: parseError(err) };
    }
  },

  async autoLogin() {
    // Prefer resuming an existing session; fall back to saved credentials.
    try {
      const raw = localStorage.getItem(LS_SESSION);
      if (raw) {
        const { service, session } = JSON.parse(raw);
        agent = makeAgent(service);
        await agent.resumeSession(session);
        await refreshProfile();
        return { ok: true, profile: currentProfile, service };
      }
    } catch {
      /* fall through to credential login */
    }
    const c = loadCreds();
    if (!c) return { ok: false, error: 'No saved session.' };
    return this.login({ identifier: c.identifier, password: c.password, service: c.service, remember: true });
  },

  async logout({ forget }) {
    agent = null;
    currentProfile = null;
    localStorage.removeItem(LS_SESSION);
    if (forget) clearCreds();
    return { ok: true };
  },

  async resolveUsers(actors) {
    try {
      requireAgent();
      const cleaned = normalizeActors(actors);
      const resolved = [];
      const failed = [];
      for (let i = 0; i < cleaned.length; i += 25) {
        const batch = cleaned.slice(i, i + 25);
        try {
          const { data } = await agent.getProfiles({ actors: batch });
          const found = new Set();
          for (const p of data.profiles) {
            found.add(p.handle.toLowerCase());
            found.add(p.did.toLowerCase());
            resolved.push(userView(p));
          }
          for (const a of batch) if (!found.has(a.toLowerCase())) failed.push(a);
        } catch {
          failed.push(...batch);
        }
      }
      return { ok: true, resolved, failed };
    } catch (err) {
      return { ok: false, error: parseError(err) };
    }
  },

  async fetchConnections(actor, type, max) {
    try {
      requireAgent();
      const limitMax = Math.min(Math.max(parseInt(max, 10) || 1000, 1), 10000);
      const isFollowers = type === 'followers';
      const method = isFollowers ? 'getFollowers' : 'getFollows';
      const key = isFollowers ? 'followers' : 'follows';
      const out = [];
      let cursor;
      do {
        const { data } = await agent.app.bsky.graph[method]({
          actor: actor.trim(),
          limit: 100,
          cursor,
        });
        for (const p of data[key]) {
          out.push(userView(p));
          if (out.length >= limitMax) break;
        }
        cursor = data.cursor;
      } while (cursor && out.length < limitMax);
      return { ok: true, users: out };
    } catch (err) {
      return { ok: false, error: parseError(err) };
    }
  },

  async searchUsers(query, max) {
    try {
      requireAgent();
      const limitMax = Math.min(Math.max(parseInt(max, 10) || 50, 1), 1000);
      const out = [];
      let cursor;
      do {
        const { data } = await agent.app.bsky.actor.searchActors({
          q: query.trim(),
          limit: 100,
          cursor,
        });
        for (const p of data.actors) {
          out.push(userView(p));
          if (out.length >= limitMax) break;
        }
        cursor = data.cursor;
      } while (cursor && out.length < limitMax);
      return { ok: true, users: out };
    } catch (err) {
      return { ok: false, error: parseError(err) };
    }
  },

  async startFollow(targets, delayMs, skipExisting, onProgress) {
    try {
      requireAgent();
      if (followJob.running) return { ok: false, error: 'A follow job is already running.' };
      followJob = { running: true, cancel: false };
      const delay = Math.min(Math.max(parseInt(delayMs, 10) || 1000, 0), 60000);
      const list = Array.isArray(targets) ? targets : [];
      let success = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < list.length; i++) {
        if (followJob.cancel) break;
        const t = list[i];
        const label = t.handle || t.did;

        if (skipExisting && t.viewerFollowing) {
          skipped++;
          onProgress?.({ done: i + 1, total: list.length, status: 'skipped', label, success, skipped, failed });
          continue;
        }

        try {
          await agent.follow(t.did);
          success++;
          onProgress?.({ done: i + 1, total: list.length, status: 'followed', label, success, skipped, failed });
        } catch (err) {
          failed++;
          const msg = parseError(err);
          onProgress?.({ done: i + 1, total: list.length, status: 'error', label, message: msg, success, skipped, failed });
          if (/rate ?limit/i.test(msg)) await sleep(Math.max(delay, 5000));
        }

        if (i < list.length - 1 && delay > 0 && !followJob.cancel) await sleep(delay);
      }

      const cancelled = followJob.cancel;
      followJob.running = false;
      return { ok: true, summary: { success, skipped, failed, total: list.length, cancelled } };
    } catch (err) {
      followJob.running = false;
      return { ok: false, error: parseError(err) };
    }
  },

  stopFollow() {
    if (followJob.running) followJob.cancel = true;
    return { ok: true };
  },
};
