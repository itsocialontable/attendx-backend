// src/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  _id:               { type: String, required: true },
  // ── Admin fields ──────────────────────────────────────────────
  fullName:          { type: String, default: '' },
  lName:             { type: String, default: '' },
  companyName:       { type: String, default: '' },
  phoneNo:           { type: String, default: '' },
  // ── Common ───────────────────────────────────────────────────
  name:              { type: String, required: true, trim: true },
  username:          { type: String, required: true, unique: true, trim: true },
  password:          { type: String, required: true },
  role:              { type: String, enum: ['admin', 'employee'], default: 'employee' },
  email:             { type: String, default: '' },
  // ── Multi-admin: employee belongs to which admin ─────────────
  admin_id:          { type: String, default: null },   // null for admins themselves
  // ── Employee fields ───────────────────────────────────────────
  dept:              { type: String, default: '' },
  salary:            { type: Number, default: 0 },
  join_date:         { type: String, default: '' },
  address:           { type: String, default: '' },
  phone:             { type: String, default: '' },
  emp_id:            { type: String, default: '' },
  designation:       { type: String, default: '' },
  emergency_contact: { type: String, default: '' },
  // ── Bank / Docs ───────────────────────────────────────────────
  bank_ac_no:        { type: String, default: null },
  bank_name:         { type: String, default: null },
  bank_branch:       { type: String, default: null },
  bank_ifsc:         { type: String, default: null },
  aadhar_no:         { type: String, default: null },
  pan_no:            { type: String, default: null },
  // ── OTP for forget password ───────────────────────────────────
  otp:               { type: String, default: null },
  otp_expires:       { type: Date,   default: null },
  is_verified:       { type: Boolean, default: false },
}, {
  timestamps: false,
  versionKey: false,
  _id: false,
});

module.exports = mongoose.model('User', userSchema);
