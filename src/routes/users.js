// src/routes/users.js — Employee Management (Admin CRUD)
// Multi-admin: har admin sirf apne employees dekh aur manage kar sakta hai
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const User    = require('../models/User');
const { uid, isValidEmail } = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');

// Format user for response
function fmtUser(u) {
  const obj = u.toObject ? u.toObject() : u;
  return {
    id:                obj._id,
    name:              obj.name,
    fullName:          obj.fullName         || obj.name,
    lName:             obj.lName            || '',
    username:          obj.username,
    email:             obj.email            || '',
    role:              obj.role,
    admin_id:          obj.admin_id         || '',
    dept:              obj.dept             || '',
    salary:            parseFloat(obj.salary || 0),
    join_date:         obj.join_date        || '',
    address:           obj.address          || '',
    phone:             obj.phone            || '',
    emp_id:            obj.emp_id           || '',
    designation:       obj.designation      || '',
    emergency_contact: obj.emergency_contact|| '',
    bank_ac_no:        obj.bank_ac_no       || '',
    bank_name:         obj.bank_name        || '',
    bank_branch:       obj.bank_branch      || '',
    bank_ifsc:         obj.bank_ifsc        || '',
    aadhar_no:         obj.aadhar_no        || '',
    pan_no:            obj.pan_no           || '',
  };
}

/**
 * GET /api/users
 * Admin: Sirf apne employees — admin_id se scoped
 * Query: ?dept=IT&search=rahul
 */
router.get('/', adminOnly, async (req, res) => {
  try {
    // Filter by this admin's employees only
    const filter = { role: 'employee', admin_id: req.user.userId };

    if (req.query.dept)   filter.dept = req.query.dept;
    if (req.query.emp_id) filter.emp_id = req.query.emp_id;

    if (req.query.search) {
      const regex = new RegExp(req.query.search, 'i');
      filter.$or = [{ name: regex }, { email: regex }, { emp_id: regex }];
    }

    const users = await User.find(filter, '-password').sort({ name: 1 });
    return res.json(users.map(fmtUser));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/users/:id
 * Admin: only if employee belongs to them
 * Employee: only their own profile
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, '-password');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Employee can only see their own profile
    if (req.user.role === 'employee' && req.user.userId !== req.params.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Admin can only see employees that belong to them
    if (req.user.role === 'admin' && user.role === 'employee' && user.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
    }

    return res.json(fmtUser(user));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/users
 * Admin: Add new employee — auto-assign admin_id = logged-in admin
 */
router.post('/', adminOnly, async (req, res) => {
  try {
    const {
      fullName, lName, email, phone, address,
      empId, designation, dept, joinDate, salary,
      emergencyContact, password,
      // legacy fields
      name, username,
      bankAcNo, bankName, bankBranch, bankIfsc, aadharNo, panNo,
    } = req.body;

    const displayName = fullName || name;
    const loginEmail  = email || username;
    const loginPass   = password;

    if (!displayName || !loginEmail || !loginPass) {
      return res.status(400).json({ error: 'fullName, email and password are required.' });
    }

    if (!isValidEmail(loginEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address (e.g. name@example.com).' });
    }

    const existing = await User.findOne({ username: loginEmail.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'This email is already registered.' });
    }

    const hashed = await bcrypt.hash(loginPass, 10);
    const newId  = uid();

    await User.create({
      _id:               newId,
      fullName:          displayName.trim(),
      lName:             lName?.trim()           || '',
      name:              `${displayName.trim()} ${lName?.trim() || ''}`.trim(),
      username:          loginEmail.trim().toLowerCase(),
      email:             loginEmail.trim().toLowerCase(),
      password:          hashed,
      role:              'employee',
      admin_id:          req.user.userId,   // belongs to the admin who created them
      dept:              dept              || '',
      salary:            parseFloat(salary || 0),
      join_date:         joinDate          || new Date().toISOString().substring(0, 10),
      address:           address           || '',
      phone:             phone             || '',
      emp_id:            empId             || '',
      designation:       designation       || '',
      emergency_contact: emergencyContact  || '',
      bank_ac_no:        bankAcNo          || null,
      bank_name:         bankName          || null,
      bank_branch:       bankBranch        || null,
      bank_ifsc:         bankIfsc          || null,
      aadhar_no:         aadharNo          || null,
      pan_no:            panNo             || null,
      is_verified:       true,
    });

    return res.status(201).json({ success: true, id: newId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/users/:id
 * Admin: Update employee — only if they own this employee
 */
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Ensure this employee belongs to the requesting admin
    if (user.role === 'employee' && user.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
    }

    if (req.body.email !== undefined && req.body.email && !isValidEmail(req.body.email)) {
      return res.status(400).json({ error: 'Please enter a valid email address (e.g. name@example.com).' });
    }

    const fields = [
      'fullName','lName','email','phone','address',
      'emp_id','designation','dept','salary','join_date',
      'emergency_contact','bank_ac_no','bank_name','bank_branch',
      'bank_ifsc','aadhar_no','pan_no',
    ];

    fields.forEach(f => {
      if (req.body[f] !== undefined) user[f] = req.body[f];
    });

    if (req.body.joinDate       !== undefined) user.join_date    = req.body.joinDate;
    if (req.body.bankAcNo       !== undefined) user.bank_ac_no   = req.body.bankAcNo   || null;
    if (req.body.bankName       !== undefined) user.bank_name    = req.body.bankName   || null;
    if (req.body.bankBranch     !== undefined) user.bank_branch  = req.body.bankBranch || null;
    if (req.body.bankIfsc       !== undefined) user.bank_ifsc    = req.body.bankIfsc   || null;
    if (req.body.aadharNo       !== undefined) user.aadhar_no    = req.body.aadharNo   || null;
    if (req.body.panNo          !== undefined) user.pan_no       = req.body.panNo      || null;
    if (req.body.emergencyContact !== undefined) user.emergency_contact = req.body.emergencyContact;

    if (req.body.fullName || req.body.lName) {
      user.name = `${user.fullName || ''} ${user.lName || ''}`.trim();
    }

    if (req.body.password && req.body.password.trim()) {
      user.password = await bcrypt.hash(req.body.password.trim(), 10);
    }

    await user.save();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/users/:id
 * Admin: Delete employee + cascade — only if they own this employee
 */
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (user.role === 'employee' && user.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
    }

    const [Attendance, Leave, Document, SaturdayOff] = [
      require('../models/Attendance'),
      require('../models/Leave'),
      require('../models/Document'),
      require('../models/SaturdayOff'),
    ];
    await Promise.all([
      User.findByIdAndDelete(userId),
      Attendance.deleteMany({ user_id: userId }),
      Leave.deleteMany({ user_id: userId }),
      Document.deleteMany({ user_id: userId }),
      SaturdayOff.deleteMany({ user_id: userId }),
    ]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/users/:id/change-password
 * Employee apna password change kare (or admin for their own employee)
 */
router.put('/:id/change-password', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Employee can only change their own password
    if (req.user.role === 'employee' && req.user.userId !== req.params.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // Admin can only change password of their own employees
    if (req.user.role === 'admin' && user.role === 'employee' && user.admin_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied. This employee does not belong to your account.' });
    }

    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new password are required.' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Incorrect old password.' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
