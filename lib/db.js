// ─────────────────────────────────────────────────────────────
// lib/db.js – Mongoose connection for the local Express server
// ─────────────────────────────────────────────────────────────
const mongoose = require('mongoose');

async function connectDB() {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/focuslens';

    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
    });

    console.log(`MongoDB connected → ${uri}`);
}

module.exports = connectDB;
