// src/models/Review.js
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  _id:            { type: String, required: true },
  employee_id:    { type: String, required: true, ref: 'User' },
  admin_id:       { type: String, required: true, ref: 'User' },
  month:          { type: String, required: true },   // YYYY-MM
  rating:         { type: Number, required: true, min: 1, max: 5 },
  comment:        { type: String, default: '' },
  // Attendance snapshot saved with review for historical accuracy
  attendance_rate:  { type: Number, default: 0 },    // percentage 0-100
  present_days:     { type: Number, default: 0 },
  total_working_days: { type: Number, default: 0 },
  created_at:     { type: String, default: '' },      // ISO string
}, {
  timestamps: false,
  versionKey: false,
  _id: false,
});

// One review per employee per month (admin can update it)
reviewSchema.index({ employee_id: 1, month: 1 }, { unique: true });
reviewSchema.index({ admin_id: 1 });

module.exports = mongoose.model('Review', reviewSchema);
