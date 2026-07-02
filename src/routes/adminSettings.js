// src/routes/adminSettings.js — Admin Settings
const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const { adminOnly } = require('../middleware/auth');

/**
 * GET /api/admin/settings
 * Get current admin's settings
 */
router.get('/', adminOnly, async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId, 'max_saturday_offs companyName fullName lName email');
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });

    return res.json({
      max_saturday_offs: admin.max_saturday_offs ?? 2,
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
 * Update admin settings
 * Body: { max_saturday_offs: 0 | 1 | 2 | 3 | 4 }
 */
router.put('/', adminOnly, async (req, res) => {
  try {
    const { max_saturday_offs } = req.body;

    if (max_saturday_offs === undefined) {
      return res.status(400).json({ error: 'max_saturday_offs is required.' });
    }

    const val = Number(max_saturday_offs);
    if (![0, 1, 2, 3, 4].includes(val)) {
      return res.status(400).json({ error: 'max_saturday_offs must be 0, 1, 2, 3, or 4.' });
    }

    await User.findByIdAndUpdate(req.user.userId, { max_saturday_offs: val });

    return res.json({
      success: true,
      message: `Saturday offs per month updated to ${val}.`,
      max_saturday_offs: val,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
