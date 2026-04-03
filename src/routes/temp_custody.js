const express = require('express');
const { body } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/temp-custody ────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { status, employee_id, overdue, page = 1, limit = 50, include_deleted = false } = req.query;
  const offset = (page - 1) * limit;

  let conditions = [];
  let values = [];
  let paramCount = 1;

  if (!req.query.include_deleted) {
    conditions.push(`tc.deleted_at IS NULL`);
  }

  if (status) { conditions.push(`tc.returned = $${paramCount++}`); values.push(status === 'returned'); }
  if (employee_id) { conditions.push(`tc.employee_id = $${paramCount++}`); values.push(employee_id); }
  if (overdue === 'true') { conditions.push(`tc.due_date < NOW() AND tc.returned = false`); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`
    SELECT 
      tc.*,
      e.name AS employee_name,
      e.department AS employee_department,
      a.item_id,
      i.name AS item_name,
      i.brand,
      i.model
    FROM temp_custody tc
    LEFT JOIN employees e ON tc.employee_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN assignments a ON tc.assignment_id = a.id AND a.deleted_at IS NULL
    LEFT JOIN inventory_items i ON a.item_id = i.id AND i.deleted_at IS NULL
    ${whereClause}
    ORDER BY tc.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `, [...values, limit, offset]);

  const countResult = await query(`SELECT COUNT(*) FROM temp_custody tc ${whereClause}`, values);

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

// ─── GET /api/temp-custody/:id ────────────────────────────────────────────────
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT 
      tc.*,
      e.name AS employee_name,
      e.department AS employee_department,
      e.phone AS employee_phone,
      a.item_id,
      i.name AS item_name,
      i.brand,
      i.model,
      i.serial_number
    FROM temp_custody tc
    LEFT JOIN employees e ON tc.employee_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN assignments a ON tc.assignment_id = a.id AND a.deleted_at IS NULL
    LEFT JOIN inventory_items i ON a.item_id = i.id AND i.deleted_at IS NULL
    WHERE tc.id = $1
  `, [id]);

  if (result.rows.length === 0) throw new AppError('العهدة المؤقتة غير موجودة', 404);
  res.json({ success: true, data: result.rows[0] });
}));

// ─── POST /api/temp-custody ───────────────────────────────────────────────────
router.post('/',
  authenticate,
  [
    body('assignment_id').notEmpty().withMessage('العهدة مطلوبة'),
    body('employee_id').notEmpty().withMessage('الموظف مطلوب'),
    body('due_date').notEmpty().withMessage('تاريخ الإرجاع مطلوب'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { assignment_id, employee_id, due_date, notes } = req.body;

    const assignment = await query('SELECT id FROM assignments WHERE id = $1 AND status = $2', [assignment_id, 'active']);
    if (assignment.rows.length === 0) throw new AppError('العهدة غير موجودة أو غير نشطة', 404);

    const result = await transaction(async (client) => {
      const custodyResult = await client.query(`
        INSERT INTO temp_custody (assignment_id, employee_id, due_date, notes, returned)
        VALUES ($1, $2, $3, $4, false)
        RETURNING *
      `, [assignment_id, employee_id, due_date, notes]);

      const custody = custodyResult.rows[0];

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['CREATE_TEMP_CUSTODY', req.user.email, 'temp_custody', custody.id, JSON.stringify({ assignment_id, employee_id, due_date })]);

      return custody;
    });

    res.status(201).json({ success: true, message: 'تم إنشاء العهدة المؤقتة بنجاح', data: result });
  })
);

// ─── PUT /api/temp-custody/:id/return ────────────────────────────────────────
router.put('/:id/return', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  const custody = await query('SELECT id, returned FROM temp_custody WHERE id = $1', [id]);
  if (custody.rows.length === 0) throw new AppError('العهدة المؤقتة غير موجودة', 404);
  if (custody.rows[0].returned) throw new AppError('تم إرجاع العهدة بالفعل', 400);

  await transaction(async (client) => {
    await client.query(`
      UPDATE temp_custody 
      SET returned = true, return_date = NOW(), notes = COALESCE($1, notes), updated_at = NOW()
      WHERE id = $2
    `, [notes, id]);

    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['RETURN_TEMP_CUSTODY', req.user.email, 'temp_custody', id, JSON.stringify({ returned: true })]);
  });

  res.json({ success: true, message: 'تم إرجاع العهدة المؤقتة بنجاح' });
}));

// ─── PUT /api/temp-custody/:id/extend ────────────────────────────────────────
router.put('/:id/extend',
  authenticate,
  [
    body('due_date').notEmpty().withMessage('تاريخ الإرجاع الجديد مطلوب'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { due_date, notes } = req.body;

    const custody = await query('SELECT id, returned FROM temp_custody WHERE id = $1', [id]);
    if (custody.rows.length === 0) throw new AppError('العهدة المؤقتة غير موجودة', 404);
    if (custody.rows[0].returned) throw new AppError('لا يمكن تمديد عهدة تم إرجاعها', 400);

    await query(`
      UPDATE temp_custody 
      SET due_date = $1, extended_date = $1, notes = COALESCE($2, notes), updated_at = NOW()
      WHERE id = $3
    `, [due_date, notes, id]);

    res.json({ success: true, message: 'تم تمديد العهدة المؤقتة بنجاح' });
  })
);

// ─── DELETE /api/temp-custody/:id ────────────────────────────────────────────
// Soft delete
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id FROM temp_custody WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('العهدة المؤقتة غير موجودة', 404);

  await transaction(async (client) => {
    await client.query('UPDATE temp_custody SET deleted_at = NOW() WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['DELETE_TEMP_CUSTODY', req.user.email, 'temp_custody', id, JSON.stringify({ deleted: true })]);
  });

  res.json({ success: true, message: 'تم حذف العهدة المؤقتة بنجاح' });
}));

// ─── POST /api/temp-custody/:id/restore ────────────────────────────────────────
router.post('/:id/restore', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id FROM temp_custody WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('العهدة المؤقتة غير موجودة أو لم تكن محذوفة', 404);

  await transaction(async (client) => {
    await client.query('UPDATE temp_custody SET deleted_at = NULL WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['RESTORE_TEMP_CUSTODY', req.user.email, 'temp_custody', id, JSON.stringify({ restored: true })]);
  });

  res.json({ success: true, message: 'تم استعادة العهدة المؤقتة بنجاح' });
}));

module.exports = router;