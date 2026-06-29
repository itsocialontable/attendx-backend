// src/routes/documents.js — Document Upload (MongoDB)
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const Document = require('../models/Document');
const { uid }  = require('../utils/helpers');
const { authenticate, adminOnly } = require('../middleware/auth');

// Multer — memory storage (files stored as Base64 in DB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Sirf JPG, PNG ya PDF allowed hai.'));
  }
});

const VALID_DOC_TYPES = ['aadhar', 'pan', 'marksheet', 'passbook'];

/**
 * GET /api/documents/:userId
 * Returns list of docs (without file data)
 */
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const rows = await Document.find(
      { user_id: userId },
      'doc_type file_name file_type uploaded_at'
    );

    return res.json(rows.map(r => ({
      doc_type:    r.doc_type,
      file_name:   r.file_name,
      file_type:   r.file_type,
      uploaded_at: r.uploaded_at || '',
    })));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/documents/:userId/:docType/view
 * Returns full file data (Base64) for viewing
 */
router.get('/:userId/:docType/view', authenticate, async (req, res) => {
  try {
    const { userId, docType } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const doc = await Document.findOne({ user_id: userId, doc_type: docType });
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    return res.json({
      file_data: doc.file_data,
      file_type: doc.file_type,
      file_name: doc.file_name,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/documents
 * Upload — multipart OR JSON Base64
 */
router.post('/', authenticate, upload.single('file'), async (req, res) => {
  try {
    let userId, docType, fileData, fileName, fileType;

    if (req.file) {
      userId   = req.body.userId  || req.user.userId;
      docType  = (req.body.docType || '').toLowerCase().trim();
      fileType = req.file.mimetype;
      fileName = req.file.originalname;
      fileData = `data:${fileType};base64,${req.file.buffer.toString('base64')}`;
    } else {
      userId   = req.body.userId   || req.user.userId;
      docType  = (req.body.docType || '').toLowerCase().trim();
      fileData = req.body.fileData || '';
      fileName = req.body.fileName || '';
      fileType = req.body.fileType || '';
    }

    if (!VALID_DOC_TYPES.includes(docType)) {
      return res.status(400).json({ error: 'Invalid doc type. Use: aadhar, pan, marksheet, passbook' });
    }
    if (!fileData) {
      return res.status(400).json({ error: 'File data required.' });
    }
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const today = new Date().toISOString().substring(0, 10);

    // Upsert: update if exists, insert if not
    const existing = await Document.findOne({ user_id: userId, doc_type: docType });

    if (existing) {
      existing.file_data   = fileData;
      existing.file_name   = fileName;
      existing.file_type   = fileType;
      existing.uploaded_at = today;
      await existing.save();
    } else {
      await Document.create({
        _id:         uid(),
        user_id:     userId,
        doc_type:    docType,
        file_data:   fileData,
        file_name:   fileName,
        file_type:   fileType,
        uploaded_at: today,
      });
    }

    return res.json({ success: true, docType, fileName });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size must not exceed 5MB.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/documents/:userId/:docType
 */
router.delete('/:userId/:docType', authenticate, async (req, res) => {
  try {
    const { userId, docType } = req.params;

    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    await Document.deleteOne({ user_id: userId, doc_type: docType });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
