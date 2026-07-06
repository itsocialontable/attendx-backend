// src/models/Review.js
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  _id:            { type: String, required: true },
  user_id:        { type: String, required: true, ref: 'User' },   // employee being reviewed
  admin_id:       { type: String, required: true, ref: 'User' },
  month:          { type: String, required: true },   // YYYY-MM
  rating:         { type: Number, required: true, min: 1, max: 5 },
  title:          { type: String, default: '' },
  comment:        { type: String, default: '' },
  category:       { type: String, default: 'overall' },
  is_visible:     { type: Boolean, default: true },
  given_on:       { type: String, default: '' },      // date string (IST)
}, {
  timestamps: false,
  versionKey: false,
  _id: false,
});

// One review per employee per month per category (admin can update it)
reviewSchema.index({ user_id: 1, month: 1, category: 1 }, { unique: true });
reviewSchema.index({ admin_id: 1 });

module.exports = mongoose.model('Review', reviewSchema);
