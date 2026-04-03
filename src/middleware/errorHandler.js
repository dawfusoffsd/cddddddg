const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // PostgreSQL Errors
  if (err.code) {
    switch (err.code) {
      case '23505': // Unique violation
        statusCode = 409;
        message = 'البيانات موجودة مسبقاً';
        if (err.detail) {
          if (err.detail.includes('email')) message = 'البريد الإلكتروني مستخدم مسبقاً';
          if (err.detail.includes('national_id')) message = 'الرقم القومي مستخدم مسبقاً';
          if (err.detail.includes('sim_number')) message = 'رقم الخط مستخدم مسبقاً';
        }
        break;

      case '23503': // Foreign key violation
        statusCode = 400;
        message = 'البيانات المرتبطة غير موجودة';
        break;

      case '23502': // Not null violation
        statusCode = 400;
        message = `الحقل ${err.column} مطلوب`;
        break;

      case '22P02': // Invalid text representation
        statusCode = 400;
        message = 'صيغة البيانات غير صحيحة';
        break;

      case '42P01': // Undefined table
        statusCode = 500;
        message = 'خطأ في قاعدة البيانات - الجدول غير موجود';
        break;

      case 'ECONNREFUSED': // Connection refused
        statusCode = 503;
        message = 'لا يمكن الاتصال بقاعدة البيانات';
        break;

      default:
        if (err.code.startsWith('23')) {
          statusCode = 400;
          message = 'خطأ في البيانات المدخلة';
        }
    }
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Token غير صحيح';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً';
  }

  // Validation Errors
  if (err.name === 'ValidationError') {
    statusCode = 422;
    message = err.message;
  }

  // Log error in development
  if (process.env.NODE_ENV === 'development') {
    console.error('🔴 Error:', {
      message: err.message,
      code: err.code,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      body: req.body,
    });
  } else {
    // Log only in production (without stack)
    console.error(`🔴 [${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${statusCode}: ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && {
      error: err.message,
      stack: err.stack,
      code: err.code,
    }),
  });
};

// Not Found Handler
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `المسار ${req.originalUrl} غير موجود`,
  });
};

// Async Handler Wrapper (لتجنب try/catch في كل route)
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom Error Class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
};
