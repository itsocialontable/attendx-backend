// server.js — AttendX Node.js Backend (MongoDB)
require('dotenv').config();

const express          = require('express');
const cors             = require('cors');
const connectDB        = require('./src/config/db');
const responseFormatter = require('./src/middleware/responseFormatter');

const app = express();

// ── CONNECT DATABASE ──────────────────────────────────────────────
connectDB();

// ── MIDDLEWARE ────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Auto-adds { success, message } to every JSON response (without
// touching existing fields), so frontend toasts work uniformly.
app.use(responseFormatter);

// ── ROUTES ────────────────────────────────────────────────────────
app.use('/api',                 require('./src/routes/auth'));
app.use('/api/users',           require('./src/routes/users'));
app.use('/api/attendance',      require('./src/routes/attendance'));
app.use('/api/leaves',          require('./src/routes/leaves'));
app.use('/api/salary',          require('./src/routes/salary'));
app.use('/api/documents',       require('./src/routes/documents'));
app.use('/api/dashboard',       require('./src/routes/dashboard'));
app.use('/api/reviews',         require('./src/routes/reviews'));
app.use('/api/notifications',   require('./src/routes/notifications'));
app.use('/api/admin/settings',  require('./src/routes/adminSettings'));
// Note: /api/saturday-offs removed — Saturdays are now working days

// ── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    app:     'AttendX Backend (MongoDB)',
    version: '3.1.0',
    time:    new Date().toISOString(),
  });
});

// ── 404 HANDLER ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── START SERVER ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 AttendX Backend v3.1 (MongoDB) running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
