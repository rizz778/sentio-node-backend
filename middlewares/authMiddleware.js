/**
 * Downstream User Identity Middleware
 * ===================================
 * Node backend operates as an internal downstream microservice.
 * Upstream Gateway authenticates the client and injects trusted identity headers.
 * This middleware extracts the user identity without performing local JWT/passport checks.
 */

export const downstreamAuth = (req, res, next) => {
  // Extract user ID from upstream headers, query, or body
  const userId =
    req.headers['x-user-id'] ||
    req.headers['x-user-uid'] ||
    req.query.userId ||
    req.body.userId ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? extractUserIdFromToken(req.headers.authorization.split(' ')[1])
      : null);

  if (!userId) {
    return res.status(401).json({
      message: 'Unauthorized: Downstream request requires x-user-id header or userId parameter',
    });
  }

  // Attach trusted user identity to request object
  req.user = {
    _id: userId,
    id: userId,
    email: req.headers['x-user-email'] || '',
  };

  next();
};

function extractUserIdFromToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return payload.id || payload.userId || payload.sub || payload.uid || null;
    }
  } catch (e) {
    // If token parsing fails, ignore and return null
  }
  return null;
}

export default downstreamAuth;
