// src/routes/salary.js — Salary Calculator + Generator (MongoDB)
const express      = require('express');
const router       = express.Router();
const User         = require('../models/User');
const Attendance   = require('../models/Attendance');
const Leave        = require('../models/Leave');
const SalaryRecord = require('../models/SalaryRecord');
const SaturdayOff  = require('../models/SaturdayOff');
const { uid, todayIST } = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');

// ── Helper: count days/Sundays/working-days in an arbitrary inclusive
// date range "YYYY-MM-DD" → "YYYY-MM-DD" ─────────────────────────────
function countDayRange(startStr, endStr) {
  if (!startStr || !endStr || startStr > endStr) return { totalDays: 0, sundays: 0, workingDays: 0 };
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end   = new Date(ey, em - 1, ed);
  let totalDays = 0, sundays = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    totalDays++;
    if (d.getDay() === 0) sundays++;
  }
  return { totalDays, sundays, workingDays: totalDays - sundays };
}

// ── Helper: full calendar month stats (used as the per-day RATE basis,
// even when a partial custom range is being calculated) ──────────────
function calcMonthWorkingDays(year, mon) {
  const lastDay     = new Date(year, mon, 0);
  const daysInMonth = lastDay.getDate();
  const mStart      = `${year}-${String(mon).padStart(2, '0')}-01`;
  const mEnd        = lastDay.toISOString().substring(0, 10);
  const stats       = countDayRange(mStart, mEnd);
  return { daysInMonth, sundays: stats.sundays, totalWorkingDays: stats.workingDays, lastDay, mStart, mEnd };
}

// ── Core salary calculation for an arbitrary period ───────────────────
// periodStart/periodEnd: "YYYY-MM-DD" inclusive — can be a full calendar
// month OR a custom admin-picked range (e.g. mid-month join/exit, or a
// partial "Salary Calculator" From/To selection).
// rateMonth: "YYYY-MM" — the calendar month whose working-day count sets
// the per-day salary rate (standard payroll convention: rate never
// changes just because a shorter range was queried).
async function computeSalaryCore(userId, { periodStart, periodEnd, rateMonth }) {
  const user = await User.findById(userId, 'name fullName lName dept designation salary admin_id role');
  if (!user) return null;

  const monthlySalary = parseFloat(user.salary || 0);
  const [rY, rM] = rateMonth.split('-').map(Number);
  const rateStats = calcMonthWorkingDays(rY, rM);
  const perDaySalary = rateStats.totalWorkingDays > 0 ? monthlySalary / rateStats.totalWorkingDays : 0;

  // Cap the period at "today" — days that haven't happened yet are never
  // queried or counted as absent (fixes: future dates were being marked
  // absent when calculating mid-month).
  const todayStr   = todayIST();
  const elapsedEnd = periodEnd > todayStr ? todayStr : periodEnd;
  const hasElapsed = periodStart <= elapsedEnd;

  const fullPeriodStats    = countDayRange(periodStart, periodEnd);
  const elapsedPeriodStats = hasElapsed ? countDayRange(periodStart, elapsedEnd) : { totalDays: 0, sundays: 0, workingDays: 0 };

  const attRows = hasElapsed
    ? await Attendance.find({ user_id: userId, date: { $gte: periodStart, $lte: elapsedEnd } })
    : [];

  // A half-day is still a day the employee showed up — it should count
  // towards "present" for display purposes. `halfDays` is kept separately
  // as a subset flag (used for the 0.5-day deduction below), but anyone
  // who checked in — full day or half day — is included in presentDays.
  let fullDayPresentDays = 0, halfDays = 0, lateDays = 0;
  attRows.forEach(a => {
    if (a.check_in) {
      if (a.is_half_day) halfDays++;
      else {
        fullDayPresentDays++;
        if (a.is_late) lateDays++;
      }
    }
  });
  const presentDays = fullDayPresentDays + halfDays;

  // Approved leaves within the elapsed window (paid — no deduction)
  const paidLeaveAgg = hasElapsed ? await Leave.aggregate([
    { $match: { user_id: userId, status: 'approved', type: { $ne: 'unpaid' }, from_date: { $gte: periodStart }, to_date: { $lte: elapsedEnd } } },
    { $group: { _id: null, total: { $sum: '$days' } } }
  ]) : [];
  const approvedLeaveDays = parseFloat(paidLeaveAgg[0]?.total || 0);

  // Unpaid leaves within the elapsed window (deducted)
  const unpaidLeaveAgg = hasElapsed ? await Leave.aggregate([
    { $match: { user_id: userId, status: 'approved', type: 'unpaid', from_date: { $gte: periodStart }, to_date: { $lte: elapsedEnd } } },
    { $group: { _id: null, total: { $sum: '$days' } } }
  ]) : [];
  const unpaidLeaveDays = parseFloat(unpaidLeaveAgg[0]?.total || 0);

  // Saturday-offs taken within the elapsed window — approved rest days,
  // not absences, so remove them from the working-day count.
  const saturdayOffRows = hasElapsed
    ? await SaturdayOff.find({ user_id: userId, date: { $gte: periodStart, $lte: elapsedEnd } })
    : [];
  const saturdayOffDays = saturdayOffRows.length;
  const elapsedWorkingDaysNet = Math.max(0, elapsedPeriodStats.workingDays - saturdayOffDays);

  // Upcoming approved leaves — scheduled later within the period but
  // haven't happened yet, so not part of the deduction math above.
  // Shown separately so admin/employee can see what's already scheduled.
  let upcomingApprovedLeaveDays = 0, upcomingLeaveCount = 0;
  if (elapsedEnd < periodEnd) {
    const [ey, em, ed] = elapsedEnd.split('-').map(Number);
    const nd     = new Date(ey, em - 1, ed + 1);
    const nextDay = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
    const upcomingAgg = await Leave.aggregate([
      { $match: { user_id: userId, status: 'approved', from_date: { $lte: periodEnd }, to_date: { $gte: nextDay } } },
      { $group: { _id: null, total: { $sum: '$days' }, count: { $sum: 1 } } }
    ]);
    upcomingApprovedLeaveDays = parseFloat(upcomingAgg[0]?.total || 0);
    upcomingLeaveCount        = upcomingAgg[0]?.count || 0;
  }

  // ── Absence math — half-day counted ONCE only ─────────────────────
  // A half-day fully occupies its working-day slot here (previously it
  // only got 0.5 credit, which left the other 0.5 falling into
  // absentDays AS WELL — deducting a full day's pay for one half-day).
  // The actual pay cut for a half-day is applied separately below via
  // halfDayDeduction, so it must not also inflate absentDays.
  // NOTE: presentDays already includes halfDays (see above), so it must
  // NOT be added again here or half-days would occupy two working-day
  // slots instead of one.
  const presentForAbsence = presentDays + approvedLeaveDays;
  const absentDays        = Math.max(0, elapsedWorkingDaysNet - presentForAbsence - unpaidLeaveDays);

  const halfDayDeduction     = halfDays * (perDaySalary * 0.5);
  const absentDeduction      = absentDays * perDaySalary;
  const unpaidLeaveDeduction = unpaidLeaveDays * perDaySalary;
  const totalAutoDeduction   = halfDayDeduction + absentDeduction + unpaidLeaveDeduction;
  const baseNetSalary        = Math.max(0, monthlySalary - totalAutoDeduction);

  return {
    user,
    basicSalary:         monthlySalary,
    perDaySalary:        parseFloat(perDaySalary.toFixed(2)),
    periodStart, periodEnd,
    periodDays:          fullPeriodStats.totalDays,
    periodSundays:       fullPeriodStats.sundays,
    periodWorkingDays:   fullPeriodStats.workingDays,
    elapsedWorkingDays:  elapsedWorkingDaysNet,
    saturdayOffDays,
    presentDays,
    halfDays,
    lateDays,
    approvedLeaveDays:   parseFloat(approvedLeaveDays.toFixed(1)),
    unpaidLeaveDays:     parseFloat(unpaidLeaveDays.toFixed(1)),
    upcomingApprovedLeaveDays: parseFloat(upcomingApprovedLeaveDays.toFixed(1)),
    upcomingLeaveCount,
    absentDays:          parseFloat(absentDays.toFixed(1)),
    halfDayDeduction:    parseFloat(halfDayDeduction.toFixed(2)),
    absentDeduction:     parseFloat(absentDeduction.toFixed(2)),
    unpaidLeaveDeduction:parseFloat(unpaidLeaveDeduction.toFixed(2)),
    totalAutoDeduction:  parseFloat(totalAutoDeduction.toFixed(2)),
    baseNetSalary:       parseFloat(baseNetSalary.toFixed(2)),
  };
}

// ── Wrapper: whole calendar month (existing behaviour / field names,
// used by /generate so saved SalaryRecord fields stay unchanged) ─────
async function computeSalary(userId, month) {
  const [year, mon] = month.split('-').map(Number);
  const { mStart, mEnd } = calcMonthWorkingDays(year, mon);
  const core = await computeSalaryCore(userId, { periodStart: mStart, periodEnd: mEnd, rateMonth: month });
  if (!core) return null;
  return {
    ...core,
    daysInMonth:      core.periodDays,
    sundays:          core.periodSundays,
    offDays:          core.periodSundays, // Sunday offs — alias for the UI's "Off Days" field
    totalWorkingDays: core.periodWorkingDays,
  };
}

// ── Wrapper: custom From/To date range (can be a partial period, e.g.
// mid-month join/exit, or any admin-picked range within one month) ───
async function computeSalaryForRange(userId, fromDate, toDate) {
  const rateMonth = fromDate.substring(0, 7); // rate always based on fromDate's calendar month
  const core = await computeSalaryCore(userId, { periodStart: fromDate, periodEnd: toDate, rateMonth });
  if (!core) return null;
  return {
    ...core,
    daysInMonth:      core.periodDays,       // days in the SELECTED RANGE (not necessarily the full month)
    sundays:          core.periodSundays,
    offDays:          core.periodSundays,    // Sunday offs — alias for the UI's "Off Days" field
    totalWorkingDays: core.periodWorkingDays, // working days in the selected range
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
 * GET /api/salary/all  — list employees for the Salary Management screen
 * Only includes employees whose salary has ALREADY been generated
 * (i.e. a SalaryRecord exists) for the given month — an employee should
 * not appear in this list as a "pending" preview before the admin has
 * actually generated their salary.
 */
router.get('/all', adminOnly, async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required.' });

    // Only employees who already have a generated record for this month
    const records = await SalaryRecord.find({ admin_id: req.user.userId, month });
    if (records.length === 0) return res.json({ month, employees: [] });

    const userIds = records.map(r => r.user_id);
    const users   = await User.find({ _id: { $in: userIds } }, 'name dept');
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const employees = records.map(r => {
      const u = userMap[r.user_id] || {};
      return {
        userId:      r.user_id,
        name:        u.name || '',
        dept:        u.dept || '',
        basicSalary: r.basic_salary,
        workingDays: r.total_working_days,      // full month working days
        offDays:     r.sundays,                 // Sunday offs in the month
        presentDays: r.present_days,
        halfDays:    r.half_days,
        absentDays:  r.absent_days,
        deduction:   r.total_auto_deduction,
        netSalary:   r.net_salary,
        status:      r.status,
        generatedAt: r.generated_at,
      };
    });

    return res.json({ month, employees });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ───────────────────────────────────────────────────────────────────
// NEW ROUTES
// ───────────────────────────────────────────────────────────────────

/**
 * POST /api/salary/calculate  — same as GET but via POST body
 * Body: { userId, month }  OR  { userId, fromDate, toDate }
 * If fromDate+toDate are both sent, the EXACT range is used (can be a
 * partial period, e.g. mid-month join/exit) — not just their month.
 */
router.post('/calculate', authenticate, async (req, res) => {
  try {
    const { userId, fromDate, toDate } = req.body;
    let   { month } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    if (req.user.role === 'employee' && req.user.userId !== userId)
      return res.status(403).json({ error: 'Access denied.' });

    let data;
    if (fromDate && toDate) {
      // Custom (possibly partial) date range — honoured exactly as given
      data = await computeSalaryForRange(userId, fromDate, toDate);
      if (!month) month = String(fromDate).substring(0, 7);
    } else {
      if (!month && fromDate) month = String(fromDate).substring(0, 7);
      if (!month) return res.status(400).json({ error: 'month (YYYY-MM) or fromDate+toDate are required.' });
      data = await computeSalary(userId, month);
    }

    if (!data) return res.status(404).json({ error: 'Employee not found.' });

    if (req.user.role === 'admin' && data.user.role === 'employee' && data.user.admin_id !== req.user.userId)
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });

    return res.json({
      userId, month,
      fromDate: fromDate || null,
      toDate:   toDate   || null,
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