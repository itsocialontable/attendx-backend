// src/utils/helpers.js — Common Utilities
const crypto = require('crypto');

// Generate random 10-char ID
function uid() {
  return crypto.randomBytes(6).toString('hex').substring(0, 10);
}

// "HH:MM:SS" → "HH:MM"
function fixTime(val) {
  if (!val) return null;
  return String(val).substring(0, 5);
}

// Fix attendance record types for Flutter JSON
function fixRecord(r) {
  const obj = r.toObject ? r.toObject() : { ...r };
  return {
    id:                 obj._id,
    user_id:            obj.user_id,
    date:               String(obj.date || ''),
    check_in:           fixTime(obj.check_in),
    check_out:          fixTime(obj.check_out),
    lunch_in:           fixTime(obj.lunch_in),
    lunch_out:          fixTime(obj.lunch_out),
    net_mins:           parseInt(obj.net_mins || 0),
    break_mins:         parseInt(obj.break_mins || 0),
    is_late:            !!obj.is_late,
    is_half_day:        !!obj.is_half_day,
    checkin_location:   obj.checkin_location  || null,
    checkout_location:  obj.checkout_location || null,
    lunch_in_location:  obj.lunch_in_location || null,
    lunch_out_location: obj.lunch_out_location || null,
  };
}

// IST-aware date/time
function nowIST() {
  const d = new Date();
  const istOffset = 5 * 60 + 30;
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + istOffset * 60000);
}

function todayIST() {
  const ist = nowIST();
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  const d = String(ist.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeNowIST() {
  const ist = nowIST();
  const h = String(ist.getHours()).padStart(2, '0');
  const m = String(ist.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Minutes since midnight from "HH:MM"
function toMins(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Basic email format check (must contain text@text.text)
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

module.exports = { uid, fixTime, fixRecord, nowIST, todayIST, timeNowIST, toMins, isValidEmail };
