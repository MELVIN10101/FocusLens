// ── Analytics Engine ──────────────────────────────────────
async function apiFetch(path) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'API_FETCH', path }, (res) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      if (res?.error) return reject(new Error(res.error));
      resolve(res.data);
    });
  });
}

let activeHostname = null;   // null = all sites
let charts = {};             // chart instances

function driftColor(score) {
  if (score <= 20) return '#00f5a0';
  if (score <= 45) return '#f5c842';
  if (score <= 70) return '#ff7a3d';
  return '#ff3366';
}

// ── Connection status ──────────────────────────────────────
function updateConnectionStatus(online) {
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  if (online) {
    dot.className = 'conn-dot online';
    lbl.textContent = 'MongoDB connected';
  } else {
    dot.className = 'conn-dot offline';
    lbl.textContent = 'Server offline';
  }
}

// ── Site nav loader ───────────────────────────────────────
// hostAvgMap: hostname -> avgDrift (pre-loaded from /analytics/hostname)
let hostAvgMap = {};

async function loadSiteNav() {
  try {
    const [sitesRes, hostRes] = await Promise.all([
      apiFetch('/api/sites'),
      apiFetch('/api/analytics/hostname'),
    ]);
    updateConnectionStatus(true);

    // Build drift lookup
    hostAvgMap = {};
    (hostRes || []).forEach(h => { hostAvgMap[h._id] = Math.round(h.avgDrift); });

    const list = document.getElementById('sitenav-list');
    list.innerHTML = '';

    const sites = (sitesRes.sites || []).sort();
    if (!sites.length) {
      list.innerHTML = '<div class="sitenav-loading">No data yet — browse with the extension active.</div>';
      return;
    }

    sites.forEach(site => {
      const avg = hostAvgMap[site];
      const color = avg !== undefined
        ? (avg <= 20 ? '#00f5a0' : avg <= 45 ? '#f5c842' : avg <= 70 ? '#ff7a3d' : '#ff3366')
        : 'var(--muted)';

      const item = document.createElement('div');
      item.className = 'sitenav-item';
      item.id = 'nav-' + site;
      item.onclick = () => selectSite(site);
      item.innerHTML = `
        <span class="sitenav-icon">🌐</span>
        <span class="sitenav-label" title="${site}">${site}</span>
        ${avg !== undefined ? `<span class="drift-badge" style="color:${color};border-color:${color}40">${avg}</span>` : ''}
      `;
      list.appendChild(item);
    });

    // Restore active state
    _applyNavActive(activeHostname);
  } catch (e) {
    updateConnectionStatus(false);
    document.getElementById('sitenav-list').innerHTML =
      '<div class="sitenav-loading">⚠ Cannot reach server</div>';
  }
}

function _applyNavActive(hostname) {
  document.getElementById('nav-all').classList.toggle('active', !hostname);
  document.querySelectorAll('#sitenav-list .sitenav-item').forEach(el => {
    // id is "nav-<hostname>"
    el.classList.toggle('active', el.id === 'nav-' + hostname);
  });
}

function selectSite(hostname) {
  activeHostname = hostname;
  _applyNavActive(hostname);
  // Update the heading
  document.getElementById('an-site-heading').textContent = hostname || 'All Sites';
  loadAnalytics();
}

// ── Destroy & recreate charts ─────────────────────────────
function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ── Summary cards ──────────────────────────────────────────
function renderSummary(summary, label) {
  const empty = document.getElementById('an-empty');
  if (!summary) {
    empty.style.display = 'block';
    ['an-avgdrift', 'an-count', 'an-idle', 'an-tabs', 'an-scrolls', 'an-lastseen'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('an-site-label').textContent = label || 'all sites';
    return;
  }
  empty.style.display = 'none';
  const color = driftColor(summary.avgDrift || 0);
  document.getElementById('an-avgdrift').textContent = summary.avgDrift || '—';
  document.getElementById('an-avgdrift').style.color = color;
  document.getElementById('an-count').textContent = summary.count || '—';
  document.getElementById('an-idle').textContent = (summary.avgIdleSec || 0) + 's';
  document.getElementById('an-tabs').textContent = summary.avgTabSwitches || '—';
  document.getElementById('an-scrolls').textContent = summary.avgRapidScrolls || '—';
  document.getElementById('an-lastseen').textContent = summary.lastSeen
    ? new Date(summary.lastSeen).toLocaleString()
    : '—';
  document.getElementById('an-site-label').textContent = label || 'all sites';
}

// ── Drift Over Time chart ─────────────────────────────────
function renderDriftChart(data) {
  destroyChart('drift');
  if (!data.length) return;
  charts.drift = new Chart(document.getElementById('driftChart'), {
    type: 'line',
    data: {
      labels: data.map(d => new Date(d.t).toLocaleDateString() + ' ' + new Date(d.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      datasets: [{
        label: 'Drift Score',
        data: data.map(d => d.drift),
        borderColor: '#9b72ff',
        backgroundColor: '#9b72ff18',
        fill: true,
        tension: 0.4,
        pointRadius: data.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
      }]
    },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          beginAtZero: true, max: 100, grid: { color: '#1e253520' },
          ticks: { color: '#4a5675', font: { size: 10 } }
        }
      }
    }
  });
}

// ── Avg Drift by Site chart ───────────────────────────────
function renderHostChart(data) {
  destroyChart('host');
  if (!data.length) return;
  const sorted = [...data].sort((a, b) => b.avgDrift - a.avgDrift).slice(0, 12);
  charts.host = new Chart(document.getElementById('hostChart'), {
    type: 'bar',
    data: {
      labels: sorted.map(d => d._id),
      datasets: [{
        label: 'Avg Drift',
        data: sorted.map(d => Math.round(d.avgDrift)),
        backgroundColor: sorted.map(d => driftColor(d.avgDrift) + 'cc'),
        borderColor: sorted.map(d => driftColor(d.avgDrift)),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      animation: false,
      indexAxis: sorted.length > 5 ? 'y' : 'x',
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, max: 100, ticks: { color: '#4a5675', font: { size: 10 } }, grid: { color: '#1e253520' } },
        y: { ticks: { color: '#8896b3', font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}

// ── Distribution Doughnut ─────────────────────────────────
function renderDistChart(data) {
  destroyChart('dist');
  const total = data.focused + data.mild + data.distracted + data.critical;
  if (!total) return;
  charts.dist = new Chart(document.getElementById('distChart'), {
    type: 'doughnut',
    data: {
      labels: ['Focused', 'Mild Drift', 'Distracted', 'Critical'],
      datasets: [{
        data: [data.focused, data.mild, data.distracted, data.critical],
        backgroundColor: ['#00f5a0cc', '#f5c842cc', '#ff7a3dcc', '#ff3366cc'],
        borderColor: ['#00f5a0', '#f5c842', '#ff7a3d', '#ff3366'],
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8896b3', font: { size: 10 }, boxWidth: 12 } }
      },
      cutout: '65%'
    }
  });
}

// ── Main load ─────────────────────────────────────────────
async function loadAnalytics() {
  const qs = activeHostname ? '?hostname=' + encodeURIComponent(activeHostname) : '';
  const status = document.getElementById('analytics-status');
  status.textContent = 'Loading…';
  try {
    if (activeHostname) {
      // Per-site detailed load
      const [siteRes, distRes, hostRes] = await Promise.all([
        apiFetch('/api/analytics/site?hostname=' + encodeURIComponent(activeHostname)),
        apiFetch('/api/analytics/distribution' + qs),
        apiFetch('/api/analytics/hostname'),
      ]);
      renderSummary(siteRes.summary, activeHostname);
      renderDriftChart((siteRes.snaps || []).reverse().map(s => ({ t: s.createdAt, drift: s.driftScore })));
      renderHostChart(hostRes);
      renderDistChart(distRes);
    } else {
      // All-sites load
      const [driftRes, hostRes, distRes] = await Promise.all([
        apiFetch('/api/analytics/drift'),
        apiFetch('/api/analytics/hostname'),
        apiFetch('/api/analytics/distribution'),
      ]);
      // Build global summary from hostname agg
      const totalSnaps = hostRes.reduce((s, d) => s + (d.count || 0), 0);
      const avgDrift = hostRes.length
        ? Math.round(hostRes.reduce((s, d) => s + d.avgDrift, 0) / hostRes.length)
        : null;
      renderSummary(
        totalSnaps ? { count: totalSnaps, avgDrift, avgIdleSec: null, avgTabSwitches: null, avgRapidScrolls: null, lastSeen: driftRes.length ? driftRes[driftRes.length - 1].t : null } : null,
        'all sites'
      );
      renderDriftChart(driftRes);
      renderHostChart(hostRes);
      renderDistChart(distRes);
    }
    status.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    status.textContent = '⚠ Server offline — is npm start running?';
    console.error('Analytics load failed:', e);
  }
}

// loadAnalytics also updates connection status
const _origLoadAnalytics = loadAnalytics;
loadAnalytics = async function () {
  try {
    await _origLoadAnalytics();
    updateConnectionStatus(true);
  } catch (e) {
    updateConnectionStatus(false);
  }
};

// ── Load highest drift site signals ──────────────────────
let highestDriftData = null;
let usingRealData = false;

async function loadHighestDriftSignals() {
  try {
    // Get hostname data sorted by avg drift
    const hostRes = await apiFetch('/api/analytics/hostname');
    if (!hostRes || !hostRes.length) {
      usingRealData = false;
      return;
    }

    // Find the site with highest avg drift
    const highestSite = hostRes.sort((a, b) => b.avgDrift - a.avgDrift)[0];
    const hostname = highestSite._id;

    // Get detailed data for this site
    const siteRes = await apiFetch('/api/analytics/site?hostname=' + encodeURIComponent(hostname));
    if (!siteRes || !siteRes.snaps || !siteRes.snaps.length) {
      usingRealData = false;
      return;
    }

    highestDriftData = {
      hostname,
      avgDrift: highestSite.avgDrift,
      snaps: siteRes.snaps
    };

    usingRealData = true;

    // Update site label
    document.getElementById('highest-site-label').textContent = `Data from: ${hostname} (highest drift: ${highestSite.avgDrift})`;

    // Update signal displays with real data
    updateSignalsFromData(siteRes.snaps);

  } catch (e) {
    console.error('Failed to load highest drift signals:', e);
    usingRealData = false;
    document.getElementById('highest-site-label').textContent = 'No data available';
  }
}

function updateSignalsFromData(snaps) {
  if (!snaps || !snaps.length) return;

  // Get the most recent snapshot
  const latest = snaps[snaps.length - 1];

  // Update signal counters
  document.getElementById('sv-tabs').textContent = latest.tabSwitches || 0;
  document.getElementById('sv-idle').textContent = (latest.totalIdleSec || 0) + 's';
  document.getElementById('sv-scroll').textContent = latest.rapidScrollCount || 0;
  document.getElementById('sv-clicks').textContent = latest.clickCount || 0;
  document.getElementById('sv-copy').textContent = latest.copyCount || 0;
  document.getElementById('sv-paste').textContent = latest.pasteCount || 0;
  document.getElementById('sv-susp').textContent = latest.suspiciousPatterns || 0;
  document.getElementById('sv-mouse').textContent = 'Real Data';

  // Update drift score ring
  const score = latest.driftScore || 0;
  const ring = document.getElementById('ring-arc');
  const text = document.getElementById('drift-score');
  const CIRCUMFERENCE = 2 * Math.PI * 50;
  const pct = (score / 100) * CIRCUMFERENCE;
  ring.style.strokeDasharray = `${pct} ${CIRCUMFERENCE - pct}`;
  ring.style.stroke = driftColor(score);
  text.textContent = score;
  text.style.color = driftColor(score);

  // Update mouse trail with a pattern representing activity
  updateMouseTrailFromData(latest);

  // Update scroll chart with recent scroll speeds
  updateScrollChartFromData(snaps);
}

function updateMouseTrailFromData(latest) {
  const canvas = document.getElementById('mouse-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = driftColor(latest.driftScore || 0);
  ctx.lineWidth = 3;
  
  // Draw a pattern based on activity levels
  const activity = (latest.clickCount || 0) + (latest.copyCount || 0) + (latest.pasteCount || 0);
  const points = Math.min(activity + 5, 20); // At least 5 points, max 20
  
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const x = (canvas.width / points) * i + Math.random() * 20 - 10;
    const y = canvas.height / 2 + Math.sin(i * 0.5) * 30 + Math.random() * 20 - 10;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function scoreLabel(s) {
  if (s <= 20) return 'Focused';
  if (s <= 45) return 'Mild Drift';
  if (s <= 70) return 'Distracted';
  return 'Critical Drift';
}

function updateScrollChartFromData(snaps) {
  const scrollChart = document.getElementById('scroll-chart');
  const MAX_BARS = 30;

  // Get recent rapid scroll counts
  const recentScrolls = snaps.slice(-MAX_BARS).map(s => s.rapidScrollCount || 0);

  scrollChart.innerHTML = '';
  recentScrolls.forEach((count, i) => {
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    const height = Math.min(count * 10, 100); // Scale appropriately
    bar.style.height = height + '%';
    bar.title = count + ' rapid scrolls';
    scrollChart.appendChild(bar);
  });
}

// Initial load + periodic refresh
loadSiteNav();
loadAnalytics();
loadHighestDriftSignals(); // Load highest drift signals initially
setInterval(() => { 
  loadSiteNav(); 
  loadAnalytics(); 
  loadHighestDriftSignals(); // Refresh highest drift signals
}, 10000);