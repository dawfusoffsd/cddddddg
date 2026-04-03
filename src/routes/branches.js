const express = require('express');
const { body } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/branches ────────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { include_deleted = false } = req.query;
  
  let whereClause = include_deleted ? '' : 'WHERE b.deleted_at IS NULL';
  
  const result = await query(`
    SELECT b.*, COUNT(e.id) AS employee_count
    FROM branches b
    LEFT JOIN employees e ON b.id = e.branch_id AND e.status = 'active' AND e.deleted_at IS NULL
    ${whereClause}
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `);
  res.json({ success: true, data: result.rows });
}));

// ─── GET /api/branches/:id ────────────────────────────────────────────────────
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT b.*, COUNT(e.id) AS employee_count
    FROM branches b
    LEFT JOIN employees e ON b.id = e.branch_id AND e.status = 'active' AND e.deleted_at IS NULL
    WHERE b.id = $1
    GROUP BY b.id
  `, [id]);

  if (result.rows.length === 0) throw new AppError('الفرع غير موجود', 404);

  const employees = await query(`
    SELECT id, name, department, position FROM employees WHERE branch_id = $1 AND status = 'active' AND deleted_at IS NULL
  `, [id]);

  res.json({ success: true, data: { ...result.rows[0], employees: employees.rows } });
}));

// ─── POST /api/branches ───────────────────────────────────────────────────────
router.post('/',
  authenticate,
  requireAdmin,
  [
    body('name').notEmpty().withMessage('اسم الفرع مطلوب'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, location, phone, manager, email, notes } = req.body;

    const result = await transaction(async (client) => {
      const branchResult = await client.query(`
        INSERT INTO branches (name, location, phone, manager, email, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [name, location, phone, manager, email, notes]);

      const branch = branchResult.rows[0];

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['CREATE_BRANCH', req.user.email, 'branches', branch.id, JSON.stringify({ name, location })]);

      return branch;
    });

    res.status(201).json({ success: true, message: 'تم إضافة الفرع بنجاح', data: result });
  })
);

// ─── PUT /api/branches/:id ────────────────────────────────────────────────────
router.put('/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const exists = await query('SELECT id FROM branches WHERE id = $1', [id]);
    if (exists.rows.length === 0) throw new AppError('الفرع غير موجود', 404);

    const { name, location, phone, manager, email, notes } = req.body;

    const result = await transaction(async (client) => {
      const branchResult = await client.query(`
        UPDATE branches SET
          name = COALESCE($1, name),
          location = COALESCE($2, location),
          phone = COALESCE($3, phone),
          manager = COALESCE($4, manager),
          email = COALESCE($5, email),
          notes = COALESCE($6, notes),
          updated_at = NOW()
        WHERE id = $7
        RETURNING *
      `, [name, location, phone, manager, email, notes, id]);

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['UPDATE_BRANCH', req.user.email, 'branches', id, JSON.stringify(req.body)]);

      return branchResult.rows[0];
    });

    res.json({ success: true, message: 'تم تحديث الفرع بنجاح', data: result });
  })
);

// ─── DELETE /api/branches/:id ─────────────────────────────────────────────────
// Soft delete
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id, name FROM branches WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('الفرع غير موجود', 404);

  const hasEmployees = await query('SELECT id FROM employees WHERE branch_id = $1 AND status = $2 AND deleted_at IS NULL LIMIT 1', [id, 'active']);
  if (hasEmployees.rows.length > 0) throw new AppError('لا يمكن حذف فرع يحتوي على موظفين نشطين', 400);

  await transaction(async (client) => {
    await client.query('UPDATE branches SET deleted_at = NOW() WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['DELETE_BRANCH', req.user.email, 'branches', id, JSON.stringify({ name: exists.rows[0].name })]);
  });

  res.json({ success: true, message: 'تم حذف الفرع بنجاح' });
}));

// ─── POST /api/branches/:id/restore ───────────────────────────────────────────
router.post('/:id/restore', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id, name FROM branches WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('الفرع غير موجود أو لم يكن محذوفاً', 404);

  await transaction(async (client) => {
    await client.query('UPDATE branches SET deleted_at = NULL WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['RESTORE_BRANCH', req.user.email, 'branches', id, JSON.stringify({ name: exists.rows[0].name })]);
  });

  res.json({ success: true, message: 'تم استعادة الفرع بنجاح' });
}));

module.exports = router;