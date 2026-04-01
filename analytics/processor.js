// ─────────────────────────────────────────────────────────────
// analytics/processor.js
// Reads raw Snapshots, computes engineered features, and upserts
// them into the Analytics collection.
// Run manually: node analytics/processor.js
// ─────────────────────────────────────────────────────────────
const mongoose = require('mongoose');
const Snapshot = require('../lib/SnapshotModel');
const Analytics = require('../lib/AnalyticsModel');

async function run() {
    await mongoose.connect('mongodb://127.0.0.1:27017/focuslens');

    const data = await Snapshot.find().lean();
    console.log('Total snapshot records:', data.length);

    if (!data.length) {
        console.log('Nothing to process.');
        return process.exit(0);
    }

    // Feature engineering
    const processed = data.map(d => {
        const elapsedSec = (d.elapsed / 1000) || 1;
        const idleRatio = d.totalIdleSec / elapsedSec;
        const interactionDensity = (d.clickCount + d.mouseMoveCount + d.rapidScrollCount) / elapsedSec;
        const switchRate = d.tabSwitches / elapsedSec;

        return {
            hostname: d.hostname,
            driftScore: d.driftScore,
            idleRatio: +idleRatio.toFixed(4),
            interactionDensity: +interactionDensity.toFixed(4),
            switchRate: +switchRate.toFixed(4),
            createdAt: d.createdAt,
        };
    });

    console.log('Sample (first 5):', processed.slice(0, 5));

    // Clear old analytics and re-insert
    await Analytics.deleteMany({});
    await Analytics.insertMany(processed);
    console.log(`Inserted ${processed.length} analytics records.`);

    process.exit(0);
}

run().catch(err => {
    console.error('Processor error:', err.message);
    process.exit(1);
});