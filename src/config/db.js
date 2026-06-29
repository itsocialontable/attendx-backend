// src/config/db.js — MongoDB Connection (Mongoose)
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.DB_NAME || 'attendx',
    });
    console.log(`✅ MongoDB connected — ${conn.connection.host} / ${conn.connection.name}`);
  } catch (err) {
    console.error('❌ MongoDB connection FAILED:', err.message);
    process.exit(1);
  }
};

// Graceful disconnect
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB connection closed.');
  process.exit(0);
});

module.exports = connectDB;
