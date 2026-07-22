// XSS + input hardening + security headers + correlation id
function sanitize(input, maxLen = 500) {
  if (input === null || input === undefined) return input;
  let s = String(input);
  if (s.length > maxLen) s = s.slice(0, maxLen);
  // strip control chars (keep tab/newline)
  s = Array.from(s).filter(c => {
    const code = c.charCodeAt(0);
    return code >= 0x20 || code === 0x09 || code === 0x0a;
  }).join('');
  // strip HTML tags
  s = s.replace(/<[^>]*>/g, '');
  // strip javascript: URIs and inline event handlers
  s = s.replace(/javascript:/gi, '');
  s = s.replace(/on\w+\s*=/gi, '');
  return s.trim();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-XSS-Protection', '0');
  next();
}

function correlationId(req, res, next) {
  const cid = req.headers['x-correlation-id'] || require('crypto').randomUUID();
  req.correlationId = cid;
  res.setHeader('X-Correlation-Id', cid);
  next();
}

function requireJsonContent(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) {
    return res.status(415).json({ success: false, error: { message: 'Content-Type application/json olmali' } });
  }
  next();
}

module.exports = { sanitize, securityHeaders, correlationId, requireJsonContent };
