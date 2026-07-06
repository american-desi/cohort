// Cohort — shared client helpers: identity, AI settings, DOM utilities.
// Security note: user-generated content is ALWAYS rendered with
// textContent / createElement (see el() below), never innerHTML.

'use strict';

const Cohort = (() => {
  const HANDLE_KEY = 'cohort_handle';
  const AI_KEY = 'cohort_ai';

  const PROVIDERS = {
    gemini: {
      label: 'Google Gemini',
      model: 'gemini-2.5-flash',
      base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    groq: {
      label: 'Groq',
      model: 'llama-3.3-70b-versatile',
      base: 'https://api.groq.com/openai/v1',
    },
    openrouter: {
      label: 'OpenRouter',
      model: 'google/gemini-2.5-flash',
      base: 'https://openrouter.ai/api/v1',
    },
    anthropic: {
      label: 'Anthropic (Messages API)',
      model: 'claude-sonnet-4-5',
      base: 'https://api.anthropic.com/v1/messages',
    },
    custom: {
      label: 'Custom base URL (OpenAI-compatible)',
      model: '',
      base: '',
    },
  };

  // --- tiny DOM helper (safe: text goes through textContent) ---------------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // --- identity -------------------------------------------------------------
  function getHandle() {
    return (localStorage.getItem(HANDLE_KEY) || '').trim();
  }

  function setHandle(handle) {
    localStorage.setItem(HANDLE_KEY, handle.trim().slice(0, 40));
    updateNavHandle();
  }

  function updateNavHandle() {
    const btn = document.getElementById('nav-handle');
    if (btn) btn.textContent = getHandle() ? '@' + getHandle() : 'set handle';
  }

  // Handle modal — built once, shown on first visit or via the nav chip.
  function buildHandleModal() {
    const backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'handle-modal';
    // Static markup only — no user data flows through innerHTML.
    backdrop.innerHTML = `
      <div class="modal">
        <h2>Welcome to Cohort 👋</h2>
        <p class="modal-sub">Pick a handle so your cohort knows who's building. Stored only in this browser.</p>
        <form id="handle-form">
          <div class="field">
            <label for="handle-input">Your handle</label>
            <input id="handle-input" maxlength="40" required placeholder="e.g. grace_h" autocomplete="off" />
          </div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary">Let's build</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    backdrop.querySelector('#handle-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const value = backdrop.querySelector('#handle-input').value.trim();
      if (!value) return;
      setHandle(value);
      backdrop.classList.remove('open');
      pendingHandleCallbacks.splice(0).forEach((cb) => cb(getHandle()));
    });
    return backdrop;
  }

  const pendingHandleCallbacks = [];

  function openHandleModal() {
    const backdrop = document.getElementById('handle-modal') || buildHandleModal();
    backdrop.querySelector('#handle-input').value = getHandle();
    backdrop.classList.add('open');
    backdrop.querySelector('#handle-input').focus();
  }

  // Calls cb(handle) immediately if a handle exists, otherwise after the
  // first-visit modal is completed.
  function ensureHandle(cb) {
    const existing = getHandle();
    if (existing) {
      cb(existing);
      return;
    }
    pendingHandleCallbacks.push(cb);
    openHandleModal();
  }

  // --- AI settings -------------------------------------------------------------
  function getAISettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AI_KEY) || '{}');
      return {
        provider: parsed.provider || 'gemini',
        api_key: parsed.api_key || '',
        model: parsed.model || '',
        base_url: parsed.base_url || '',
      };
    } catch {
      return { provider: 'gemini', api_key: '', model: '', base_url: '' };
    }
  }

  function saveAISettings(settings) {
    localStorage.setItem(AI_KEY, JSON.stringify(settings));
  }

  function buildAIModal() {
    const backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'ai-modal';
    // Static markup only — saved values are injected via .value below.
    backdrop.innerHTML = `
      <div class="modal">
        <h2>⚙ AI Settings</h2>
        <p class="modal-sub">Your key is stored only in this browser and sent only with your own AI requests.</p>
        <form id="ai-form">
          <div class="field">
            <label for="ai-provider">Provider</label>
            <select id="ai-provider"></select>
          </div>
          <div class="field" id="ai-base-field" style="display:none">
            <label for="ai-base">Base URL</label>
            <input id="ai-base" placeholder="https://api.example.com/v1" autocomplete="off" />
            <p class="hint">An OpenAI-compatible endpoint exposing /chat/completions.</p>
          </div>
          <div class="field">
            <label for="ai-key">API key</label>
            <input id="ai-key" type="password" autocomplete="off" placeholder="paste your key" />
            <p class="hint">Free keys: Gemini — aistudio.google.com/apikey · Groq — console.groq.com · OpenRouter — openrouter.ai</p>
          </div>
          <div class="field">
            <label for="ai-model">Model</label>
            <input id="ai-model" autocomplete="off" />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="ai-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(backdrop);

    const providerSel = backdrop.querySelector('#ai-provider');
    for (const [value, info] of Object.entries(PROVIDERS)) {
      const opt = el('option', null, info.label);
      opt.value = value;
      providerSel.appendChild(opt);
    }

    const modelInput = backdrop.querySelector('#ai-model');
    const baseField = backdrop.querySelector('#ai-base-field');

    providerSel.addEventListener('change', () => {
      const preset = PROVIDERS[providerSel.value] || PROVIDERS.custom;
      modelInput.value = preset.model;
      baseField.style.display = providerSel.value === 'custom' ? '' : 'none';
    });

    backdrop.querySelector('#ai-cancel').addEventListener('click', () => {
      backdrop.classList.remove('open');
    });

    backdrop.querySelector('#ai-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveAISettings({
        provider: providerSel.value,
        api_key: backdrop.querySelector('#ai-key').value.trim(),
        model: modelInput.value.trim(),
        base_url: backdrop.querySelector('#ai-base').value.trim(),
      });
      backdrop.classList.remove('open');
    });

    return backdrop;
  }

  function openAISettings() {
    const backdrop = document.getElementById('ai-modal') || buildAIModal();
    const settings = getAISettings();
    const providerSel = backdrop.querySelector('#ai-provider');
    providerSel.value = settings.provider;
    backdrop.querySelector('#ai-key').value = settings.api_key;
    backdrop.querySelector('#ai-model').value =
      settings.model || (PROVIDERS[settings.provider] || PROVIDERS.custom).model;
    backdrop.querySelector('#ai-base').value = settings.base_url;
    backdrop.querySelector('#ai-base-field').style.display =
      settings.provider === 'custom' ? '' : 'none';
    backdrop.classList.add('open');
  }

  // Settings payload sent with @ai requests (never persisted server-side).
  function aiRequestSettings() {
    const s = getAISettings();
    const preset = PROVIDERS[s.provider] || PROVIDERS.custom;
    return {
      provider: s.provider,
      api_key: s.api_key,
      model: s.model || preset.model,
      base_url: s.base_url,
    };
  }

  // --- shared nav wiring -------------------------------------------------------
  function initNav() {
    updateNavHandle();
    const handleBtn = document.getElementById('nav-handle');
    if (handleBtn) handleBtn.addEventListener('click', openHandleModal);
    const aiBtn = document.getElementById('ai-settings-btn');
    if (aiBtn) aiBtn.addEventListener('click', openAISettings);
  }

  return {
    el,
    PROVIDERS,
    getHandle,
    ensureHandle,
    openHandleModal,
    getAISettings,
    aiRequestSettings,
    openAISettings,
    initNav,
  };
})();
