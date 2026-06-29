// src/models/Attendance.js
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  _id:                { type: String, required: true },
  user_id:            { type: String, required: true, ref: 'User' },
  date:               { type: String, required: true },    // YYYY-MM-DD
  check_in:           { type: String, default: null },     // HH:MM
  check_out:          { type: String, default: null },
  lunch_in:           { type: String, default: null },
  lunch_out:          { type: String, default: null },
  net_mins:           { type: Number, default: 0 },
  break_mins:         { type: Number, default: 0 },
  is_late:            { type: Boolean, default: false },
  is_half_day:        { type: Boolean, default: false },
  checkin_location:   { type: String, default: null },
  checkout_location:  { type: String, default: null },
  lunch_in_location:  { type: String, default: null },
  lunch_out_location: { type: String, default: null },
}, {
  timestamps: false,
  versionKey: false,
  _id: false,
});

// Unique constraint: one record per user per date
attendanceSchema.index({ user_id: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
