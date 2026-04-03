const { v4: uuidv4 } = require('uuid');

/**
 * Request ID Middleware
 * Adds a unique ID to each request for better logging and debugging
 */
const requestId = (req, res, next) => {
  // Generate unique ID for each request
  const requestId = uuidv4();
  
  // Attach to request object
  req.id = requestId;
  
  // Add to response headers
  res.setHeader('X-Request-ID', requestId);
  
  // Also make it available in the response body for easier debugging
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    // Only add request ID to non-error responses or when not already present
    if (data && typeof data === 'object' && !data.requestId) {
      data.requestId = requestId;
    }
    return originalJson(data);
  };
  
  next();
};

/**
 * Request Logger Middleware
 * Logs request details with request ID for tracing
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log when request starts
  console.log(`[${req.id}] ${req.method} ${req.originalUrl} - Started`);
  
  // Log when response is sent
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    
    // Color code based on status
    let logMethod = 'log';
    if (status >= 500) logMethod = 'error';
    else if (status >= 400) logMethod = 'warn';
    
    console[logMethod](`[${req.id}] ${req.method} ${req.originalUrl} - ${status} (${duration}ms)`);
  });
  
  next();
};

module.exports = {
  requestId,
  requestLogger
};
