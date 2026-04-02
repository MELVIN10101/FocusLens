// ─────────────────────────────────────────────────────────────
// analytics/processor.js
// Reads raw Snapshots, computes engineered features, and upserts
// them into the Analytics collection.
// Run manually: node analytics/processor.js
// ─────────────────────────────────────────────────────────────
const mongoose = require('mongoose');
const Snapshot = require('../lib/SnapshotModel');
const Analytics = require('../lib/AnalyticsModel');

// Advanced Analytics Utilities
function sigmoid(x, k = 0.1, x0 = 50) {
    return 100 / (1 + Math.exp(-k * (x - x0)));
}

function calculateHoltTrend(series, steps = 10) {
    if (series.length < 3) {
        const last = series[series.length - 1] || 0;
        return { predicted: last, trend: 'stable', confidence: 0.5, forecast: new Array(steps).fill(last) };
    }

    const alpha = 0.3;
    const beta = 0.1;
    let level = series[0];
    let trend = series[1] - series[0];

    for (let i = 1; i < series.length; i++) {
        const lastLevel = level;
        level = alpha * series[i] + (1 - alpha) * (level + trend);
        trend = beta * (level - lastLevel) + (1 - beta) * trend;
    }

    const forecast = [];
    for (let h = 1; h <= steps; h++) {
        forecast.push(Math.max(0, Math.min(100, Math.round(level + h * trend))));
    }

    let trendLabel = 'stable';
    if (trend > 2) trendLabel = 'up';
    if (trend < -2) trendLabel = 'down';

    return {
        predicted: forecast[0],
        trend: trendLabel,
        confidence: Math.min(0.9, 0.4 + (series.length / 50)),
        forecast
    };
}

async function run() {
    await mongoose.connect('mongodb://127.0.0.1:27017/focuslens');

    const rawData = await Snapshot.find().sort({ createdAt: 1 }).lean();
    console.log('Total snapshots:', rawData.length);

    if (!rawData.length) {
        process.exit(0);
    }

    // Process by hostname for accurate trending
    const sites = [...new Set(rawData.map(d => d.hostname))];
    const processed = [];

    for (const site of sites) {
        const siteData = rawData.filter(d => d.hostname === site);
        const driftHistory = [];

        for (let i = 0; i < siteData.length; i++) {
            const d = siteData[i];
            const elapsedSec = (d.elapsed / 1000) || 1;

            // 1. Refined Signal Weighting
            const rawSignalSum =
                (d.tabSwitches * 8) +
                (d.totalIdleSec * 2) +
                (d.rapidScrollCount * 5) +
                (d.suspiciousPatterns * 15);

            const refinedScore = Math.round(sigmoid(rawSignalSum, 0.05, 40));
            driftHistory.push(refinedScore);

            // 2. Prediction (look ahead 10 steps)
            const prediction = calculateHoltTrend(driftHistory.slice(0, i + 1), 10);

            processed.push({
                hostname: d.hostname,
                driftScore: refinedScore,
                predictedDrift: prediction.predicted,
                predictionTrend: prediction.trend,
                confidence: prediction.confidence,
                driftForecast: prediction.forecast,
                idleRatio: +(d.totalIdleSec / elapsedSec).toFixed(4),
                interactionDensity: +((d.clickCount + d.mouseMoveCount + d.rapidScrollCount) / elapsedSec).toFixed(4),
                switchRate: +(d.tabSwitches / elapsedSec).toFixed(4),
                createdAt: d.createdAt,
            });
        }
    }

    console.log(`Summary: Processed ${processed.length} analytics records across ${sites.length} sites.`);
    await Analytics.deleteMany({});
    await Analytics.insertMany(processed);
    console.log(`Inserted ${processed.length} analytics records.`);

    process.exit(0);
}

run().catch(err => {
    console.error('Processor error:', err.message);
    process.exit(1);
});