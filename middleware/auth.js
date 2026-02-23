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

module.exports = { requireLogin, requireRole };
