// ============================================================
// server.js – Local Express API for the FocusLens extension
// Replaces Netlify serverless functions.
//
// Routes:
//   POST /api/snapshots  – save a drift snapshot
//   GET  /api/snapshots  – query snapshots (?hostname=&limit=)
//
// Usage:
//   node server.js
//   (MongoDB must be running on localhost:27017)
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./lib/db');
const Snapshot = require('./lib/SnapshotModel');
const Analytics = require('./lib/AnalyticsModel');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── POST /api/snapshots ─────────────────────────────────────
app.post('/api/snapshots', async (req, res) => {
    const data = req.body;

    if (!data.url || data.driftScore === undefined || data.elapsed === undefined) {
        return res.status(400).json({ error: 'Missing required fields: url, driftScore, elapsed' });
    }

    let hostname;
    try {
        hostname = new URL(data.url).hostname.toLowerCase();
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
        const snap = await Snapshot.create({
            url: data.url,
            hostname,
            driftScore: data.driftScore,
            attentionLabel: data.attentionLabel,
            attentionColor: data.attentionColor,
            elapsed: data.elapsed,
            tabSwitches: data.tabSwitches,
            avgFocusLossDuration: data.avgFocusLossDuration,
            totalIdleSec: data.totalIdleSec,
            idlePeriodCount: data.idlePeriodCount,
            rapidScrollCount: data.rapidScrollCount,
            copyCount: data.copyCount,
            pasteCount: data.pasteCount,
            clickCount: data.clickCount,
            suspiciousPatterns: data.suspiciousPatterns,
            mouseMoveCount: data.mouseMoveCount,
        });
        console.log(`[+] Snapshot saved — ${hostname} (score: ${data.driftScore})`);
        return res.status(201).json({ ok: true, id: snap._id });
    } catch (err) {
        console.error('[snapshots POST] DB error:', err.message);
        return res.status(500).json({ error: 'Database error', detail: err.message });
    }
});

// ── GET /api/sites – list all tracked hostnames ──────────────
app.get('/api/sites', async (req, res) => {
    try {
        const sites = await Snapshot.distinct('hostname');
        return res.json({ ok: true, sites: sites.sort() });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── Analytics endpoints (all support ?hostname= filter) ──────

app.get('/api/analytics/drift', async (req, res) => {
    try {
        const filter = req.query.hostname ? { hostname: req.query.hostname } : {};
        const data = await Snapshot.find(filter).sort({ createdAt: 1 }).lean();
        return res.json(data.map(d => ({ t: d.createdAt, drift: d.driftScore })));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/analytics/hostname', async (req, res) => {
    try {
        const agg = await Snapshot.aggregate([
            { $group: { _id: '$hostname', avgDrift: { $avg: '$driftScore' }, count: { $sum: 1 } } },
            { $sort: { avgDrift: -1 } }
        ]);
        return res.json(agg);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/analytics/distribution', async (req, res) => {
    try {
        const filter = req.query.hostname ? { hostname: req.query.hostname } : {};
        const data = await Snapshot.find(filter).lean();
        const buckets = { focused: 0, mild: 0, distracted: 0, critical: 0 };
        data.forEach(d => {
            if (d.driftScore <= 20) buckets.focused++;
            else if (d.driftScore <= 45) buckets.mild++;
            else if (d.driftScore <= 70) buckets.distracted++;
            else buckets.critical++;
        });
        return res.json(buckets);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Per-site detailed stats
app.get('/api/analytics/site', async (req, res) => {
    try {
        const { hostname } = req.query;
        if (!hostname) return res.status(400).json({ error: 'hostname required' });
        const snaps = await Snapshot.find({ hostname }).sort({ createdAt: -1 }).limit(200).lean();
        if (!snaps.length) return res.json({ ok: true, hostname, snaps: [], summary: null });

        const avg = (arr, key) => arr.reduce((s, d) => s + (d[key] || 0), 0) / arr.length;
        const summary = {
            count: snaps.length,
            avgDrift: Math.round(avg(snaps, 'driftScore')),
            avgIdleSec: Math.round(avg(snaps, 'totalIdleSec')),
            avgTabSwitches: +avg(snaps, 'tabSwitches').toFixed(1),
            avgRapidScrolls: +avg(snaps, 'rapidScrollCount').toFixed(1),
            avgClicks: Math.round(avg(snaps, 'clickCount')),
            lastSeen: snaps[0].createdAt,
        };
        return res.json({ ok: true, hostname, snaps, summary });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Predictions from the Analytics collection
app.get('/api/analytics/prediction', async (req, res) => {
    try {
        const { hostname } = req.query;
        const filter = hostname ? { hostname } : {};
        // Get the latest processed analytic for this site
        const latest = await Analytics.findOne(filter).sort({ createdAt: -1 }).lean();
        if (!latest) return res.json({ ok: false, message: 'No prediction data yet' });

        return res.json({
            ok: true,
            hostname: latest.hostname,
            currentDrift: latest.driftScore,
            predictedDrift: latest.predictedDrift,
            driftForecast: latest.driftForecast || [],
            trend: latest.predictionTrend,
            confidence: latest.confidence,
            timestamp: latest.createdAt
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ── GET /api/snapshots ──────────────────────────────────────
app.get('/api/snapshots', async (req, res) => {
    const { hostname, limit } = req.query;
    const maxDocs = Math.min(parseInt(limit, 10) || 50, 500);
    const filter = hostname ? { hostname: hostname.toLowerCase() } : {};

    try {
        const docs = await Snapshot.find(filter)
            .sort({ createdAt: -1 })
            .limit(maxDocs)
            .lean();
        return res.json({ ok: true, count: docs.length, results: docs });
    } catch (err) {
        return res.status(500).json({ error: 'Database error', detail: err.message });
    }
});

// ── Health check ────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Start ────────────────────────────────────────────────────
connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`\nFocusLens API server running → http://localhost:${PORT}`);
            console.log('Routes:');
            console.log(`  POST http://localhost:${PORT}/api/snapshots`);
            console.log(`  GET  http://localhost:${PORT}/api/snapshots`);
        });
    })
    .catch((err) => {
        console.error('Failed to connect to MongoDB:', err.message);
        process.exit(1);
    });
