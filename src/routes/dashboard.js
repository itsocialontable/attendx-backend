// src/routes/dashboard.js — Dashboard Stats (MongoDB)
// Multi-admin: har admin sirf apne employees ka data dekh sakta hai
// Saturday: sab din working hain, koi Saturday off nahi
const express    = require('express');
const router     = express.Router();
const User       = require('../models/User');
const Attendance = require('../models/Attendance');
const Leave      = require('../models/Leave');
const { authenticate, adminOnly } = require('../middleware/auth');
const { todayIST } = require('../utils/helpers');

/**
 * GET /api/dashboard/stats
 * Admin: Overall stats for today — sirf apne employees ka
 */
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const today   = todayIST();
    const adminId = req.user.userId;

    // Get only this admin's employee IDs
    const myEmployees = await User.find({ role: 'employee', admin_id: adminId }, '_id');
    const empIds = myEmployees.map(e => e._id.toString());

    const [
      totalEmployees,
      presentToday,
      pendingLeaves,
      lateToday,
      halfDayToday,
    ] = await Promise.all([
      Promise.resolve(empIds.length),
      Attendance.distinct('user_id', { date: today, user_id: { $in: empIds } }).then(ids => ids.length),
      Leave.countDocuments({ status: 'pending', user_id: { $in: empIds } }),
      Attendance.countDocuments({ date: today, is_late: true, user_id: { $in: empIds } }),
      Attendance.countDocuments({ date: today, is_half_day: true, user_id: { $in: empIds } }),
    ]);

    return res.json({
      totalEmployees,
      presentToday,
      absentToday:   Math.max(0, totalEmployees - presentToday),
      pendingLeaves,
      lateToday,
      halfDayToday,
      date:          today,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dashboard/employee-stats/:userId
 * Employee: Personal stats for current month
 * Saturday is a working day — no Saturday offs
 */
router.get('/employee-stats/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    // Access control
    if (req.user.role === 'employee' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (req.user.role === 'admin') {
      const emp = await User.findById(userId, 'admin_id role');
      if (!emp) return res.status(404).json({ error: 'User not found.' });
      if (emp.role === 'employee' && emp.admin_id !== req.user.userId) {
        return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
      }
    }

    const today  = todayIST();
    const month  = today.substring(0, 7);
    const mStart = month + '-01';
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0);
    const mEnd   = lastDay.toISOString().substring(0, 10);

    const todayRecord = await Attendance.findOne({ user_id: userId, date: today });

    const attRows = await Attendance.find({
      user_id: userId,
      date:    { $gte: mStart, $lte: mEnd },
    });

    let present = 0, halfDays = 0, lateDays = 0, totalMins = 0;
    attRows.forEach(a => {
      if (a.check_in) {
        if (a.is_half_day) halfDays++;
        else {
          present++;
          if (a.is_late) lateDays++;
        }
        totalMins += parseInt(a.net_mins || 0);
      }
    });

    const [pendingLeaves, approvedAgg, warningCount] = await Promise.all([
      Leave.countDocuments({ user_id: userId, status: 'pending' }),
      Leave.aggregate([
        {
          $match: {
            user_id:   userId,
            status:    'approved',
            from_date: { $gte: mStart },
            to_date:   { $lte: mEnd },
          }
        },
        { $group: { _id: null, total: { $sum: '$days' } } }
      ]),
      Attendance.countDocuments({
        user_id:     userId,
        date:        { $gte: mStart, $lte: mEnd },
        is_late:     true,
        is_half_day: false,
      }),
    ]);

    // Sundays in month — Saturdays are working days now
    const daysInMonth = lastDay.getDate();
    let sundays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(y, m - 1, d).getDay() === 0) sundays++;
    }

    const totalWorkingDays  = daysInMonth - sundays;
    const approvedLeaveDays = parseFloat(approvedAgg[0]?.total || 0);
    const effectivePresent  = present + halfDays * 0.5 + approvedLeaveDays;
    const absentDays        = Math.max(0, totalWorkingDays - effectivePresent);

    const MAX_WARNINGS = parseInt(process.env.MAX_WARNINGS || 3);

    // Build today_working object
    let todayWorking = null;
    if (todayRecord) {
      const checkInStr  = todayRecord.check_in  ? String(todayRecord.check_in).substring(0, 5)  : null;
      const checkOutStr = todayRecord.check_out ? String(todayRecord.check_out).substring(0, 5) : null;

      function to12hr(timeStr) {
        if (!timeStr) return null;
        const [h, mm] = timeStr.split(':').map(Number);
        const suffix = h >= 12 ? 'PM' : 'AM';
        const h12    = h % 12 || 12;
        return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
      }

      let workingMins = 0;
      if (checkInStr) {
        const { toMins, timeNowIST } = require('../utils/helpers');
        if (checkOutStr) {
          workingMins = Math.max(0, toMins(checkOutStr) - toMins(checkInStr));
        } else {
          const nowStr = timeNowIST();
          workingMins = Math.max(0, toMins(nowStr) - toMins(checkInStr));
        }
      }

      const workingHours  = Math.floor(workingMins / 60);
      const workingMinRem = workingMins % 60;

      todayWorking = {
        date:             today,
        isPresent:        !!todayRecord.check_in,
        checkIn:          checkInStr,
        checkIn12hr:      to12hr(checkInStr),
        checkOut:         checkOutStr,
        checkOut12hr:     to12hr(checkOutStr),
        isCheckedOut:     !!checkOutStr,
        workingMins,
        workingFormatted: `${workingHours}h ${workingMinRem}m`,
        isLate:           !!todayRecord.is_late,
        isHalfDay:        !!todayRecord.is_half_day,
        lunchIn:          todayRecord.lunch_in  ? String(todayRecord.lunch_in).substring(0, 5)  : null,
        lunchOut:         todayRecord.lunch_out ? String(todayRecord.lunch_out).substring(0, 5) : null,
        breakMins:        parseInt(todayRecord.break_mins || 0),
      };
    }

    return res.json({
      userId,
      month,
      today_working:   todayWorking,
      presentDays:     present,
      halfDays,
      lateDays,
      totalWorkMins:   totalMins,
      absentDays:      parseFloat(absentDays.toFixed(1)),
      pendingLeaves,
      approvedLeaves:  approvedLeaveDays,
      warnings:        warningCount,
      maxWarnings:     MAX_WARNINGS,
      warningsLeft:    Math.max(0, MAX_WARNINGS - warningCount),
      nextLateIsHalfDay: warningCount >= MAX_WARNINGS,
      daysInMonth,
      sundays,
      totalWorkingDays,  // Saturdays included — only Sundays off
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
