const express = require('express');
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/transactions ────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { type, item_id, employee_id, from_date, to_date, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let conditions = [];
  let values = [];
  let paramCount = 1;

  if (type) { conditions.push(`t.type = $${paramCount++}`); values.push(type); }
  if (item_id) { conditions.push(`t.item_id = $${paramCount++}`); values.push(item_id); }
  if (employee_id) { conditions.push(`t.employee_id = $${paramCount++}`); values.push(employee_id); }
  if (from_date) { conditions.push(`t.created_at >= $${paramCount++}`); values.push(from_date); }
  if (to_date) { conditions.push(`t.created_at <= $${paramCount++}`); values.push(to_date); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`
    SELECT 
      t.*,
      i.name AS item_name,
      i.brand,
      i.model,
      e.name AS employee_name,
      u.name AS user_name
    FROM transactions t
    LEFT JOIN inventory_items i ON t.item_id = i.id AND i.deleted_at IS NULL
    LEFT JOIN employees e ON t.employee_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN users u ON t.user_id = u.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `, [...values, limit, offset]);

  const countResult = await query(`SELECT COUNT(*) FROM transactions t ${whereClause}`, values);

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

// ─── GET /api/transactions/stats ──────────────────────────────────────────────
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const { from_date, to_date } = req.query;

  let conditions = [];
  let values = [];
  let paramCount = 1;

  if (from_date) { conditions.push(`created_at >= $${paramCount++}`); values.push(from_date); }
  if (to_date) { conditions.push(`created_at <= $${paramCount++}`); values.push(to_date); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const stats = await query(`
    SELECT 
      type,
      COUNT(*) AS count,
      SUM(quantity) AS total_quantity
    FROM transactions
    ${whereClause}
    GROUP BY type
  `, values);

  const daily = await query(`
    SELECT 
      DATE(created_at) AS date,
      type,
      COUNT(*) AS count
    FROM transactions
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at), type
    ORDER BY date DESC
  `);

  res.json({ success: true, data: { summary: stats.rows, daily: daily.rows } });
}));

// ─── GET /api/transactions/:id ────────────────────────────────────────────────
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT 
      t.*,
      i.name AS item_name,
      i.brand,
      i.model,
      i.serial_number,
      e.name AS employee_name,
      e.department AS employee_department,
      u.name AS user_name
    FROM transactions t
    LEFT JOIN inventory_items i ON t.item_id = i.id AND i.deleted_at IS NULL
    LEFT JOIN employees e ON t.employee_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN users u ON t.user_id = u.id
    WHERE t.id = $1
  `, [id]);

  if (result.rows.length === 0) throw new AppError('المعاملة غير موجودة', 404);
  res.json({ success: true, data: result.rows[0] });
}));

module.exports = router;