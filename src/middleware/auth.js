const jwt = require('jsonwebtoken');
const { getUserRole, hasRole } = require('../config/database');

/**
 * Middleware: التحقق من الـ JWT Token
 */
const authenticate = async (req, res, next) => {
  try {
    // 1. استخراج الـ Token من الـ Header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No token provided' 
      });
    }

    const token = authHeader.substring(7); // إزالة "Bearer "

    // 2. التحقق من صحة الـ Token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. حفظ بيانات المستخدم في الـ Request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid token' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Token expired' 
      });
    }
    
    console.error('Auth Error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Authentication failed' 
    });
  }
};

/**
 * Middleware: التحقق من الدور (Admin فقط)
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authentication required' 
      });
    }

    const isAdmin = await hasRole(req.user.id, 'Admin');

    if (!isAdmin) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Admin access required' 
      });
    }

    next();
  } catch (error) {
    console.error('Admin Check Error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Authorization failed' 
    });
  }
};

/**
 * Middleware: التحقق من الدور (Admin أو Manager)
 */
const requireAdminOrManager = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authentication required' 
      });
    }

    const isAdmin = await hasRole(req.user.id, 'Admin');
    const isManager = await hasRole(req.user.id, 'Manager');

    if (!isAdmin && !isManager) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Admin or Manager access required' 
      });
    }

    next();
  } catch (error) {
    console.error('Authorization Check Error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Authorization failed' 
    });
  }
};

/**
 * Middleware: التحقق من دور معين
 */
const requireRole = (roleName) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'Authentication required' 
        });
      }

      const hasRequiredRole = await hasRole(req.user.id, roleName);

      if (!hasRequiredRole) {
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: `${roleName} access required` 
        });
      }

      next();
    } catch (error) {
      console.error('Role Check Error:', error);
      res.status(500).json({ 
        error: 'Internal Server Error', 
        message: 'Authorization failed' 
      });
    }
  };
};

/**
 * Optional Authentication - لا يرمي خطأ إذا لم يكن هناك Token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role
      };
    }
    
    next();
  } catch (error) {
    // في حالة Optional Auth، نمرر الطلب حتى لو فشل الـ Token
    next();
  }
};

module.exports = {
  authenticate,
  requireAdmin,
  requireAdminOrManager,
  requireRole,
  optionalAuth
};
