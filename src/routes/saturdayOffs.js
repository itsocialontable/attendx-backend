// src/routes/saturdayOffs.js — Saturday Off Management (MongoDB)
const express     = require('express');
const router      = express.Router();
const SaturdayOff = require('../models/SaturdayOff');
const { uid }     = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');

/**
 * GET /api/saturday-offs
 * Query: userId, month (YYYY-MM)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { userId, month } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required.' });

    const targetMonth = month || new Date().toISOString().substring(0, 7);

    const rows = await SaturdayOff.find(
      { user_id: userId, month: targetMonth },
    ).sort({ date: 1 });

    return res.json({
      userId,
      month: targetMonth,
      offs:  rows.map(r => r.date),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/saturday-offs
 * Toggle Saturday off ON/OFF
 * Body: { userId?, date }
 * Max 2 per month
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { userId, date } = req.body;
    const targetUserId = userId || req.user.userId;

    if (targetUserId !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    if (!date) return res.status(400).json({ error: 'date required.' });

    const dayOfWeek = new Date(date).getDay();
    if (dayOfWeek !== 6) {
      return res.status(400).json({ error: 'The provided date must be a Saturday.' });
    }

    const month = date.substring(0, 7);

    // Toggle: if exists → remove
    const existing = await SaturdayOff.findOne({ user_id: targetUserId, date });
    if (existing) {
      await SaturdayOff.deleteOne({ user_id: targetUserId, date });
      return res.json({ action: 'removed', date });
    }

    // Max 2 per month
    const count = await SaturdayOff.countDocuments({ user_id: targetUserId, month });
    if (count >= 2) {
      return res.status(400).json({ error: 'A maximum of 2 Saturday offs are allowed per month.' });
    }

    await SaturdayOff.create({
      _id:     uid(),
      user_id: targetUserId,
      date,
      month,
    });
    return res.json({ action: 'added', date });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/saturday-offs
 * Body: { userId?, date }
 */
router.delete('/', authenticate, async (req, res) => {
  try {
    const { userId, date } = req.body;
    const targetUserId = userId || req.user.userId;

    if (targetUserId !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    await SaturdayOff.deleteOne({ user_id: targetUserId, date });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
