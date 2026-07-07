// // src/routes/attendance.js — Attendance Management (MongoDB)
// const express    = require('express');
// const router     = express.Router();
// const Attendance = require('../models/Attendance');
// const User       = require('../models/User');
// const { uid, fixRecord, todayIST, timeNowIST, toMins } = require('../utils/helpers');
// const { authenticate, adminOnly } = require('../middleware/auth');
// const { checkGeofence } = require('../utils/geofence');

// // ── Default timing constants (fallback if admin has no settings yet) ──
// const DEFAULT_LATE_HOUR       = parseInt(process.env.LATE_HOUR       || 10);
// const DEFAULT_LATE_MINUTE     = parseInt(process.env.LATE_MINUTE     || 15);
// const DEFAULT_HALF_DAY_HOUR   = parseInt(process.env.HALF_DAY_HOUR   || 11);
// const DEFAULT_HALF_DAY_MINUTE = parseInt(process.env.HALF_DAY_MINUTE || 30);
// const DEFAULT_MAX_WARNINGS    = parseInt(process.env.MAX_WARNINGS    || 3);
// const DEFAULT_LUNCH_END_HOUR  = parseInt(process.env.LUNCH_END_HOUR  || 14);
// const DEFAULT_LUNCH_END_MIN   = parseInt(process.env.LUNCH_END_MINUTE || 0);

// const OFFICE_START_HOUR   = parseInt(process.env.OFFICE_START_HOUR   || 10);
// const OFFICE_START_MINUTE = parseInt(process.env.OFFICE_START_MINUTE || 0);
// const OFFICE_END_HOUR     = parseInt(process.env.OFFICE_END_HOUR     || 18);
// const OFFICE_END_MINUTE   = parseInt(process.env.OFFICE_END_MINUTE   || 30);
// const LUNCH_START_HOUR    = parseInt(process.env.LUNCH_START_HOUR    || 13);
// const LUNCH_START_MINUTE  = parseInt(process.env.LUNCH_START_MINUTE  || 15);

// // ── Helper: get admin policy for a given userId ────────────────────
// async function getAdminPolicy(userId) {
//   const user = await User.findById(userId, 'admin_id role');
//   if (!user) return null;

//   const adminId = user.role === 'admin' ? userId : user.admin_id;
//   if (!adminId) return null;

//   const admin = await User.findById(adminId,
//     'late_hour late_minute half_day_hour half_day_minute max_warnings lunch_end_hour lunch_end_minute');
//   if (!admin) return null;

//   return {
//     LATE_THRESH:     (admin.late_hour ?? DEFAULT_LATE_HOUR) * 60 + (admin.late_minute ?? DEFAULT_LATE_MINUTE),
//     HALF_DAY_THRESH: (admin.half_day_hour ?? DEFAULT_HALF_DAY_HOUR) * 60 + (admin.half_day_minute ?? DEFAULT_HALF_DAY_MINUTE),
//     MAX_WARNINGS:    admin.max_warnings    ?? DEFAULT_MAX_WARNINGS,
//     LUNCH_END_THRESH:(admin.lunch_end_hour ?? DEFAULT_LUNCH_END_HOUR) * 60 + (admin.lunch_end_minute ?? DEFAULT_LUNCH_END_MIN),
//     lateStr:         `${String(admin.late_hour ?? DEFAULT_LATE_HOUR).padStart(2,'0')}:${String(admin.late_minute ?? DEFAULT_LATE_MINUTE).padStart(2,'0')}`,
//     halfDayStr:      `${String(admin.half_day_hour ?? DEFAULT_HALF_DAY_HOUR).padStart(2,'0')}:${String(admin.half_day_minute ?? DEFAULT_HALF_DAY_MINUTE).padStart(2,'0')}`,
//     lunchEndStr:     `${String(admin.lunch_end_hour ?? DEFAULT_LUNCH_END_HOUR).padStart(2,'0')}:${String(admin.lunch_end_minute ?? DEFAULT_LUNCH_END_MIN).padStart(2,'0')}`,
//   };
// }

// /**
//  * GET /api/attendance
//  * Query params: userId, date, fromDate, toDate
//  * Response now includes name, designation, workingHours, isLate, isHalfDay
//  * Response shape: { summary: { all, present, absent, halfDay, late }, records: [...] }
//  */
// router.get('/', authenticate, async (req, res) => {
//   try {
//     const filter = {};
//     if (req.query.userId)   filter.user_id = req.query.userId;
//     if (req.query.date)     filter.date    = req.query.date;
//     if (req.query.fromDate || req.query.toDate) {
//       filter.date = {};
//       if (req.query.fromDate) filter.date.$gte = req.query.fromDate;
//       if (req.query.toDate)   filter.date.$lte = req.query.toDate;
//     }

//     // Admin: scope to only their employees
//     if (req.user.role === 'admin' && !req.query.userId) {
//       const myEmployees = await User.find({ role: 'employee', admin_id: req.user.userId }, '_id');
//       filter.user_id = { $in: myEmployees.map(e => e._id.toString()) };
//     } else if (req.user.role === 'admin' && req.query.userId) {
//       const emp = await User.findById(req.query.userId, 'admin_id role');
//       if (!emp || (emp.role === 'employee' && emp.admin_id !== req.user.userId)) {
//         return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
//       }
//     }

//     const rows = await Attendance.find(filter).sort({ date: -1 });

//     // Enrich each record with user info
//     const userCache = {};
//     const enriched = await Promise.all(rows.map(async (row) => {
//       const base = fixRecord(row);
//       let userInfo = userCache[row.user_id];
//       if (!userInfo) {
//         const u = await User.findById(row.user_id, 'name fullName lName designation dept');
//         userInfo = u ? {
//           name:        u.name || `${u.fullName || ''} ${u.lName || ''}`.trim(),
//           designation: u.designation || '',
//           dept:        u.dept || '',
//         } : { name: '', designation: '', dept: '' };
//         userCache[row.user_id] = userInfo;
//       }

//       const ciMins = row.check_in  ? toMins(String(row.check_in).substring(0,5))  : 0;
//       const coMins = row.check_out ? toMins(String(row.check_out).substring(0,5)) : 0;
//       const workingHoursMins = row.check_out ? Math.max(0, coMins - ciMins - (row.break_mins || 0)) : 0;
//       const wh = Math.floor(workingHoursMins / 60);
//       const wm = workingHoursMins % 60;

//       return {
//         ...base,
//         name:         userInfo.name,
//         designation:  userInfo.designation,
//         dept:         userInfo.dept,
//         workingHours: row.check_out ? `${wh}h ${wm}m` : null,
//         workingMins:  workingHoursMins,
//         isLate:       row.is_late     || false,
//         isHalfDay:    row.is_half_day || false,
//       };
//     }));

//     // ── Summary counts for admin panel tabs (All / Present / Late / Half Day / Absent) ──
//     const summary = { all: enriched.length, present: 0, absent: 0, halfDay: 0, late: 0 };
//     enriched.forEach((r) => {
//       if (r.status === 'absent')        summary.absent++;
//       else if (r.status === 'half_day') summary.halfDay++;
//       else                               summary.present++;
//       if (r.isLate) summary.late++;
//     });

//     return res.json({ summary, records: enriched });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * GET /api/attendance/today-state/:userId
//  */
// router.get('/today-state/:userId', authenticate, async (req, res) => {
//   try {
//     const today  = todayIST();
//     const record = await Attendance.findOne({ user_id: req.params.userId, date: today });
//     return res.json(record ? fixRecord(record) : null);
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * GET /api/attendance/warnings/:userId
//  */
// router.get('/warnings/:userId', authenticate, async (req, res) => {
//   try {
//     const today  = todayIST();
//     const month  = today.substring(0, 7);
//     const mStart = month + '-01';
//     const d      = new Date(today);
//     const mEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().substring(0, 10);

//     const policy = await getAdminPolicy(req.params.userId);
//     const MAX_WARNINGS = policy?.MAX_WARNINGS ?? DEFAULT_MAX_WARNINGS;

//     const count = await Attendance.countDocuments({
//       user_id:     req.params.userId,
//       date:        { $gte: mStart, $lte: mEnd },
//       is_late:     true,
//       is_half_day: false,
//     });

//     return res.json({
//       userId:            req.params.userId,
//       warnings:          count,
//       maxWarnings:       MAX_WARNINGS,
//       warningsLeft:      Math.max(0, MAX_WARNINGS - count),
//       nextLateIsHalfDay: count >= MAX_WARNINGS,
//       month:             mStart,
//     });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * GET /api/attendance/lunch-timing
//  */
// router.get('/lunch-timing', authenticate, async (req, res) => {
//   const policy = await getAdminPolicy(req.user.userId);
//   const lunchStart = `${String(LUNCH_START_HOUR).padStart(2,'0')}:${String(LUNCH_START_MINUTE).padStart(2,'0')}`;
//   const lunchEnd   = policy?.lunchEndStr || `${String(DEFAULT_LUNCH_END_HOUR).padStart(2,'0')}:${String(DEFAULT_LUNCH_END_MIN).padStart(2,'0')}`;
//   return res.json({
//     lunchStart,
//     lunchEnd,
//     message: `Lunch break is allowed between ${lunchStart} and ${lunchEnd}.`,
//   });
// });

// /**
//  * GET /api/attendance/office-location
//  */
// router.get('/office-location', authenticate, async (req, res) => {
//   const { OFFICE_LAT, OFFICE_LNG, OFFICE_RADIUS } = require('../utils/geofence');
//   return res.json({
//     officeName:    'Pratap Tower, Narayan Vihar, Jaipur',
//     officeAddress: '1st Floor, SC20, Pratap Tower, Narayan Vihar, Jaipur, Rajasthan 302020',
//     latitude:      OFFICE_LAT,
//     longitude:     OFFICE_LNG,
//     radiusMeters:  OFFICE_RADIUS,
//   });
// });

// /**
//  * POST /api/attendance/checkin
//  */
// router.post('/checkin', authenticate, async (req, res) => {
//   try {
//     const userId  = req.user.userId;
//     const today   = todayIST();
//     const nowStr  = timeNowIST();
//     const formattedTime = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
//     const location = req.body.location || null;

//     // Geofence
//     const lat = parseFloat(req.body.latitude);
//     const lng = parseFloat(req.body.longitude);
//     if (!isNaN(lat) && !isNaN(lng)) {
//       const geo = checkGeofence(lat, lng);
//       if (!geo.allowed) {
//         return res.status(403).json({ error: geo.message, code: 'OUTSIDE_GEOFENCE', distance: geo.distance, radius: geo.radius });
//       }
//     }

//     // Already checked in?
//     const existing = await Attendance.findOne({ user_id: userId, date: today });
//     if (existing) {
//       return res.status(400).json({
//         error:    "Today's check-in has already been completed.",
//         checkIn:  existing.check_in,
//         checkOut: existing.check_out,
//         isLate:   existing.is_late,
//         isHalfDay:existing.is_half_day,
//       });
//     }

//     // Get admin policy
//     const policy        = await getAdminPolicy(userId);
//     const LATE_THRESH   = policy?.LATE_THRESH   ?? (DEFAULT_LATE_HOUR * 60 + DEFAULT_LATE_MINUTE);
//     const HALF_THRESH   = policy?.HALF_DAY_THRESH ?? (DEFAULT_HALF_DAY_HOUR * 60 + DEFAULT_HALF_DAY_MINUTE);
//     const MAX_WARNINGS  = policy?.MAX_WARNINGS  ?? DEFAULT_MAX_WARNINGS;

//     const totalMins       = toMins(nowStr);
//     const isDirectHalfDay = totalMins >= HALF_THRESH;
//     const isLateArrival   = !isDirectHalfDay && totalMins >= LATE_THRESH;

//     let warningCount = 0, autoHalfDay = false, halfDayAmount = 0, halfDayReason = '';

//     if (isDirectHalfDay) {
//       halfDayReason = 'direct_half_day';
//       const userDoc = await User.findById(userId, 'salary');
//       const monthlySalary = parseFloat(userDoc?.salary || 0);
//       const d = new Date(today);
//       const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
//       let sundays = 0;
//       for (let day = 1; day <= daysInMonth; day++) {
//         if (new Date(d.getFullYear(), d.getMonth(), day).getDay() === 0) sundays++;
//       }
//       halfDayAmount = (daysInMonth - sundays) > 0 ? (monthlySalary / (daysInMonth - sundays)) * 0.5 : 0;

//     } else if (isLateArrival) {
//       const d      = new Date(today);
//       const mStart = today.substring(0, 7) + '-01';
//       const mEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().substring(0, 10);

//       const prevWarnings = await Attendance.countDocuments({
//         user_id: userId, date: { $gte: mStart, $lte: mEnd, $lt: today },
//         is_late: true, is_half_day: false,
//       });
//       warningCount = prevWarnings + 1;

//       if (warningCount > MAX_WARNINGS) {
//         autoHalfDay   = true;
//         halfDayReason = 'auto_half_day_warnings';
//         const userDoc = await User.findById(userId, 'salary');
//         const monthlySalary = parseFloat(userDoc?.salary || 0);
//         const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
//         let sundays = 0;
//         for (let day = 1; day <= daysInMonth; day++) {
//           if (new Date(d.getFullYear(), d.getMonth(), day).getDay() === 0) sundays++;
//         }
//         halfDayAmount = (daysInMonth - sundays) > 0 ? (monthlySalary / (daysInMonth - sundays)) * 0.5 : 0;
//       }
//     }

//     const finalIsHalfDay = isDirectHalfDay || autoHalfDay;
//     const finalIsLate    = isLateArrival && !finalIsHalfDay;
//     const recordId       = uid();

//     await Attendance.create({
//       _id:              recordId,
//       user_id:          userId,
//       date:             today,
//       check_in:         nowStr,
//       is_late:          finalIsLate,
//       is_half_day:      finalIsHalfDay,
//       checkin_location: location,
//     });

//     return res.json({
//       success:       true,
//       id:            recordId,
//       checkIn:       formattedTime,
//       isLate:        finalIsLate,
//       isHalfDay:     finalIsHalfDay,
//       halfDayReason,
//       autoHalfDay,
//       warningCount,
//       maxWarnings:   MAX_WARNINGS,
//       halfDayAmount: parseFloat(halfDayAmount.toFixed(2)),
//       officeStart:   `${String(OFFICE_START_HOUR).padStart(2,'0')}:${String(OFFICE_START_MINUTE).padStart(2,'0')}`,
//       officeEnd:     `${String(OFFICE_END_HOUR).padStart(2,'0')}:${String(OFFICE_END_MINUTE).padStart(2,'0')}`,
//     });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * POST /api/attendance/checkout
//  */
// router.post('/checkout', authenticate, async (req, res) => {
//   try {
//     const userId   = req.user.userId;
//     const today    = todayIST();
//     const nowStr   = timeNowIST();
//     const location = req.body.location || null;

//     const lat = parseFloat(req.body.latitude);
//     const lng = parseFloat(req.body.longitude);
//     if (!isNaN(lat) && !isNaN(lng)) {
//       const geo = checkGeofence(lat, lng);
//       if (!geo.allowed) {
//         return res.status(403).json({ error: geo.message, code: 'OUTSIDE_GEOFENCE', distance: geo.distance, radius: geo.radius });
//       }
//     }

//     const record = await Attendance.findOne({ user_id: userId, date: today });
//     if (!record)          return res.status(400).json({ error: 'No check-in found for today.' });
//     if (record.check_out) return res.status(400).json({ error: 'Check-out has already been completed.' });

//     const ciStr   = String(record.check_in || '09:00').substring(0, 5);
//     const netMins = Math.max(0, toMins(nowStr) - toMins(ciStr));

//     record.check_out         = nowStr;
//     record.net_mins          = netMins;
//     record.checkout_location = location;
//     await record.save();

//     return res.json({ success: true, checkOut: nowStr, netMins });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * POST /api/attendance/lunch-in
//  */
// router.post('/lunch-in', authenticate, async (req, res) => {
//   try {
//     const userId   = req.user.userId;
//     const today    = todayIST();
//     const nowStr   = timeNowIST();
//     const location = req.body.location || null;

//     const lat = parseFloat(req.body.latitude);
//     const lng = parseFloat(req.body.longitude);
//     if (!isNaN(lat) && !isNaN(lng)) {
//       const geo = checkGeofence(lat, lng);
//       if (!geo.allowed) {
//         return res.status(403).json({ error: geo.message, code: 'OUTSIDE_GEOFENCE', distance: geo.distance, radius: geo.radius });
//       }
//     }

//     const record = await Attendance.findOne({ user_id: userId, date: today });
//     if (!record)          return res.status(400).json({ error: 'Please check in first.' });
//     if (record.check_out) return res.status(400).json({ error: 'Check-out already done.' });
//     if (record.lunch_in)  return res.status(400).json({ error: 'Lunch break has already been started.' });

//     const policy          = await getAdminPolicy(userId);
//     const LUNCH_START_THRESH = LUNCH_START_HOUR * 60 + LUNCH_START_MINUTE;
//     const LUNCH_END_THRESH   = policy?.LUNCH_END_THRESH ?? (DEFAULT_LUNCH_END_HOUR * 60 + DEFAULT_LUNCH_END_MIN);
//     const lunchEndStr        = policy?.lunchEndStr ?? `${String(DEFAULT_LUNCH_END_HOUR).padStart(2,'0')}:${String(DEFAULT_LUNCH_END_MIN).padStart(2,'0')}`;

//     const nowMins = toMins(nowStr);
//     const lunchStartStr = `${String(LUNCH_START_HOUR).padStart(2,'0')}:${String(LUNCH_START_MINUTE).padStart(2,'0')}`;

//     if (nowMins < LUNCH_START_THRESH) {
//       return res.status(400).json({ error: `Lunch break ${lunchStartStr} (1:15 PM) has not started yet.`, lunchStart: lunchStartStr });
//     }
//     if (nowMins > LUNCH_END_THRESH) {
//       return res.status(400).json({ error: `Lunch window has closed at ${lunchEndStr}. Lunch break is no longer allowed.`, lunchEnd: lunchEndStr });
//     }

//     record.lunch_in          = nowStr;
//     record.lunch_in_location = location;
//     await record.save();

//     return res.json({ success: true, lunchIn: nowStr, message: `Lunch break started. Please return by ${lunchEndStr}.`, lunchEnd: lunchEndStr });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * POST /api/attendance/lunch-out
//  */
// router.post('/lunch-out', authenticate, async (req, res) => {
//   try {
//     const userId   = req.user.userId;
//     const today    = todayIST();
//     const nowStr   = timeNowIST();
//     const location = req.body.location || null;

//     const lat = parseFloat(req.body.latitude);
//     const lng = parseFloat(req.body.longitude);
//     if (!isNaN(lat) && !isNaN(lng)) {
//       const geo = checkGeofence(lat, lng);
//       if (!geo.allowed) {
//         return res.status(403).json({ error: geo.message, code: 'OUTSIDE_GEOFENCE', distance: geo.distance, radius: geo.radius });
//       }
//     }

//     const record = await Attendance.findOne({ user_id: userId, date: today });
//     if (!record || !record.lunch_in) return res.status(400).json({ error: 'Lunch break has not been started.' });
//     if (record.lunch_out)            return res.status(400).json({ error: 'Lunch break has already ended.' });

//     const lunchMins = Math.max(0, toMins(nowStr) - toMins(String(record.lunch_in).substring(0,5)));
//     record.lunch_out          = nowStr;
//     record.break_mins         = (record.break_mins || 0) + lunchMins;
//     record.lunch_out_location = location;
//     await record.save();

//     return res.json({ success: true, lunchOut: nowStr, lunchMins });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * POST /api/attendance/verify-location
//  */
// router.post('/verify-location', authenticate, async (req, res) => {
//   const lat = parseFloat(req.body.latitude);
//   const lng = parseFloat(req.body.longitude);
//   if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'latitude and longitude are required.' });
//   const geo = checkGeofence(lat, lng);
//   return res.json({ allowed: geo.allowed, distance: geo.distance, radius: geo.radius, message: geo.message, officeLat: geo.officeLat, officeLng: geo.officeLng });
// });

// /**
//  * POST /api/attendance/admin-add
//  * Admin manually add attendance for an employee.
//  * - status: "Absent"  -> only userId + date required (checkIn/checkOut NOT needed)
//  * - status: "Present"/"Half Day"/omitted -> checkIn AND checkOut both required (old behaviour)
//  * Blocks if employee already has a check-in for that date.
//  * Only allows adding for admin's own employees.
//  */
// router.post('/admin-add', adminOnly, async (req, res) => {
//   try {
//     const { userId, date, checkIn, checkOut, location, status } = req.body;

//     if (!userId || !date) {
//       return res.status(400).json({ error: 'userId and date are required.' });
//     }

//     const normalizedStatus = String(status || '').trim().toLowerCase();
//     const isAbsent = normalizedStatus === 'absent';

//     // checkIn/checkOut only required when NOT marking Absent
//     if (!isAbsent && (!checkIn || !checkOut)) {
//       return res.status(400).json({ error: 'checkIn and checkOut are required (unless status is "Absent").' });
//     }

//     // Ownership check — employee must belong to this admin
//     const emp = await User.findById(userId, 'admin_id role name');
//     if (!emp) return res.status(404).json({ error: 'Employee not found.' });
//     if (emp.role !== 'employee' || emp.admin_id !== req.user.userId) {
//       return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
//     }

//     // Already checked in? Block it (applies whether marking present or absent)
//     const existing = await Attendance.findOne({ user_id: userId, date });
//     if (existing && existing.check_in) {
//       return res.status(409).json({
//         error:    `${emp.name} has already checked in on ${date}. Delete the existing record first if you want to override.`,
//         checkIn:  existing.check_in,
//         checkOut: existing.check_out || null,
//       });
//     }

//     // ── Marking Absent: no checkIn/checkOut needed ──────────────
//     if (isAbsent) {
//       const recordId = existing ? existing._id : uid();
//       await Attendance.findOneAndUpdate(
//         { user_id: userId, date },
//         {
//           $setOnInsert: { _id: recordId, user_id: userId, date },
//           $set: {
//             check_in:         null,
//             check_out:        null,
//             net_mins:         0,
//             is_late:          false,
//             is_half_day:      false,
//             status:           'absent',
//             checkin_location: location || 'Marked absent by admin',
//           },
//         },
//         { upsert: true, new: true }
//       );

//       return res.status(201).json({
//         success: true,
//         id:      recordId,
//         status:  'absent',
//       });
//     }

//     // ── Marking Present / Half Day: checkIn & checkOut required ─
//     // Get admin policy for timing rules
//     const policy        = await getAdminPolicy(userId);
//     const LATE_THRESH   = policy?.LATE_THRESH    ?? (DEFAULT_LATE_HOUR * 60 + DEFAULT_LATE_MINUTE);
//     const HALF_THRESH   = policy?.HALF_DAY_THRESH ?? (DEFAULT_HALF_DAY_HOUR * 60 + DEFAULT_HALF_DAY_MINUTE);

//     const totalMins       = toMins(checkIn);
//     const isDirectHalfDay = totalMins >= HALF_THRESH;
//     const isLateArrival   = !isDirectHalfDay && totalMins >= LATE_THRESH;
//     const netMins         = Math.max(0, toMins(checkOut) - toMins(checkIn));

//     const recordId = uid();
//     await Attendance.create({
//       _id:              recordId,
//       user_id:          userId,
//       date,
//       check_in:         checkIn,
//       check_out:        checkOut,
//       net_mins:         netMins,
//       is_late:          isLateArrival && !isDirectHalfDay,
//       is_half_day:      isDirectHalfDay,
//       status:           isDirectHalfDay ? 'half_day' : 'present',
//       checkin_location: location || 'Added by admin',
//     });

//     return res.status(201).json({
//       success:   true,
//       id:        recordId,
//       isLate:    isLateArrival && !isDirectHalfDay,
//       isHalfDay: isDirectHalfDay,
//       netMins,
//     });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * PUT /api/attendance/:id
//  * Admin: Edit an existing attendance record
//  */
// router.put('/:id', adminOnly, async (req, res) => {
//   try {
//     const record = await Attendance.findById(req.params.id);
//     if (!record) return res.status(404).json({ error: 'Attendance record not found.' });

//     // Ownership check
//     const emp = await User.findById(record.user_id, 'admin_id role');
//     if (!emp || emp.role !== 'employee' || emp.admin_id !== req.user.userId) {
//       return res.status(403).json({ error: 'Access denied. This record does not belong to your employee.' });
//     }

//     const { checkIn, checkOut, location, status, net_mins } = req.body;
//     const normalizedStatus = String(status || '').trim().toLowerCase().replace(/\s+/g, '_'); // "Half Day" -> "half_day"

//     if (checkIn)   record.check_in  = checkIn;
//     if (checkOut)  record.check_out = checkOut;
//     if (location)  record.checkin_location = location;

//     if (normalizedStatus === 'absent') {
//       // Explicitly marking Absent — clear check-in/out
//       record.check_in    = null;
//       record.check_out   = null;
//       record.is_half_day = false;
//       record.is_late     = false;
//       record.net_mins    = 0;
//       record.status      = 'absent';
//     } else if (normalizedStatus === 'half_day') {
//       // Explicitly marking Half Day — keep whatever checkIn/checkOut were sent
//       record.is_half_day = true;
//       record.is_late     = false;
//       record.status      = 'half_day';
//     } else if (normalizedStatus === 'present') {
//       record.is_half_day = false;
//       record.status      = 'present';
//     }

//     // Recalculate timing flags from checkIn only when no explicit status override was given
//     if (checkIn && !normalizedStatus) {
//       const policy      = await getAdminPolicy(record.user_id);
//       const LATE_THRESH = policy?.LATE_THRESH    ?? (DEFAULT_LATE_HOUR * 60 + DEFAULT_LATE_MINUTE);
//       const HALF_THRESH = policy?.HALF_DAY_THRESH ?? (DEFAULT_HALF_DAY_HOUR * 60 + DEFAULT_HALF_DAY_MINUTE);

//       const totalMins       = toMins(checkIn);
//       const isDirectHalfDay = totalMins >= HALF_THRESH;
//       const isLateArrival   = !isDirectHalfDay && totalMins >= LATE_THRESH;

//       record.is_half_day = isDirectHalfDay;
//       record.is_late     = isLateArrival && !isDirectHalfDay;
//       record.status      = isDirectHalfDay ? 'half_day' : 'present';
//     }

//     // Use net_mins sent by frontend if provided, otherwise recalc from check_in/check_out
//     if (typeof net_mins === 'number') {
//       record.net_mins = net_mins;
//     } else if (record.check_in && record.check_out) {
//       record.net_mins = Math.max(0, toMins(String(record.check_out).substring(0,5)) - toMins(String(record.check_in).substring(0,5)));
//     }

//     // Fallback: keep status in sync if it was never set on this record before
//     if (!record.status) {
//       record.status = record.is_half_day ? 'half_day' : (record.check_in ? 'present' : 'absent');
//     }

//     await record.save();
//     return res.json({ success: true, record: fixRecord(record) });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// /**
//  * DELETE /api/attendance/:id
//  */
// router.delete('/:id', adminOnly, async (req, res) => {
//   try {
//     const record = await Attendance.findById(req.params.id);
//     if (!record) return res.status(404).json({ error: 'Record not found.' });

//     // Ownership check
//     const emp = await User.findById(record.user_id, 'admin_id role');
//     if (!emp || emp.role !== 'employee' || emp.admin_id !== req.user.userId) {
//       return res.status(403).json({ error: 'Access denied.' });
//     }

//     await Attendance.findByIdAndDelete(req.params.id);
//     return res.json({ success: true });
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// });

// module.exports = router;

// src/routes/attendance.js — Attendance Management (MongoDB)
const express    = require('express');
const router     = express.Router();
const Attendance = require('../models/Attendance');
const User       = require('../models/User');
const { uid, fixRecord, todayIST, timeNowIST, toMins } = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');
const { checkGeofence } = require('../utils/geofence');

// ── Default timing constants (fallback if admin has no settings yet) ──
const DEFAULT_LATE_HOUR       = parseInt(process.env.LATE_HOUR       || 10);
const DEFAULT_LATE_MINUTE     = parseInt(process.env.LATE_MINUTE     || 15);
const DEFAULT_HALF_DAY_HOUR   = parseInt(process.env.HALF_DAY_HOUR   || 11);
const DEFAULT_HALF_DAY_MINUTE = parseInt(process.env.HALF_DAY_MINUTE || 30);
const DEFAULT_MAX_WARNINGS    = parseInt(process.env.MAX_WARNINGS    || 3);
const DEFAULT_LUNCH_END_HOUR  = parseInt(process.env.LUNCH_END_HOUR  || 14);
const DEFAULT_LUNCH_END_MIN   = parseInt(process.env.LUNCH_END_MINUTE || 0);

const OFFICE_START_HOUR   = parseInt(process.env.OFFICE_START_HOUR   || 10);
const OFFICE_START_MINUTE = parseInt(process.env.OFFICE_START_MINUTE || 0);
const OFFICE_END_HOUR     = parseInt(process.env.OFFICE_END_HOUR     || 18);
const OFFICE_END_MINUTE   = parseInt(process.env.OFFICE_END_MINUTE   || 30);
const LUNCH_START_HOUR    = parseInt(process.env.LUNCH_START_HOUR    || 13);
const LUNCH_START_MINUTE  = parseInt(process.env.LUNCH_START_MINUTE  || 15);

// ── Helper: get admin policy for a given userId ────────────────────
async function getAdminPolicy(userId) {
  const user = await User.findById(userId, 'admin_id role');
  if (!user) return null;

  const adminId = user.role === 'admin' ? userId : user.admin_id;
  if (!adminId) return null;

  const admin = await User.findById(adminId,
    'late_hour late_minute half_day_hour half_day_minute max_warnings lunch_end_hour lunch_end_minute');
  if (!admin) return null;

  return {
    LATE_THRESH:     (admin.late_hour ?? DEFAULT_LATE_HOUR) * 60 + (admin.late_minute ?? DEFAULT_LATE_MINUTE),
    HALF_DAY_THRESH: (admin.half_day_hour ?? DEFAULT_HALF_DAY_HOUR) * 60 + (admin.half_day_minute ?? DEFAULT_HALF_DAY_MINUTE),
    MAX_WARNINGS:    admin.max_warnings    ?? DEFAULT_MAX_WARNINGS,
    LUNCH_END_THRESH:(admin.lunch_end_hour ?? DEFAULT_LUNCH_END_HOUR) * 60 + (admin.lunch_end_minute ?? DEFAULT_LUNCH_END_MIN),
    lateStr:         `${String(admin.late_hour ?? DEFAULT_LATE_HOUR).padStart(2,'0')}:${String(admin.late_minute ?? DEFAULT_LATE_MINUTE).padStart(2,'0')}`,
    halfDayStr:      `${String(admin.half_day_hour ?? DEFAULT_HALF_DAY_HOUR).padStart(2,'0')}:${String(admin.half_day_minute ?? DEFAULT_HALF_DAY_MINUTE).padStart(2,'0')}`,
    lunchEndStr:     `${String(admin.lunch_end_hour ?? DEFAULT_LUNCH_END_HOUR).padStart(2,'0')}:${String(admin.lunch_end_minute ?? DEFAULT_LUNCH_END_MIN).padStart(2,'0')}`,
  };
}

/**
 * GET /api/attendance
 * Query params: userId, date, fromDate, toDate
 * Response now includes name, designation, workingHours, isLate, isHalfDay
 * Response shape: { summary: { all, present, absent, halfDay, late }, records: [...] }
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

    // Admin: scope to only their employees
    if (req.user.role === 'admin' && !req.query.userId) {
      const myEmployees = await User.find({ role: 'employee', admin_id: req.user.userId }, '_id');
      filter.user_id = { $in: myEmployees.map(e => e._id.toString()) };
    } else if (req.user.role === 'admin' && req.query.userId) {
      const emp = await User.findById(req.query.userId, 'admin_id role');
      if (!emp || (emp.role === 'employee' && emp.admin_id !== req.user.userId)) {
        return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
      }
    }

    const rows = await Attendance.find(filter).sort({ date: -1 });

    // Enrich each record with user info
    const userCache = {};
    const enriched = await Promise.all(rows.map(async (row) => {
      const base = fixRecord(row);
      let userInfo = userCache[row.user_id];
      if (!userInfo) {
        const u = await User.findById(row.user_id, 'name fullName lName designation dept');
        userInfo = u ? {
          name:        u.name || `${u.fullName || ''} ${u.lName || ''}`.trim(),
          designation: u.designation || '',
          dept:        u.dept || '',
        } : { name: '', designation: '', dept: '' };
        userCache[row.user_id] = userInfo;
      }

      const ciMins = row.check_in  ? toMins(String(row.check_in).substring(0,5))  : 0;
      const coMins = row.check_out ? toMins(String(row.check_out).substring(0,5)) : 0;
      const workingHoursMins = row.check_out ? Math.max(0, coMins - ciMins - (row.break_mins || 0)) : 0;
      const wh = Math.floor(workingHoursMins / 60);
      const wm = workingHoursMins % 60;

      return {
        ...base,
        name:         userInfo.name,
        designation:  userInfo.designation,
        dept:         userInfo.dept,
        workingHours: row.check_out ? `${wh}h ${wm}m` : null,
        workingMins:  workingHoursMins,
        isLate:       row.is_late     || false,
        isHalfDay:    row.is_half_day || false,
      };
    }));

    // ── Summary counts for admin panel tabs (All / Present / Late / Half Day / Absent) ──
    const summary = { all: enriched.length, present: 0, absent: 0, halfDay: 0, late: 0 };
    enriched.forEach((r) => {
      if (r.status === 'absent')        summary.absent++;
      else if (r.status === 'half_day') summary.halfDay++;
      else                               summary.present++;
      if (r.isLate) summary.late++;
    });

    return res.json({ summary, records: enriched });
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
 */
router.get('/warnings/:userId', authenticate, async (req, res) => {
  try {
    const today  = todayIST();
    const month  = today.substring(0, 7);
    const mStart = month + '-01';
    const d      = new Date(today);
    const mEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().substring(0, 10);

    const policy = await getAdminPolicy(req.params.userId);
    const MAX_WARNINGS = policy?.MAX_WARNINGS ?? DEFAULT_MAX_WARNINGS;

    const count = await Attendance.countDocuments({
      user_id:     req.params.userId,
      date:        { $gte: mStart, $lte: mEnd },
      is_late:     true,
      is_half_day: false,
    });

    return res.json({
      userId:            req.params.userId,
      warnings:          count,
      maxWarnings:       MAX_WARNINGS,
      warningsLeft:      Math.max(0, MAX_WARNINGS - count),
      nextLateIsHalfDay: count >= MAX_WARNINGS,
      month:             mStart,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/attendance/lunch-timing
 */
router.get('/lunch-timing', authenticate, async (req, res) => {
  const policy = await getAdminPolicy(req.user.userId);
  const lunchStart = `${String(LUNCH_START_HOUR).padStart(2,'0')}:${String(LUNCH_START_MINUTE).padStart(2,'0')}`;
  const lunchEnd   = policy?.lunchEndStr || `${String(DEFAULT_LUNCH_END_HOUR).padStart(2,'0')}:${String(DEFAULT_LUNCH_END_MIN).padStart(2,'0')}`;
  return res.json({
    lunchStart,
    lunchEnd,
    message: `Lunch break is allowed between ${lunchStart} and ${lunchEnd}.`,
  });
});

/**
 * GET /api/attendance/office-location
 */
router.get('/office-location', authenticate, async (req, res) => {
  const { OFFICE_LAT, OFFICE_LNG, OFFICE_RADIUS } = require('../utils/geofence');
  return res.json({
    officeName:    'Pratap Tower, Narayan Vihar, Jaipur',
    officeAddress: '1st Floor, SC20, Pratap Tower, Narayan Vihar, Jaipur, Rajasthan 302020',
    latitude:      OFFICE_LAT,
    longitude:     OFFICE_LNG,
    radiusMeters:  OFFICE_RADIUS,
  });
});

/**
 * POST /api/attendance/checkin
 */
router.post('/checkin', authenticate, async (req, res) => {
  try {
    const userId  = req.user.userId;
    const today   = todayIST();
    const nowStr  = timeNowIST();
    const formattedTime = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    const location = req.body.location || null;

    // Geofence
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      const geo = checkGeofence(lat, lng);
      if (!geo.allowed) {
        return res.status(403).json({ error: geo.message, code: 'OUTSIDE_GEOFENCE', distance: geo.distance, radius: geo.radius });
      }
    }

    // Already checked in?
    const existing = await Attendance.findOne({ user_id: userId, date: today });
    if (existing) {
      return res.status(400).json({
        error:    "Today's check-in has already been completed.",
        checkIn:  existing.check_in,
        checkOut: existing.check_out,
        isLate:   existing.is_late,
        isHalfDay:existing.is_half_day,
      });
    }

    // Get admin policy
    const policy        = await getAdminPolicy(userId);
    const LATE_THRESH   = policy?.LATE_THRESH   ?? (DEFAULT_LATE_HOUR * 60 + DEFAULT_LATE_MINUTE);
    const HALF_THRESH   = policy?.HALF_DAY_THRESH ?? (DEFAULT_HALF_DAY_HOUR * 60 + DEFAULT_HALF_DAY_MINUTE);
    const MAX_WARNINGS  = policy?.MAX_WARNINGS  ?? DEFAULT_MAX_WARNINGS;

    const totalMins       = toMins(nowStr);
    const isDirectHalfDay = totalMins >= HALF_THRESH;
    const isLateArrival   = !isDirectHalfDay && totalMins >= LATE_THRESH;

    let warningCount = 0, autoHalfDay = false, halfDayAmount = 0, halfDayReason = '';

    if (isDirectHalfDay) {
      halfDayReason = 'direct_half_day';
      const userDoc = await User.findById(userId, 'salary');
      const monthlySalary = parseFloat(userDoc?.salary || 0);
      const d = new Date(today);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      let sundays = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        if (new Date(d.getFullYear(), d.getMonth(), day).getDay() === 0) sundays++;
      }
      halfDayAmount = (daysInMonth - sundays) > 0 ? (monthlySalary / (daysInMonth - sundays)) * 0.5 : 0;

    } else if (isLateArrival) {
      const d      = new Date(today);
      const mStart = today.substring(0, 7) + '-01';
      const mEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().substring(0, 10);

      const prevWarnings = await Attendance.countDocuments({
        user_id: userId, date: { $gte: mStart, $lte: mEnd, $lt: today },
        is_late: true, is_half_day: false,
      });
      warningCount = prevWarnings + 1;

      if (warningCount > MAX_WARNINGS) {
        autoHalfDay   = true;
        halfDayReason = 'auto_half_day_warnings';
        const userDoc = await User.findById(userId, 'salary');
        const monthlySalary = parseFloat(userDoc?.salary || 0);
        const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        let sundays = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          if (new Date(d.getFullYear(), d.getMonth(), day).getDay() === 0) sundays++;
        }
        halfDayAmount = (daysInMonth - sundays) > 0 ? (monthlySalary / (daysInMonth - sundays)) * 0.5 : 0;
      }
    }

    const finalIsHalfDay = isDirectHalfDay || autoHalfDay;
    const finalIsLate    = isLateArrival && !finalIsHalfDay;
    const recordId       = uid();

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
      success:       true,
      id:            recordId,
      checkIn:       formattedTime,
      isLate:        finalIsLate,
      isHalfDay:     finalIsHalfDay,
      halfDayReason,
      autoHalfDay,
      warningCount,
      maxWarnings:   MAX_WARNINGS,
      halfDayAmount: parseFloat(halfDayAmount.toFixed(2)),
      officeStart:   `${String(OFFICE_START_HOUR).padStart(2,'0')}:${String(OFFICE_START_MINUTE).padStart(2,'0')}`,
      officeEnd:     `${String(OFFICE_END_HOUR).padStart(2,'0')}:${String(OFFICE_END_MINUTE).padStart(2,'0')}`,
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

    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      const geo = checkGeofence(lat, lng);
      if (!geo.allowed) {
        return res.status(403).json({ error: geo.message, code: 'OUTSIDE_GEOFENCE', distance: geo.distance, radius: geo.radius });
      }
    }

    const record = await Attendance.findOne({ user_id: userId, date: today });
    if (!record)          return res.status(400).json({ error: 'No check-in found for today.' });
    if (record.check_out) return res.status(400).json({ error: 'Check-out has already been completed.' });

    const ciStr   = String(record.check_in || '09:00').substring(0, 5);
    const netMins = Math.max(0, toMins(nowStr) - toMins(ciStr));

    record.check_out         = nowStr;
    record.net_mins          = netMins;
    record.checkout_location = location;
    await record.save();

    return res.json({ success: true, checkOut: nowStr, netMins });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attendance/lunch-in
 */
router.post('/lunch-in', authenticate, async (req, res) => {
  try {
    const userId   = req.user.userId;
    const today    = todayIST();
    const nowStr   = timeNowIST();
    const location = req.body.location || null;

    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      const geo = checkGeofence(lat, lng);
      if (!geo.allowed) {
        return res.status(403).json({ error: geo.message, code: 'OUTSIDE_GEOFENCE', distance: geo.distance, radius: geo.radius });
      }
    }

    const record = await Attendance.findOne({ user_id: userId, date: today });
    if (!record)          return res.status(400).json({ error: 'Please check in first.' });
    if (record.check_out) return res.status(400).json({ error: 'Check-out already done.' });
    if (record.lunch_in)  return res.status(400).json({ error: 'Lunch break has already been started.' });

    const policy          = await getAdminPolicy(userId);
    const LUNCH_START_THRESH = LUNCH_START_HOUR * 60 + LUNCH_START_MINUTE;
    const LUNCH_END_THRESH   = policy?.LUNCH_END_THRESH ?? (DEFAULT_LUNCH_END_HOUR * 60 + DEFAULT_LUNCH_END_MIN);
    const lunchEndStr        = policy?.lunchEndStr ?? `${String(DEFAULT_LUNCH_END_HOUR).padStart(2,'0')}:${String(DEFAULT_LUNCH_END_MIN).padStart(2,'0')}`;

    const nowMins = toMins(nowStr);
    const lunchStartStr = `${String(LUNCH_START_HOUR).padStart(2,'0')}:${String(LUNCH_START_MINUTE).padStart(2,'0')}`;

    if (nowMins < LUNCH_START_THRESH) {
      return res.status(400).json({ error: `Lunch break ${lunchStartStr} (1:15 PM) has not started yet.`, lunchStart: lunchStartStr });
    }
    if (nowMins > LUNCH_END_THRESH) {
      return res.status(400).json({ error: `Lunch window has closed at ${lunchEndStr}. Lunch break is no longer allowed.`, lunchEnd: lunchEndStr });
    }

    record.lunch_in          = nowStr;
    record.lunch_in_location = location;
    await record.save();

    return res.json({ success: true, lunchIn: nowStr, message: `Lunch break started. Please return by ${lunchEndStr}.`, lunchEnd: lunchEndStr });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attendance/lunch-out
 */
router.post('/lunch-out', authenticate, async (req, res) => {
  try {
    const userId   = req.user.userId;
    const today    = todayIST();
    const nowStr   = timeNowIST();
    const location = req.body.location || null;

    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (!isNaN(lat) && !isNaN(lng)) {
      const geo = checkGeofence(lat, lng);
      if (!geo.allowed) {
        return res.status(403).json({ error: geo.message, code: 'OUTSIDE_GEOFENCE', distance: geo.distance, radius: geo.radius });
      }
    }

    const record = await Attendance.findOne({ user_id: userId, date: today });
    if (!record || !record.lunch_in) return res.status(400).json({ error: 'Lunch break has not been started.' });
    if (record.lunch_out)            return res.status(400).json({ error: 'Lunch break has already ended.' });

    const lunchMins = Math.max(0, toMins(nowStr) - toMins(String(record.lunch_in).substring(0,5)));
    record.lunch_out          = nowStr;
    record.break_mins         = (record.break_mins || 0) + lunchMins;
    record.lunch_out_location = location;
    await record.save();

    return res.json({ success: true, lunchOut: nowStr, lunchMins });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attendance/verify-location
 */
router.post('/verify-location', authenticate, async (req, res) => {
  const lat = parseFloat(req.body.latitude);
  const lng = parseFloat(req.body.longitude);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'latitude and longitude are required.' });
  const geo = checkGeofence(lat, lng);
  return res.json({ allowed: geo.allowed, distance: geo.distance, radius: geo.radius, message: geo.message, officeLat: geo.officeLat, officeLng: geo.officeLng });
});

/**
 * POST /api/attendance/admin-add
 * Admin manually add/mark attendance for an employee.
 * - status: "Present" / "Half Day" / "Absent" -> checkIn/checkOut are OPTIONAL (quick mark)
 * - no status given -> checkIn AND checkOut both required (raw add, old behaviour)
 * Blocks with 409 if employee already has a check-in for that date (e.g. self check-in from employee app).
 * Only allows adding for admin's own employees.
 */
router.post('/admin-add', adminOnly, async (req, res) => {
  try {
    const { userId, date, checkIn, checkOut, location, status, net_mins } = req.body;

    if (!userId || !date) {
      return res.status(400).json({ error: 'userId and date are required.' });
    }

    const normalizedStatus = String(status || '').trim().toLowerCase().replace(/\s+/g, '_'); // "Half Day" -> "half_day"
    const isAbsent   = normalizedStatus === 'absent';
    const isHalfDay  = normalizedStatus === 'half_day';

    // checkIn/checkOut only required when NO status was given at all (raw add flow)
    if (!normalizedStatus && (!checkIn || !checkOut)) {
      return res.status(400).json({ error: 'checkIn and checkOut are required, or send a status ("Present" / "Half Day" / "Absent").' });
    }

    // Ownership check — employee must belong to this admin
    const emp = await User.findById(userId, 'admin_id role name');
    if (!emp) return res.status(404).json({ error: 'Employee not found.' });
    if (emp.role !== 'employee' || emp.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
    }

    // Already checked in (e.g. employee self-checked-in from their app)? Block it — admin must know first.
    const existing = await Attendance.findOne({ user_id: userId, date });
    if (existing && existing.check_in) {
      return res.status(409).json({
        error:          `${emp.name} has already checked in on ${date}. Delete/edit the existing record if you want to override.`,
        alreadyCheckedIn: true,
        checkIn:        existing.check_in,
        checkOut:       existing.check_out || null,
      });
    }

    // ── Marking Absent: no checkIn/checkOut needed ──────────────
    if (isAbsent) {
      const recordId = existing ? existing._id : uid();
      await Attendance.findOneAndUpdate(
        { user_id: userId, date },
        {
          $setOnInsert: { _id: recordId, user_id: userId, date },
          $set: {
            check_in:         null,
            check_out:        null,
            net_mins:         0,
            is_late:          false,
            is_half_day:      false,
            status:           'absent',
            checkin_location: location || 'Marked absent by admin',
          },
        },
        { upsert: true, new: true }
      );

      return res.status(201).json({ success: true, id: recordId, status: 'absent' });
    }

    // ── Marking Present / Half Day (checkIn/checkOut optional) / Raw add ─
    let finalIsHalfDay = isHalfDay;
    let finalIsLate    = false;
    let finalStatus    = normalizedStatus || 'present';
    let netMins         = typeof net_mins === 'number' ? net_mins : 0;

    if (checkIn && checkOut) {
      const policy      = await getAdminPolicy(userId);
      const LATE_THRESH = policy?.LATE_THRESH    ?? (DEFAULT_LATE_HOUR * 60 + DEFAULT_LATE_MINUTE);
      const HALF_THRESH = policy?.HALF_DAY_THRESH ?? (DEFAULT_HALF_DAY_HOUR * 60 + DEFAULT_HALF_DAY_MINUTE);

      const totalMins       = toMins(checkIn);
      const isDirectHalfDay = totalMins >= HALF_THRESH;
      const isLateArrival   = !isDirectHalfDay && totalMins >= LATE_THRESH;
      netMins = Math.max(0, toMins(checkOut) - toMins(checkIn));

      if (!normalizedStatus) {
        // No explicit status sent — auto-detect present/half-day/late from the times (old raw-add behaviour)
        finalIsHalfDay = isDirectHalfDay;
        finalIsLate    = isLateArrival && !isDirectHalfDay;
        finalStatus    = isDirectHalfDay ? 'half_day' : 'present';
      } else {
        // Explicit status given — respect it, but still flag late arrival for "present"
        finalIsLate = !isHalfDay && isLateArrival;
      }
    }

    const recordId = existing ? existing._id : uid();
    await Attendance.findOneAndUpdate(
      { user_id: userId, date },
      {
        $setOnInsert: { _id: recordId, user_id: userId, date },
        $set: {
          check_in:         checkIn  || null,
          check_out:        checkOut || null,
          net_mins:         netMins,
          is_late:          finalIsLate,
          is_half_day:      finalIsHalfDay,
          status:           finalStatus,
          checkin_location: location || (normalizedStatus ? `Marked ${finalStatus.replace('_',' ')} by admin` : 'Added by admin'),
        },
      },
      { upsert: true, new: true }
    );

    return res.status(201).json({
      success:   true,
      id:        recordId,
      status:    finalStatus,
      isLate:    finalIsLate,
      isHalfDay: finalIsHalfDay,
      netMins,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/attendance/:id
 * Admin: Edit an existing attendance record
 */
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Attendance record not found.' });

    // Ownership check
    const emp = await User.findById(record.user_id, 'admin_id role');
    if (!emp || emp.role !== 'employee' || emp.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied. This record does not belong to your employee.' });
    }

    const { checkIn, checkOut, location, status, net_mins } = req.body;
    const normalizedStatus = String(status || '').trim().toLowerCase().replace(/\s+/g, '_'); // "Half Day" -> "half_day"

    if (checkIn)   record.check_in  = checkIn;
    if (checkOut)  record.check_out = checkOut;
    if (location)  record.checkin_location = location;

    if (normalizedStatus === 'absent') {
      // Explicitly marking Absent — clear check-in/out
      record.check_in    = null;
      record.check_out   = null;
      record.is_half_day = false;
      record.is_late     = false;
      record.net_mins    = 0;
      record.status      = 'absent';
    } else if (normalizedStatus === 'half_day') {
      // Explicitly marking Half Day — keep whatever checkIn/checkOut were sent
      record.is_half_day = true;
      record.is_late     = false;
      record.status      = 'half_day';
    } else if (normalizedStatus === 'present') {
      record.is_half_day = false;
      record.status      = 'present';
    }

    // Recalculate timing flags from checkIn only when no explicit status override was given
    if (checkIn && !normalizedStatus) {
      const policy      = await getAdminPolicy(record.user_id);
      const LATE_THRESH = policy?.LATE_THRESH    ?? (DEFAULT_LATE_HOUR * 60 + DEFAULT_LATE_MINUTE);
      const HALF_THRESH = policy?.HALF_DAY_THRESH ?? (DEFAULT_HALF_DAY_HOUR * 60 + DEFAULT_HALF_DAY_MINUTE);

      const totalMins       = toMins(checkIn);
      const isDirectHalfDay = totalMins >= HALF_THRESH;
      const isLateArrival   = !isDirectHalfDay && totalMins >= LATE_THRESH;

      record.is_half_day = isDirectHalfDay;
      record.is_late     = isLateArrival && !isDirectHalfDay;
      record.status      = isDirectHalfDay ? 'half_day' : 'present';
    }

    // Use net_mins sent by frontend if provided, otherwise recalc from check_in/check_out
    if (typeof net_mins === 'number') {
      record.net_mins = net_mins;
    } else if (record.check_in && record.check_out) {
      record.net_mins = Math.max(0, toMins(String(record.check_out).substring(0,5)) - toMins(String(record.check_in).substring(0,5)));
    }

    // Fallback: keep status in sync if it was never set on this record before
    if (!record.status) {
      record.status = record.is_half_day ? 'half_day' : (record.check_in ? 'present' : 'absent');
    }

    await record.save();
    return res.json({ success: true, record: fixRecord(record) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/attendance/:id
 */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const record = await Attendance.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found.' });

    // Ownership check
    const emp = await User.findById(record.user_id, 'admin_id role');
    if (!emp || emp.role !== 'employee' || emp.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    await Attendance.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
