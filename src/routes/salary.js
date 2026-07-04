// src/routes/salary.js — Salary Calculator + Generator (MongoDB)
const express      = require('express');
const router       = express.Router();
const User         = require('../models/User');
const Attendance   = require('../models/Attendance');
const Leave        = require('../models/Leave');
const SalaryRecord = require('../models/SalaryRecord');
const { uid }      = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');

// ── Helper: working days in a month ──────────────────────────────
function calcWorkingDays(year, mon) {
  const lastDay     = new Date(year, mon, 0);
  const daysInMonth = lastDay.getDate();
  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, mon - 1, d).getDay() === 0) sundays++;
  }
  return { daysInMonth, sundays, totalWorkingDays: daysInMonth - sundays, lastDay };
}

// ── Helper: core salary calculation logic (reused in calculate + generate) ──
async function computeSalary(userId, month) {
  const user = await User.findById(userId, 'name fullName lName dept designation salary admin_id role');
  if (!user) return null;

  const monthlySalary = parseFloat(user.salary || 0);
  const [year, mon]   = month.split('-').map(Number);
  const { daysInMonth, sundays, totalWorkingDays, lastDay } = calcWorkingDays(year, mon);
  const perDaySalary  = totalWorkingDays > 0 ? monthlySalary / totalWorkingDays : 0;

  const mStart = month + '-01';
  const mEnd   = lastDay.toISOString().substring(0, 10);

  const attRows = await Attendance.find({ user_id: userId, date: { $gte: mStart, $lte: mEnd } });

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

  // Approved leaves (paid — no deduction)
  const paidLeaveAgg = await Leave.aggregate([
    { $match: { user_id: userId, status: 'approved', type: { $ne: 'unpaid' }, from_date: { $gte: mStart }, to_date: { $lte: mEnd } } },
    { $group: { _id: null, total: { $sum: '$days' } } }
  ]);
  const approvedLeaveDays = parseFloat(paidLeaveAgg[0]?.total || 0);

  // Unpaid leaves (deducted)
  const unpaidLeaveAgg = await Leave.aggregate([
    { $match: { user_id: userId, status: 'approved', type: 'unpaid', from_date: { $gte: mStart }, to_date: { $lte: mEnd } } },
    { $group: { _id: null, total: { $sum: '$days' } } }
  ]);
  const unpaidLeaveDays = parseFloat(unpaidLeaveAgg[0]?.total || 0);

  const effectivePresent  = presentDays + (halfDays * 0.5) + approvedLeaveDays;
  const absentDays        = Math.max(0, totalWorkingDays - effectivePresent - unpaidLeaveDays);
  const halfDayDeduction  = halfDays * (perDaySalary * 0.5);
  const absentDeduction   = absentDays * perDaySalary;
  const unpaidLeaveDeduction = unpaidLeaveDays * perDaySalary;
  const totalAutoDeduction = halfDayDeduction + absentDeduction + unpaidLeaveDeduction;
  const baseNetSalary     = Math.max(0, monthlySalary - totalAutoDeduction);

  return {
    user,
    basicSalary:         monthlySalary,
    perDaySalary:        parseFloat(perDaySalary.toFixed(2)),
    daysInMonth,
    sundays,
    totalWorkingDays,
    presentDays,
    halfDays,
    lateDays,
    approvedLeaveDays:   parseFloat(approvedLeaveDays.toFixed(1)),
    unpaidLeaveDays:     parseFloat(unpaidLeaveDays.toFixed(1)),
    absentDays:          parseFloat(absentDays.toFixed(1)),
    halfDayDeduction:    parseFloat(halfDayDeduction.toFixed(2)),
    absentDeduction:     parseFloat(absentDeduction.toFixed(2)),
    unpaidLeaveDeduction:parseFloat(unpaidLeaveDeduction.toFixed(2)),
    totalAutoDeduction:  parseFloat(totalAutoDeduction.toFixed(2)),
    baseNetSalary:       parseFloat(baseNetSalary.toFixed(2)),
  };
}

// ── Helper: recalculate net salary for a saved record ────────────
function recalcNet(record) {
  const base = record.basic_salary - record.total_auto_deduction;
  return Math.max(0, base
    + (record.bonus          || 0)
    + (record.overtime_amount|| 0)
    + (record.other_addition || 0)
    - (record.pf             || 0)
    - (record.tds            || 0)
    - (record.other_deduction|| 0)
  );
}

// ───────────────────────────────────────────────────────────────────
// EXISTING ROUTES (unchanged URLs)
// ───────────────────────────────────────────────────────────────────

/**
 * GET /api/salary/calculate  (preview — nothing saved)
 */
router.get('/calculate', authenticate, async (req, res) => {
  try {
    const { userId, month } = req.query;
    if (!userId || !month) return res.status(400).json({ error: 'userId and month (YYYY-MM) are required.' });

    if (req.user.role === 'employee' && req.user.userId !== userId)
      return res.status(403).json({ error: 'Access denied.' });

    const data = await computeSalary(userId, month);
    if (!data) return res.status(404).json({ error: 'Employee not found.' });

    if (req.user.role === 'admin' && data.user.role === 'employee' && data.user.admin_id !== req.user.userId)
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });

    return res.json({
      userId, month,
      userName:    data.user.name,
      dept:        data.user.dept || '',
      designation: data.user.designation || '',
      ...data,
      user: undefined,
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/salary/all  — preview for all employees (not saved)
 */
router.get('/all', adminOnly, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required.' });

    const employees = await User.find({ role: 'employee', admin_id: req.user.userId }, '_id');
    const results   = await Promise.all(
      employees.map(async (emp) => {
        const data = await computeSalary(emp._id.toString(), month);
        if (!data) return null;
        return {
          userId:      emp._id,
          name:        data.user.name,
          dept:        data.user.dept || '',
          basicSalary: data.basicSalary,
          workingDays: data.totalWorkingDays,
          presentDays: data.presentDays,
          halfDays:    data.halfDays,
          absentDays:  data.absentDays,
          deduction:   data.totalAutoDeduction,
          netSalary:   data.baseNetSalary,
        };
      })
    );

    return res.json({ month, employees: results.filter(Boolean) });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ───────────────────────────────────────────────────────────────────
// NEW ROUTES
// ───────────────────────────────────────────────────────────────────

/**
 * POST /api/salary/calculate  — same as GET but via POST body
 * Body: { userId, month }
 */
router.post('/calculate', authenticate, async (req, res) => {
  try {
    const { userId, month } = req.body;
    if (!userId || !month) return res.status(400).json({ error: 'userId and month (YYYY-MM) are required.' });

    if (req.user.role === 'employee' && req.user.userId !== userId)
      return res.status(403).json({ error: 'Access denied.' });

    const data = await computeSalary(userId, month);
    if (!data) return res.status(404).json({ error: 'Employee not found.' });

    if (req.user.role === 'admin' && data.user.role === 'employee' && data.user.admin_id !== req.user.userId)
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });

    return res.json({
      userId, month,
      userName:    data.user.name,
      dept:        data.user.dept || '',
      designation: data.user.designation || '',
      ...data,
      user: undefined,
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/salary/generate
 * Generate and SAVE salary for one or all employees for a month.
 * If already generated, updates (upsert).
 * Body: { month, userId? }  — userId optional; if omitted, generates for ALL employees
 */
router.post('/generate', adminOnly, async (req, res) => {
  try {
    const { month, userId } = req.body;
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required.' });

    let employeeIds = [];
    if (userId) {
      // Single employee
      const emp = await User.findById(userId, 'admin_id role');
      if (!emp || emp.role !== 'employee' || emp.admin_id !== req.user.userId)
        return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
      employeeIds = [userId];
    } else {
      // All employees under this admin
      const emps = await User.find({ role: 'employee', admin_id: req.user.userId }, '_id');
      employeeIds = emps.map(e => e._id.toString());
    }

    if (employeeIds.length === 0)
      return res.status(404).json({ error: 'No employees found.' });

    const generated = [];
    for (const empId of employeeIds) {
      const data = await computeSalary(empId, month);
      if (!data) continue;

      // Check if already exists
      const existing = await SalaryRecord.findOne({ user_id: empId, month });

      const netSalary = Math.max(0, data.baseNetSalary
        + (existing?.bonus           || 0)
        + (existing?.overtime_amount || 0)
        + (existing?.other_addition  || 0)
        - (existing?.pf              || 0)
        - (existing?.tds             || 0)
        - (existing?.other_deduction || 0)
      );

      const payload = {
        admin_id:              req.user.userId,
        month,
        basic_salary:          data.basicSalary,
        per_day_salary:        data.perDaySalary,
        days_in_month:         data.daysInMonth,
        total_working_days:    data.totalWorkingDays,
        sundays:               data.sundays,
        present_days:          data.presentDays,
        absent_days:           data.absentDays,
        half_days:             data.halfDays,
        late_days:             data.lateDays,
        approved_leave_days:   data.approvedLeaveDays,
        unpaid_leave_days:     data.unpaidLeaveDays,
        absent_deduction:      data.absentDeduction,
        half_day_deduction:    data.halfDayDeduction,
        unpaid_leave_deduction:data.unpaidLeaveDeduction,
        total_auto_deduction:  data.totalAutoDeduction,
        net_salary:            parseFloat(netSalary.toFixed(2)),
        updated_at:            new Date(),
      };

      let record;
      if (existing) {
        Object.assign(existing, payload);
        await existing.save();
        record = existing;
      } else {
        record = await SalaryRecord.create({ _id: uid(), user_id: empId, ...payload });
      }

      generated.push({
        id:          record._id,
        userId:      empId,
        name:        data.user.name,
        dept:        data.user.dept || '',
        month,
        basicSalary: data.basicSalary,
        netSalary:   record.net_salary,
        status:      record.status,
      });
    }

    return res.status(201).json({
      success:   true,
      month,
      generated: generated.length,
      records:   generated,
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/salary/records
 * Admin: list all generated salary records
 * Query: ?month=YYYY-MM  or  ?userId=...
 */
router.get('/records', adminOnly, async (req, res) => {
  try {
    const filter = { admin_id: req.user.userId };
    if (req.query.month)  filter.month   = req.query.month;
    if (req.query.userId) filter.user_id = req.query.userId;

    const records = await SalaryRecord.find(filter).sort({ month: -1, user_id: 1 });

    // Attach employee names
    const userIds = [...new Set(records.map(r => r.user_id))];
    const users   = await User.find({ _id: { $in: userIds } }, 'name dept designation');
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const result = records.map(r => {
      const u = userMap[r.user_id] || {};
      return {
        id:           r._id,
        userId:       r.user_id,
        name:         u.name || '',
        dept:         u.dept || '',
        designation:  u.designation || '',
        month:        r.month,
        basicSalary:  r.basic_salary,
        presentDays:  r.present_days,
        absentDays:   r.absent_days,
        halfDays:     r.half_days,
        lateDays:     r.late_days,
        totalDeduction: r.total_auto_deduction,
        bonus:        r.bonus,
        overtime:     r.overtime_amount,
        pf:           r.pf,
        tds:          r.tds,
        otherDeduction: r.other_deduction,
        otherAddition:  r.other_addition,
        netSalary:    r.net_salary,
        status:       r.status,
        generatedAt:  r.generated_at,
        updatedAt:    r.updated_at,
        notes:        r.notes,
      };
    });

    return res.json(result);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/salary/records/:id
 * Get single salary record (admin or employee)
 */
router.get('/records/:id', authenticate, async (req, res) => {
  try {
    const record = await SalaryRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Salary record not found.' });

    if (req.user.role === 'admin' && record.admin_id !== req.user.userId)
      return res.status(403).json({ error: 'Access denied.' });
    if (req.user.role === 'employee' && record.user_id !== req.user.userId)
      return res.status(403).json({ error: 'Access denied.' });

    const u = await User.findById(record.user_id, 'name dept designation');
    return res.json({ ...record.toObject(), name: u?.name || '', dept: u?.dept || '', designation: u?.designation || '' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/salary/records/:id
 * Admin: edit optional fields only (bonus, overtime, pf, tds, other_deduction, other_addition, notes, status)
 * net_salary is auto-recalculated — admin cannot set it directly
 */
router.put('/records/:id', adminOnly, async (req, res) => {
  try {
    const record = await SalaryRecord.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Salary record not found.' });
    if (record.admin_id !== req.user.userId)
      return res.status(403).json({ error: 'Access denied.' });

    const allowed = ['bonus', 'overtime_hours', 'overtime_amount', 'pf', 'tds', 'other_deduction', 'other_addition', 'notes', 'status'];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) record[field] = req.body[field];
    });

    // Recalculate net_salary automatically
    record.net_salary  = parseFloat(recalcNet(record).toFixed(2));
    record.updated_at  = new Date();
    await record.save();

    return res.json({
      success:   true,
      netSalary: record.net_salary,
      record:    record.toObject(),
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/salary/my-history
 * Employee: last 6 months salary records
 */
router.get('/my-history', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Last 6 months
    const months = [];
    const now    = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const records = await SalaryRecord.find({
      user_id: userId,
      month:   { $in: months },
    }).sort({ month: -1 });

    return res.json({
      userId,
      totalRecords: records.length,
      records: records.map(r => ({
        id:           r._id,
        month:        r.month,
        basicSalary:  r.basic_salary,
        presentDays:  r.present_days,
        absentDays:   r.absent_days,
        halfDays:     r.half_days,
        lateDays:     r.late_days,
        totalDeduction: r.total_auto_deduction,
        bonus:        r.bonus,
        overtime:     r.overtime_amount,
        pf:           r.pf,
        tds:          r.tds,
        otherDeduction: r.other_deduction,
        otherAddition:  r.other_addition,
        netSalary:    r.net_salary,
        status:       r.status,
        notes:        r.notes,
        generatedAt:  r.generated_at,
      })),
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
