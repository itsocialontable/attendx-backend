// src/routes/notifications.js — Notification System
const express       = require('express');
const router        = express.Router();
const Notification  = require('../models/Notification');
const { uid, todayIST } = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');

function fmtNotif(n) {
  const obj = n.toObject ? n.toObject() : n;
  return {
    id:         obj._id,
    user_id:    obj.user_id,
    title:      obj.title,
    message:    obj.message,
    type:       obj.type,
    is_read:    obj.is_read,
    created_at: obj.created_at,
  };
}

/**
 * GET /api/notifications
 * Apni saari notifications dekho
 * Query: ?is_read=false
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const filter = { user_id: req.user.userId };
    if (req.query.is_read !== undefined) {
      filter.is_read = req.query.is_read === 'true';
    }

    const notifs = await Notification.find(filter).sort({ created_at: -1 }).limit(50);
    const unread = await Notification.countDocuments({ user_id: req.user.userId, is_read: false });

    return res.json({ notifications: notifs.map(fmtNotif), unread_count: unread });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/notifications/:id/read
 * Ek notification read mark karo
 */
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ error: 'Notification not found.' });
    if (notif.user_id !== req.user.userId) return res.status(403).json({ error: 'Access denied.' });

    notif.is_read = true;
    await notif.save();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/notifications/read-all
 * Saari notifications read mark karo
 */
router.put('/read-all', authenticate, async (req, res) => {
  try {
    await Notification.updateMany(
      { user_id: req.user.userId, is_read: false },
      { is_read: true }
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/notifications/:id
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ error: 'Notification not found.' });
    if (notif.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }
    await notif.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notifications/send
 * Admin: Kisi employee ko notification bhejo
 * Body: { user_id, title, message, type }
 * type: general | leave | attendance | salary | review
 */
router.post('/send', adminOnly, async (req, res) => {
  try {
    const { user_id, title, message, type = 'general' } = req.body;

    if (!user_id || !title || !message) {
      return res.status(400).json({ error: 'user_id, title and message are required.' });
    }

    const notif = await Notification.create({
      _id:        uid(),
      user_id,
      title,
      message,
      type,
      is_read:    false,
      created_at: new Date().toISOString(),
    });

    return res.status(201).json({ success: true, notification: fmtNotif(notif) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notifications/broadcast
 * Admin: Sabhi employees ko ek saath notification bhejo
 * Body: { title, message, type }
 */
router.post('/broadcast', adminOnly, async (req, res) => {
  try {
    const { title, message, type = 'general' } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: 'title and message are required.' });
    }

    const User = require('../models/User');
    const employees = await User.find({ role: 'employee' }, '_id');

    const notifs = employees.map(emp => ({
      _id:        uid(),
      user_id:    emp._id,
      title,
      message,
      type,
      is_read:    false,
      created_at: new Date().toISOString(),
    }));

    await Notification.insertMany(notifs);

    return res.json({ success: true, sent_to: employees.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
