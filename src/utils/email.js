// src/utils/email.js — OTP / transactional email sender
//
// Uses SMTP credentials from .env. Until those are filled in, it safely
// falls back to logging the OTP to the console (like the old behaviour),
// so nothing breaks in dev — once SMTP_HOST/SMTP_USER/SMTP_PASS are set,
// real emails start going out automatically with no other code changes.

const nodemailer = require('nodemailer');

const SMTP_CONFIGURED = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

let transporter = null;
if (SMTP_CONFIGURED) {
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/25
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const SUBJECTS = {
  registration:     'AttendX — Verify your admin registration',
  'password-reset':  'AttendX — Password reset OTP',
};

/**
 * Sends an OTP email. Returns true if an actual email went out,
 * false if it only logged to console (SMTP not configured, or send failed).
 */
async function sendOTPEmail(toEmail, otp, purpose = 'verification') {
  const subject = SUBJECTS[purpose] || 'AttendX — Your OTP code';

  if (!SMTP_CONFIGURED) {
    console.log(`\n📧 [SMTP not configured] OTP for ${toEmail}: ${otp} (valid 10 mins) — purpose: ${purpose}\n`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: toEmail,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color:#1a73e8; margin-bottom: 4px;">AttendX</h2>
          <p>Your One-Time Password (OTP) is:</p>
          <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
          <p>This OTP is valid for <b>10 minutes</b>. Please do not share it with anyone.</p>
          <p style="color:#888; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
        </div>
      `,
    });
    console.log(`\n📧 OTP email sent to ${toEmail} (purpose: ${purpose})\n`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send OTP email to ${toEmail}:`, err.message);
    // Fallback so the OTP is still visible to the developer/tester
    console.log(`\n📧 [FALLBACK after send failure] OTP for ${toEmail}: ${otp} (valid 10 mins)\n`);
    return false;
  }
}

module.exports = { sendOTPEmail, SMTP_CONFIGURED };
