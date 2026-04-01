// ============================================================
// FocusLens – Background Service Worker
// Aggregates snapshots per tab, persists to chrome.storage,
// and forwards each snapshot to the local MongoDB API server.
// ============================================================

const sessions = {}; // tabId → latest snapshot

// ── Local API sync ──────────────────────────────────────────
// Make sure the local server is running: node server.js
const API_URL = 'http://localhost:3000/api/snapshots';

/**
 * Fire-and-forget POST to the local Express API.
 * Failures are silent – chrome.storage remains the source of truth.
 */
async function pushToLocal(payload) {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    // Server not running or network error – silently ignored
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

    // Sync to local MongoDB server (fire-and-forget)
    pushToLocal({ url: msg.url, ...msg.payload });
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

      // Sync to local MongoDB server
      pushToLocal({ url: msg.url, ...msg.payload });
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

  if (msg.type === 'API_FETCH') {
    fetch(`http://localhost:3000${msg.path}`)
      .then(res => res.json())
      .then(data => reply({ data }))
      .catch(err => reply({ error: err.message }));
    return true;
  }
});

// ── Cleanup ──────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  delete sessions[tabId];
});
