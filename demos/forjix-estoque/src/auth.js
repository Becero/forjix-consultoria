import jwt from 'jsonwebtoken';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET é obrigatório em produção.');
}

const secret = process.env.JWT_SECRET || 'forjix-demo-change-this-secret-before-production';
const cookieName = 'forjix_session';

export function issueToken(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email },
    secret,
    { expiresIn: '8h', issuer: 'forjix-estoque', audience: 'forjix-clients', algorithm: 'HS256' }
  );
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function readCookie(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
  return cookies[cookieName];
}

export function createAuthMiddleware(db) {
  return function authenticate(req, res, next) {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    const token = bearer || readCookie(req);
    if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });

    try {
      const payload = jwt.verify(token, secret, {
        issuer: 'forjix-estoque',
        audience: 'forjix-clients',
        algorithms: ['HS256']
      });
      const user = db.prepare(`SELECT u.id, u.name, u.email, u.active, u.group_id,
        g.name AS group_name FROM users u JOIN access_groups g ON g.id = u.group_id WHERE u.id = ?`).get(payload.sub);
      if (!user?.active) return res.status(401).json({ error: 'Usuário inativo ou inexistente.' });
      user.permissions = db.prepare('SELECT permission_code FROM group_permissions WHERE group_id = ?')
        .all(user.group_id).map(item => item.permission_code);
      req.user = user;
      next();
    } catch {
      return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    }
  };
}

export function permit(permission) {
  return (req, res, next) => req.user.permissions.includes(permission)
    ? next()
    : res.status(403).json({ error: 'Seu grupo não possui permissão para esta ação.' });
}
