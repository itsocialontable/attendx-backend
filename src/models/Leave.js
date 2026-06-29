// src/models/Leave.js
const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema({
  _id:        { type: String, required: true },
  user_id:    { type: String, required: true, ref: 'User' },
  type:       { type: String, enum: ['paid', 'unpaid', 'sick', 'casual', 'half_day'], required: true },
  from_date:  { type: String, default: '' },   // YYYY-MM-DD
  to_date:    { type: String, default: '' },   // YYYY-MM-DD
  days:       { type: Number, default: 1 },
  session:    { type: String, default: null },  // 'morning' | 'afternoon' | null
  reason:     { type: String, default: '' },
  applied_on: { type: String, default: '' },   // YYYY-MM-DD
  status:     { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
}, {
  timestamps: false,
  versionKey: false,
  _id: false,
});

leaveSchema.index({ user_id: 1, status: 1 });
leaveSchema.index({ from_date: 1, to_date: 1 });

module.exports = mongoose.model('Leave', leaveSchema);
