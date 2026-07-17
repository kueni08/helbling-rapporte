function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Nicht eingeloggt' });
  }
  next();
}

function requireRole(...roles) {
  return [requireLogin, (req, res, next) => {
    if (!roles.includes(req.session.userRole)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    next();
  }];
}

function requireOrderAccess(paramName = 'orderId') {
  return [requireLogin, (req, res, next) => {
    const { getDb } = require('../lib/database');
    const orderId = Number.parseInt(req.params[paramName], 10);
    if (!Number.isInteger(orderId)) return res.status(404).json({ error: 'Auftrag nicht gefunden' });
    const order = getDb().prepare('SELECT id, assigned_to FROM orders WHERE id=?').get(orderId);
    if (!order) return res.status(404).json({ error: 'Auftrag nicht gefunden' });
    if (req.session.userRole === 'monteur' && order.assigned_to !== req.session.userId) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    if (!['admin', 'planer', 'monteur'].includes(req.session.userRole)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    req.orderAccess = order;
    next();
  }];
}

module.exports = { requireLogin, requireRole, requireOrderAccess };
