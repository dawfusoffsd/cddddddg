const express = require('express');
const { body } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, requireAdminOrManager } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/assignments ─────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { employee_id, status, item_id, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let conditions = [];
  let values = [];
  let paramCount = 1;

  if (employee_id) { conditions.push(`a.employee_id = $${paramCount++}`); values.push(employee_id); }
  if (status) { conditions.push(`a.status = $${paramCount++}`); values.push(status); }
  if (item_id) { conditions.push(`a.item_id = $${paramCount++}`); values.push(item_id); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`
    SELECT 
      a.*,
      e.name AS employee_name,
      e.national_id,
      e.department,
      i.name AS item_name,
      i.brand,
      i.model,
      i.serial_number,
      c.name AS category_name
    FROM assignments a
    LEFT JOIN employees e ON a.employee_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN inventory_items i ON a.item_id = i.id AND i.deleted_at IS NULL
    LEFT JOIN categories c ON i.category_id = c.id AND c.deleted_at IS NULL
    ${whereClause}
    ORDER BY a.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `, [...values, limit, offset]);

  const countResult = await query(`
    SELECT COUNT(*) FROM assignments a ${whereClause}
  `, values);

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

// ─── GET /api/assignments/:id ─────────────────────────────────────────────────
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT 
      a.*,
      e.name AS employee_name,
      e.national_id,
      e.department,
      e.phone AS employee_phone,
      i.name AS item_name,
      i.brand,
      i.model,
      i.serial_number,
      c.name AS category_name,
      c.icon AS category_icon
    FROM assignments a
    LEFT JOIN employees e ON a.employee_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN inventory_items i ON a.item_id = i.id AND i.deleted_at IS NULL
    LEFT JOIN categories c ON i.category_id = c.id AND c.deleted_at IS NULL
    WHERE a.id = $1
  `, [id]);

  if (result.rows.length === 0) throw new AppError('العهدة غير موجودة', 404);
  res.json({ success: true, data: result.rows[0] });
}));

// ─── POST /api/assignments ────────────────────────────────────────────────────
router.post('/',
  authenticate,
  [
    body('employee_id').notEmpty().withMessage('الموظف مطلوب'),
    body('item_id').notEmpty().withMessage('العنصر مطلوب'),
    body('quantity').isInt({ min: 1 }).withMessage('الكمية يجب أن تكون أكبر من صفر'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { employee_id, item_id, quantity, notes, expected_return_date } = req.body;

    const item = await query('SELECT id, name, quantity FROM inventory_items WHERE id = $1', [item_id]);
    if (item.rows.length === 0) throw new AppError('العنصر غير موجود', 404);
    if (item.rows[0].quantity < quantity) throw new AppError('الكمية المطلوبة غير متوفرة في المخزون', 400);

    const employee = await query('SELECT id, name FROM employees WHERE id = $1', [employee_id]);
    if (employee.rows.length === 0) throw new AppError('الموظف غير موجود', 404);

    const result = await transaction(async (client) => {
      const assignResult = await client.query(`
        INSERT INTO assignments (employee_id, item_id, quantity, notes, expected_return_date, status, assigned_by)
        VALUES ($1, $2, $3, $4, $5, 'active', $6)
        RETURNING *
      `, [employee_id, item_id, quantity, notes, expected_return_date, req.user.id]);

      const assignment = assignResult.rows[0];

      await client.query(`
        UPDATE inventory_items 
        SET quantity = quantity - $1, updated_at = NOW()
        WHERE id = $2
      `, [quantity, item_id]);

      await client.query(`
        INSERT INTO transactions (type, item_id, employee_id, quantity, assignment_id, user_id, notes)
        VALUES ('assign', $1, $2, $3, $4, $5, $6)
      `, [item_id, employee_id, quantity, assignment.id, req.user.id, `تسليم عهدة للموظف: ${employee.rows[0].name}`]);

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['CREATE_ASSIGNMENT', req.user.email, 'assignments', assignment.id,
        JSON.stringify({ employee_name: employee.rows[0].name, item_name: item.rows[0].name, quantity })]);

      return assignment;
    });

    res.status(201).json({ success: true, message: 'تم إنشاء العهدة بنجاح', data: result });
  })
);

// ─── PUT /api/assignments/:id/return ─────────────────────────────────────────
router.put('/:id/return',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;

    const assignment = await query(`
      SELECT a.*, i.name AS item_name, e.name AS employee_name
      FROM assignments a
      LEFT JOIN inventory_items i ON a.item_id = i.id
      LEFT JOIN employees e ON a.employee_id = e.id
      WHERE a.id = $1
    `, [id]);

    if (assignment.rows.length === 0) throw new AppError('العهدة غير موجودة', 404);
    if (assignment.rows[0].status !== 'active') throw new AppError('العهدة غير نشطة', 400);

    const { item_id, employee_id, quantity } = assignment.rows[0];

    await transaction(async (client) => {
      await client.query(`
        UPDATE assignments 
        SET status = 'returned', return_date = NOW(), return_notes = $1, updated_at = NOW()
        WHERE id = $2
      `, [notes, id]);

      await client.query(`
        UPDATE inventory_items 
        SET quantity = quantity + $1, updated_at = NOW()
        WHERE id = $2
      `, [quantity, item_id]);

      await client.query(`
        INSERT INTO transactions (type, item_id, employee_id, quantity, assignment_id, user_id, notes)
        VALUES ('return', $1, $2, $3, $4, $5, $6)
      `, [item_id, employee_id, quantity, id, req.user.id, `إرجاع عهدة من الموظف: ${assignment.rows[0].employee_name}`]);

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['RETURN_ASSIGNMENT', req.user.email, 'assignments', id,
        JSON.stringify({ item_name: assignment.rows[0].item_name, employee_name: assignment.rows[0].employee_name })]);
    });

    res.json({ success: true, message: 'تم إرجاع العهدة بنجاح' });
  })
);

// ─── PUT /api/assignments/:id/extend ─────────────────────────────────────────
router.put('/:id/extend',
  authenticate,
  [
    body('expected_return_date').notEmpty().withMessage('تاريخ الإرجاع المتوقع مطلوب'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { expected_return_date, notes } = req.body;

    const assignment = await query('SELECT id, status FROM assignments WHERE id = $1', [id]);
    if (assignment.rows.length === 0) throw new AppError('العهدة غير موجودة', 404);
    if (assignment.rows[0].status !== 'active') throw new AppError('العهدة غير نشطة', 400);

    await query(`
      UPDATE assignments 
      SET expected_return_date = $1, notes = COALESCE($2, notes), updated_at = NOW()
      WHERE id = $3
    `, [expected_return_date, notes, id]);

    res.json({ success: true, message: 'تم تمديد العهدة بنجاح' });
  })
);

module.exports = router;