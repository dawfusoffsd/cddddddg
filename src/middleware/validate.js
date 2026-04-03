const { validationResult } = require('express-validator');

// ============================================
// Validation Middleware
// ============================================

const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));

    return res.status(400).json({
      success: false,
      message: 'بيانات غير صحيحة',
      errors: formattedErrors
    });
  }
  
  next();
};

module.exports = { validate };
