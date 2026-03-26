// ─────────────────────────────────────────────────────────────
// snapshots.js – POST /.netlify/functions/snapshots
// Receives a drift snapshot from the extension, validates it,
// and persists it to MongoDB Atlas.
// ─────────────────────────────────────────────────────────────
const connectDB = require('./_lib/db');
const Snapshot = require('./_lib/SnapshotModel');
const { validateSnapshot } = require('./_lib/validate');

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
    // ── CORS preflight ─────────────────────────────────────
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: CORS, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // ── Parse body ─────────────────────────────────────────
    let raw;
    try {
        raw = JSON.parse(event.body || '{}');
    } catch {
        return {
            statusCode: 400,
            headers: CORS,
            body: JSON.stringify({ error: 'Invalid JSON body' }),
        };
    }

    // ── Validate ───────────────────────────────────────────
    const { data, hostname, error } = validateSnapshot(raw);
    if (error) {
        return {
            statusCode: error.status,
            headers: CORS,
            body: JSON.stringify({ error: error.message, details: error.details }),
        };
    }

    // ── Persist ────────────────────────────────────────────
    try {
        await connectDB();

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

        return {
            statusCode: 201,
            headers: CORS,
            body: JSON.stringify({ ok: true, id: snap._id }),
        };
    } catch (err) {
        console.error('[snapshots] DB error:', err.message);
        return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ error: 'Database error', detail: err.message }),
        };
    }
};
