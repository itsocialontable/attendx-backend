// src/routes/adminSettings.js — Admin Settings
const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const { adminOnly } = require('../middleware/auth');
const { to12Hour } = require('../utils/helpers');

/**
 * GET /api/admin/settings
 */
router.get('/', adminOnly, async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId,
      'max_saturday_offs companyName fullName lName email late_hour late_minute half_day_hour half_day_minute max_warnings lunch_end_hour lunch_end_minute office_start_hour office_start_minute office_end_hour office_end_minute');
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });

    const officeStartHour   = admin.office_start_hour   ?? 10;
    const officeStartMinute = admin.office_start_minute ?? 0;
    const officeEndHour     = admin.office_end_hour     ?? 18;
    const officeEndMinute   = admin.office_end_minute   ?? 30;

    return res.json({
      max_saturday_offs: admin.max_saturday_offs ?? 2,
      late_hour:         admin.late_hour         ?? 10,
      late_minute:       admin.late_minute        ?? 15,
      half_day_hour:     admin.half_day_hour      ?? 11,
      half_day_minute:   admin.half_day_minute    ?? 30,
      max_warnings:      admin.max_warnings       ?? 3,
      lunch_end_hour:    admin.lunch_end_hour     ?? 14,
      lunch_end_minute:  admin.lunch_end_minute   ?? 0,
      // Office timing (24hr values for logic + AM/PM string for display)
      office_start_hour:   officeStartHour,
      office_start_minute: officeStartMinute,
      office_end_hour:     officeEndHour,
      office_end_minute:   officeEndMinute,
      office_start_time_ampm: to12Hour(`${String(officeStartHour).padStart(2,'0')}:${String(officeStartMinute).padStart(2,'0')}`),
      office_end_time_ampm:   to12Hour(`${String(officeEndHour).padStart(2,'0')}:${String(officeEndMinute).padStart(2,'0')}`),
      companyName:       admin.companyName,
      fullName:          admin.fullName,
      lName:             admin.lName,
      email:             admin.email,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/admin/settings
 * Body (all optional — send only what you want to change):
 * {
 *   max_saturday_offs: 0-4,
 *   late_hour: 10, late_minute: 15,
 *   half_day_hour: 11, half_day_minute: 30,
 *   max_warnings: 3,
 *   lunch_end_hour: 14, lunch_end_minute: 0,
 *   office_start_hour: 10, office_start_minute: 0,
 *   office_end_hour: 18, office_end_minute: 30
 * }
 */
router.put('/', adminOnly, async (req, res) => {
  try {
    const {
      max_saturday_offs,
      late_hour, late_minute,
      half_day_hour, half_day_minute,
      max_warnings,
      lunch_end_hour, lunch_end_minute,
      office_start_hour, office_start_minute,
      office_end_hour, office_end_minute,
    } = req.body;

    const updates = {};

    // Saturday offs
    if (max_saturday_offs !== undefined) {
      const val = Number(max_saturday_offs);
      if (![0,1,2,3,4].includes(val))
        return res.status(400).json({ error: 'max_saturday_offs must be 0, 1, 2, 3, or 4.' });
      updates.max_saturday_offs = val;
    }

    // Late threshold
    if (late_hour !== undefined) {
      const h = Number(late_hour), m = Number(late_minute ?? 0);
      if (h < 0 || h > 23 || m < 0 || m > 59)
        return res.status(400).json({ error: 'Invalid late_hour or late_minute.' });
      updates.late_hour   = h;
      updates.late_minute = m;
    }

    // Half day threshold
    if (half_day_hour !== undefined) {
      const h = Number(half_day_hour), m = Number(half_day_minute ?? 0);
      if (h < 0 || h > 23 || m < 0 || m > 59)
        return res.status(400).json({ error: 'Invalid half_day_hour or half_day_minute.' });
      updates.half_day_hour   = h;
      updates.half_day_minute = m;
    }

    // Max warnings
    if (max_warnings !== undefined) {
      const w = Number(max_warnings);
      if (w < 1 || w > 10)
        return res.status(400).json({ error: 'max_warnings must be between 1 and 10.' });
      updates.max_warnings = w;
    }

    // Lunch end time
    if (lunch_end_hour !== undefined) {
      const h = Number(lunch_end_hour), m = Number(lunch_end_minute ?? 0);
      if (h < 0 || h > 23 || m < 0 || m > 59)
        return res.status(400).json({ error: 'Invalid lunch_end_hour or lunch_end_minute.' });
      updates.lunch_end_hour   = h;
      updates.lunch_end_minute = m;
    }

    // Office start time
    if (office_start_hour !== undefined) {
      const h = Number(office_start_hour), m = Number(office_start_minute ?? 0);
      if (h < 0 || h > 23 || m < 0 || m > 59)
        return res.status(400).json({ error: 'Invalid office_start_hour or office_start_minute.' });
      updates.office_start_hour   = h;
      updates.office_start_minute = m;
    }

    // Office end time
    if (office_end_hour !== undefined) {
      const h = Number(office_end_hour), m = Number(office_end_minute ?? 0);
      if (h < 0 || h > 23 || m < 0 || m > 59)
        return res.status(400).json({ error: 'Invalid office_end_hour or office_end_minute.' });
      updates.office_end_hour   = h;
      updates.office_end_minute = m;
    }

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: 'No valid fields to update.' });

    await User.findByIdAndUpdate(req.user.userId, updates);

    return res.json({ success: true, updated: updates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
