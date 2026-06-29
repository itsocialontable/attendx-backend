// src/models/Document.js
const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  _id:         { type: String, required: true },
  user_id:     { type: String, required: true, ref: 'User' },
  doc_type:    { type: String, enum: ['aadhar', 'pan', 'marksheet', 'passbook'], required: true },
  file_data:   { type: String, required: true },  // Base64 data URI
  file_name:   { type: String, default: '' },
  file_type:   { type: String, default: '' },      // MIME type
  uploaded_at: { type: String, default: '' },      // YYYY-MM-DD
}, {
  timestamps: false,
  versionKey: false,
  _id: false,
});

// One document per type per user
documentSchema.index({ user_id: 1, doc_type: 1 }, { unique: true });

module.exports = mongoose.model('Document', documentSchema);
