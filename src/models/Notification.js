// src/models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  _id:        { type: String, required: true },
  user_id:    { type: String, required: true, ref: 'User' },
  title:      { type: String, required: true },
  message:    { type: String, required: true },
  type:       { type: String, enum: ['general', 'leave', 'attendance', 'salary', 'review'], default: 'general' },
  is_read:    { type: Boolean, default: false },
  created_at: { type: String, default: '' },  // ISO string
}, {
  timestamps: false,
  versionKey: false,
  _id: false,
});

notificationSchema.index({ user_id: 1, is_read: 1 });
notificationSchema.index({ created_at: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
