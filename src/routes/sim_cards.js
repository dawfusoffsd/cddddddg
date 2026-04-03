const express = require('express');
const { body } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/sim-cards ───────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { status, operator, employee_id, page = 1, limit = 50, include_deleted = false } = req.query;
  const offset = (page - 1) * limit;

  let conditions = [];
  let values = [];
  let paramCount = 1;

  // Filter deleted sim cards unless include_deleted is true
  if (!include_deleted) {
    conditions.push(`s.deleted_at IS NULL`);
  }

  if (status) { conditions.push(`s.status = $${paramCount++}`); values.push(status); }
  if (operator) { conditions.push(`s.operator = $${paramCount++}`); values.push(operator); }
  if (employee_id) { conditions.push(`s.employee_id = $${paramCount++}`); values.push(employee_id); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`
    SELECT 
      s.*,
      e.name AS employee_name,
      e.department AS employee_department
    FROM sim_cards s
    LEFT JOIN employees e ON s.employee_id = e.id AND e.deleted_at IS NULL
    ${whereClause}
    ORDER BY s.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `, [...values, limit, offset]);

  const countResult = await query(`SELECT COUNT(*) FROM sim_cards s ${whereClause}`, values);

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

// ─── GET /api/sim-cards/:id ───────────────────────────────────────────────────
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT s.*, e.name AS employee_name, e.department AS employee_department
    FROM sim_cards s
    LEFT JOIN employees e ON s.employee_id = e.id
    WHERE s.id = $1
  `, [id]);

  if (result.rows.length === 0) throw new AppError('الخط غير موجود', 404);
  res.json({ success: true, data: result.rows[0] });
}));

// ─── POST /api/sim-cards ──────────────────────────────────────────────────────
router.post('/',
  authenticate,
  [
    body('sim_number').notEmpty().withMessage('رقم الخط مطلوب'),
    body('operator').notEmpty().withMessage('شركة التشغيل مطلوبة'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { sim_number, operator, employee_id, status, plan, monthly_cost, notes, activation_date } = req.body;

    const exists = await query('SELECT id FROM sim_cards WHERE sim_number = $1', [sim_number]);
    if (exists.rows.length > 0) throw new AppError('رقم الخط موجود بالفعل', 400);

    const result = await transaction(async (client) => {
      const simResult = await client.query(`
        INSERT INTO sim_cards (sim_number, operator, employee_id, status, plan, monthly_cost, notes, activation_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [sim_number, operator, employee_id, status || 'active', plan, monthly_cost, notes, activation_date]);

      const sim = simResult.rows[0];

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['CREATE_SIM_CARD', req.user.email, 'sim_cards', sim.id, JSON.stringify({ sim_number, operator })]);

      return sim;
    });

    res.status(201).json({ success: true, message: 'تم إضافة الخط بنجاح', data: result });
  })
);

// ─── PUT /api/sim-cards/:id ───────────────────────────────────────────────────
router.put('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const exists = await query('SELECT id FROM sim_cards WHERE id = $1', [id]);
    if (exists.rows.length === 0) throw new AppError('الخط غير موجود', 404);

    const { sim_number, operator, employee_id, status, plan, monthly_cost, notes, activation_date } = req.body;

    const result = await transaction(async (client) => {
      const simResult = await client.query(`
        UPDATE sim_cards SET
          sim_number = COALESCE($1, sim_number),
          operator = COALESCE($2, operator),
          employee_id = $3,
          status = COALESCE($4, status),
          plan = COALESCE($5, plan),
          monthly_cost = COALESCE($6, monthly_cost),
          notes = COALESCE($7, notes),
          activation_date = COALESCE($8, activation_date),
          updated_at = NOW()
        WHERE id = $9
        RETURNING *
      `, [sim_number, operator, employee_id, status, plan, monthly_cost, notes, activation_date, id]);

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['UPDATE_SIM_CARD', req.user.email, 'sim_cards', id, JSON.stringify(req.body)]);

      return simResult.rows[0];
    });

    res.json({ success: true, message: 'تم تحديث الخط بنجاح', data: result });
  })
);

// ─── DELETE /api/sim-cards/:id ────────────────────────────────────────────────
// Soft delete
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id, sim_number, status FROM sim_cards WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('الخط غير موجود', 404);
  if (exists.rows[0].status === 'assigned') throw new AppError('لا يمكن حذف خط مخصص لموظف', 400);

  await transaction(async (client) => {
    await client.query('UPDATE sim_cards SET deleted_at = NOW() WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['DELETE_SIM_CARD', req.user.email, 'sim_cards', id, JSON.stringify({ sim_number: exists.rows[0].sim_number })]);
  });

  res.json({ success: true, message: 'تم حذف الخط بنجاح' });
}));

// ─── POST /api/sim-cards/:id/restore ──────────────────────────────────────────
router.post('/:id/restore', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id, sim_number FROM sim_cards WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('الخط غير موجود أو لم يكن محذوفاً', 404);

  await transaction(async (client) => {
    await client.query('UPDATE sim_cards SET deleted_at = NULL WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['RESTORE_SIM_CARD', req.user.email, 'sim_cards', id, JSON.stringify({ sim_number: exists.rows[0].sim_number })]);
  });

  res.json({ success: true, message: 'تم استعادة الخط بنجاح' });
}));

module.exports = router;