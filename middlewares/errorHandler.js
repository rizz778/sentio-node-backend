const errorHandler = (err, req, res, next) => {
  const reqId = req.id || req.headers['x-request-id'] || '-';
  const user = req.user?.id || req.user?.uid || req.headers['x-user-id'] || 'anon';
  
  console.error(`[Node-Error] ❌ [${reqId}] ${req.method} ${req.originalUrl || req.url} [${user}]:`, err.message);
  if (process.env.NODE_ENV !== 'production' || process.env.VERBOSE_LOGS === 'true') {
    console.error(err.stack);
  }

  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);

  res.json({
    success: false,
    message: err.message,
    requestId: reqId,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack, // Hide stack trace in production
  });
};

export default errorHandler;