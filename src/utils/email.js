// src/utils/email.js — OTP / transactional email sender
//
// Priority order:
//   1) Resend HTTP API (RESEND_API_KEY set) — works reliably on Render/Railway/
//      any cloud host because it's a plain HTTPS call, not blocked SMTP ports.
//   2) Gmail/SMTP via nodemailer (SMTP_HOST/SMTP_USER/SMTP_PASS set) — kept as
//      a fallback for local/dev use (e.g. via ngrok) where SMTP isn't blocked.
//   3) Console log only — safe no-op fallback so nothing crashes if neither
//      is configured.
//
// No other code changes are needed elsewhere — sendOTPEmail() keeps the same
// signature and behaviour, it just now tries Resend first.

const nodemailer = require('nodemailer');

const RESEND_CONFIGURED = !!process.env.RESEND_API_KEY;

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

function buildHtml(otp) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#1a73e8; margin-bottom: 4px;">AttendX</h2>
      <p>Your One-Time Password (OTP) is:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
      <p>This OTP is valid for <b>10 minutes</b>. Please do not share it with anyone.</p>
      <p style="color:#888; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
    </div>
  `;
}

// ── Resend (HTTP API) — preferred sender ────────────────────────────
async function sendViaResend(toEmail, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    process.env.EMAIL_FROM || 'AttendX <onboarding@resend.dev>',
      to:      [toEmail],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${errBody}`);
  }
  return true;
}

// ── Gmail/SMTP — fallback sender (local/dev) ────────────────────────
async function sendViaSmtp(toEmail, subject, html) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to:   toEmail,
    subject,
    html,
  });
  return true;
}

/**
 * Sends an OTP email. Returns true if an actual email went out,
 * false if it only logged to console (no provider configured, or send failed).
 */
async function sendOTPEmail(toEmail, otp, purpose = 'verification') {
  const subject = SUBJECTS[purpose] || 'AttendX — Your OTP code';
  const html = buildHtml(otp);

  if (RESEND_CONFIGURED) {
    try {
      await sendViaResend(toEmail, subject, html);
      console.log(`\n📧 OTP email sent via Resend to ${toEmail} (purpose: ${purpose})\n`);
      return true;
    } catch (err) {
      console.error(`❌ Resend failed for ${toEmail}:`, err.message);
      // fall through to SMTP if configured, otherwise to console fallback below
    }
  }

  if (SMTP_CONFIGURED) {
    try {
      await sendViaSmtp(toEmail, subject, html);
      console.log(`\n📧 OTP email sent via SMTP to ${toEmail} (purpose: ${purpose})\n`);
      return true;
    } catch (err) {
      console.error(`❌ SMTP failed for ${toEmail}:`, err.message);
    }
  }

  if (!RESEND_CONFIGURED && !SMTP_CONFIGURED) {
    console.log(`\n📧 [No email provider configured] OTP for ${toEmail}: ${otp} (valid 10 mins) — purpose: ${purpose}\n`);
  } else {
    console.log(`\n📧 [FALLBACK after send failure] OTP for ${toEmail}: ${otp} (valid 10 mins)\n`);
  }
  return false;
}

module.exports = { sendOTPEmail, SMTP_CONFIGURED, RESEND_CONFIGURED };
