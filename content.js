// ============================================================
// FocusLens – Content Script
// Tracks behavioural signals and sends them to background.js
// ============================================================

(function () {
  if (window.__focusLensInjected) return;
  window.__focusLensInjected = true;

  // ── State ────────────────────────────────────────────────
  const SESSION_START = Date.now();
  let isTracking = false;

  const state = {
    // Tab focus
    tabSwitches: 0,
    focusLossDurations: [],        // ms each time tab was blurred
    lastBlurTime: null,

    // Mouse activity
    lastMouseMove: Date.now(),
    idlePeriods: [],               // { start, duration }
    idleStart: null,
    IDLE_THRESHOLD: 10000,         // 10 s of no mouse = idle
    mouseMoveCount: 0,
    mousePositions: [],            // sampled positions for bot detection

    // Scroll
    scrollEvents: [],              // { time, y, speed }
    lastScrollY: window.scrollY,
    lastScrollTime: Date.now(),
    rapidScrollCount: 0,
    RAPID_SCROLL_SPEED: 3000,     // px/s threshold

    // Clicks
    clicks: [],                    // { time, x, y, target }
    clickCount: 0,

    // Copy-paste
    copyCount: 0,
    pasteCount: 0,
    copyPasteEvents: [],

    // Bot / attention detection
    suspiciousPatterns: 0,
    linearMoveCount: 0,            // overly straight mouse lines = possible bot
  };

  // ── Helpers ──────────────────────────────────────────────
  function now() { return Date.now(); }
  function elapsed() { return now() - SESSION_START; }

  function sendToBackground(type, payload) {
    try {
      chrome.runtime.sendMessage({ type, payload, url: location.href, ts: now() });
    } catch (_) {}
  }

  function score() {
    // 0–100 drift score: higher = more drifted
    const totalTime = Math.max(elapsed() / 1000, 1); // seconds

    const switchPenalty   = Math.min(state.tabSwitches * 8, 30);
    const idlePenalty     = Math.min(state.idlePeriods.length * 6, 25);
    const rapidScrollPen  = Math.min(state.rapidScrollCount * 4, 20);
    const copyPastePen    = Math.min(state.copyPasteEvents.length * 3, 15);
    const botPen          = Math.min(state.suspiciousPatterns * 5, 10);

    return Math.min(Math.round(switchPenalty + idlePenalty + rapidScrollPen + copyPastePen + botPen), 100);
  }

  function attentionLabel(s) {
    if (s <= 20) return { label: 'Focused', color: '#00e5a0' };
    if (s <= 45) return { label: 'Mild Drift', color: '#f5c518' };
    if (s <= 70) return { label: 'Distracted', color: '#ff8c42' };
    return { label: 'Critical Drift', color: '#ff3d6b' };
  }

  // ── Bot detection helper ─────────────────────────────────
  function detectLinearMouse(positions) {
    if (positions.length < 5) return false;
    const last = positions.slice(-5);
    const dxArr = last.slice(1).map((p, i) => p.x - last[i].x);
    const dyArr = last.slice(1).map((p, i) => p.y - last[i].y);
    const dxStd = stdDev(dxArr);
    const dyStd = stdDev(dyArr);
    return dxStd < 2 && dyStd < 2; // suspiciously uniform movement
  }

  function stdDev(arr) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / arr.length);
  }

  // ── Event Listeners ──────────────────────────────────────

  // Tab visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.lastBlurTime = now();
      state.tabSwitches++;
    } else {
      if (state.lastBlurTime) {
        state.focusLossDurations.push(now() - state.lastBlurTime);
        state.lastBlurTime = null;
      }
    }
    snapshot();
  });

  // Mouse movement
  document.addEventListener('mousemove', (e) => {
    const t = now();
    state.mouseMoveCount++;
    state.lastMouseMove = t;

    // Sample every 10th move for bot detection
    if (state.mouseMoveCount % 10 === 0) {
      state.mousePositions.push({ x: e.clientX, y: e.clientY, t });
      if (state.mousePositions.length > 50) state.mousePositions.shift();

      if (detectLinearMouse(state.mousePositions)) {
        state.linearMoveCount++;
        if (state.linearMoveCount > 3) state.suspiciousPatterns++;
      } else {
        state.linearMoveCount = 0;
      }
    }

    // End idle if was idle
    if (state.idleStart) {
      state.idlePeriods.push({ start: state.idleStart, duration: t - state.idleStart });
      state.idleStart = null;
    }
  }, { passive: true });

  // Idle detection loop
  setInterval(() => {
    const sinceMove = now() - state.lastMouseMove;
    if (sinceMove >= state.IDLE_THRESHOLD && !state.idleStart) {
      state.idleStart = now() - sinceMove;
    }
  }, 2000);

  // Scroll tracking
  let scrollRaf = null;
  document.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      const t = now();
      const y = window.scrollY;
      const dt = (t - state.lastScrollTime) / 1000 || 0.001;
      const dy = Math.abs(y - state.lastScrollY);
      const speed = dy / dt;

      state.scrollEvents.push({ t, y, speed });
      if (speed > state.RAPID_SCROLL_SPEED) state.rapidScrollCount++;
      if (state.scrollEvents.length > 200) state.scrollEvents.shift();

      state.lastScrollY = y;
      state.lastScrollTime = t;
      scrollRaf = null;
    });
  }, { passive: true });

  // Clicks
  document.addEventListener('click', (e) => {
    state.clickCount++;
    state.clicks.push({ t: now(), x: e.clientX, y: e.clientY, tag: e.target.tagName });
    if (state.clicks.length > 100) state.clicks.shift();
  });

  // Copy / paste
  document.addEventListener('copy', () => {
    state.copyCount++;
    state.copyPasteEvents.push({ type: 'copy', t: now() });
  });

  document.addEventListener('paste', () => {
    state.pasteCount++;
    state.copyPasteEvents.push({ type: 'paste', t: now() });
  });

  // ── Snapshot sender ──────────────────────────────────────
  function snapshot() {
    const driftScore = score();
    const attention = attentionLabel(driftScore);
    const totalIdleMs = state.idlePeriods.reduce((a, b) => a + b.duration, 0) +
      (state.idleStart ? now() - state.idleStart : 0);

    const avgFocusLoss = state.focusLossDurations.length
      ? Math.round(state.focusLossDurations.reduce((a, b) => a + b, 0) / state.focusLossDurations.length)
      : 0;

    sendToBackground('SNAPSHOT', {
      driftScore,
      attention,
      elapsed: elapsed(),
      tabSwitches: state.tabSwitches,
      avgFocusLossDuration: avgFocusLoss,
      totalIdleSec: Math.round(totalIdleMs / 1000),
      idlePeriodCount: state.idlePeriods.length + (state.idleStart ? 1 : 0),
      rapidScrollCount: state.rapidScrollCount,
      copyCount: state.copyCount,
      pasteCount: state.pasteCount,
      clickCount: state.clickCount,
      suspiciousPatterns: state.suspiciousPatterns,
      mouseMoveCount: state.mouseMoveCount,
    });
  }

  // ── Message listener (popup requests) ───────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'GET_SNAPSHOT') {
      const driftScore = score();
      const attention = attentionLabel(driftScore);
      const totalIdleMs = state.idlePeriods.reduce((a, b) => a + b.duration, 0) +
        (state.idleStart ? now() - state.idleStart : 0);

      const avgFocusLoss = state.focusLossDurations.length
        ? Math.round(state.focusLossDurations.reduce((a, b) => a + b, 0) / state.focusLossDurations.length)
        : 0;

      reply({
        driftScore,
        attention,
        elapsed: elapsed(),
        tabSwitches: state.tabSwitches,
        avgFocusLossDuration: avgFocusLoss,
        totalIdleSec: Math.round(totalIdleMs / 1000),
        idlePeriodCount: state.idlePeriods.length + (state.idleStart ? 1 : 0),
        rapidScrollCount: state.rapidScrollCount,
        copyCount: state.copyCount,
        pasteCount: state.pasteCount,
        clickCount: state.clickCount,
        suspiciousPatterns: state.suspiciousPatterns,
        mouseMoveCount: state.mouseMoveCount,
        recentScrollSpeeds: state.scrollEvents.slice(-10).map(e => Math.round(e.speed)),
      });
    }
    return true;
  });

  // Send periodic snapshots every 30s
  setInterval(snapshot, 30000);

})();
