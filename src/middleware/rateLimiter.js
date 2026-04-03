const rateLimit = require('express-rate-limit');

// ========================================
// General API Rate Limiter
// ========================================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'تم تجاوز الحد المسموح به من الطلبات، حاول مرة أخرى بعد 15 دقيقة'
  },
  handler: (req, res, next, options) => {
    console.warn(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json(options.message);
  }
});

// ========================================
// Auth Rate Limiter (Stricter)
// ========================================
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'تم تجاوز الحد المسموح به لمحاولات تسجيل الدخول، حاول مرة أخرى بعد 15 دقيقة'
  },
  handler: (req, res, next, options) => {
    console.warn(`⚠️ Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json(options.message);
  }
});

// ========================================
// Create User Rate Limiter
// ========================================
const createUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'تم تجاوز الحد المسموح به لإنشاء المستخدمين، حاول مرة أخرى بعد ساعة'
  }
});

// ========================================
// Upload Rate Limiter
// ========================================
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 uploads per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'تم تجاوز الحد المسموح به للرفع، حاول مرة أخرى بعد ساعة'
  }
});

module.exports = {
  apiLimiter,
  authLimiter,
  createUserLimiter,
  uploadLimiter
};
