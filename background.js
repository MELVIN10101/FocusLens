// ============================================================
// FocusLens – Background Service Worker
// Aggregates snapshots per tab, persists to chrome.storage,
// and forwards each snapshot to the Netlify cloud backend.
// ============================================================

const sessions = {}; // tabId → latest snapshot

// ── Cloud sync ───────────────────────────────────────────────
// Replace this with your actual Netlify site URL after deploying.
// Example: 'https://focuslens.netlify.app'
const NETLIFY_SITE = 'PLACEHOLDER_NETLIFY_URL';
const API_URL = `${NETLIFY_SITE}/.netlify/functions/snapshots`;

/**
 * Fire-and-forget POST to the Netlify function.
 * Failures are silent – local storage remains the source of truth.
 */
async function pushToCloud(payload) {
  if (!NETLIFY_SITE || NETLIFY_SITE === 'PLACEHOLDER_NETLIFY_URL') return;
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    // Network error – silently ignored
  }
}

// ── Message handlers ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'SNAPSHOT' && sender.tab) {
    const tabId = sender.tab.id;
    sessions[tabId] = {
      ...msg.payload,
      url: msg.url,
      lastUpdated: msg.ts,
    };

    // Persist to local storage (keep last 500 snapshots)
    chrome.storage.local.get(['history'], (res) => {
      const history = res.history || [];
      history.push({
        tabId,
        url: msg.url,
        ...msg.payload,
        ts: msg.ts,
      });
      if (history.length > 500) history.splice(0, history.length - 500);
      chrome.storage.local.set({ history, lastSession: sessions[tabId] });
    });

    // Sync to cloud (fire-and-forget)
    pushToCloud({ url: msg.url, ...msg.payload });
  }
});

// Also handle SNAPSHOT messages from extension pages (e.g. dashboard.html)
// which call chrome.runtime.sendMessage directly instead of via a content script.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'SNAPSHOT' && !sender.tab) {
    // Message came from an extension page – use the sender's tab query
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const tabId = tabs[0].id;
      sessions[tabId] = {
        ...msg.payload,
        url: msg.url,
        lastUpdated: msg.ts,
      };

      // Sync to cloud
      pushToCloud({ url: msg.url, ...msg.payload });
    });
  }
});

// ── Popup data providers ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'GET_ACTIVE_SESSION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return reply(null);
      const tabId = tabs[0].id;
      const session = sessions[tabId] || null;
      reply({ session, tabId, url: tabs[0].url });
    });
    return true;
  }

  if (msg.type === 'GET_HISTORY') {
    chrome.storage.local.get(['history'], (res) => {
      reply(res.history || []);
    });
    return true;
  }

  if (msg.type === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ history: [] }, () => reply({ ok: true }));
    return true;
  }
});

// ── Cleanup ──────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  delete sessions[tabId];
});
