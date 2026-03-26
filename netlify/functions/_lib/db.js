// ─────────────────────────────────────────────────────────────
// db.js – cached Mongoose connection for Netlify functions
// A single connection is reused across warm lambda invocations.
// ─────────────────────────────────────────────────────────────
const mongoose = require('mongoose');

let cachedConn = null;

async function connectDB() {
    if (cachedConn && mongoose.connection.readyState === 1) {
        return cachedConn;
    }

    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI environment variable is not set.');

    cachedConn = await mongoose.connect(uri, {
        // Recommended settings for serverless environments
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 10000,
    });

    return cachedConn;
}

module.exports = connectDB;
