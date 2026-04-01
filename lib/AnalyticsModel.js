const mongoose = require('mongoose');

const AnalyticsSchema = new mongoose.Schema({
    hostname: String,
    driftScore: Number,
    idleRatio: Number,
    interactionDensity: Number,
    switchRate: Number,
    createdAt: Date
});

module.exports = mongoose.model('Analytics', AnalyticsSchema);