// src/routes/leaves.js — Leave Management (MongoDB)
// Multi-admin: admin sirf apne employees ki leaves dekh aur approve/reject kar sakta hai
const express = require('express');
const router  = express.Router();
const Leave   = require('../models/Leave');
const User    = require('../models/User');
const { uid } = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');

function fmtLeave(l, userInfo) {
  const obj = l.toObject ? l.toObject() : l;
  return {
    id:          obj._id,
    user_id:     obj.user_id,
    name:        userInfo?.name        || '',
    designation: userInfo?.designation || '',
    type:        obj.type,
    from_date:   obj.from_date  || '',
    to_date:     obj.to_date    || '',
    days:        parseFloat(obj.days || 1),
    session:     obj.session    || null,
    reason:      obj.reason     || '',
    applied_on:  obj.applied_on || '',
    status:      obj.status,
  };
}

/**
 * GET /api/leaves
 * Admin: only their employees' leaves
 * Employee: only their own
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const filter = {};

    if (req.user.role !== 'admin') {
      filter.user_id = req.user.userId;
    } else {
      // Get only this admin's employee IDs
      const myEmployees = await User.find({ role: 'employee', admin_id: req.user.userId }, '_id');
      const empIds = myEmployees.map(e => e._id.toString());
      filter.user_id = req.query.userId
        ? (empIds.includes(req.query.userId) ? req.query.userId : null)
        : { $in: empIds };
      if (filter.user_id === null) return res.json([]); // employee not theirs
    }

    if (req.query.status) filter.status = req.query.status;

    const rows = await Leave.find(filter).sort({ applied_on: -1 });

    // Enrich each leave with employee name + designation
    const userCache = {};
    const enriched = await Promise.all(rows.map(async (row) => {
      let userInfo = userCache[row.user_id];
      if (!userInfo) {
        const u = await User.findById(row.user_id, 'name fullName lName designation');
        userInfo = u ? {
          name:        u.name || `${u.fullName || ''} ${u.lName || ''}`.trim(),
          designation: u.designation || '',
        } : { name: '', designation: '' };
        userCache[row.user_id] = userInfo;
      }
      return fmtLeave(row, userInfo);
    }));

    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/leaves
 * Employee: Apply for leave
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { from, to, type, reason, session } = req.body;

    if (!from || !reason || !type) {
      return res.status(400).json({ error: 'from, type and reason are required.' });
    }

    const validTypes = ['paid', 'unpaid', 'sick', 'casual', 'half_day'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid leave type.' });
    }

    let days   = 1;
    let toDate = to || from;

    if (type === 'half_day') {
      days   = 0.5;
      toDate = from;
    } else {
      const d1 = new Date(from);
      const d2 = new Date(toDate);
      days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
    }

    const leaveId = uid();
    const today   = new Date().toISOString().substring(0, 10);

    // Same date(s) ke liye already pending/approved leave ho to dobara apply na hone do
    const overlapping = await Leave.findOne({
      user_id: userId,
      status:  { $in: ['pending', 'approved'] },
      from_date: { $lte: toDate },
      to_date:   { $gte: from },
    });

    if (overlapping) {
      return res.status(409).json({
        error: `You already have a ${overlapping.status} leave covering this date (${overlapping.from_date} to ${overlapping.to_date}). Cancel it first if you want to apply again.`,
      });
    }

    await Leave.create({
      _id:        leaveId,
      user_id:    userId,
      type,
      from_date:  from,
      to_date:    toDate,
      days,
      session:    session || null,
      reason,
      applied_on: today,
      status:     'pending',
    });

    return res.status(201).json({ success: true, id: leaveId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/leaves/:id
 * Admin: Approve / Reject — only for their own employees
 */
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: 'Leave not found.' });

    // Verify this employee belongs to the admin
    const emp = await User.findById(leave.user_id, 'admin_id');
    if (!emp || emp.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied. This leave does not belong to your employee.' });
    }

    await Leave.findByIdAndUpdate(req.params.id, { status });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/leaves/:id
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: 'Leave not found.' });

    if (req.user.role !== 'admin') {
      if (leave.user_id !== req.user.userId) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      if (leave.status !== 'pending') {
        return res.status(400).json({ error: 'Only pending leaves can be cancelled.' });
      }
    } else {
      // Admin can only delete leaves of their own employees
      const emp = await User.findById(leave.user_id, 'admin_id');
      if (!emp || emp.admin_id !== req.user.userId) {
        return res.status(403).json({ error: 'Access denied. This leave does not belong to your employee.' });
      }
    }

    await Leave.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
