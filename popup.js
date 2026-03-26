// ============================================================
// FocusLens – Popup Script
// ============================================================

const CIRCUMFERENCE = 2 * Math.PI * 54; // radius 54

function scoreColor(s) {
  if (s <= 20) return '#00e5a0';
  if (s <= 45) return '#f5c518';
  if (s <= 70) return '#ff8c42';
  return '#ff3d6b';
}

function attentionLabel(s) {
  if (s <= 20) return 'Focused';
  if (s <= 45) return 'Mild Drift';
  if (s <= 70) return 'Distracted';
  return 'Critical Drift';
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 20) : '');
  } catch (_) { return url.slice(0, 30); }
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ── Render live dashboard ────────────────────────────────────
function renderLive(data) {
  const score = data.driftScore || 0;
  const color = scoreColor(score);
  const label = attentionLabel(score);

  const scrollSpeeds = data.recentScrollSpeeds || [];
  const maxSpeed = Math.max(...scrollSpeeds, 1);

  const botRisk = Math.min(Math.round((data.suspiciousPatterns || 0) * 12.5), 100);
  const botColor = botRisk < 30 ? '#00e5a0' : botRisk < 60 ? '#f5c518' : '#ff3d6b';

  const tabClass = data.tabSwitches > 5 ? 'alert' : data.tabSwitches > 2 ? 'warn' : '';
  const idleClass = data.idlePeriodCount > 4 ? 'alert' : data.idlePeriodCount > 1 ? 'warn' : '';
  const scrollClass = data.rapidScrollCount > 5 ? 'alert' : data.rapidScrollCount > 2 ? 'warn' : '';

  const offset = CIRCUMFERENCE * (1 - score / 100);

  const scrollBarsHTML = scrollSpeeds.length
    ? scrollSpeeds.map(sp => {
      const h = Math.max(2, Math.round((sp / maxSpeed) * 28));
      const c = sp > 3000 ? '#ff3d6b' : sp > 1500 ? '#ff8c42' : '#7c6eff';
      return `<div class="scroll-bar" style="height:${h}px;background:${c}"></div>`;
    }).join('')
    : '<span style="font-size:10px;color:var(--muted);margin:auto">No scroll data</span>';

  document.getElementById('live-content').innerHTML = `
    <div class="score-section">
      <div class="ring-wrap">
        <svg class="ring-svg" width="140" height="140" viewBox="0 0 140 140">
          <circle class="ring-bg" cx="70" cy="70" r="54"/>
          <circle class="ring-fill"
            cx="70" cy="70" r="54"
            stroke="${color}"
            stroke-dasharray="${CIRCUMFERENCE}"
            stroke-dashoffset="${offset}"
          />
        </svg>
        <div class="ring-center">
          <div class="ring-score" style="color:${color}">${score}</div>
          <div class="ring-label">Drift Score</div>
        </div>
      </div>
      <div class="status-pill" style="background:${color}22;color:${color};border:1px solid ${color}44">
        ${label}
      </div>
      <div class="session-time">Session: ${fmtTime(data.elapsed || 0)}</div>
    </div>

    <div class="metrics">
      <div class="metric ${tabClass}">
        <div class="metric-icon">🔄</div>
        <div class="metric-val">${data.tabSwitches || 0}</div>
        <div class="metric-key">Tab Switches</div>
      </div>
      <div class="metric ${idleClass}">
        <div class="metric-icon">💤</div>
        <div class="metric-val">${data.totalIdleSec || 0}s</div>
        <div class="metric-key">Idle Time</div>
      </div>
      <div class="metric ${scrollClass}">
        <div class="metric-icon">⚡</div>
        <div class="metric-val">${data.rapidScrollCount || 0}</div>
        <div class="metric-key">Rapid Scrolls</div>
      </div>
      <div class="metric">
        <div class="metric-icon">📋</div>
        <div class="metric-val">${(data.copyCount || 0) + (data.pasteCount || 0)}</div>
        <div class="metric-key">Copy/Paste</div>
      </div>
      <div class="metric">
        <div class="metric-icon">🖱️</div>
        <div class="metric-val">${data.clickCount || 0}</div>
        <div class="metric-key">Clicks</div>
      </div>
      <div class="metric">
        <div class="metric-icon">↔️</div>
        <div class="metric-val">${data.avgFocusLossDuration ? fmtMs(data.avgFocusLossDuration) : '—'}</div>
        <div class="metric-key">Avg Focus Loss</div>
      </div>
    </div>

    <div class="scroll-section">
      <div class="section-label">Scroll Speed Pattern</div>
      <div class="scroll-bars">${scrollBarsHTML}</div>
    </div>

    <div class="bot-section">
      <div class="section-label">Engagement Authenticity</div>
      <div class="bot-bar-wrap">
        <div class="bot-icon">${botRisk < 30 ? '✅' : botRisk < 60 ? '⚠️' : '🤖'}</div>
        <div class="bot-info">
          <div class="bot-label">Bot-like pattern risk</div>
          <div class="bot-bar-bg">
            <div class="bot-bar-fill" style="width:${botRisk}%;background:${botColor}"></div>
          </div>
        </div>
        <div class="bot-val" style="color:${botColor}">${botRisk}%</div>
      </div>
    </div>
  `;
}

// ── Render history ───────────────────────────────────────────
function renderHistory(history) {
  const el = document.getElementById('history-list');
  if (!history || history.length === 0) {
    el.innerHTML = `
      <div class="no-data" style="min-height:200px">
        <div class="no-data-icon">📊</div>
        <div class="no-data-title">No history yet</div>
        <div class="no-data-sub">Sessions will appear here as you browse.</div>
      </div>`;
    return;
  }

  const items = [...history].reverse().slice(0, 30);
  el.innerHTML = items.map(item => {
    const color = scoreColor(item.driftScore || 0);
    const label = attentionLabel(item.driftScore || 0);
    return `
      <div class="history-item">
        <div class="history-dot" style="background:${color}"></div>
        <div class="history-info">
          <div class="history-url">${shortUrl(item.url || '')}</div>
          <div class="history-score" style="color:${color}">${label} · Score ${item.driftScore || 0}</div>
        </div>
        <div class="history-time">${timeAgo(item.ts)}</div>
      </div>`;
  }).join('');
}

// ── Init ─────────────────────────────────────────────────────
let liveInterval = null;

function stopLivePolling() {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }
}

function startLivePolling() {
  stopLivePolling();
  loadLive();
  liveInterval = setInterval(loadLive, 2000);
}

function loadLive() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const tab = tabs[0];

    chrome.tabs.sendMessage(tab.id, { type: 'GET_SNAPSHOT' }, (resp) => {
      if (!chrome.runtime.lastError && resp) {
        // Content script responded (normal web page)
        renderLive(resp);
        return;
      }

      // Content script not available (e.g. extension pages like dashboard.html,
      // chrome:// pages, etc.) — fall back to background session data pushed
      // by the dashboard's own pushSnapshot().
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_SESSION' }, (res) => {
        if (chrome.runtime.lastError || !res || !res.session) {
          stopLivePolling();
          document.getElementById('live-content').innerHTML = `
            <div class="no-data">
              <div class="no-data-icon">🕵️</div>
              <div class="no-data-title">No data yet</div>
              <div class="no-data-sub">Interact with the current page for a few seconds, then click Refresh.</div>
              <button class="refresh-btn" id="refresh-btn">Refresh</button>
            </div>`;
          document.getElementById('refresh-btn')?.addEventListener('click', startLivePolling);
          return;
        }
        renderLive(res.session);
      });
    });
  });
}

function loadHistory() {
  chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (history) => {
    renderHistory(history);
  });
}

// Tab switching
document.getElementById('btn-live').addEventListener('click', () => {
  document.getElementById('btn-live').classList.add('active');
  document.getElementById('btn-history').classList.remove('active');
  document.getElementById('panel-live').style.display = 'block';
  document.getElementById('panel-history').style.display = 'none';
  startLivePolling();
});

document.getElementById('btn-history').addEventListener('click', () => {
  document.getElementById('btn-history').classList.add('active');
  document.getElementById('btn-live').classList.remove('active');
  document.getElementById('panel-live').style.display = 'none';
  document.getElementById('panel-history').style.display = 'block';
  stopLivePolling();
  loadHistory();
});

// Stop polling when popup is closed
window.addEventListener('unload', stopLivePolling);

document.getElementById('clear-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' }, () => loadHistory());
});

document.getElementById('btn-testbed').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

// Kick off
startLivePolling();
