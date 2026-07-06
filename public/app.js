// Cohort — index page: tab views, projects grid, leaderboard, HN news.
// All user-generated content is rendered via Cohort.el (textContent), never innerHTML.

'use strict';

(() => {
  const { el } = Cohort;
  const VIEWS = ['home', 'projects', 'opensource', 'leaderboard', 'news', 'learn'];
  let projects = [];
  let newsLoaded = false;
  let ossLoaded = false;

  // --- tab switching ------------------------------------------------------
  function currentView() {
    const hash = location.hash.replace('#', '');
    return VIEWS.includes(hash) ? hash : 'home';
  }

  function showView(name, push) {
    for (const v of VIEWS) {
      document.getElementById(`view-${v}`).classList.toggle('active', v === name);
    }
    document.querySelectorAll('.nav-tab[data-view]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.view === name);
    });
    if (push && location.hash !== `#${name}`) {
      history.pushState(null, '', `#${name}`);
    }
    if (name === 'projects' || name === 'leaderboard') loadProjects();
    if (name === 'news' && !newsLoaded) loadNews();
    if (name === 'opensource' && !ossLoaded) loadOpenSource();
  }

  document.querySelectorAll('.nav-tab[data-view]').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view, true));
  });
  window.addEventListener('popstate', () => showView(currentView(), false));
  window.addEventListener('hashchange', () => showView(currentView(), false));

  // --- projects -------------------------------------------------------------
  async function loadProjects() {
    try {
      const res = await fetch('/api/projects');
      projects = await res.json();
    } catch {
      projects = [];
    }
    renderProjects();
    renderLeaderboard();
  }

  function upvoteButton(project, onVoted) {
    const btn = el('button', 'upvote-btn');
    btn.appendChild(el('span', null, '▲'));
    const count = el('span', null, String(project.upvotes));
    btn.appendChild(count);
    btn.title = 'One upvote per handle';
    btn.addEventListener('click', () => {
      Cohort.ensureHandle(async (handle) => {
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/upvote`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ handle }),
          });
          const body = await res.json();
          if (res.ok) {
            project.upvotes = body.upvotes;
            count.textContent = String(body.upvotes);
            btn.classList.add('voted');
            if (onVoted) onVoted();
          } else if (res.status === 409) {
            btn.classList.add('voted');
          }
        } catch { /* network hiccup: leave button as-is */ }
      });
    });
    return btn;
  }

  function renderProjects() {
    const grid = document.getElementById('project-grid');
    grid.replaceChildren();
    if (!projects.length) {
      grid.appendChild(el('p', 'empty-note', 'No projects yet — start the first one.'));
      return;
    }
    for (const p of projects) {
      const card = el('div', 'project-card');
      card.appendChild(el('h3', null, p.name));
      card.appendChild(el('p', 'project-pitch', p.pitch));
      card.appendChild(el('p', 'project-founder', `founded by @${p.founder}`));

      if (p.repo) {
        const repo = el('a', 'repo-link', p.repo.replace('https://github.com/', ''));
        repo.href = p.repo;
        repo.target = '_blank';
        repo.rel = 'noopener noreferrer';
        card.appendChild(repo);
      }

      if (p.tags && p.tags.length) {
        const row = el('div', 'tag-row');
        for (const t of p.tags) row.appendChild(el('span', 'tag', t));
        card.appendChild(row);
      }

      const actions = el('div', 'card-actions');
      actions.appendChild(upvoteButton(p, renderLeaderboard));
      const open = el('a', 'btn btn-ghost btn-sm', 'Open workspace →');
      open.href = `/p/${encodeURIComponent(p.id)}`;
      actions.appendChild(open);
      card.appendChild(actions);

      grid.appendChild(card);
    }
  }

  // --- leaderboard --------------------------------------------------------------
  function renderLeaderboard() {
    const board = document.getElementById('board');
    board.replaceChildren();
    const ranked = [...projects].sort((a, b) => b.upvotes - a.upvotes);
    if (!ranked.length) {
      board.appendChild(el('p', 'empty-note', 'Nothing on the board yet.'));
      return;
    }
    ranked.forEach((p, i) => {
      const rank = i + 1;
      const row = el('div', `board-row${rank <= 3 ? ` rank-${rank}` : ''}`);
      row.appendChild(el('span', 'board-rank', `#${rank}`));
      const info = el('div', 'board-info');
      const title = el('h3');
      const link = el('a', null, p.name);
      link.href = `/p/${encodeURIComponent(p.id)}`;
      title.appendChild(link);
      info.appendChild(title);
      info.appendChild(el('p', null, p.pitch));
      row.appendChild(info);
      row.appendChild(el('span', 'board-votes', `▲ ${p.upvotes}`));
      board.appendChild(row);
    });
  }

  // --- news -----------------------------------------------------------------------
  async function loadNews() {
    const list = document.getElementById('news-list');
    list.replaceChildren(el('p', 'empty-note', 'Loading Hacker News…'));
    try {
      const res = await fetch('/api/news');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const stories = await res.json();
      newsLoaded = true;
      list.replaceChildren();
      stories.forEach((s, i) => {
        const item = el('div', 'news-item');
        item.appendChild(el('span', 'news-rank', String(i + 1)));
        const body = el('div', 'news-body');
        const title = el('a', 'news-title', s.title);
        title.href = s.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
        body.appendChild(title);

        const meta = el('p', 'news-meta');
        meta.appendChild(document.createTextNode(`${s.score} points by ${s.by} · `));
        const comments = el('a', null, `${s.comments} comments`);
        comments.href = `https://news.ycombinator.com/item?id=${encodeURIComponent(s.id)}`;
        comments.target = '_blank';
        comments.rel = 'noopener noreferrer';
        meta.appendChild(comments);
        body.appendChild(meta);

        item.appendChild(body);
        list.appendChild(item);
      });
    } catch {
      list.replaceChildren(el('p', 'empty-note', 'Could not load Hacker News right now. Try again in a minute.'));
    }
  }

  // --- open source discovery ------------------------------------------------------
  async function loadOpenSource() {
    const grid = document.getElementById('oss-grid');
    grid.replaceChildren(el('p', 'empty-note', 'Finding projects that want contributors…'));
    try {
      const res = await fetch('/api/opensource');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const repos = await res.json();
      ossLoaded = true;
      grid.replaceChildren();
      for (const r of repos) {
        const card = el('div', 'project-card');
        card.appendChild(el('h3', null, r.name));
        card.appendChild(el('p', 'project-pitch', r.description));
        const meta = el('p', 'oss-meta', `★ ${r.stars.toLocaleString()}${r.language ? ` · ${r.language}` : ''}`);
        card.appendChild(meta);
        const actions = el('div', 'card-actions');
        const team = el('button', 'btn btn-primary btn-sm', 'Team up →');
        team.title = 'Open a Cohort workspace for this repo — coordinate contributions with chat and @ai';
        team.addEventListener('click', () => {
          Cohort.ensureHandle(async (handle) => {
            team.disabled = true;
            try {
              const resp = await fetch('/api/projects/adopt', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ repo: r.url, name: r.name.split('/').pop(), pitch: '', handle }),
              });
              const body = await resp.json();
              if (resp.ok) location.href = `/p/${encodeURIComponent(body.id)}`;
              else team.disabled = false;
            } catch { team.disabled = false; }
          });
        });
        actions.appendChild(team);
        const issues = el('a', 'btn btn-ghost btn-sm', 'Good first issues →');
        issues.href = r.issuesUrl;
        issues.target = '_blank';
        issues.rel = 'noopener noreferrer';
        actions.appendChild(issues);
        const repo = el('a', 'btn btn-ghost btn-sm', 'View repo');
        repo.href = r.url;
        repo.target = '_blank';
        repo.rel = 'noopener noreferrer';
        actions.appendChild(repo);
        card.appendChild(actions);
        grid.appendChild(card);
      }
    } catch {
      grid.replaceChildren(el('p', 'empty-note', 'Could not reach GitHub right now. Try again in a minute.'));
    }
  }

  // --- start-a-project modal ------------------------------------------------------
  const projectModal = document.getElementById('project-modal');

  function openProjectModal() {
    Cohort.ensureHandle((handle) => {
      document.getElementById('pf-handle').value = handle;
      document.getElementById('pf-error').textContent = '';
      projectModal.classList.add('open');
      document.getElementById('pf-name').focus();
    });
  }

  document.getElementById('new-project-btn').addEventListener('click', openProjectModal);
  document.getElementById('cta-start').addEventListener('click', openProjectModal);
  document.getElementById('cta-browse').addEventListener('click', () => showView('projects', true));
  document.getElementById('cta-learn').addEventListener('click', () => showView('learn', true));

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).classList.remove('open');
    });
  });
  projectModal.addEventListener('click', (e) => {
    if (e.target === projectModal) projectModal.classList.remove('open');
  });

  document.getElementById('project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('pf-error');
    errorBox.textContent = '';
    const payload = {
      name: document.getElementById('pf-name').value.trim(),
      pitch: document.getElementById('pf-pitch').value.trim(),
      founder: document.getElementById('pf-handle').value.trim(),
      tags: document.getElementById('pf-tags').value,
      repo: document.getElementById('pf-repo').value.trim(),
    };
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        errorBox.textContent = body.error || 'Something went wrong.';
        return;
      }
      projectModal.classList.remove('open');
      e.target.reset();
      await loadProjects();
      showView('projects', true);
    } catch {
      errorBox.textContent = 'Network error — is the server running?';
    }
  });

  // --- boot ------------------------------------------------------------------------
  Cohort.initNav();
  Cohort.ensureHandle(() => {});
  showView(currentView(), false);
  loadProjects();
})();
