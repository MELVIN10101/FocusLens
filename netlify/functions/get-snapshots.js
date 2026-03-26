// ─────────────────────────────────────────────────────────────
// get-snapshots.js – GET /.netlify/functions/get-snapshots
// Query: ?hostname=example.com&limit=50
// Returns the most recent snapshots for a given hostname.
// ─────────────────────────────────────────────────────────────
const connectDB = require('./_lib/db');
const Snapshot = require('./_lib/SnapshotModel');

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: CORS, body: '' };
    }

    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const { hostname, limit } = event.queryStringParameters || {};
    const maxDocs = Math.min(parseInt(limit, 10) || 50, 200);

    const filter = hostname ? { hostname: hostname.toLowerCase() } : {};

    try {
        await connectDB();

        const docs = await Snapshot.find(filter)
            .sort({ createdAt: -1 })
            .limit(maxDocs)
            .lean();

        return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({ ok: true, count: docs.length, results: docs }),
        };
    } catch (err) {
        console.error('[get-snapshots] DB error:', err.message);
        return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ error: 'Database error', detail: err.message }),
        };
    }
};
