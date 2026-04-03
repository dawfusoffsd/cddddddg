const express = require('express');
const { body } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// ─── GET /api/categories ──────────────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { include_deleted = false } = req.query;
  
  let whereClause = include_deleted ? '' : 'WHERE c.deleted_at IS NULL';
  
  const result = await query(`
    SELECT c.*, COUNT(i.id) AS item_count
    FROM categories c
    LEFT JOIN inventory_items i ON c.id = i.category_id AND i.deleted_at IS NULL
    ${whereClause}
    GROUP BY c.id
    ORDER BY c.name ASC
  `);
  res.json({ success: true, data: result.rows });
}));

// ─── GET /api/categories/:id ──────────────────────────────────────────────────
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT c.*, COUNT(i.id) AS item_count
    FROM categories c
    LEFT JOIN inventory_items i ON c.id = i.category_id AND i.deleted_at IS NULL
    WHERE c.id = $1
    GROUP BY c.id
  `, [id]);

  if (result.rows.length === 0) throw new AppError('التصنيف غير موجود', 404);

  const items = await query(`
    SELECT id, name, brand, model, quantity, status FROM inventory_items WHERE category_id = $1 AND deleted_at IS NULL
  `, [id]);

  res.json({ success: true, data: { ...result.rows[0], items: items.rows } });
}));

// ─── POST /api/categories ─────────────────────────────────────────────────────
router.post('/',
  authenticate,
  requireAdmin,
  [
    body('name').notEmpty().withMessage('اسم التصنيف مطلوب'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, icon, color, description } = req.body;

    const exists = await query('SELECT id FROM categories WHERE name = $1', [name]);
    if (exists.rows.length > 0) throw new AppError('التصنيف موجود بالفعل', 400);

    const result = await transaction(async (client) => {
      const catResult = await client.query(`
        INSERT INTO categories (name, icon, color, description)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [name, icon || '📦', color || '#6B7280', description]);

      const category = catResult.rows[0];

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['CREATE_CATEGORY', req.user.email, 'categories', category.id, JSON.stringify({ name })]);

      return category;
    });

    res.status(201).json({ success: true, message: 'تم إضافة التصنيف بنجاح', data: result });
  })
);

// ─── PUT /api/categories/:id ──────────────────────────────────────────────────
router.put('/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const exists = await query('SELECT id FROM categories WHERE id = $1', [id]);
    if (exists.rows.length === 0) throw new AppError('التصنيف غير موجود', 404);

    const { name, icon, color, description } = req.body;

    const result = await transaction(async (client) => {
      const catResult = await client.query(`
        UPDATE categories SET
          name = COALESCE($1, name),
          icon = COALESCE($2, icon),
          color = COALESCE($3, color),
          description = COALESCE($4, description),
          updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `, [name, icon, color, description, id]);

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['UPDATE_CATEGORY', req.user.email, 'categories', id, JSON.stringify(req.body)]);

      return catResult.rows[0];
    });

    res.json({ success: true, message: 'تم تحديث التصنيف بنجاح', data: result });
  })
);

// ─── DELETE /api/categories/:id ───────────────────────────────────────────────
// Soft delete
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id, name FROM categories WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('التصنيف غير موجود', 404);

  const hasItems = await query('SELECT id FROM inventory_items WHERE category_id = $1 AND deleted_at IS NULL LIMIT 1', [id]);
  if (hasItems.rows.length > 0) throw new AppError('لا يمكن حذف تصنيف يحتوي على عناصر مخزون', 400);

  await transaction(async (client) => {
    await client.query('UPDATE categories SET deleted_at = NOW() WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['DELETE_CATEGORY', req.user.email, 'categories', id, JSON.stringify({ name: exists.rows[0].name })]);
  });

  res.json({ success: true, message: 'تم حذف التصنيف بنجاح' });
}));

// ─── POST /api/categories/:id/restore ─────────────────────────────────────────
router.post('/:id/restore', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query('SELECT id, name FROM categories WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
  if (exists.rows.length === 0) throw new AppError('التصنيف غير موجود أو لم يكن محذوفاً', 404);

  await transaction(async (client) => {
    await client.query('UPDATE categories SET deleted_at = NULL WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['RESTORE_CATEGORY', req.user.email, 'categories', id, JSON.stringify({ name: exists.rows[0].name })]);
  });

  res.json({ success: true, message: 'تم استعادة التصنيف بنجاح' });
}));

module.exports = router;