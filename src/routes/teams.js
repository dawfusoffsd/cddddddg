const express = require('express');
const { body } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/teams ───────────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { include_deleted = false } = req.query;
  
  let whereClause = include_deleted ? '' : 'WHERE t.deleted_at IS NULL';
  
  const result = await query(`
    SELECT t.*, COUNT(e.id) AS employee_count
    FROM teams t
    LEFT JOIN employees e ON t.id = e.team_id AND e.status = 'active' AND e.deleted_at IS NULL
    ${whereClause}
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `);
  res.json({ success: true, data: result.rows });
}));

// ─── GET /api/teams/:id ───────────────────────────────────────────────────────
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT t.*, COUNT(e.id) AS employee_count
    FROM teams t
    LEFT JOIN employees e ON t.id = e.team_id AND e.status = 'active' AND e.deleted_at IS NULL
    WHERE t.id = $1
    GROUP BY t.id
  `, [id]);

  if (result.rows.length === 0) throw new AppError('الفريق غير موجود', 404);

  const employees = await query(`
    SELECT id, name, department, position FROM employees WHERE team_id = $1 AND status = 'active' AND deleted_at IS NULL
  `, [id]);

  res.json({ success: true, data: { ...result.rows[0], employees: employees.rows } });
}));

// ─── POST /api/teams ──────────────────────────────────────────────────────────
router.post('/',
  authenticate,
  requireAdmin,
  [
    body('name').notEmpty().withMessage('اسم الفريق مطلوب'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, manager, team_leader, description, branch_id } = req.body;

    const result = await transaction(async (client) => {
      const teamResult = await client.query(`
        INSERT INTO teams (name, manager, team_leader, description, branch_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [name, manager, team_leader, description, branch_id]);

      const team = teamResult.rows[0];

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['CREATE_TEAM', req.user.email, 'teams', team.id, JSON.stringify({ name, manager })]);

      return team;
    });

    res.status(201).json({ success: true, message: 'تم إضافة الفريق بنجاح', data: result });
  })
);

// ─── PUT /api/teams/:id ───────────────────────────────────────────────────────
router.put('/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const exists = await query('SELECT id FROM teams WHERE id = $1', [id]);
    if (exists.rows.length === 0) throw new AppError('الفريق غير موجود', 404);

    const { name, manager, team_leader, description, branch_id } = req.body;

    const result = await transaction(async (client) => {
      const teamResult = await client.query(`
        UPDATE teams SET
          name = COALESCE($1, name),
          manager = COALESCE($2, manager),
          team_leader = COALESCE($3, team_leader),
          description = COALESCE($4, description),
          branch_id = COALESCE($5, branch_id),
          updated_at = NOW()
        WHERE id = $6
        RETURNING *
      `, [name, manager, team_leader, description, branch_id, id]);

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['UPDATE_TEAM', req.user.email, 'teams', id, JSON.stringify(req.body)]);

      return teamResult.rows[0];
    });

    res.json({ success: true, message: 'تم تحديث الفريق بنجاح', data: result });
  })
);

// ─── DELETE /api/teams/:id ────────────────────────────────────────────────────
// Soft delete
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id, name FROM teams WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('الفريق غير موجود', 404);

  const hasEmployees = await query('SELECT id FROM employees WHERE team_id = $1 AND status = $2 AND deleted_at IS NULL LIMIT 1', [id, 'active']);
  if (hasEmployees.rows.length > 0) throw new AppError('لا يمكن حذف فريق يحتوي على موظفين نشطين', 400);

  await transaction(async (client) => {
    await client.query('UPDATE teams SET deleted_at = NOW() WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['DELETE_TEAM', req.user.email, 'teams', id, JSON.stringify({ name: exists.rows[0].name })]);
  });

  res.json({ success: true, message: 'تم حذف الفريق بنجاح' });
}));

// ─── POST /api/teams/:id/restore ──────────────────────────────────────────────
router.post('/:id/restore', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id, name FROM teams WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('الفريق غير موجود أو لم يكن محذوفاً', 404);

  await transaction(async (client) => {
    await client.query('UPDATE teams SET deleted_at = NULL WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['RESTORE_TEAM', req.user.email, 'teams', id, JSON.stringify({ name: exists.rows[0].name })]);
  });

  res.json({ success: true, message: 'تم استعادة الفريق بنجاح' });
}));

module.exports = router;