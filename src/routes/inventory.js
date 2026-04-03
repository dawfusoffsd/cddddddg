const express = require('express');
const { body, query: queryValidator } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, requireAdminOrManager } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/inventory ───────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { category_id, status, search, page = 1, limit = 50, include_deleted = false } = req.query;
  const offset = (page - 1) * limit;

  let conditions = [];
  let values = [];
  let paramCount = 1;

  // Filter out deleted items unless include_deleted is true
  if (!include_deleted) {
    conditions.push(`i.deleted_at IS NULL`);
  }

  if (category_id) { conditions.push(`i.category_id = $${paramCount++}`); values.push(category_id); }
  if (status) { conditions.push(`i.status = $${paramCount++}`); values.push(status); }
  if (search) {
    conditions.push(`(i.name ILIKE $${paramCount} OR i.brand ILIKE $${paramCount + 1} OR i.model ILIKE $${paramCount + 2} OR i.serial_number ILIKE $${paramCount + 3})`);
    values.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    paramCount += 4;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(`
    SELECT 
      i.*,
      c.name AS category_name,
      c.icon AS category_icon,
      c.color AS category_color
    FROM inventory_items i
    LEFT JOIN categories c ON i.category_id = c.id
    ${whereClause}
    ORDER BY i.created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `, [...values, limit, offset]);

  const countResult = await query(`
    SELECT COUNT(*) FROM inventory_items i ${whereClause}
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

// ─── GET /api/inventory/:id ───────────────────────────────────────────────────
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT 
      i.*,
      c.name AS category_name,
      c.icon AS category_icon,
      c.color AS category_color
    FROM inventory_items i
    LEFT JOIN categories c ON i.category_id = c.id
    WHERE i.id = $1
  `, [id]);

  if (result.rows.length === 0) throw new AppError('العنصر غير موجود', 404);
  res.json({ success: true, data: result.rows[0] });
}));

// ─── POST /api/inventory ──────────────────────────────────────────────────────
router.post('/',
  authenticate,
  [
    body('name').notEmpty().withMessage('اسم العنصر مطلوب'),
    body('category_id').notEmpty().withMessage('التصنيف مطلوب'),
    body('quantity').isInt({ min: 0 }).withMessage('الكمية يجب أن تكون رقم صحيح'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, brand, model, category_id, serial_number, quantity = 0, min_quantity, status, notes, location, purchase_date, purchase_price } = req.body;

    const result = await transaction(async (client) => {
      const itemResult = await client.query(`
        INSERT INTO inventory_items 
          (name, brand, model, category_id, serial_number, quantity, min_quantity, status, notes, location, purchase_date, purchase_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [name, brand, model, category_id, serial_number, quantity, min_quantity || 0, status || 'available', notes, location, purchase_date, purchase_price]);

      const item = itemResult.rows[0];

      if (quantity > 0) {
        await client.query(`
          INSERT INTO transactions (type, item_id, quantity, user_id, notes)
          VALUES ('in', $1, $2, $3, 'إضافة مخزون جديد')
        `, [item.id, quantity, req.user.id]);
      }

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['CREATE_INVENTORY_ITEM', req.user.email, 'inventory_items', item.id, JSON.stringify({ name, quantity })]);

      return item;
    });

    res.status(201).json({ success: true, message: 'تم إضافة العنصر بنجاح', data: result });
  })
);

// ─── PUT /api/inventory/:id ───────────────────────────────────────────────────
router.put('/:id',
  authenticate,
  [
    body('name').optional().notEmpty().withMessage('اسم العنصر لا يمكن أن يكون فارغاً'),
    body('quantity').optional().isInt({ min: 0 }).withMessage('الكمية يجب أن تكون رقم صحيح'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const exists = await query('SELECT id, quantity FROM inventory_items WHERE id = $1', [id]);
    if (exists.rows.length === 0) throw new AppError('العنصر غير موجود', 404);

    const { name, brand, model, category_id, serial_number, quantity, min_quantity, status, notes, location, purchase_date, purchase_price } = req.body;
    const oldQuantity = exists.rows[0].quantity;

    const result = await transaction(async (client) => {
      const itemResult = await client.query(`
        UPDATE inventory_items SET
          name = COALESCE($1, name),
          brand = COALESCE($2, brand),
          model = COALESCE($3, model),
          category_id = COALESCE($4, category_id),
          serial_number = COALESCE($5, serial_number),
          quantity = COALESCE($6, quantity),
          min_quantity = COALESCE($7, min_quantity),
          status = COALESCE($8, status),
          notes = COALESCE($9, notes),
          location = COALESCE($10, location),
          purchase_date = COALESCE($11, purchase_date),
          purchase_price = COALESCE($12, purchase_price),
          updated_at = NOW()
        WHERE id = $13
        RETURNING *
      `, [name, brand, model, category_id, serial_number, quantity, min_quantity, status, notes, location, purchase_date, purchase_price, id]);

      const item = itemResult.rows[0];

      if (quantity !== undefined && quantity !== oldQuantity) {
        const diff = quantity - oldQuantity;
        await client.query(`
          INSERT INTO transactions (type, item_id, quantity, user_id, notes)
          VALUES ($1, $2, $3, $4, $5)
        `, [diff > 0 ? 'in' : 'out', id, Math.abs(diff), req.user.id, 'تعديل المخزون']);
      }

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['UPDATE_INVENTORY_ITEM', req.user.email, 'inventory_items', id, JSON.stringify(req.body)]);

      return item;
    });

    res.json({ success: true, message: 'تم تحديث العنصر بنجاح', data: result });
  })
);

// ─── DELETE /api/inventory/:id ────────────────────────────────────────────────
// Soft delete instead of hard delete
router.delete('/:id', authenticate, requireAdminOrManager, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const exists = await query('SELECT id, name FROM inventory_items WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('العنصر غير موجود', 404);

  const assigned = await query(`
    SELECT id FROM assignments WHERE item_id = $1 AND status = 'active' LIMIT 1
  `, [id]);
  if (assigned.rows.length > 0) throw new AppError('لا يمكن حذف عنصر مخصص لموظف', 400);

  await transaction(async (client) => {
    // Soft delete: set deleted_at instead of deleting
    await client.query('UPDATE inventory_items SET deleted_at = NOW() WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['DELETE_INVENTORY_ITEM', req.user.email, 'inventory_items', id, JSON.stringify({ name: exists.rows[0].name })]);
  });

  res.json({ success: true, message: 'تم حذف العنصر بنجاح' });
}));

// ─── POST /api/inventory/:id/restore ──────────────────────────────────────────
// Restore a soft-deleted item
router.post('/:id/restore', authenticate, requireAdminOrManager, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const exists = await query('SELECT id, name FROM inventory_items WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('العنصر غير موجود أو لم يكن محذوفاً', 404);

  await transaction(async (client) => {
    // Restore: set deleted_at to NULL
    await client.query('UPDATE inventory_items SET deleted_at = NULL WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['RESTORE_INVENTORY_ITEM', req.user.email, 'inventory_items', id, JSON.stringify({ name: exists.rows[0].name })]);
  });

  res.json({ success: true, message: 'تم استعادة العنصر بنجاح' });
}));

module.exports = router;
