// src/routes/reviews.js — Review System (Admin → Employee)
// Admin employee ko monthly review deta hai (rating + comment)
// Employee apne reviews dekh sakta hai + graph + avg rating + attendance rate

const express    = require('express');
const router     = express.Router();
const Review     = require('../models/Review');
const User       = require('../models/User');
const Attendance = require('../models/Attendance');
const Leave      = require('../models/Leave');
const { authenticate, adminOnly } = require('../middleware/auth');
const { uid, todayIST } = require('../utils/helpers');

// ─────────────────────────────────────────────────────────────────
// HELPER: Calculate attendance rate for a given user and month
// ─────────────────────────────────────────────────────────────────
async function calcAttendanceRate(userId, month) {
  const [y, m]  = month.split('-').map(Number);
  const mStart  = `${month}-01`;
  const lastDay = new Date(y, m, 0);
  const mEnd    = lastDay.toISOString().substring(0, 10);
  const daysInMonth = lastDay.getDate();

  // Count sundays
  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(y, m - 1, d).getDay() === 0) sundays++;
  }

  // Approved leaves this month
  const approvedAgg = await Leave.aggregate([
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
  const approvedLeaveDays = parseFloat(approvedAgg[0]?.total || 0);

  // Attendance records
  const attRows = await Attendance.find({
    user_id: userId,
    date:    { $gte: mStart, $lte: mEnd },
    check_in: { $ne: null },
  });

  let present = 0, halfDays = 0;
  attRows.forEach(a => {
    if (a.is_half_day) halfDays++;
    else present++;
  });

  // Saturdays are working days — only Sundays off
  const totalWorkingDays = daysInMonth - sundays;
  const effectivePresent = present + halfDays * 0.5 + approvedLeaveDays;
  const attendanceRate   = totalWorkingDays > 0
    ? Math.min(100, parseFloat(((effectivePresent / totalWorkingDays) * 100).toFixed(1)))
    : 0;

  return {
    totalWorkingDays,
    presentDays:    present,
    halfDays,
    approvedLeaves: approvedLeaveDays,
    attendanceRate,
  };
}

// ─────────────────────────────────────────────────────────────────
// 1. POST /api/reviews
//    Admin → employee ko review dega
//    Body: { user_id, month, rating, title, comment, category }
// ─────────────────────────────────────────────────────────────────
router.post('/', adminOnly, async (req, res) => {
  try {
    const {
      user_id,
      month,      // "YYYY-MM"
      rating,
      title   = '',
      comment = '',
      category = 'overall',
    } = req.body;

    if (!user_id || !month || !rating) {
      return res.status(400).json({ error: 'user_id, month and rating are required.' });
    }

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM (e.g. 2025-06).' });
    }

    // Validate rating
    const ratingNum = parseFloat(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    // Employee exist karta hai?
    const emp = await User.findById(user_id);
    if (!emp || emp.role !== 'employee') {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    // Check: same admin ne is month is category ka review already diya?
    const existing = await Review.findOne({
      user_id,
      admin_id: req.user.userId,
      month,
      category,
    });

    if (existing) {
      // Update existing review
      existing.rating     = ratingNum;
      existing.title      = title;
      existing.comment    = comment;
      existing.given_on   = todayIST();
      existing.is_visible = true;
      await existing.save();
      return res.json({ message: 'Review updated successfully.', review: fmtReview(existing) });
    }

    // Create new review
    const review = new Review({
      _id:      uid(),
      user_id,
      admin_id: req.user.userId,
      month,
      rating:   ratingNum,
      title,
      comment,
      category,
      given_on: todayIST(),
    });

    await review.save();
    return res.status(201).json({ message: 'Review submitted successfully.', review: fmtReview(review) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 2. PUT /api/reviews/:id
//    Admin apna review edit kar sakta hai
// ─────────────────────────────────────────────────────────────────
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found.' });

    // Sirf wahi admin edit kar sakta hai jisne diya tha
    if (review.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'You can only edit your own review.' });
    }

    const { rating, title, comment, category, is_visible } = req.body;

    if (rating !== undefined) {
      const r = parseFloat(rating);
      if (isNaN(r) || r < 1 || r > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
      }
      review.rating = r;
    }
    if (title     !== undefined) review.title      = title;
    if (comment   !== undefined) review.comment    = comment;
    if (category  !== undefined) review.category   = category;
    if (is_visible !== undefined) review.is_visible = !!is_visible;
    review.given_on = todayIST();

    await review.save();
    return res.json({ message: 'Review updated successfully.', review: fmtReview(review) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 3. DELETE /api/reviews/:id
//    Admin review delete kar sakta hai
// ─────────────────────────────────────────────────────────────────
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found.' });

    if (review.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'You can only delete your own review.' });
    }

    await review.deleteOne();
    return res.json({ message: 'Review deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 4. GET /api/reviews/employee/:userId
//    Employee apne saare reviews dekhega (employee panel)
//    Query: ?month=2025-06 (optional filter)
// ─────────────────────────────────────────────────────────────────
router.get('/employee/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    // Employee sirf apne reviews dekh sakta hai
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const filter = { user_id: userId, is_visible: true };
    if (req.query.month) filter.month = req.query.month;

    const reviews = await Review.find(filter).sort({ month: -1, given_on: -1 });

    // Admin info bhi attach karo
    const adminIds  = [...new Set(reviews.map(r => r.admin_id))];
    const adminDocs = await User.find({ _id: { $in: adminIds } }, 'name');
    const adminMap  = {};
    adminDocs.forEach(a => { adminMap[a._id] = a.name; });

    const result = reviews.map(r => ({
      ...fmtReview(r),
      admin_name: adminMap[r.admin_id] || 'Admin',
    }));

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 5. GET /api/reviews/admin/all
//    Admin — sabke reviews dekhe (filter by employee / month)
//    Query: ?userId=xxx&month=2025-06
// ─────────────────────────────────────────────────────────────────
router.get('/admin/all', adminOnly, async (req, res) => {
  try {
    // Only this admin's own reviews — not every admin's reviews in the system.
    const filter = { admin_id: req.user.userId };
    if (req.query.userId) filter.user_id = req.query.userId;
    if (req.query.month)  filter.month   = req.query.month;

    const reviews = await Review.find(filter).sort({ month: -1, given_on: -1 });

    // Attach employee + admin names
    const allIds  = [...new Set([...reviews.map(r => r.user_id), ...reviews.map(r => r.admin_id)])];
    const users   = await User.find({ _id: { $in: allIds } }, 'name');
    const nameMap = {};
    users.forEach(u => { nameMap[u._id] = u.name; });

    return res.json(reviews.map(r => ({
      ...fmtReview(r),
      employee_name: nameMap[r.user_id]  || 'Employee',
      admin_name:    nameMap[r.admin_id] || 'Admin',
    })));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 6. GET /api/reviews/avg-rating/:userId
//    Employee Panel — Average rating (monthly ya overall)
//    Query: ?months=6 (kitne last months, default 6)
// ─────────────────────────────────────────────────────────────────
router.get('/avg-rating/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const monthsBack = parseInt(req.query.months || 6);
    const today      = todayIST();
    const months     = getLastNMonths(today, monthsBack);

    // Per-month average rating
    const monthlyRatings = await Review.aggregate([
      {
        $match: {
          user_id:    userId,
          is_visible: true,
          month:      { $in: months },
        }
      },
      {
        $group: {
          _id:        '$month',
          avgRating:  { $avg: '$rating' },
          count:      { $sum: 1 },
          categories: { $push: { category: '$category', rating: '$rating' } },
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Overall average across all time (visible reviews)
    const overallAgg = await Review.aggregate([
      { $match: { user_id: userId, is_visible: true } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, total: { $sum: 1 } } }
    ]);

    // Category-wise average (all time)
    const categoryAgg = await Review.aggregate([
      { $match: { user_id: userId, is_visible: true } },
      { $group: { _id: '$category', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // Fill missing months with null
    const monthlyMap = {};
    monthlyRatings.forEach(r => { monthlyMap[r._id] = r; });

    const monthlyData = months.map(mo => ({
      month:     mo,
      avgRating: monthlyMap[mo] ? parseFloat(monthlyMap[mo].avgRating.toFixed(2)) : null,
      count:     monthlyMap[mo]?.count || 0,
    }));

    return res.json({
      userId,
      overallAvgRating: overallAgg[0] ? parseFloat(overallAgg[0].avgRating.toFixed(2)) : null,
      totalReviews:     overallAgg[0]?.total || 0,
      monthlyRatings:   monthlyData,
      categoryRatings:  categoryAgg.map(c => ({
        category:  c._id,
        avgRating: parseFloat(c.avgRating.toFixed(2)),
        count:     c.count,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 7. GET /api/reviews/attendance-rate/:userId
//    Employee Panel — Monthly attendance rate (last N months)
//    Query: ?months=6
// ─────────────────────────────────────────────────────────────────
router.get('/attendance-rate/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const monthsBack = parseInt(req.query.months || 6);
    const today      = todayIST();
    const months     = getLastNMonths(today, monthsBack);

    // Calculate attendance rate for each month in parallel
    const monthlyStats = await Promise.all(
      months.map(async (month) => {
        const stats = await calcAttendanceRate(userId, month);
        return { month, ...stats };
      })
    );

    // Overall average attendance rate
    const validMonths = monthlyStats.filter(m => m.totalWorkingDays > 0);
    const overallRate = validMonths.length > 0
      ? parseFloat((validMonths.reduce((sum, m) => sum + m.attendanceRate, 0) / validMonths.length).toFixed(1))
      : 0;

    return res.json({
      userId,
      overallAttendanceRate: overallRate,
      monthlyAttendance: monthlyStats,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 8. GET /api/reviews/graph/:userId
//    Employee Panel — Combined graph data
//    Rating + Attendance Rate monthly (last N months)
//    Query: ?months=6
// ─────────────────────────────────────────────────────────────────
router.get('/graph/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const monthsBack = parseInt(req.query.months || 6);
    const today      = todayIST();
    const months     = getLastNMonths(today, monthsBack);

    // Ratings per month
    const ratingAgg = await Review.aggregate([
      {
        $match: {
          user_id:    userId,
          is_visible: true,
          month:      { $in: months },
        }
      },
      {
        $group: {
          _id:       '$month',
          avgRating: { $avg: '$rating' },
          count:     { $sum: 1 },
        }
      }
    ]);

    const ratingMap = {};
    ratingAgg.forEach(r => { ratingMap[r._id] = r; });

    // Attendance rate per month
    const attendanceData = await Promise.all(
      months.map(async (month) => {
        const stats = await calcAttendanceRate(userId, month);
        return { month, ...stats };
      })
    );

    const attendanceMap = {};
    attendanceData.forEach(a => { attendanceMap[a.month] = a; });

    // Combined graph data — one entry per month
    const graphData = months.map(month => {
      const att = attendanceMap[month];
      return {
        month,
        monthLabel:      formatMonthLabel(month),       // "Jan 2025"
        avgRating:       ratingMap[month]
          ? parseFloat(ratingMap[month].avgRating.toFixed(2))
          : null,
        reviewCount:     ratingMap[month]?.count || 0,
        attendanceRate:  att?.attendanceRate || 0,
        presentDays:     att?.presentDays    || 0,
        halfDays:        att?.halfDays       || 0,
        totalWorkingDays: att?.totalWorkingDays || 0,
        approvedLeaves:  att?.approvedLeaves || 0,
      };
    });

    // Summary stats
    const validRatingMonths     = graphData.filter(g => g.avgRating !== null);
    const validAttendanceMonths = graphData.filter(g => g.totalWorkingDays > 0);

    return res.json({
      userId,
      months:              monthsBack,
      graphData,
      summary: {
        overallAvgRating: validRatingMonths.length > 0
          ? parseFloat((validRatingMonths.reduce((s, g) => s + g.avgRating, 0) / validRatingMonths.length).toFixed(2))
          : null,
        overallAttendanceRate: validAttendanceMonths.length > 0
          ? parseFloat((validAttendanceMonths.reduce((s, g) => s + g.attendanceRate, 0) / validAttendanceMonths.length).toFixed(1))
          : 0,
        totalReviews: graphData.reduce((s, g) => s + g.reviewCount, 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 9. GET /api/reviews/monthly-summary/:userId
//    Employee Panel — Complete monthly summary
//    Ek month ke liye rating + attendance + review details
//    Query: ?month=2025-06 (default: current month)
// ─────────────────────────────────────────────────────────────────
router.get('/monthly-summary/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const today = todayIST();
    const month = req.query.month || today.substring(0, 7);

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM.' });
    }

    // Reviews for this month
    const reviews = await Review.find({ user_id: userId, month, is_visible: true })
      .sort({ given_on: -1 });

    // Admin names
    const adminIds  = [...new Set(reviews.map(r => r.admin_id))];
    const adminDocs = await User.find({ _id: { $in: adminIds } }, 'name');
    const adminMap  = {};
    adminDocs.forEach(a => { adminMap[a._id] = a.name; });

    // Attendance rate for this month
    const attStats = await calcAttendanceRate(userId, month);

    // Average rating this month
    const avgRating = reviews.length > 0
      ? parseFloat((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(2))
      : null;

    return res.json({
      userId,
      month,
      monthLabel: formatMonthLabel(month),
      // Attendance
      attendanceRate:   attStats.attendanceRate,
      presentDays:      attStats.presentDays,
      halfDays:         attStats.halfDays,
      totalWorkingDays: attStats.totalWorkingDays,
      approvedLeaves:   attStats.approvedLeaves,
      // Reviews
      avgRating,
      totalReviews: reviews.length,
      reviews: reviews.map(r => ({
        ...fmtReview(r),
        admin_name: adminMap[r.admin_id] || 'Admin',
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

// Last N months ki list return karta hai (ascending order)
function getLastNMonths(todayStr, n) {
  const months = [];
  const d = new Date(todayStr);
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const mo = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    months.push(mo);
  }
  return months;
}

// "2025-06" → "Jun 2025"
function formatMonthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  const names  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[m - 1]} ${y}`;
}

// Review object format
function fmtReview(r) {
  const obj = r.toObject ? r.toObject() : r;
  return {
    id:         obj._id,
    user_id:    obj.user_id,
    admin_id:   obj.admin_id,
    month:      obj.month,
    monthLabel: formatMonthLabel(obj.month),
    rating:     parseFloat(obj.rating),
    title:      obj.title       || '',
    comment:    obj.comment     || '',
    category:   obj.category    || 'overall',
    is_visible: obj.is_visible,
    given_on:   obj.given_on,
  };
}

module.exports = router;
