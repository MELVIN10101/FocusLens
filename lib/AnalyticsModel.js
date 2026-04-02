const mongoose = require('mongoose');

const AnalyticsSchema = new mongoose.Schema({
    hostname: String,
    driftScore: Number,
    predictedDrift: Number,
    predictionTrend: String, // 'up', 'down', 'stable'
    confidence: Number,
    idleRatio: Number,
    interactionDensity: Number,
    switchRate: Number,
    driftForecast: [Number],
    createdAt: Date
});

module.exports = mongoose.model('Analytics', AnalyticsSchema);