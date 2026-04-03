const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const { query, transaction } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiter for setup-admin endpoint
const setupAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 minutes
  message: 'Too many setup attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── GET /api/users ───────────────────────────────────────────────────────────
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT 
      u.id,
      u.name,
      u.email,
      u.created_at,
      u.updated_at,
      ur.role
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    ORDER BY u.created_at DESC
  `);
  res.json({ success: true, data: result.rows });
}));

// ─── GET /api/users/:id ───────────────────────────────────────────────────────
router.get('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(`
    SELECT 
      u.id,
      u.name,
      u.email,
      u.created_at,
      u.updated_at,
      ur.role
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    WHERE u.id = $1
  `, [id]);

  if (result.rows.length === 0) throw new AppError('المستخدم غير موجود', 404);
  res.json({ success: true, data: result.rows[0] });
}));

// ─── POST /api/users ──────────────────────────────────────────────────────────
router.post('/',
  authenticate,
  requireAdmin,
  [
    body('name').notEmpty().withMessage('الاسم مطلوب'),
    body('email').isEmail().withMessage('البريد الإلكتروني غير صحيح'),
    body('password')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
      .withMessage('كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل وتتضمن حروف كبيرة وصغيرة وأرقام ورموز'),
    body('role').isIn(['admin', 'manager', 'user']).withMessage('الدور غير صحيح'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;

    const exists = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) throw new AppError('البريد الإلكتروني مستخدم بالفعل', 400);

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await transaction(async (client) => {
      const userResult = await client.query(`
        INSERT INTO users (name, email, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id, name, email, created_at
      `, [name, email, hashedPassword]);

      const user = userResult.rows[0];

      await client.query(`
        INSERT INTO user_roles (user_id, role)
        VALUES ($1, $2)
      `, [user.id, role]);

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['CREATE_USER', req.user.email, 'users', user.id, JSON.stringify({ name, email, role })]);

      return { ...user, role };
    });

    res.status(201).json({ success: true, message: 'تم إنشاء المستخدم بنجاح', data: result });
  })
);

// ─── PUT /api/users/:id ───────────────────────────────────────────────────────
router.put('/:id',
  authenticate,
  requireAdmin,
  [
    body('name').optional().notEmpty().withMessage('الاسم لا يمكن أن يكون فارغاً'),
    body('email').optional().isEmail().withMessage('البريد الإلكتروني غير صحيح'),
    body('role').optional().isIn(['admin', 'manager', 'user']).withMessage('الدور غير صحيح'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, email, role, password } = req.body;

    const exists = await query('SELECT id FROM users WHERE id = $1', [id]);
    if (exists.rows.length === 0) throw new AppError('المستخدم غير موجود', 404);

    const result = await transaction(async (client) => {
      let updateFields = [];
      let updateValues = [];
      let paramCount = 1;

      if (name) { updateFields.push(`name = $${paramCount++}`); updateValues.push(name); }
      if (email) { updateFields.push(`email = $${paramCount++}`); updateValues.push(email); }
      if (password) {
        const hashed = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
        updateFields.push(`password_hash = $${paramCount++}`);
        updateValues.push(hashed);
      }

      let profile;
      if (updateFields.length > 0) {
        updateValues.push(id);
        const profileResult = await client.query(`
          UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW()
          WHERE id = $${paramCount}
          RETURNING id, name, email, updated_at
        `, updateValues);
        profile = profileResult.rows[0];
      }

      if (role) {
        await client.query(`
          UPDATE user_roles SET role = $1 WHERE user_id = $2
        `, [role, id]);
      }

      await client.query(`
        INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, ['UPDATE_USER', req.user.email, 'users', id, JSON.stringify({ name, email, role })]);

      return { ...profile, role };
    });

    res.json({ success: true, message: 'تم تحديث المستخدم بنجاح', data: result });
  })
);

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) throw new AppError('لا يمكنك حذف حسابك الخاص', 400);

  const exists = await query('SELECT id, email FROM users WHERE id = $1', [id]);
  if (exists.rows.length === 0) throw new AppError('المستخدم غير موجود', 404);

  await transaction(async (client) => {
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await client.query(`
      INSERT INTO audit_logs (action, user_email, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, ['DELETE_USER', req.user.email, 'users', id, JSON.stringify({ deleted_email: exists.rows[0].email })]);
  });

  res.json({ success: true, message: 'تم حذف المستخدم بنجاح' });
}));

// ─── POST /api/users/setup-admin ──────────────────────────────────────────────
router.post('/setup-admin', setupAdminLimiter, asyncHandler(async (req, res) => {
  const adminExists = await query(`
    SELECT u.id FROM users u
    JOIN user_roles ur ON u.id = ur.user_id
    WHERE ur.role = 'admin'
    LIMIT 1
  `);

  if (adminExists.rows.length > 0) {
    throw new AppError('Admin account already exists', 400);
  }

  const { name, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password || process.env.ADMIN_PASSWORD || 'Admin@123456', parseInt(process.env.BCRYPT_ROUNDS) || 12);
  const adminName = name || process.env.ADMIN_NAME || 'System Admin';
  const adminEmail = email || process.env.ADMIN_EMAIL || 'admin@system.com';

  const result = await transaction(async (client) => {
    const userResult = await client.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, created_at
    `, [adminName, adminEmail, hashedPassword]);

    const user = userResult.rows[0];

    await client.query(`
      INSERT INTO user_roles (user_id, role)
      VALUES ($1, 'admin')
    `, [user.id]);

    return user;
  });

  res.status(201).json({
    success: true,
    message: 'تم إنشاء حساب Admin بنجاح',
    data: { id: result.id, name: result.name, email: result.email, role: 'admin' }
  });
}));

module.exports = router;