// Cohort — the open-source online Y Combinator
// Single-process server: Express (HTTP + static + JSON API) and ws (realtime rooms).
// Persistence is one data.json file loaded at boot and saved with a debounce.

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Input limits
const MAX_NAME = 60;
const MAX_PITCH = 400;
const MAX_HANDLE = 40;
const MAX_TAG = 24;
const MAX_TAGS = 8;
const MAX_CHAT = 2000;
const MAX_DOC = 200000;
const MAX_CHAT_HISTORY = 200;

// ---------------------------------------------------------------------------
// Persistence: load at boot, debounced save
// ---------------------------------------------------------------------------

function seedData() {
  const fans = (n, salt) =>
    Array.from({ length: n }, (_, i) => `demo_backer_${salt}_${i + 1}`);
  return {
    projects: [
      {
        id: 'seed-verdant',
        name: 'VerdantQuery',
        pitch:
          'One clean API for the world’s messy public climate data — emissions, temperature and sea-level datasets, normalized, versioned and queryable from a single endpoint.',
        founder: 'lena_k',
        tags: ['backend engineer', 'data scientist', 'devrel'],
        upvoters: fans(18, 'v'),
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
        doc:
          '# VerdantQuery — working notes\n\nMVP scope:\n- Ingest NOAA + Copernicus CSVs into one schema\n- /v1/query endpoint with dataset, region, year params\n- API keys + rate limiting later\n\nOpen questions: pricing for researchers vs. companies?\n',
        chat: [],
      },
      {
        id: 'seed-spriteforge',
        name: 'SpriteForge',
        pitch:
          'The missing collaboration layer for indie game studios: shared asset pipelines, one-click playtest builds and structured playtester feedback in one place.',
        founder: 'marco_dev',
        tags: ['game dev', 'designer', 'growth'],
        upvoters: fans(11, 's'),
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
        doc:
          '# SpriteForge scratchpad\n\nThis week:\n- CLI that watches /assets and pushes to CDN\n- Feedback widget embedded in web builds\n\nCompetitors: itch.io (distribution only), Backtrace (crashes only). Our wedge is the playtest loop.\n',
        chat: [],
      },
      {
        id: 'seed-tutorloop',
        name: 'TutorLoop',
        pitch:
          'A marketplace matching students with vetted peer tutors — pay per solved problem, not per hour. Tutors build a public track record; students only pay for answers that work.',
        founder: 'aisha_b',
        tags: ['frontend engineer', 'ops', 'marketing'],
        upvoters: fans(6, 't'),
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
        doc:
          '# TutorLoop plan\n\nHypothesis: per-problem pricing beats hourly for homework help.\n\nNext: landing page + waitlist, interview 10 students, escrow flow sketch.\n',
        chat: [],
      },
    ],
  };
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.projects)) return parsed;
    console.warn('data.json malformed, reseeding');
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('data.json unreadable, reseeding:', err.message);
  }
  const seeded = seedData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(seeded, null, 2));
  console.log('Seeded data.json with demo projects');
  return seeded;
}

const data = loadData();

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), (err) => {
      if (err) console.error('Failed to save data.json:', err.message);
    });
  }, 800);
}

function flushSaveSync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save data.json on exit:', err.message);
  }
}

process.on('SIGINT', () => { flushSaveSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSaveSync(); process.exit(0); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function findProject(id) {
  return data.projects.find((p) => p.id === id);
}

function publicProject(p) {
  return {
    id: p.id,
    name: p.name,
    pitch: p.pitch,
    founder: p.founder,
    tags: p.tags,
    upvotes: p.upvoters.length,
    createdAt: p.createdAt,
    repo: p.repo || null,
  };
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/api/projects', (req, res) => {
  res.json(data.projects.map(publicProject));
});

app.get('/api/projects/:id', (req, res) => {
  const project = findProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(publicProject(project));
});

app.post('/api/projects', (req, res) => {
  const body = req.body || {};
  const name = cleanText(body.name, MAX_NAME);
  const pitch = cleanText(body.pitch, MAX_PITCH);
  const founder = cleanText(body.founder, MAX_HANDLE);
  if (!name || !pitch || !founder) {
    return res.status(400).json({ error: 'name, pitch and founder are required' });
  }
  let tags = [];
  if (Array.isArray(body.tags)) tags = body.tags;
  else if (typeof body.tags === 'string') tags = body.tags.split(',');
  tags = tags
    .map((t) => cleanText(t, MAX_TAG))
    .filter(Boolean)
    .slice(0, MAX_TAGS);

  // Optional GitHub repo link (open-source projects welcome contributors here)
  let repo = cleanText(body.repo, 200);
  if (repo && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repo)) {
    return res.status(400).json({ error: 'repo must be a github.com/owner/name URL' });
  }

  const project = {
    id: crypto.randomBytes(5).toString('hex'),
    name,
    pitch,
    founder,
    tags,
    repo: repo || null,
    upvoters: [],
    createdAt: Date.now(),
    doc: '',
    chat: [],
  };
  data.projects.unshift(project);
  scheduleSave();
  res.status(201).json(publicProject(project));
});

// Adopt an open-source repo: creates a Cohort project linked to it, or
// returns the existing one so contributors gather in a single workspace.
app.post('/api/projects/adopt', (req, res) => {
  const body = req.body || {};
  const repo = cleanText(body.repo, 200);
  const handle = cleanText(body.handle, MAX_HANDLE);
  if (!repo || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repo)) {
    return res.status(400).json({ error: 'repo must be a github.com/owner/name URL' });
  }
  if (!handle) return res.status(400).json({ error: 'handle is required' });

  const existing = data.projects.find((p) => p.repo && p.repo.replace(/\/$/, '') === repo.replace(/\/$/, ''));
  if (existing) return res.json({ ...publicProject(existing), existing: true });

  const name = cleanText(body.name, MAX_NAME) || repo.split('/').pop();
  const pitch = cleanText(body.pitch, MAX_PITCH) ||
    `Contributor squad for ${repo.replace('https://github.com/', '')} — we pick good first issues, review each other's PRs and learn together.`;
  const project = {
    id: crypto.randomBytes(5).toString('hex'),
    name,
    pitch,
    founder: handle,
    tags: ['open source', 'contributors welcome'],
    repo,
    upvoters: [],
    createdAt: Date.now(),
    doc: [
      `# ${name} — contributor squad`,
      '',
      `Repo: ${repo}`,
      `Good first issues: ${repo}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`,
      '',
      '## How we work',
      '1. Claim an issue below before starting (avoid duplicate work).',
      '2. Fork the repo -> clone your fork -> branch -> fix -> pull request.',
      '3. Post your PR link in chat for a squad review before requesting maintainer review.',
      '',
      '## Claimed issues',
      '- (issue link) — @handle — status',
      '',
      '## Notes',
      '',
    ].join('\n'),
    chat: [],
  };
  data.projects.unshift(project);
  scheduleSave();
  res.status(201).json(publicProject(project));
});

app.post('/api/projects/:id/upvote', (req, res) => {
  const project = findProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const handle = cleanText((req.body || {}).handle, MAX_HANDLE);
  if (!handle) return res.status(400).json({ error: 'handle is required' });
  if (project.upvoters.includes(handle)) {
    return res.status(409).json({ error: 'Already upvoted', upvotes: project.upvoters.length });
  }
  project.upvoters.push(handle);
  scheduleSave();
  res.json({ ok: true, upvotes: project.upvoters.length });
});

// --- GitHub open-source discovery (30 min cache) ----------------------------
// Real repos actively looking for new contributors (good first issues).

const ossCache = { at: 0, repos: null, pending: null };

async function fetchOpenSource() {
  const q = encodeURIComponent('good-first-issues:>3 stars:>300 archived:false');
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=24`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'cohort-app', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const body = await res.json();
  return (body.items || []).map((r) => ({
    name: r.full_name,
    description: r.description || '',
    stars: r.stargazers_count,
    language: r.language,
    url: r.html_url,
    issuesUrl: `${r.html_url}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`,
  }));
}

app.get('/api/opensource', async (req, res) => {
  if (ossCache.repos && Date.now() - ossCache.at < 30 * 60 * 1000) {
    return res.json(ossCache.repos);
  }
  try {
    if (!ossCache.pending) {
      ossCache.pending = fetchOpenSource().finally(() => { ossCache.pending = null; });
    }
    const repos = await ossCache.pending;
    ossCache.repos = repos;
    ossCache.at = Date.now();
    res.json(repos);
  } catch (err) {
    console.error('GitHub fetch error:', err.message);
    if (ossCache.repos) return res.json(ossCache.repos);
    res.status(502).json({ error: 'Could not reach GitHub right now' });
  }
});

// --- Hacker News proxy (10 min cache) --------------------------------------

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const newsCache = { at: 0, stories: null, pending: null };

async function fetchTopStories() {
  const idsRes = await fetch(`${HN_BASE}/topstories.json`, { signal: AbortSignal.timeout(10000) });
  if (!idsRes.ok) throw new Error(`HN topstories HTTP ${idsRes.status}`);
  const ids = (await idsRes.json()).slice(0, 30);
  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`${HN_BASE}/item/${id}.json`, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    })
  );
  return items
    .filter((it) => it && it.title)
    .map((it) => ({
      id: it.id,
      title: it.title,
      url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      score: it.score || 0,
      by: it.by || 'unknown',
      comments: it.descendants || 0,
    }));
}

app.get('/api/news', async (req, res) => {
  const TEN_MIN = 10 * 60 * 1000;
  if (newsCache.stories && Date.now() - newsCache.at < TEN_MIN) {
    return res.json(newsCache.stories);
  }
  try {
    // Coalesce concurrent refreshes into one upstream fetch.
    if (!newsCache.pending) {
      newsCache.pending = fetchTopStories().finally(() => { newsCache.pending = null; });
    }
    const stories = await newsCache.pending;
    newsCache.stories = stories;
    newsCache.at = Date.now();
    res.json(stories);
  } catch (err) {
    if (newsCache.stories) return res.json(newsCache.stories); // stale is better than nothing
    res.status(502).json({ error: `Could not reach Hacker News: ${err.message}` });
  }
});

// --- Workspace page ---------------------------------------------------------

app.get('/p/:id', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'workspace.html'));
});

// ---------------------------------------------------------------------------
// WebSocket: rooms keyed by project id
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // projectId -> Set<ws>

function roomMembers(projectId) {
  const room = rooms.get(projectId);
  if (!room) return [];
  return [...room].filter((c) => c.readyState === WebSocket.OPEN).map((c) => c.handle);
}

function broadcast(projectId, message, exclude) {
  const room = rooms.get(projectId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const client of room) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function pushChat(project, entry) {
  project.chat.push(entry);
  if (project.chat.length > MAX_CHAT_HISTORY) {
    project.chat.splice(0, project.chat.length - MAX_CHAT_HISTORY);
  }
  scheduleSave();
}

function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

wss.on('connection', (ws) => {
  ws.handle = null;
  ws.projectId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      const project = findProject(typeof msg.projectId === 'string' ? msg.projectId : '');
      const handle = cleanText(msg.handle, MAX_HANDLE) || 'anonymous';
      if (!project) return sendTo(ws, { type: 'error', message: 'Project not found' });
      if (ws.projectId) return; // already joined

      ws.projectId = project.id;
      ws.handle = handle;
      if (!rooms.has(project.id)) rooms.set(project.id, new Set());
      rooms.get(project.id).add(ws);

      sendTo(ws, {
        type: 'init',
        project: publicProject(project),
        doc: project.doc,
        chat: project.chat.slice(-MAX_CHAT_HISTORY),
        members: roomMembers(project.id),
      });
      broadcast(project.id, { type: 'presence', members: roomMembers(project.id) }, ws);
      return;
    }

    const project = ws.projectId ? findProject(ws.projectId) : null;
    if (!project) return; // must join first

    if (msg.type === 'doc') {
      const text = typeof msg.text === 'string' ? msg.text.slice(0, MAX_DOC) : '';
      project.doc = text;
      scheduleSave();
      broadcast(project.id, { type: 'doc', text, from: ws.handle }, ws);
      return;
    }

    if (msg.type === 'chat') {
      const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT) : '';
      if (!text) return;
      const entry = { from: ws.handle, text, ts: Date.now() };
      pushChat(project, entry);
      broadcast(project.id, { type: 'chat', ...entry });
      return;
    }

    if (msg.type === 'ai') {
      const prompt = typeof msg.prompt === 'string' ? msg.prompt.trim().slice(0, MAX_CHAT) : '';
      if (!prompt) return;
      // Echo the user's @ai message into the room chat first.
      const userEntry = { from: ws.handle, text: `@ai ${prompt}`.slice(0, MAX_CHAT), ts: Date.now() };
      pushChat(project, userEntry);
      broadcast(project.id, { type: 'chat', ...userEntry });
      handleAiRequest(ws, project, prompt, msg.settings || {});
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.projectId) return;
    const room = rooms.get(ws.projectId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) rooms.delete(ws.projectId);
      else broadcast(ws.projectId, { type: 'presence', members: roomMembers(ws.projectId) });
    }
  });

  ws.on('error', () => { /* handled by close */ });
});

// ---------------------------------------------------------------------------
// AI co-builder. API keys arrive per-request from the client's localStorage
// and are NEVER persisted server-side — they exist only for the lifetime of
// the outbound provider call.
// ---------------------------------------------------------------------------

const PROVIDER_BASES = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const NO_KEY_MESSAGE =
  'No AI key is configured in this browser yet. Open ⚙ AI Settings in the top nav, ' +
  'pick a provider and paste an API key — Gemini (aistudio.google.com/apikey), Groq ' +
  '(console.groq.com) and OpenRouter (openrouter.ai) all have generous free tiers. ' +
  'Your key stays in your browser and is only forwarded with your own requests.';

function buildSystemPrompt(project) {
  const recent = project.chat
    .slice(-10)
    .map((m) => `${m.from}: ${m.text}`)
    .join('\n');
  let sys =
    "You are Cohort's AI co-builder sitting in a startup team's group chat. " +
    `The team: ${project.name}: ${project.pitch}. ` +
    'Recent chat context is included. Be concise, concrete and actionable — ' +
    'code when asked, straight answers, no fluff.';
  if (recent) sys += `\n\nRecent chat:\n${recent}`;
  return sys;
}

async function callAiProvider(project, prompt, settings) {
  const provider = typeof settings.provider === 'string' ? settings.provider : 'gemini';
  const apiKey = typeof settings.api_key === 'string' ? settings.api_key.trim() : '';
  const model = (typeof settings.model === 'string' && settings.model.trim()) || 'gemini-2.5-flash';
  if (!apiKey) return NO_KEY_MESSAGE;

  const system = buildSystemPrompt(project);
  const timeout = AbortSignal.timeout(45000);

  if (provider === 'anthropic') {
    // Anthropic Messages API is not OpenAI-shaped.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: timeout,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.error?.message || `HTTP ${res.status}`;
      throw new Error(detail);
    }
    const text = (body.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return text || '(empty response)';
  }

  // OpenAI-compatible providers
  let base;
  if (provider === 'custom') {
    base = typeof settings.base_url === 'string' ? settings.base_url.trim().replace(/\/+$/, '') : '';
    if (!/^https?:\/\//.test(base)) throw new Error('Custom provider needs a valid base URL in AI Settings');
  } else {
    base = PROVIDER_BASES[provider];
    if (!base) throw new Error(`Unknown provider "${provider}"`);
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
    signal: timeout,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error?.message || body?.error || `HTTP ${res.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return body?.choices?.[0]?.message?.content || '(empty response)';
}

async function handleAiRequest(ws, project, prompt, settings) {
  let reply;
  try {
    reply = await callAiProvider(project, prompt, settings);
  } catch (err) {
    reply = `I couldn't reach the AI provider: ${err.message}. Check your key and model in ⚙ AI Settings.`;
  }
  const entry = { from: 'AI', text: String(reply).slice(0, 8000), ts: Date.now() };
  pushChat(project, entry);
  broadcast(project.id, { type: 'chat', ...entry });
}

// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Cohort running at http://localhost:${PORT}`);
});
