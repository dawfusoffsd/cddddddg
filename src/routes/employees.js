const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate, requireAdminOrManager } = require('../middleware/auth');

const router = express.Router();

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Audit log helper
const auditLog = async (action, userId, userEmail, entityId, details) => {
  try {
    await db.query(
      `INSERT INTO audit_logs (action, user_id, user_email, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'employee', $4, $5)`,
      [action, userId, userEmail, entityId, details]
    );
  } catch (error) {
    console.error('Audit log error:', error);
  }
};

// GET /api/employees - Get all employees
router.get('/',
  authenticate,
  [
    query('branch_id').optional().isUUID(),
    query('team_id').optional().isUUID(),
    query('department').optional().isString(),
    query('status').optional().isIn(['active', 'inactive', 'suspended']),
    query('include_deleted').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const { branch_id, team_id, department, status, include_deleted = false } = req.query;
      
      let queryText = `
        SELECT e.*, 
               b.name as branch_name,
               t.name as team_name,
               COUNT(DISTINCT a.id) as total_assignments
        FROM employees e
        LEFT JOIN branches b ON e.branch_id = b.id
        LEFT JOIN teams t ON e.team_id = t.id
        LEFT JOIN assignments a ON e.id = a.employee_id AND a.status = 'active'
        WHERE 1=1
      `;
      
      const params = [];
      let paramIndex = 1;
      
      // Filter deleted employees unless include_deleted is true
      if (!include_deleted) {
        queryText += ` AND e.deleted_at IS NULL`;
      }
      
      if (branch_id) {
        queryText += ` AND e.branch_id = $${paramIndex++}`;
        params.push(branch_id);
      }
      
      if (team_id) {
        queryText += ` AND e.team_id = $${paramIndex++}`;
        params.push(team_id);
      }
      
      if (department) {
        queryText += ` AND e.department = $${paramIndex++}`;
        params.push(department);
      }
      
      if (status) {
        queryText += ` AND e.status = $${paramIndex++}`;
        params.push(status);
      }
      
      queryText += ` GROUP BY e.id, b.name, t.name ORDER BY e.created_at DESC`;
      
      const result = await db.query(queryText, params);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
      
    } catch (error) {
      console.error('Get employees error:', error);
      res.status(500).json({ error: 'Failed to fetch employees' });
    }
  }
);

// GET /api/employees/:id - Get single employee
router.get('/:id',
  authenticate,
  [
    param('id').isUUID()
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const result = await db.query(
        `SELECT e.*, 
                b.name as branch_name,
                t.name as team_name,
                t.manager as team_manager,
                t.team_leader,
                COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'active') as active_assignments,
                COUNT(DISTINCT a.id) as total_assignments
         FROM employees e
         LEFT JOIN branches b ON e.branch_id = b.id
         LEFT JOIN teams t ON e.team_id = t.id
         LEFT JOIN assignments a ON e.id = a.employee_id
         WHERE e.id = $1
         GROUP BY e.id, b.name, t.name, t.manager, t.team_leader`,
        [id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      
      // Get employee's assignments
      const assignments = await db.query(
        `SELECT a.*, 
                i.name as item_name,
                i.brand,
                i.model,
                c.name as category_name
         FROM assignments a
         JOIN inventory_items i ON a.item_id = i.id
         LEFT JOIN categories c ON i.category_id = c.id
         WHERE a.employee_id = $1
         ORDER BY a.created_at DESC`,
        [id]
      );
      
      res.json({
        success: true,
        data: {
          ...result.rows[0],
          assignments: assignments.rows
        }
      });
      
    } catch (error) {
      console.error('Get employee error:', error);
      res.status(500).json({ error: 'Failed to fetch employee' });
    }
  }
);

// POST /api/employees - Create new employee
router.post('/',
  authenticate,
  [
    body('name').notEmpty().trim().isLength({ min: 2, max: 255 }),
    body('national_id').notEmpty().trim().isLength({ min: 10, max: 20 }),
    body('phone').optional().trim().isMobilePhone(),
    body('email').optional().trim().isEmail(),
    body('department').notEmpty().trim(),
    body('position').optional().trim(),
    body('branch_id').optional().isUUID(),
    body('team_id').optional().isUUID(),
    body('hire_date').optional().isISO8601(),
    body('status').optional().isIn(['active', 'inactive', 'suspended']),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        name,
        national_id,
        phone,
        email,
        department,
        position,
        branch_id,
        team_id,
        hire_date,
        status
      } = req.body;
      
      // Check if national_id already exists
      const existingEmployee = await db.query(
        'SELECT id FROM employees WHERE national_id = $1',
        [national_id]
      );
      
      if (existingEmployee.rows.length > 0) {
        return res.status(400).json({ error: 'National ID already exists' });
      }
      
      const result = await db.query(
        `INSERT INTO employees (name, national_id, phone, email, department, position, branch_id, team_id, hire_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [name, national_id, phone, email, department, position, branch_id, team_id, hire_date, status || 'active']
      );
      
      const employee = result.rows[0];
      
      // Audit log
      await auditLog(
        'CREATE_EMPLOYEE',
        req.user.id,
        req.user.email,
        employee.id,
        JSON.stringify({ name, national_id, department })
      );
      
      res.status(201).json({
        success: true,
        data: employee,
        message: 'Employee created successfully'
      });
      
    } catch (error) {
      console.error('Create employee error:', error);
      res.status(500).json({ error: 'Failed to create employee' });
    }
  }
);

// PUT /api/employees/:id - Update employee
router.put('/:id',
  authenticate,
  [
    param('id').isUUID(),
    body('name').optional().trim().isLength({ min: 2, max: 255 }),
    body('national_id').optional().trim().isLength({ min: 10, max: 20 }),
    body('phone').optional().trim(),
    body('email').optional().trim().isEmail(),
    body('department').optional().trim(),
    body('position').optional().trim(),
    body('branch_id').optional().isUUID(),
    body('team_id').optional().isUUID(),
    body('hire_date').optional().isISO8601(),
    body('status').optional().isIn(['active', 'inactive', 'suspended']),
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Check if employee exists
      const existing = await db.query('SELECT * FROM employees WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      
      // If updating national_id, check for duplicates
      if (updates.national_id && updates.national_id !== existing.rows[0].national_id) {
        const duplicate = await db.query(
          'SELECT id FROM employees WHERE national_id = $1 AND id != $2',
          [updates.national_id, id]
        );
        if (duplicate.rows.length > 0) {
          return res.status(400).json({ error: 'National ID already exists' });
        }
      }
      
      const fields = [];
      const values = [];
      let paramIndex = 1;
      
      Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined) {
          fields.push(`${key} = $${paramIndex++}`);
          values.push(updates[key]);
        }
      });
      
      if (fields.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      
      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);
      
      const query = `
        UPDATE employees 
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;
      
      const result = await db.query(query, values);
      
      // Audit log
      await auditLog(
        'UPDATE_EMPLOYEE',
        req.user.id,
        req.user.email,
        id,
        JSON.stringify(updates)
      );
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Employee updated successfully'
      });
      
    } catch (error) {
      console.error('Update employee error:', error);
      res.status(500).json({ error: 'Failed to update employee' });
    }
  }
);

// DELETE /api/employees/:id - Delete employee (Admin/Manager only) - Soft Delete
router.delete('/:id',
  authenticate,
  requireAdminOrManager,
  [
    param('id').isUUID()
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if employee exists
      const existing = await db.query('SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      
      // Check if employee has active assignments
      const assignments = await db.query(
        'SELECT COUNT(*) as count FROM assignments WHERE employee_id = $1 AND status = $2',
        [id, 'active']
      );
      
      if (parseInt(assignments.rows[0].count) > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete employee with active assignments',
          active_assignments: parseInt(assignments.rows[0].count)
        });
      }
      
      // Soft delete instead of hard delete
      await db.query('UPDATE employees SET deleted_at = NOW() WHERE id = $1', [id]);
      
      // Audit log
      await auditLog(
        'DELETE_EMPLOYEE',
        req.user.id,
        req.user.email,
        id,
        JSON.stringify(existing.rows[0])
      );
      
      res.json({
        success: true,
        message: 'Employee deleted successfully'
      });
      
    } catch (error) {
      console.error('Delete employee error:', error);
      res.status(500).json({ error: 'Failed to delete employee' });
    }
  }
);

// POST /api/employees/:id/restore - Restore soft-deleted employee
router.post('/:id/restore',
  authenticate,
  requireAdminOrManager,
  [
    param('id').isUUID()
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await db.query('SELECT * FROM employees WHERE id = $1 AND deleted_at IS NOT NULL', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Employee not found or not deleted' });
      }
      
      await db.query('UPDATE employees SET deleted_at = NULL WHERE id = $1', [id]);
      
      await auditLog(
        'RESTORE_EMPLOYEE',
        req.user.id,
        req.user.email,
        id,
        JSON.stringify({ name: existing.rows[0].name })
      );
      
      res.json({
        success: true,
        message: 'Employee restored successfully'
      });
      
    } catch (error) {
      console.error('Restore employee error:', error);
      res.status(500).json({ error: 'Failed to restore employee' });
    }
  }
);

module.exports = router;