const express = require('express');
const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/audit-logs ──────────────────────────────────────────────────────
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { action, user_email, entity_type, from_date, to_date, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let conditions = [];
  let values = [];
  let paramCount = 1;

  if (action) { conditions.push(`al.action ILIKE $${paramCount++}`); values.push(`%${action}%`); }
  if (user_email) { conditions.push(`al.user_email ILIKE $${paramCount++}`); values.push(`%${user_email}%`); }
  if (entity_type) { conditions.push(`al.entity_type = $${paramCount++}`); values.push(entity_type); }
  if (from_date) { conditions.push(`al.created_at >= $${paramCount++}`); values.push(from_date); }
  if (to_date) { conditions.push(`al.created_at <= $${paramCount++}`); values.push(to_date); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`
    SELECT al.*
    FROM audit_logs al
    ${whereClause}
    ORDER BY al.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `, [...values, limit, offset]);

  const countResult = await query(`SELECT COUNT(*) FROM audit_logs al ${whereClause}`, values);

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

// ─── GET /api/audit-logs/:id ──────────────────────────────────────────────────
router.get('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query('SELECT * FROM audit_logs WHERE id = $1', [id]);

  if (result.rows.length === 0) throw new AppError('السجل غير موجود', 404);
  res.json({ success: true, data: result.rows[0] });
}));

module.exports = router;
