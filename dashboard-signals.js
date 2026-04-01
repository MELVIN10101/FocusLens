// ============================================================
// FocusLens · dashboard-signals.js
// Live session signal tracking.
// NOTE: The drift meter (ring + score + status tag) is owned
// by dashboard-analytics.js → loadHighestSite(). This file
// only updates the signal counters, log, and clock.
// ============================================================

const CIRCUMFERENCE = 2 * Math.PI * 50;

const S = {
  sessionStart: Date.now(),
  tabSwitches: 0,
  focusLossDurations: [],
  lastBlurTime: null,
  isTabFocused: true,

  lastMouseMove: Date.now(),
  idlePeriods: [],
  idleStart: null,
  isIdle: false,
  IDLE_THRESHOLD: 10000,
  mouseMoveCount: 0,
  mousePositions: [],

  scrollSpeeds: [],
  lastScrollY: window.scrollY,
  lastScrollTime: Date.now(),
  rapidScrollCount: 0,
  RAPID_THRESHOLD: 3000,
  lastScrollSpeed: 0,

  clicks: 0,
  lastClickTarget: '—',

  copyCount: 0,
  pasteCount: 0,
  lastClipboard: '—',

  suspiciousPatterns: 0,
  linearCount: 0,

  botSimInterval: null,
};

function now() { return Date.now(); }
function elapsed() { return now() - S.sessionStart; }

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function driftScore() {
  const switchP = Math.min(S.tabSwitches * 8, 30);
  const idleP   = Math.min(S.idlePeriods.length * 6, 25);
  const scrollP = Math.min(S.rapidScrollCount * 4, 20);
  const cpP     = Math.min((S.copyCount + S.pasteCount) * 3, 15);
  const botP    = Math.min(S.suspiciousPatterns * 5, 10);
  return Math.min(Math.round(switchP + idleP + scrollP + cpP + botP), 100);
}

function scoreColor(s) {
  if (s <= 20) return 'var(--green)';
  if (s <= 45) return 'var(--yellow)';
  if (s <= 70) return 'var(--orange)';
  return 'var(--red)';
}

function scoreLabel(s) {
  if (s <= 20) return 'Focused';
  if (s <= 45) return 'Mild Drift';
  if (s <= 70) return 'Distracted';
  return 'Critical Drift';
}

function totalIdleSec() {
  const done = S.idlePeriods.reduce((a, b) => a + b, 0);
  const cur  = S.idleStart ? now() - S.idleStart : 0;
  return Math.round((done + cur) / 1000);
}

// ── Logging ──────────────────────────────────────────────────
const logStream = document.getElementById('log-stream');
const MAX_LOG = 80;

function log(type, msg) {
  const ts = fmtTime(elapsed());
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-ts">${ts}</span><span class="log-type ${type}">${type.toUpperCase()}</span><span class="log-msg">${msg}</span>`;
  logStream.prepend(entry);
  while (logStream.children.length > MAX_LOG) logStream.lastChild.remove();
}

function clearLog() { logStream.innerHTML = ''; }

function flash(sigId) {
  const el = document.getElementById(sigId);
  if (!el) return;
  el.classList.remove('firing');
  void el.offsetWidth;
  el.classList.add('firing');
  setTimeout(() => el.classList.remove('firing'), 500);
}

function setDot(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'sig-dot' + (state ? ' ' + state : '');
}

// ── Tab visibility ────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    S.lastBlurTime = now();
    S.tabSwitches++;
    S.isTabFocused = false;
    document.getElementById('sv-tab').textContent = 'Away';
    setDot('sd-tab', 'alert');
    flash('sig-tab');
    log('tab', `Left page · switch #${S.tabSwitches}`);
  } else {
    if (S.lastBlurTime) {
      const dur = now() - S.lastBlurTime;
      S.focusLossDurations.push(dur);
      S.lastBlurTime = null;
      log('tab', `Returned after ${(dur / 1000).toFixed(1)}s`);
    }
    S.isTabFocused = true;
    document.getElementById('sv-tab').textContent = 'Focused';
    setDot('sd-tab', 'on');
    flash('sig-tab');
  }
});

// ── Mouse movement ────────────────────────────────────────────
const heatCanvas = document.getElementById('mouse-canvas');
const heatCtx    = heatCanvas.getContext('2d');
const mousePoints = [];

function resizeCanvas() {
  heatCanvas.width  = heatCanvas.offsetWidth;
  heatCanvas.height = heatCanvas.offsetHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function drawMouseTrail() {
  heatCtx.clearRect(0, 0, heatCanvas.width, heatCanvas.height);
  if (mousePoints.length < 2) return;
  heatCtx.beginPath();
  heatCtx.strokeStyle = 'rgba(155,114,255,0.4)';
  heatCtx.lineWidth = 1.5;
  heatCtx.moveTo(mousePoints[0].x, mousePoints[0].y);
  for (let i = 1; i < mousePoints.length; i++) heatCtx.lineTo(mousePoints[i].x, mousePoints[i].y);
  heatCtx.stroke();
  const last = mousePoints[mousePoints.length - 1];
  heatCtx.beginPath();
  heatCtx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  heatCtx.fillStyle = '#9b72ff';
  heatCtx.fill();
}

function stdDev(arr) {
  if (!arr.length) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / arr.length);
}

function checkLinear() {
  const pts = S.mousePositions.slice(-8);
  if (pts.length < 5) return false;
  const dx = pts.slice(1).map((p, i) => p.x - pts[i].x);
  const dy = pts.slice(1).map((p, i) => p.y - pts[i].y);
  return stdDev(dx) < 2.5 && stdDev(dy) < 2.5;
}

let moveSample = 0;
document.addEventListener('mousemove', (e) => {
  S.lastMouseMove = now();
  S.mouseMoveCount++;
  moveSample++;

  if (S.isIdle) {
    const dur = now() - S.idleStart;
    S.idlePeriods.push(dur);
    S.idleStart = null;
    S.isIdle = false;
    document.getElementById('sv-idle').textContent = 'Active';
    setDot('sd-idle', 'on');
    log('idle', `Idle ended · ${(dur / 1000).toFixed(1)}s`);
    flash('sig-idle');
  }

  if (moveSample % 8 === 0) {
    S.mousePositions.push({ x: e.clientX, y: e.clientY });
    if (S.mousePositions.length > 60) S.mousePositions.shift();
    if (checkLinear()) {
      S.linearCount++;
      if (S.linearCount >= 3) {
        S.suspiciousPatterns++;
        document.getElementById('sv-mouse').textContent = 'Suspicious!';
        setDot('sd-mouse', 'alert');
        flash('sig-mouse');
        log('bot', `Linear mouse pattern #${S.suspiciousPatterns}`);
        S.linearCount = 0;
      }
    } else {
      S.linearCount = Math.max(0, S.linearCount - 1);
      if (S.suspiciousPatterns === 0) {
        document.getElementById('sv-mouse').textContent = 'Normal';
        setDot('sd-mouse', 'on');
      }
    }
  }

  const rect = heatCanvas.getBoundingClientRect();
  const rx = e.clientX - rect.left;
  const ry = e.clientY - rect.top;
  if (rx >= 0 && rx <= heatCanvas.width && ry >= 0 && ry <= heatCanvas.height) {
    mousePoints.push({ x: rx, y: ry });
    if (mousePoints.length > 200) mousePoints.shift();
    drawMouseTrail();
  }
}, { passive: true });

// ── Idle detection ────────────────────────────────────────────
setInterval(() => {
  const since = now() - S.lastMouseMove;
  if (since >= S.IDLE_THRESHOLD && !S.isIdle && !document.hidden) {
    S.isIdle = true;
    S.idleStart = now() - since;
    document.getElementById('sv-idle').textContent = 'Idle!';
    setDot('sd-idle', 'warn');
    flash('sig-idle');
    log('idle', `Idle started (${(since / 1000).toFixed(0)}s no movement)`);
  }
}, 1500);

// ── Scroll ────────────────────────────────────────────────────
const scrollChart = document.getElementById('scroll-chart');
const MAX_BARS = 30;

function addScrollBar(speed) {
  const max   = 5000;
  const h     = Math.max(3, Math.round((Math.min(speed, max) / max) * 56));
  const color = speed > S.RAPID_THRESHOLD ? '#ff3366' : speed > 1500 ? '#ff7a3d' : '#9b72ff';
  const bar   = document.createElement('div');
  bar.className    = 'chart-bar';
  bar.style.height = h + 'px';
  bar.style.background = color;
  bar.title = `${Math.round(speed)} px/s`;
  scrollChart.appendChild(bar);
  while (scrollChart.children.length > MAX_BARS) scrollChart.firstChild.remove();
}

let scrollRaf = null;
document.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    const t  = now();
    const y  = window.scrollY;
    const dt = Math.max((t - S.lastScrollTime) / 1000, 0.001);
    const dy = Math.abs(y - S.lastScrollY);
    const speed = dy / dt;

    S.lastScrollSpeed = speed;
    S.scrollSpeeds.push(speed);
    if (S.scrollSpeeds.length > 200) S.scrollSpeeds.shift();
    addScrollBar(speed);

    const spd = Math.round(speed);
    document.getElementById('sv-scroll').textContent = `${spd} px/s`;

    if (speed > S.RAPID_THRESHOLD) {
      S.rapidScrollCount++;
      setDot('sd-scroll', 'alert');
      log('scroll', `Rapid scroll · ${spd} px/s`);
    } else {
      setDot('sd-scroll', speed > 800 ? 'warn' : 'on');
    }
    flash('sig-scroll');
    S.lastScrollY = y;
    S.lastScrollTime = t;
    scrollRaf = null;
  });
}, { passive: true });

// ── Clicks ────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  S.clicks++;
  const tag = e.target.tagName.toLowerCase();
  S.lastClickTarget = tag + (e.target.id ? '#' + e.target.id : '');
  document.getElementById('sv-click').textContent = S.lastClickTarget;
  setDot('sd-click', 'on');
  flash('sig-click');
  log('click', `${tag} at (${e.clientX}, ${e.clientY})`);
});

// ── Copy / Paste ──────────────────────────────────────────────
document.addEventListener('copy', () => {
  S.copyCount++;
  document.getElementById('sv-cp').textContent = `copy ×${S.copyCount}`;
  setDot('sd-cp', 'warn');
  flash('sig-cp');
  log('copy', `Copy event · total ${S.copyCount}`);
});

document.addEventListener('paste', () => {
  S.pasteCount++;
  document.getElementById('sv-cp').textContent = `paste ×${S.pasteCount}`;
  setDot('sd-cp', 'warn');
  flash('sig-cp');
  log('copy', `Paste event · total ${S.pasteCount}`);
});

// ── Cursor tooltip ────────────────────────────────────────────
const cursorTip = document.getElementById('cursor-tip');
document.addEventListener('mousemove', (e) => {
  cursorTip.style.left    = (e.clientX + 14) + 'px';
  cursorTip.style.top     = (e.clientY + 8)  + 'px';
  cursorTip.textContent   = `${e.clientX}, ${e.clientY}`;
  cursorTip.style.opacity = '1';
}, { passive: true });
document.addEventListener('mouseleave', () => { cursorTip.style.opacity = '0'; });

// ── Render loop (counters + clock ONLY — meter owned by analytics) ──
function render() {
  document.getElementById('c-tabs').textContent     = S.tabSwitches;
  document.getElementById('c-idles').textContent    = S.idlePeriods.length + (S.isIdle ? 1 : 0);
  document.getElementById('c-idle-time').textContent = totalIdleSec() + 's';
  document.getElementById('c-rscroll').textContent  = S.rapidScrollCount;
  document.getElementById('c-clicks').textContent   = S.clicks;
  document.getElementById('c-cp').textContent       = S.copyCount + S.pasteCount;
  document.getElementById('c-mmove').textContent    = S.mouseMoveCount;

  const botEl = document.getElementById('c-bot');
  botEl.textContent  = S.suspiciousPatterns;
  botEl.style.color  = S.suspiciousPatterns === 0 ? 'var(--green)' : S.suspiciousPatterns < 3 ? 'var(--yellow)' : 'var(--red)';

  document.getElementById('session-clock').textContent = fmtTime(elapsed());
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// ── Snapshot push ─────────────────────────────────────────────
function pushSnapshot() {
  const score = driftScore();
  const totalIdleMs = S.idlePeriods.reduce((a, b) => a + b, 0) + (S.idleStart ? now() - S.idleStart : 0);
  const avgFocusLoss = S.focusLossDurations.length
    ? Math.round(S.focusLossDurations.reduce((a, b) => a + b, 0) / S.focusLossDurations.length)
    : 0;
  try {
    chrome.runtime.sendMessage({
      type: 'SNAPSHOT', url: location.href, ts: now(),
      payload: {
        driftScore: score,
        attention: { label: scoreLabel(score), color: score <= 20 ? '#00e5a0' : score <= 45 ? '#f5c518' : score <= 70 ? '#ff8c42' : '#ff3d6b' },
        elapsed: elapsed(),
        tabSwitches: S.tabSwitches,
        avgFocusLossDuration: avgFocusLoss,
        totalIdleSec: Math.round(totalIdleMs / 1000),
        idlePeriodCount: S.idlePeriods.length + (S.isIdle ? 1 : 0),
        rapidScrollCount: S.rapidScrollCount,
        copyCount: S.copyCount,
        pasteCount: S.pasteCount,
        clickCount: S.clicks,
        suspiciousPatterns: S.suspiciousPatterns,
        mouseMoveCount: S.mouseMoveCount,
        recentScrollSpeeds: S.scrollSpeeds.slice(-10).map(s => Math.round(s)),
      },
    });
  } catch (_) {}
}
setInterval(pushSnapshot, 2000);
pushSnapshot();

// ── Test controls ─────────────────────────────────────────────
function simulateTabSwitch() {
  S.tabSwitches++;
  flash('sig-tab');
  log('tab', `Simulated switch · total ${S.tabSwitches}`);
}

function testIdle() {
  if (!S.isIdle) {
    S.isIdle = true;
    S.idleStart = now() - 10000;
    document.getElementById('sv-idle').textContent = 'Idle! (forced)';
    setDot('sd-idle', 'warn');
    flash('sig-idle');
    log('idle', 'Idle forced via test control');
  }
}

function doCopy() {
  navigator.clipboard.writeText('Attention drift test — FocusLens').catch(() => {});
  document.dispatchEvent(new ClipboardEvent('copy'));
}

function triggerRapidScroll() {
  let step = 0;
  const iv = setInterval(() => { window.scrollBy(0, 200); if (++step >= 20) clearInterval(iv); }, 16);
}

function simulateBotMouse() {
  if (S.botSimInterval) return;
  let x = 100, y = 200, count = 0;
  log('bot', 'Simulating linear mouse movement…');
  S.botSimInterval = setInterval(() => {
    x += 5;
    S.mousePositions.push({ x, y });
    if (S.mousePositions.length > 60) S.mousePositions.shift();
    moveSample += 8;
    if (++count >= 40) { clearInterval(S.botSimInterval); S.botSimInterval = null; }
  }, 30);
}

function resetBotFlag() {
  S.suspiciousPatterns = 0;
  S.linearCount = 0;
  document.getElementById('sv-mouse').textContent = 'Normal';
  setDot('sd-mouse', 'on');
  log('bot', 'Bot flags reset');
}

function resetAll() {
  Object.assign(S, {
    sessionStart: Date.now(), tabSwitches: 0, focusLossDurations: [],
    lastBlurTime: null, idlePeriods: [], idleStart: null, isIdle: false,
    lastMouseMove: Date.now(), mouseMoveCount: 0, mousePositions: [],
    scrollSpeeds: [], lastScrollY: window.scrollY, lastScrollTime: Date.now(),
    rapidScrollCount: 0, lastScrollSpeed: 0, clicks: 0, lastClickTarget: '—',
    copyCount: 0, pasteCount: 0, suspiciousPatterns: 0, linearCount: 0,
  });
  ['sv-tab','sv-idle','sv-scroll','sv-click','sv-cp','sv-mouse'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  ['sd-tab','sd-idle','sd-scroll','sd-click','sd-cp','sd-mouse'].forEach(id => setDot(id, ''));
  document.getElementById('sv-tab').textContent   = 'Focused';
  document.getElementById('sv-idle').textContent  = 'Active';
  document.getElementById('sv-mouse').textContent = 'Normal';
  scrollChart.innerHTML = '';
  mousePoints.length = 0;
  drawMouseTrail();
  clearLog();
  log('click', 'All signals reset ↺');
}

// Init
log('click', 'FocusLens testbed ready · all signals active');
log('idle',   `Idle threshold: ${S.IDLE_THRESHOLD / 1000}s`);
log('scroll', `Rapid scroll threshold: ${S.RAPID_THRESHOLD} px/s`);