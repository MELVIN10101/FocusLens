// ─────────────────────────────────────────────────────────────
// lib/SnapshotModel.js – Mongoose schema for drift snapshots
// TTL: documents are automatically deleted after 30 days.
// ─────────────────────────────────────────────────────────────
const mongoose = require('mongoose');

const SnapshotSchema = new mongoose.Schema(
    {
        // Source info
        url: { type: String, required: true },
        hostname: { type: String, required: true, index: true },

        // Drift score
        driftScore: { type: Number, required: true, min: 0, max: 100 },

        // Attention label (derived)
        attentionLabel: { type: String },
        attentionColor: { type: String },

        // Timing
        elapsed: { type: Number, required: true, min: 0 }, // ms since session start

        // Behavioural signals
        tabSwitches: { type: Number, default: 0, min: 0 },
        avgFocusLossDuration: { type: Number, default: 0, min: 0 }, // ms
        totalIdleSec: { type: Number, default: 0, min: 0 },
        idlePeriodCount: { type: Number, default: 0, min: 0 },
        rapidScrollCount: { type: Number, default: 0, min: 0 },
        copyCount: { type: Number, default: 0, min: 0 },
        pasteCount: { type: Number, default: 0, min: 0 },
        clickCount: { type: Number, default: 0, min: 0 },
        suspiciousPatterns: { type: Number, default: 0, min: 0 },
        mouseMoveCount: { type: Number, default: 0, min: 0 },

        // TTL field – document expires 30 days after creation
        createdAt: { type: Date, default: Date.now },
    },
    { versionKey: false }
);

// 30-day TTL index
SnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Compound index for efficient querying by site
SnapshotSchema.index({ hostname: 1, createdAt: -1 });

const Snapshot = mongoose.models.Snapshot || mongoose.model('Snapshot', SnapshotSchema);

module.exports = Snapshot;
