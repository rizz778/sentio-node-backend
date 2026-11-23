/**
 * Structured request and event logger middleware for Sentio Node.js Backend.
 * Captures request IDs, methods, URLs, status codes, response times, and caller identity.
 */

export const requestLogger = (req, res, next) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';
  const callerService = req.headers['x-sentio-service'] || req.headers['user-agent'] || 'unknown';

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusIcon = status >= 500 ? '🔴' : status >= 400 ? '🟡' : '🟢';
    const user = req.user?.id || req.user?.uid || req.headers['x-user-id'] || 'anonymous';

    console.log(
      `[Node-HTTP] ${statusIcon} [${requestId}] ${req.method} ${req.originalUrl || req.url} | ` +
      `Status: ${status} (${duration}ms) | User: ${user} | Service: ${callerService} | IP: ${clientIp}`
    );
  });

  next();
};

export default requestLogger;
