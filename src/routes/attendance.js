// src/routes/attendance.js — Attendance Management (MongoDB)
const express    = require('express');
const router     = express.Router();
const Attendance = require('../models/Attendance');
const User       = require('../models/User');
const { uid, fixRecord, todayIST, timeNowIST, toMins } = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');
const { checkGeofence } = require('../utils/geofence');

// ── Office Timing Rules ───────────────────────────────────────────
// Office hours  : 10:00 – 18:30
// On time       : up to 10:15  → no flag
// Late window   : 10:15 – 11:30 → is_late = true, warning counted
//   3 warnings  → 4th late arrival auto-converts to Half Day
// Half day zone : 11:30 or later → is_half_day = true (no warning, direct half day)
//
// Lunch window  : 1:15 PM – 2:00 PM (fixed)
//   lunch-in    : allowed only between 13:15 and 14:00
//   lunch-out   : allowed only after 13:15 (and after lunch_in)

const OFFICE_START_HOUR   = parseInt(process.env.OFFICE_START_HOUR   || 10);
const OFFICE_START_MINUTE = parseInt(process.env.OFFICE_START_MINUTE || 0);
const OFFICE_END_HOUR     = parseInt(process.env.OFFICE_END_HOUR     || 18);
const OFFICE_END_MINUTE   = parseInt(process.env.OFFICE_END_MINUTE   || 30);

const LATE_HOUR       = parseInt(process.env.LATE_HOUR      || 10);
const LATE_MINUTE     = parseInt(process.env.LATE_MINUTE    || 15);
const HALF_DAY_HOUR   = parseInt(process.env.HALF_DAY_HOUR  || 11);
const HALF_DAY_MINUTE = parseInt(process.env.HALF_DAY_MINUTE || 30);
const MAX_WARNINGS    = parseInt(process.env.MAX_WARNINGS   || 3);  // 4th triggers auto half day

// Lunch window: 1:15 PM – 2:00 PM
const LUNCH_START_HOUR   = parseInt(process.env.LUNCH_START_HOUR   || 13);
const LUNCH_START_MINUTE = parseInt(process.env.LUNCH_START_MINUTE || 15);
const LUNCH_END_HOUR     = parseInt(process.env.LUNCH_END_HOUR     || 14);
const LUNCH_END_MINUTE   = parseInt(process.env.LUNCH_END_MINUTE   || 0);

// Minutes since midnight thresholds
const LATE_THRESH       = LATE_HOUR * 60 + LATE_MINUTE;             // 10:15 = 615 mins
const HALF_DAY_THRESH   = HALF_DAY_HOUR * 60 + HALF_DAY_MINUTE;    // 11:30 = 690 mins
const LUNCH_START_THRESH = LUNCH_START_HOUR * 60 + LUNCH_START_MINUTE; // 13:15 = 795 mins
const LUNCH_END_THRESH   = LUNCH_END_HOUR * 60 + LUNCH_END_MINUTE;     // 14:00 = 840 mins

/**
 * GET /api/attendance
 * Query params: userId, date, fromDate, toDate
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const filter = {};
    if (req.query.userId)   filter.user_id = req.query.userId;
    if (req.query.date)     filter.date    = req.query.date;
    if (req.query.fromDate || req.query.toDate) {
      filter.date = {};
      if (req.query.fromDate) filter.date.$gte = req.query.fromDate;
      if (req.query.toDate)   filter.date.$lte = req.query.toDate;
    }

    // Admin: scope to only their employees' attendance
    if (req.user.role === 'admin' && !req.query.userId) {
      const myEmployees = await User.find({ role: 'employee', admin_id: req.user.userId }, '_id');
      const empIds = myEmployees.map(e => e._id.toString());
      filter.user_id = { $in: empIds };
    } else if (req.user.role === 'admin' && req.query.userId) {
      const emp = await User.findById(req.query.userId, 'admin_id role');
      if (!emp || (emp.role === 'employee' && emp.admin_id !== req.user.userId)) {
        return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
      }
    }

    const rows = await Attendance.find(filter).sort({ date: -1 });
    return res.json(rows.map(fixRecord));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/attendance/today-state/:userId
 */
router.get('/today-state/:userId', authenticate, async (req, res) => {
  try {
    const today  = todayIST();
    const record = await Attendance.findOne({ user_id: req.params.userId, date: today });
    return res.json(record ? fixRecord(record) : null);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/attendance/warnings/:userId
 * Returns monthly late warning count
 * Late window: 10:15–11:29  (is_late=true, is_half_day=false)
 * After MAX_WARNINGS (3) warnings → next late = auto half day
 */
router.get('/warnings/:userId', authenticate, async (req, res) => {
  try {
    const today  = todayIST();
    const month  = today.substring(0, 7);
    const mStart = month + '-01';
    const d      = new Date(today);
    const mEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0)
                     .toISOString().substring(0, 10);

    const count = await Attendance.countDocuments({
      user_id:     req.params.userId,
      date:        { $gte: mStart, $lte: mEnd },
      is_late:     true,
      is_half_day: false,
    });

    return res.json({
      userId:           req.params.userId,
      warnings:         count,
      maxWarnings:      MAX_WARNINGS,
      warningsLeft:     Math.max(0, MAX_WARNINGS - count),
      nextLateIsHalfDay: count >= MAX_WARNINGS,   // true = 4th late will be auto half day
      month:            mStart,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/attendance/lunch-timing
 * Returns lunch window info for frontend display
 */
router.get('/lunch-timing', authenticate, async (req, res) => {
  return res.json({
    lunchStart: `${String(LUNCH_START_HOUR).padStart(2,'0')}:${String(LUNCH_START_MINUTE).padStart(2,'0')}`,
    lunchEnd:   `${String(LUNCH_END_HOUR).padStart(2,'0')}:${String(LUNCH_END_MINUTE).padStart(2,'0')}`,
    message:    `Lunch break is only allowed between ${String(LUNCH_START_HOUR).padStart(2,'0')}:${String(LUNCH_START_MINUTE).padStart(2,'0')} and ${String(LUNCH_END_HOUR).padStart(2,'0')}:${String(LUNCH_END_MINUTE).padStart(2,'0')}.`,
  });
});

/**
 * POST /api/attendance/checkin
 *
 * Timing rules:
 *   Before 10:15          → On time   (is_late=false, is_half_day=false)
 *   10:15 – 11:29         → Late      (is_late=true,  is_half_day=false) + warning
 *     3rd warning done, 4th late → Auto Half Day (is_late=false, is_half_day=true)
 *   11:30 or later        → Direct Half Day (is_late=false, is_half_day=true, no warning)
 */
router.post('/checkin', authenticate, async (req, res) => {
  try {
    const userId   = req.user.userId;
    const today    = todayIST();
    const nowStr   = timeNowIST();
    const formattedTime = new Date().toLocaleTimeString('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});
    const location = req.body.location || null;

    // ── Geofence Check ──────────────────────────────────────────
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      const geo = checkGeofence(lat, lng);
      if (!geo.allowed) {
        return res.status(403).json({
          error:    geo.message,
          code:     'OUTSIDE_GEOFENCE',
          distance: geo.distance,
          radius:   geo.radius,
          allowed:  false,
        });
      }
    }

    // Already checked in today?
    const existing = await Attendance.findOne({ user_id: userId, date: today });
    // if (existing) {
    //   return res.status(400).json({ error: 'Aaj ka check-in already ho chuka hai.' });
    // }
    if (existing) {
  return res.status(400).json({
    error: "Today's check-in has already been completed.",
    checkIn: existing.check_in,
    checkOut: existing.check_out,
    isLate: existing.is_late,
    isHalfDay: existing.is_half_day
  });
}

    const totalMins = toMins(nowStr);

    // ── Step 1: Determine raw status based on arrival time ──────
    // 11:30+ → direct half day, no warning
    const isDirectHalfDay = totalMins >= HALF_DAY_THRESH;
    // 10:15–11:29 → late window
    const isLateArrival   = !isDirectHalfDay && totalMins >= LATE_THRESH;

    let warningCount  = 0;
    let autoHalfDay   = false;
    let halfDayAmount = 0;
    let halfDayReason = '';

    if (isDirectHalfDay) {
      // ── Direct half day (11:30 ke baad) ──
      halfDayReason = 'direct_half_day';

      // Calculate half day deduction amount
      const d = new Date(today);
      const userDoc = await User.findById(userId, 'salary');
      const monthlySalary = parseFloat(userDoc?.salary || 0);
      const daysInMonth   = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      let sundays = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        if (new Date(d.getFullYear(), d.getMonth(), day).getDay() === 0) sundays++;
      }
      const workingDays = daysInMonth - sundays;
      halfDayAmount     = workingDays > 0 ? (monthlySalary / workingDays) * 0.5 : 0;

    } else if (isLateArrival) {
      // ── Late window (10:15–11:29) ── count warnings this month ──
      const d      = new Date(today);
      const mStart = today.substring(0, 7) + '-01';
      const mEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0)
                       .toISOString().substring(0, 10);

      // Count previous late days this month (excluding today)
      const prevWarnings = await Attendance.countDocuments({
        user_id:     userId,
        date:        { $gte: mStart, $lte: mEnd, $lt: today },
        is_late:     true,
        is_half_day: false,
      });
      warningCount = prevWarnings + 1; // including today

      // MAX_WARNINGS = 3 → 4th late (warningCount === 4) triggers auto half day
      if (warningCount > MAX_WARNINGS) {
        autoHalfDay   = true;
        halfDayReason = 'auto_half_day_warnings';

        // Calculate half day deduction
        const userDoc = await User.findById(userId, 'salary');
        const monthlySalary = parseFloat(userDoc?.salary || 0);
        const daysInMonth   = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let sundays = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          if (new Date(d.getFullYear(), d.getMonth(), day).getDay() === 0) sundays++;
        }
        const workingDays = daysInMonth - sundays;
        halfDayAmount     = workingDays > 0 ? (monthlySalary / workingDays) * 0.5 : 0;
      }
    }

    // ── Step 2: Final flags ──────────────────────────────────────
    const finalIsHalfDay = isDirectHalfDay || autoHalfDay;
    // is_late stays false if it became a half day (auto or direct)
    const finalIsLate    = isLateArrival && !finalIsHalfDay;

    // ── Step 3: Save record ──────────────────────────────────────
    const recordId = uid();
    await Attendance.create({
      _id:              recordId,
      user_id:          userId,
      date:             today,
      check_in:         nowStr,
      is_late:          finalIsLate,
      is_half_day:      finalIsHalfDay,
      checkin_location: location,
    });

    return res.json({
      success:        true,
      id:             recordId,
      // checkIn:        nowStr,
      checkIn: formattedTime,
      isLate:         finalIsLate,
      isHalfDay:      finalIsHalfDay,
      halfDayReason,          // 'direct_half_day' | 'auto_half_day_warnings' | ''
      autoHalfDay,
      warningCount,           // 0 if on-time or direct half day
      maxWarnings:    MAX_WARNINGS,
      halfDayAmount:  parseFloat(halfDayAmount.toFixed(2)),
      officeStart:    `${String(OFFICE_START_HOUR).padStart(2,'0')}:${String(OFFICE_START_MINUTE).padStart(2,'0')}`,
      officeEnd:      `${String(OFFICE_END_HOUR).padStart(2,'0')}:${String(OFFICE_END_MINUTE).padStart(2,'0')}`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attendance/checkout
 */
router.post('/checkout', authenticate, async (req, res) => {
  try {
    const userId   = req.user.userId;
    const today    = todayIST();
    const nowStr   = timeNowIST();
    const location = req.body.location || null;

    // ── Geofence Check ──────────────────────────────────────────
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      const geo = checkGeofence(lat, lng);
      if (!geo.allowed) {
        return res.status(403).json({
          error:    geo.message,
          code:     'OUTSIDE_GEOFENCE',
          distance: geo.distance,
          radius:   geo.radius,
          allowed:  false,
        });
      }
    }

    const record = await Attendance.findOne({ user_id: userId, date: today });

    if (!record) {
      return res.status(400).json({ error: 'No check-in found for today.' });
    }
    if (record.check_out) {
      return res.status(400).json({ error: 'Check-out has already been completed.' });
    }

    const ciStr   = String(record.check_in || '09:00').substring(0, 5);
    const netMins = Math.max(0, toMins(nowStr) - toMins(ciStr));

    record.check_out          = nowStr;
    record.net_mins           = netMins;
    record.checkout_location  = location;
    await record.save();

    return res.json({ success: true, checkOut: nowStr, netMins });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attendance/lunch-in
 * Lunch break sirf 1:15 PM – 2:00 PM is allowed
 */
router.post('/lunch-in', authenticate, async (req, res) => {
  try {
    const userId   = req.user.userId;
    const today    = todayIST();
    const nowStr   = timeNowIST();
    const location = req.body.location || null;

    // ── Geofence Check ──────────────────────────────────────────
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      const geo = checkGeofence(lat, lng);
      if (!geo.allowed) {
        return res.status(403).json({
          error:    geo.message,
          code:     'OUTSIDE_GEOFENCE',
          distance: geo.distance,
          radius:   geo.radius,
          allowed:  false,
        });
      }
    }

    const record = await Attendance.findOne({ user_id: userId, date: today });

    if (!record)          return res.status(400).json({ error: 'Please check in first.' });
    if (record.check_out) return res.status(400).json({ error: 'Check-out already done.' });
    if (record.lunch_in)  return res.status(400).json({ error: 'Lunch break has already been started.' });

    // ── Lunch window check: 1:15 PM – 2:00 PM ──
    const nowMins = toMins(nowStr);
    if (nowMins < LUNCH_START_THRESH) {
      const lunchStartStr = `${String(LUNCH_START_HOUR).padStart(2,'0')}:${String(LUNCH_START_MINUTE).padStart(2,'0')}`;
      return res.status(400).json({
        error: `Lunch break ${lunchStartStr} (1:15 PM) has not started yet.`,
        lunchStart: lunchStartStr,
      });
    }
    if (nowMins > LUNCH_END_THRESH) {
      const lunchEndStr = `${String(LUNCH_END_HOUR).padStart(2,'0')}:${String(LUNCH_END_MINUTE).padStart(2,'0')}`;
      return res.status(400).json({
        error: `Lunch break ${lunchEndStr} (2:00 PM) has passed. Lunch window is closed.`,
        lunchEnd: lunchEndStr,
      });
    }

    record.lunch_in          = nowStr;
    record.lunch_in_location = location;
    await record.save();

    const lunchEndStr = `${String(LUNCH_END_HOUR).padStart(2,'0')}:${String(LUNCH_END_MINUTE).padStart(2,'0')}`;
    return res.json({
      success:  true,
      lunchIn:  nowStr,
      message:  `Lunch break started. Please return by ${lunchEndStr} (2:00 PM).`,
      lunchEnd: lunchEndStr,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attendance/lunch-out
 * Lunch-out sirf lunch_in ke baad allowed hai
 */
router.post('/lunch-out', authenticate, async (req, res) => {
  try {
    const userId   = req.user.userId;
    const today    = todayIST();
    const nowStr   = timeNowIST();
    const location = req.body.location || null;

    // ── Geofence Check ──────────────────────────────────────────
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      const geo = checkGeofence(lat, lng);
      if (!geo.allowed) {
        return res.status(403).json({
          error:    geo.message,
          code:     'OUTSIDE_GEOFENCE',
          distance: geo.distance,
          radius:   geo.radius,
          allowed:  false,
        });
      }
    }

    const record = await Attendance.findOne({ user_id: userId, date: today });

    if (!record || !record.lunch_in) {
      return res.status(400).json({ error: 'Lunch break has not been started.' });
    }
    if (record.lunch_out) {
      return res.status(400).json({ error: 'Lunch break has already ended.' });
    }

    const liStr    = String(record.lunch_in).substring(0, 5);
    const lunchMins = Math.max(0, toMins(nowStr) - toMins(liStr));

    record.lunch_out           = nowStr;
    record.break_mins          = (record.break_mins || 0) + lunchMins;
    record.lunch_out_location  = location;
    await record.save();

    return res.json({ success: true, lunchOut: nowStr, lunchMins });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attendance/admin-add
 * Admin: Manually add/override attendance
 */
router.post('/admin-add', adminOnly, async (req, res) => {
  try {
    const { userId, date, checkIn, checkOut, location } = req.body;

    if (!userId || !date || !checkIn) {
      return res.status(400).json({ error: 'userId, date and checkIn are required.' });
    }

    // Delete existing record for that date
    await Attendance.deleteOne({ user_id: userId, date });

    const totalMins       = toMins(checkIn);
    const isDirectHalfDay = totalMins >= HALF_DAY_THRESH;         // 11:30+
    const isLateArrival   = !isDirectHalfDay && totalMins >= LATE_THRESH; // 10:15–11:29

    // For admin-add we don't count warnings — just apply timing rules directly
    const finalIsHalfDay = isDirectHalfDay;
    const finalIsLate    = isLateArrival && !finalIsHalfDay;
    const netMins        = checkOut ? Math.max(0, toMins(checkOut) - toMins(checkIn)) : 0;

    const recordId = uid();
    await Attendance.create({
      _id:              recordId,
      user_id:          userId,
      date,
      check_in:         checkIn,
      check_out:        checkOut || null,
      net_mins:         netMins,
      is_late:          finalIsLate,
      is_half_day:      finalIsHalfDay,
      checkin_location: location || 'Added by admin',
    });

    return res.status(201).json({
      success:   true,
      id:        recordId,
      isLate:    finalIsLate,
      isHalfDay: finalIsHalfDay,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/attendance/:id
 */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await Attendance.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/attendance/office-location
 * Returns office lat/lng and geofence radius for frontend display
 */
router.get('/office-location', authenticate, async (req, res) => {
  const { OFFICE_LAT, OFFICE_LNG, OFFICE_RADIUS } = require('../utils/geofence');
  return res.json({
    officeName:  'Pratap Tower, Narayan Vihar, Jaipur',
    officeAddress: '1st Floor, SC20, Pratap Tower, Narayan Vihar, Jaipur, Rajasthan 302020',
    latitude:    OFFICE_LAT,
    longitude:   OFFICE_LNG,
    radiusMeters: OFFICE_RADIUS,
  });
});

/**
 * POST /api/attendance/verify-location
 * Frontend can call this to check if user is within geofence before attempting check-in/out
 * Body: { latitude, longitude }
 * Returns: { allowed, distance, radius, message }
 */
router.post('/verify-location', authenticate, async (req, res) => {
  const lat = parseFloat(req.body.latitude);
  const lng = parseFloat(req.body.longitude);

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'latitude and longitude are required.' });
  }

  const geo = checkGeofence(lat, lng);
  return res.json({
    allowed:   geo.allowed,
    distance:  geo.distance,
    radius:    geo.radius,
    message:   geo.message,
    officeLat: geo.officeLat,
    officeLng: geo.officeLng,
  });
});

module.exports = router;
