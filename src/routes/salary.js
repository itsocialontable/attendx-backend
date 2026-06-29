// src/routes/salary.js — Salary Calculator (MongoDB)
// Saturday is a working day — koi Saturday off nahi
// Multi-admin: admin sirf apne employees ka salary dekh sakta hai
const express    = require('express');
const router     = express.Router();
const User       = require('../models/User');
const Attendance = require('../models/Attendance');
const Leave      = require('../models/Leave');
const { authenticate, adminOnly } = require('../middleware/auth');

/**
 * Helper: Calculate working days for a month
 * Working Days = Total days - Sundays only (Saturdays are working)
 */
function calcWorkingDays(year, mon) {
  const lastDay     = new Date(year, mon, 0);
  const daysInMonth = lastDay.getDate();

  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, mon - 1, d).getDay() === 0) sundays++;
  }

  const totalWorkingDays = daysInMonth - sundays;
  return { daysInMonth, sundays, totalWorkingDays, lastDay };
}

/**
 * GET /api/salary/calculate
 * Query: userId, month (YYYY-MM)
 */
router.get('/calculate', authenticate, async (req, res) => {
  try {
    const { userId, month } = req.query;

    if (!userId || !month) {
      return res.status(400).json({ error: 'userId and month (YYYY-MM) are required.' });
    }

    if (req.user.role === 'employee' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const user = await User.findById(userId, 'name dept salary admin_id role');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Admin can only calculate salary for their own employees
    if (req.user.role === 'admin' && user.role === 'employee' && user.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
    }

    const monthlySalary = parseFloat(user.salary || 0);
    const [year, mon]   = month.split('-').map(Number);

    const { daysInMonth, sundays, totalWorkingDays, lastDay } = calcWorkingDays(year, mon);

    const perDaySalary = totalWorkingDays > 0 ? monthlySalary / totalWorkingDays : 0;

    const mStart = month + '-01';
    const mEnd   = lastDay.toISOString().substring(0, 10);

    const attRows = await Attendance.find({
      user_id: userId,
      date:    { $gte: mStart, $lte: mEnd },
    });

    let presentDays = 0, halfDays = 0, lateDays = 0;
    attRows.forEach(a => {
      if (a.check_in) {
        if (a.is_half_day) halfDays++;
        else {
          presentDays++;
          if (a.is_late) lateDays++;
        }
      }
    });

    const leaveAgg = await Leave.aggregate([
      {
        $match: {
          user_id:   userId,
          status:    'approved',
          from_date: { $gte: mStart },
          to_date:   { $lte: mEnd },
        }
      },
      { $group: { _id: null, total: { $sum: '$days' } } }
    ]);
    const approvedLeaveDays = parseFloat(leaveAgg[0]?.total || 0);

    const effectivePresent = presentDays + (halfDays * 0.5) + approvedLeaveDays;
    const absentDays       = Math.max(0, totalWorkingDays - effectivePresent);
    const halfDayDeduction = halfDays * (perDaySalary * 0.5);
    const absentDeduction  = absentDays * perDaySalary;
    const totalDeduction   = halfDayDeduction + absentDeduction;
    const netSalary        = Math.max(0, monthlySalary - totalDeduction);

    return res.json({
      userId,
      userName:         user.name,
      dept:             user.dept || '',
      month,
      monthlySalary,
      perDaySalary:     parseFloat(perDaySalary.toFixed(2)),
      daysInMonth,
      sundays,
      totalWorkingDays,
      presentDays,
      halfDays,
      lateDays,
      approvedLeaveDays,
      effectivePresent: parseFloat(effectivePresent.toFixed(1)),
      absentDays:       parseFloat(absentDays.toFixed(1)),
      halfDayDeduction: parseFloat(halfDayDeduction.toFixed(2)),
      absentDeduction:  parseFloat(absentDeduction.toFixed(2)),
      totalDeduction:   parseFloat(totalDeduction.toFixed(2)),
      netSalary:        parseFloat(netSalary.toFixed(2)),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/salary/all
 * Admin: Salary summary for all their employees for a month
 */
router.get('/all', adminOnly, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required.' });

    // Only this admin's employees
    const employees = await User.find({ role: 'employee', admin_id: req.user.userId }, 'name dept salary');

    const [year, mon] = month.split('-').map(Number);
    const { sundays, totalWorkingDays, lastDay } = calcWorkingDays(year, mon);
    const mStart = month + '-01';
    const mEnd   = lastDay.toISOString().substring(0, 10);

    const results = await Promise.all(employees.map(async (emp) => {
      const monthlySalary = parseFloat(emp.salary || 0);
      const perDay = totalWorkingDays > 0 ? monthlySalary / totalWorkingDays : 0;

      const attRows = await Attendance.find({
        user_id: emp._id,
        date:    { $gte: mStart, $lte: mEnd },
      }, 'is_half_day is_late check_in');

      let present = 0, halfDays = 0;
      attRows.forEach(a => {
        if (a.check_in) {
          if (a.is_half_day) halfDays++;
          else present++;
        }
      });

      const leaveAgg = await Leave.aggregate([
        {
          $match: {
            user_id:   emp._id.toString(),
            status:    'approved',
            from_date: { $gte: mStart },
            to_date:   { $lte: mEnd },
          }
        },
        { $group: { _id: null, total: { $sum: '$days' } } }
      ]);
      const leaveDays = parseFloat(leaveAgg[0]?.total || 0);

      const effective = present + halfDays * 0.5 + leaveDays;
      const absent    = Math.max(0, totalWorkingDays - effective);
      const deduction = (halfDays * perDay * 0.5) + (absent * perDay);
      const net       = Math.max(0, monthlySalary - deduction);

      return {
        userId:        emp._id,
        name:          emp.name,
        dept:          emp.dept || '',
        monthlySalary,
        sundays,
        workingDays:   totalWorkingDays,
        presentDays:   present,
        halfDays,
        leaveDays,
        absentDays:    parseFloat(absent.toFixed(1)),
        deduction:     parseFloat(deduction.toFixed(2)),
        netSalary:     parseFloat(net.toFixed(2)),
      };
    }));

    return res.json({ month, employees: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
