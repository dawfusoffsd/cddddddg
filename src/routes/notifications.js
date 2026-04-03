const express = require('express');
const { body } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/notifications ───────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { is_read, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let conditions = [`n.user_id = $1`];
  let values = [req.user.id];
  let paramCount = 2;

  if (is_read !== undefined) {
    conditions.push(`n.is_read = $${paramCount++}`);
    values.push(is_read === 'true');
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const result = await query(`
    SELECT n.*
    FROM notifications n
    ${whereClause}
    ORDER BY n.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `, [...values, limit, offset]);

  const countResult = await query(`SELECT COUNT(*) FROM notifications n ${whereClause}`, values);

  res.json({
    success: true,
    data: result.rows,
    pagination: {
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(countResult.rows[0].count / limit),
    }
  });
}));

// ─── GET /api/notifications/unread-count ──────────────────────────────────────
router.get('/unread-count', authenticate, asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false
  `, [req.user.id]);

  res.json({ success: true, data: { count: parseInt(result.rows[0].count) } });
}));

// ─── POST /api/notifications ──────────────────────────────────────────────────
router.post('/',
  authenticate,
  [
    body('title').notEmpty().withMessage('عنوان التنبيه مطلوب'),
    body('message').notEmpty().withMessage('رسالة التنبيه مطلوبة'),
    body('user_id').notEmpty().withMessage('المستخدم مطلوب'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { title, message, user_id, type, link } = req.body;

    const result = await query(`
      INSERT INTO notifications (title, message, user_id, type, link, is_read)
      VALUES ($1, $2, $3, $4, $5, false)
      RETURNING *
    `, [title, message, user_id, type || 'info', link]);

    res.status(201).json({ success: true, message: 'تم إنشاء التنبيه بنجاح', data: result.rows[0] });
  })
);

// ─── PUT /api/notifications/:id/read ─────────────────────────────────────────
router.put('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const exists = await query('SELECT id, user_id FROM notifications WHERE id = $1', [id]);
  if (exists.rows.length === 0) throw new AppError('التنبيه غير موجود', 404);
  if (exists.rows[0].user_id !== req.user.id) throw new AppError('غير مصرح', 403);

  await query(`
    UPDATE notifications SET is_read = true, updated_at = NOW() WHERE id = $1
  `, [id]);

  res.json({ success: true, message: 'تم تحديد التنبيه كمقروء' });
}));

// ─── PUT /api/notifications/read-all ─────────────────────────────────────────
router.put('/read-all', authenticate, asyncHandler(async (req, res) => {
  await query(`
    UPDATE notifications SET is_read = true, updated_at = NOW()
    WHERE user_id = $1 AND is_read = false
  `, [req.user.id]);

  res.json({ success: true, message: 'تم تحديد كل التنبيهات كمقروءة' });
}));

// ─── DELETE /api/notifications/:id ───────────────────────────────────────────
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const exists = await query('SELECT id, user_id FROM notifications WHERE id = $1', [id]);
  if (exists.rows.length === 0) throw new AppError('التنبيه غير موجود', 404);
  if (exists.rows[0].user_id !== req.user.id) throw new AppError('غير مصرح', 403);

  await query('DELETE FROM notifications WHERE id = $1', [id]);

  res.json({ success: true, message: 'تم حذف التنبيه بنجاح' });
}));

// ─── DELETE /api/notifications/clear-read ─────────────────────────────────────
router.delete('/clear-read', authenticate, asyncHandler(async (req, res) => {
  const result = await query(`
    DELETE FROM notifications WHERE user_id = $1 AND is_read = true
  `, [req.user.id]);

  res.json({ 
    success: true, 
    message: 'تم حذف كل التنبيهات المقروءة بنجاح',
    deleted_count: result.rowCount 
  });
}));

module.exports = router;