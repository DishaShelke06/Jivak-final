const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

function cookieToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === 'jivak_session') return decodeURIComponent(valueParts.join('='));
  }
  return null;
}

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken(req) || bearerToken;
  // `Bearer ${token}` when token is null/undefined literally sends the
  // string "null"/"undefined" — that's truthy, so it used to slip past
  // this check and reach jwt.verify(), which then throws and got
  // mislabeled below as "session expired" even though the real situation
  // is just "not logged in yet".
  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    // Only a genuinely expired token should trigger the client's
    // "session expired, please log in again" flow. Any other verification
    // failure (malformed token, bad signature, etc.) is just "not logged
    // in" — showing "session expired" for that is misleading and, if it
    // happens on every page load before login completes, makes the alert
    // seem stuck since it keeps re-firing for an unrelated reason.
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Not logged in.' });
  }
};
