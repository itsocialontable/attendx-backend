// src/routes/auth.js — Auth: Register, Login, OTP, Forget Password, Change Password
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { uid, isValidEmail } = require('../utils/helpers');
const { authenticate } = require('../middleware/auth');
const { sendOTPEmail } = require('../utils/email');

// ── OTP Generator ─────────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}

// ── OTP expiry: 10 minutes ────────────────────────────────────────
function otpExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

/**
 * POST /api/register
 * Admin register karo — multiple admins allowed, har admin apne employees manage karta hai
 * Body: { fullName, lName, email, phoneNo, companyName, password, confirmPassword }
 * Note: secret key ki zaroorat nahi
 */
router.post('/register', async (req, res) => {
  try {
    const {
      fullName, lName, email, phoneNo, companyName,
      password, confirmPassword,
    } = req.body;

    // Required fields
    if (!fullName || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'fullName, email, password and confirmPassword are required.' });
    }

    // Email format check (must contain @ and a valid domain)
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address (e.g. name@example.com).' });
    }

    // Password match check
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Password and confirmPassword do not match.' });
    }

    // Password strength: min 6 chars
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Email already exists?
    const existing = await User.findOne({ username: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'This email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const adminId = uid();
    const otp = generateOTP();

    const newAdmin = new User({
      _id:         adminId,
      fullName:    fullName.trim(),
      lName:       lName?.trim()       || '',
      email:       email.trim().toLowerCase(),
      phoneNo:     phoneNo?.trim()     || '',
      companyName: companyName?.trim() || '',
      name:        `${fullName.trim()} ${lName?.trim() || ''}`.trim(),
      username:    email.trim().toLowerCase(),
      password:    hashedPassword,
      role:        'admin',
      admin_id:    null,   // admins do not belong to another admin
      is_verified: false,  // becomes true only after OTP verification
      otp,
      otp_expires: otpExpiry(),
    });

    await newAdmin.save();

    await sendOTPEmail(newAdmin.email, otp, 'registration');

    return res.status(201).json({
      message: 'OTP sent to your email. Please verify to complete your registration.',
      pending_verification: true,
      email: newAdmin.email,
      otp_dev: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * POST /api/register/verify-otp
 * Admin registration ka last step — OTP verify hote hi account active ho jata hai
 * Body: { email, otp }
 * Returns: { token, user } — same shape as /api/admin/login, taaki frontend seedha login kar sake
 */
router.post('/register/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required.' });
    }

    const user = await User.findOne({ username: email.trim().toLowerCase(), role: 'admin' });

    if (!user) {
      return res.status(404).json({ error: 'No pending admin registration found for this email.' });
    }

    if (user.is_verified) {
      return res.status(409).json({ error: 'This admin is already verified. Please log in via /api/admin/login.' });
    }

    if (!user.otp || user.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }

    if (user.otp_expires && new Date() > user.otp_expires) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one via /api/register/resend-otp.' });
    }

    user.is_verified = true;
    user.otp         = null;
    user.otp_expires = null;
    await user.save();

    const token = jwt.sign(
      { userId: user._id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      message: 'Admin registered successfully!',
      token,
      user: {
        id:          user._id,
        fullName:    user.fullName || user.name,
        lName:       user.lName   || '',
        email:       user.email,
        phoneNo:     user.phoneNo || '',
        companyName: user.companyName || '',
        name:        user.name,
        role:        user.role,
        is_verified: user.is_verified,
      },
    });

  } catch (err) {
    console.error('Register verify-otp error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * POST /api/register/resend-otp
 * Pending admin registration ke liye naya OTP bhejo (email expire ho gaya ya mila nahi)
 * Body: { email }
 */
router.post('/register/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const user = await User.findOne({ username: email.trim().toLowerCase(), role: 'admin' });
    if (!user) return res.status(404).json({ error: 'No pending admin registration found for this email.' });

    if (user.is_verified) {
      return res.status(409).json({ error: 'This admin is already verified. Please log in via /api/admin/login.' });
    }

    const otp = generateOTP();
    user.otp         = otp;
    user.otp_expires = otpExpiry();
    await user.save();

    await sendOTPEmail(user.email, otp, 'registration');

    return res.json({
      message: 'A new OTP has been sent to your email.',
      otp_dev: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * POST /api/admin/login
 * Admin-only login
 * Body: { email, password }
 * Returns: { token, user } — only admin fields, no employee-specific fields
 */
router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ username: email.trim().toLowerCase() });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Only admins can use this endpoint
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'This is the admin login endpoint. Employees must use /api/employee/login.' });
    }

    // bcrypt check + legacy plain text fallback
    let isMatch = false;
    const isHashed = /^\$2[ayb]\$/.test(user.password);

    if (isHashed) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = password === user.password;
      if (isMatch) {
        user.password = await bcrypt.hash(password, 10);
        await user.save();
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Admin ne abhi OTP verify nahi kiya — registration incomplete
    if (!user.is_verified) {
      return res.status(403).json({ error: 'Please verify your email via OTP to complete registration before logging in. Use /api/register/verify-otp.' });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Admin response — only admin-relevant fields (no employee fields like dept/salary)
    return res.json({
      message: 'Admin login successful!',
      token,
      user: {
        id:          user._id,
        fullName:    user.fullName || user.name,
        lName:       user.lName   || '',
        email:       user.email,
        phoneNo:     user.phoneNo || '',
        companyName: user.companyName || '',
        name:        user.name,
        role:        user.role,
        is_verified: user.is_verified,
      },
    });

  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * POST /api/employee/login
 * Employee-only login — admin ka username/password isse login nahi hoga
 * Body: { username (ya email), password }
 * Returns: { token, user }
 */
router.post('/employee/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const loginId = username || email;

    if (!loginId || !password) {
      return res.status(400).json({ error: 'username/email and password are required.' });
    }

    const user = await User.findOne({ username: loginId.trim().toLowerCase() });

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    // Sirf employee role yahan se login kar sakta hai
    if (user.role !== 'employee') {
      return res.status(403).json({ error: 'This is the employee login endpoint. Admins must use /api/admin/login.' });
    }

    // bcrypt check + legacy plain text fallback
    let isMatch = false;
    const isHashed = /^\$2[ayb]\$/.test(user.password);

    if (isHashed) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = password === user.password;
      if (isMatch) {
        user.password = await bcrypt.hash(password, 10);
        await user.save();
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({
      message: 'Employee login successful!',
      token,
      user: {
        id:          user._id,
        fullName:    user.fullName || user.name,
        name:        user.name,
        username:    user.username,
        email:       user.email,
        role:        user.role,
        admin_id:    user.admin_id || '',   // which admin this employee belongs to
        dept:        user.dept       || '',
        salary:      parseFloat(user.salary || 0),
        joinDate:    user.join_date  || '',
        emp_id:      user.emp_id     || '',
        designation: user.designation|| '',
        phone:       user.phone      || '',
        address:     user.address    || '',
        is_verified: user.is_verified,
      },
    });

  } catch (err) {
    console.error('Employee login error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * POST /api/forgot-password
 * Body: { email }
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const user = await User.findOne({ username: email.trim().toLowerCase() });
    if (!user) return res.status(404).json({ error: 'This email is not registered.' });

    const otp = generateOTP();
    user.otp         = otp;
    user.otp_expires = otpExpiry();
    await user.save();

    console.log(`\n📧 OTP for ${email}: ${otp} (valid 10 mins)\n`);

    return res.json({
      message: 'OTP has been sent. It will expire in 10 minutes.',
      otp_dev: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * POST /api/verify-otp
 * Body: { email, otp }
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

    const user = await User.findOne({ username: email.trim().toLowerCase() });
    if (!user) return res.status(404).json({ error: 'Email not found.' });

    if (!user.otp || user.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }

    if (user.otp_expires && new Date() > user.otp_expires) {
      return res.status(400).json({ error: 'OTP has expired. Please use /api/forgot-password again.' });
    }

    user.is_verified = true;
    await user.save();

    return res.json({ message: 'OTP verified. You can now set a new password via /api/reset-password.', verified: true });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * POST /api/resend-otp
 * Body: { email }
 */
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const user = await User.findOne({ username: email.trim().toLowerCase() });
    if (!user) return res.status(404).json({ error: 'Email is not registered.' });

    const otp = generateOTP();
    user.otp         = otp;
    user.otp_expires = otpExpiry();
    await user.save();

    console.log(`\n📧 Resent OTP for ${email}: ${otp} (valid 10 mins)\n`);

    return res.json({
      message: 'A new OTP has been sent.',
      otp_dev: process.env.NODE_ENV !== 'production' ? otp : undefined,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * POST /api/reset-password
 * Body: { email, otp, newPassword, confirmPassword }
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'email, otp, newPassword and confirmPassword are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'newPassword and confirmPassword do not match.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const user = await User.findOne({ username: email.trim().toLowerCase() });
    if (!user) return res.status(404).json({ error: 'Email not found.' });

    if (!user.otp || user.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }

    if (user.otp_expires && new Date() > user.otp_expires) {
      return res.status(400).json({ error: 'OTP has expired. Please use /api/forgot-password again.' });
    }

    user.password    = await bcrypt.hash(newPassword, 10);
    user.otp         = null;
    user.otp_expires = null;
    await user.save();

    return res.json({ message: 'Password changed successfully. You can now log in.' });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

/**
 * PUT /api/change-password
 * Logged-in user apna password change kare
 * Header: Authorization: Bearer <token>
 * Body: { oldPassword, newPassword, confirmPassword }
 */
router.put('/change-password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'oldPassword, newPassword and confirmPassword are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'newPassword and confirmPassword do not match.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Incorrect old password.' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.json({ message: 'Password changed successfully.' });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

module.exports = router;
