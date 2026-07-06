// Cohort — collaborative workspace: WebSocket room, shared editor, group chat.
// All user-generated content is rendered via Cohort.el (textContent), never innerHTML.

'use strict';

(() => {
  const { el } = Cohort;
  const projectId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

  const editor = document.getElementById('ws-editor');
  const chatList = document.getElementById('chat-list');
  const chatInput = document.getElementById('chat-input');
  const connEl = document.getElementById('ws-conn');
  const docStatus = document.getElementById('ws-doc-status');

  let ws = null;
  let project = null;
  let lastTypedAt = 0;
  let docSendTimer = null;
  let reconnectDelay = 1000;
  let hasVoted = false;

  // --- left panel -------------------------------------------------------------
  function renderProject() {
    if (!project) return;
    document.title = `${project.name} — Cohort`;
    document.getElementById('ws-name').textContent = project.name;
    document.getElementById('ws-founder').textContent = `founded by @${project.founder}`;
    document.getElementById('ws-pitch').textContent = project.pitch;
    const tags = document.getElementById('ws-tags');
    tags.replaceChildren();
    for (const t of project.tags || []) tags.appendChild(el('span', 'tag', t));
    document.getElementById('ws-upvote-count').textContent = String(project.upvotes);
  }

  function renderMembers(members) {
    const list = document.getElementById('ws-members');
    list.replaceChildren();
    if (!members.length) {
      list.appendChild(el('p', 'project-founder', 'nobody online'));
      return;
    }
    for (const handle of members) {
      const row = el('div', 'member');
      row.appendChild(el('span', 'member-dot'));
      row.appendChild(el('span', null, '@' + handle));
      list.appendChild(row);
    }
  }

  document.getElementById('ws-upvote').addEventListener('click', () => {
    if (hasVoted) return;
    Cohort.ensureHandle(async (handle) => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/upvote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle }),
        });
        const body = await res.json();
        if (res.ok) {
          document.getElementById('ws-upvote-count').textContent = String(body.upvotes);
        }
        if (res.ok || res.status === 409) {
          hasVoted = true;
          document.getElementById('ws-upvote').classList.add('voted');
        }
      } catch { /* ignore network hiccups */ }
    });
  });

  // --- chat --------------------------------------------------------------------
  function appendChat(msg) {
    const wrap = el('div', 'chat-msg');
    if (msg.from === 'AI') wrap.classList.add('from-ai');
    else if (msg.from === Cohort.getHandle()) wrap.classList.add('from-me');

    const head = el('div', 'chat-from');
    head.appendChild(el('span', null, msg.from === 'AI' ? '🤖 AI' : '@' + msg.from));
    if (msg.ts) {
      const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      head.appendChild(el('span', 'chat-time', time));
    }
    wrap.appendChild(head);
    wrap.appendChild(el('div', 'chat-text', msg.text));

    const nearBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 80;
    chatList.appendChild(wrap);
    if (nearBottom) chatList.scrollTop = chatList.scrollHeight;
    return wrap;
  }

  let thinkingEl = null;
  function showThinking() {
    removeThinking();
    thinkingEl = appendChat({ from: 'AI', text: 'thinking…' });
    thinkingEl.classList.add('pending');
  }
  function removeThinking() {
    if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  }

  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (text.toLowerCase().startsWith('@ai ') || text.toLowerCase() === '@ai') {
      const prompt = text.replace(/^@ai\s*/i, '');
      if (!prompt) return;
      ws.send(JSON.stringify({ type: 'ai', prompt, settings: Cohort.aiRequestSettings() }));
      showThinking();
    } else {
      ws.send(JSON.stringify({ type: 'chat', text }));
    }
    chatInput.value = '';
  });

  // --- shared editor -------------------------------------------------------------
  // Naive last-write-wins sync: incoming full-document updates replace the
  // textarea only if this user hasn't typed within the last second.
  // Planned upgrade: Yjs CRDT for real conflict-free concurrent editing.
  editor.addEventListener('input', () => {
    lastTypedAt = Date.now();
    docStatus.textContent = 'typing…';
    clearTimeout(docSendTimer);
    docSendTimer = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'doc', text: editor.value.slice(0, 200000) }));
        docStatus.textContent = 'synced';
      }
    }, 300);
  });

  function applyRemoteDoc(text) {
    if (Date.now() - lastTypedAt < 1000) return; // don't clobber active typing
    if (editor.value === text) return;
    const { selectionStart, selectionEnd, scrollTop } = editor;
    editor.value = text;
    editor.setSelectionRange(
      Math.min(selectionStart, text.length),
      Math.min(selectionEnd, text.length)
    );
    editor.scrollTop = scrollTop;
    docStatus.textContent = 'updated by a teammate';
  }

  // --- websocket -----------------------------------------------------------------
  function setConn(ok, label) {
    connEl.replaceChildren();
    const dot = el('span', 'status-dot' + (ok ? '' : ' off'), '●');
    connEl.appendChild(dot);
    connEl.appendChild(document.createTextNode(' ' + label));
  }

  function connect(handle) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      reconnectDelay = 1000;
      setConn(true, 'live');
      ws.send(JSON.stringify({ type: 'join', projectId, handle }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'init') {
        project = msg.project;
        renderProject();
        renderMembers(msg.members || []);
        applyRemoteDoc(msg.doc || '');
        chatList.replaceChildren();
        (msg.chat || []).forEach(appendChat);
        chatList.scrollTop = chatList.scrollHeight;
      } else if (msg.type === 'presence') {
        renderMembers(msg.members || []);
      } else if (msg.type === 'doc') {
        applyRemoteDoc(msg.text || '');
      } else if (msg.type === 'chat') {
        if (msg.from === 'AI') removeThinking();
        appendChat(msg);
      } else if (msg.type === 'error') {
        setConn(false, msg.message || 'error');
        document.getElementById('ws-name').textContent = 'Project not found';
        document.getElementById('ws-pitch').textContent =
          'This workspace does not exist. Head back to the projects list.';
      }
    });

    ws.addEventListener('close', () => {
      setConn(false, 'reconnecting…');
      setTimeout(() => connect(handle), reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  // --- boot -------------------------------------------------------------------------
  Cohort.initNav();
  Cohort.ensureHandle((handle) => connect(handle));
})();
