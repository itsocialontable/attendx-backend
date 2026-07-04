// src/models/SalaryRecord.js — Saved Salary Records
const mongoose = require('mongoose');

const SalaryRecordSchema = new mongoose.Schema({
  _id:               { type: String, required: true },
  user_id:           { type: String, required: true, index: true },
  admin_id:          { type: String, required: true, index: true },
  month:             { type: String, required: true }, // YYYY-MM

  // Auto-calculated fields (set at generate time, read-only after)
  basic_salary:      { type: Number, default: 0 },
  per_day_salary:    { type: Number, default: 0 },
  days_in_month:     { type: Number, default: 0 },
  total_working_days:{ type: Number, default: 0 },
  sundays:           { type: Number, default: 0 },
  present_days:      { type: Number, default: 0 },
  absent_days:       { type: Number, default: 0 },
  half_days:         { type: Number, default: 0 },
  late_days:         { type: Number, default: 0 },
  approved_leave_days:{ type: Number, default: 0 },
  unpaid_leave_days: { type: Number, default: 0 },
  absent_deduction:  { type: Number, default: 0 },
  half_day_deduction:{ type: Number, default: 0 },
  unpaid_leave_deduction: { type: Number, default: 0 },
  total_auto_deduction: { type: Number, default: 0 },

  // Admin-editable optional fields
  bonus:             { type: Number, default: 0 },
  overtime_hours:    { type: Number, default: 0 },
  overtime_amount:   { type: Number, default: 0 },
  pf:                { type: Number, default: 0 },   // Provident Fund deduction
  tds:               { type: Number, default: 0 },   // Tax deduction
  other_deduction:   { type: Number, default: 0 },
  other_addition:    { type: Number, default: 0 },
  notes:             { type: String, default: '' },

  // Final net salary (auto-calculated, admin cannot override directly)
  net_salary:        { type: Number, default: 0 },

  status:            { type: String, enum: ['generated', 'paid'], default: 'generated' },
  generated_at:      { type: Date, default: Date.now },
  updated_at:        { type: Date, default: Date.now },
}, { _id: false });

// Unique: one record per employee per month
SalaryRecordSchema.index({ user_id: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('SalaryRecord', SalaryRecordSchema);
