// ─────────────────────────────────────────────────────────────
// validate.js – Zod schema for drift snapshot payloads
//
// Per-site validation:
//   1. URL must be a real http/https URL (rejects chrome://, extension pages, etc.)
//   2. hostname is extracted and stored alongside the doc
//   3. A configurable HOSTNAME_RULES map allows stricter checks per known domain
// ─────────────────────────────────────────────────────────────
const { z } = require('zod');

// ── Blocklisted hostname patterns ──────────────────────────
const BLOCKED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'about:', 'moz-extension:', 'file:'];
const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

// Per-hostname extra rules: { minElapsed (ms), requireFields[] }
// Extend this map for sites where you want stricter rules.
const HOSTNAME_RULES = {
    // Example: YouTube requires at least 5 s on page before recording
    'www.youtube.com': { minElapsed: 5000 },
    'youtube.com': { minElapsed: 5000 },
    // Example: Google Docs – must have at least one click (actually reading)
    'docs.google.com': { minElapsed: 3000 },
};

// ── Zod schema ─────────────────────────────────────────────
const nonNegInt = z.number().int().min(0);

const SnapshotPayloadSchema = z.object({
    url: z.string().min(1),
    driftScore: z.number().min(0).max(100),
    elapsed: z.number().min(0),
    tabSwitches: nonNegInt.default(0),
    avgFocusLossDuration: z.number().min(0).default(0),
    totalIdleSec: nonNegInt.default(0),
    idlePeriodCount: nonNegInt.default(0),
    rapidScrollCount: nonNegInt.default(0),
    copyCount: nonNegInt.default(0),
    pasteCount: nonNegInt.default(0),
    clickCount: nonNegInt.default(0),
    suspiciousPatterns: nonNegInt.default(0),
    mouseMoveCount: nonNegInt.default(0),
    // Optional rich fields – stored if present
    attentionLabel: z.string().optional(),
    attentionColor: z.string().optional(),
});

/**
 * Validates and enriches a raw POST body.
 * Returns { data, hostname } on success.
 * Throws a { status, message } object on failure.
 */
function validateSnapshot(raw) {
    // ── 1. Zod type check ─────────────────────────────────
    const parsed = SnapshotPayloadSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            error: {
                status: 422,
                message: 'Validation failed',
                details: parsed.error.flatten().fieldErrors,
            },
        };
    }

    const data = parsed.data;

    // ── 2. URL protocol/hostname check ────────────────────
    let urlObj;
    try {
        urlObj = new URL(data.url);
    } catch {
        return { error: { status: 422, message: 'Invalid URL: cannot be parsed.' } };
    }

    if (BLOCKED_PROTOCOLS.includes(urlObj.protocol)) {
        return {
            error: {
                status: 422,
                message: `URLs with protocol "${urlObj.protocol}" are not accepted.`,
            },
        };
    }

    if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return { error: { status: 422, message: 'Only http and https URLs are accepted.' } };
    }

    const hostname = urlObj.hostname.toLowerCase();

    if (BLOCKED_HOSTNAMES.has(hostname)) {
        return { error: { status: 422, message: `Hostname "${hostname}" is not accepted.` } };
    }

    // ── 3. Per-site rules ─────────────────────────────────
    const siteRule = HOSTNAME_RULES[hostname];
    if (siteRule) {
        if (siteRule.minElapsed !== undefined && data.elapsed < siteRule.minElapsed) {
            return {
                error: {
                    status: 422,
                    message: `Snapshot from "${hostname}" requires at least ${siteRule.minElapsed}ms of elapsed time.`,
                },
            };
        }
    }

    return { data, hostname };
}

module.exports = { validateSnapshot };
