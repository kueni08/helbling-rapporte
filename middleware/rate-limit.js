'use strict';

function createRateLimit({ windowMs, max, key = req => req.ip, message = 'Zu viele Anfragen. Bitte später erneut versuchen.' }) {
  const attempts = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = String(key(req) || 'unknown');
    let bucket = attempts.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    attempts.set(bucketKey, bucket);

    if (attempts.size > 10_000) {
      for (const [entryKey, entry] of attempts) if (entry.resetAt <= now) attempts.delete(entryKey);
    }

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { createRateLimit };
