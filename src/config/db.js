// // src/config/db.js — MongoDB Connection (Mongoose)
// const mongoose = require('mongoose');

// const connectDB = async () => {
//   try {
//     const conn = await mongoose.connect(process.env.MONGO_URI, {
//       dbName: process.env.DB_NAME || 'attendx',
//     });
//     console.log(`✅ MongoDB connected — ${conn.connection.host} / ${conn.connection.name}`);
//   } catch (err) {
//     console.error('❌ MongoDB connection FAILED:', err.message);
//     process.exit(1);
//   }
// };

// // Graceful disconnect
// process.on('SIGINT', async () => {
//   await mongoose.connection.close();
//   console.log('MongoDB connection closed.');
//   process.exit(0);
// });

// module.exports = connectDB;

// src/config/db.js — MongoDB Connection (Mongoose)
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.DB_NAME || 'attendx',
    });
    console.log(`✅ MongoDB connected — ${conn.connection.host} / ${conn.connection.name}`);

    // Sync Review indexes — drops any stale index (e.g. old employee_id_1_month_1)
    // that no longer matches the schema, and creates the correct one.
    try {
      const Review = require('../models/Review');
      await Review.syncIndexes();
      console.log('✅ Review indexes synced (stale employee_id index removed if present)');
    } catch (syncErr) {
      console.error('⚠️  Review.syncIndexes() failed:', syncErr.message);
    }
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
