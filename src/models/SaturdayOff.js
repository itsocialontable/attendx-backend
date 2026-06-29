// src/models/SaturdayOff.js
const mongoose = require('mongoose');

const saturdayOffSchema = new mongoose.Schema({
  _id:     { type: String, required: true },
  user_id: { type: String, required: true, ref: 'User' },
  date:    { type: String, required: true },   // YYYY-MM-DD (must be a Saturday)
  month:   { type: String, required: true },   // YYYY-MM  (derived from date)
}, {
  timestamps: false,
  versionKey: false,
  _id: false,
});

// One entry per user per date; max 2 per month enforced at route level
saturdayOffSchema.index({ user_id: 1, date: 1 }, { unique: true });
saturdayOffSchema.index({ user_id: 1, month: 1 });

module.exports = mongoose.model('SaturdayOff', saturdayOffSchema);
