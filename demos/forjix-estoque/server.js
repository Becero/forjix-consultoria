import express from 'express';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, audit } from './src/db.js';
import { clearSessionCookie, createAuthMiddleware, issueToken, permit, setSessionCookie } from './src/auth.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const db = createDatabase(process.env.DB_PATH);
const app = express();
const port = Number(process.env.PORT || 3333);
const authenticate = createAuthMiddleware(db);
const demoMode = process.env.DEMO_MODE === 'true';
const protectedDemoUsers = new Set(['admin@forjix.local', 'vendas@forjix.local', 'estoque@forjix.local']);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '500kb' }));

const loginAttempts = new Map();
function loginLimiter(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const attempt = loginAttempts.get(key) || { count: 0, since: now };
  if (now - attempt.since > 10 * 60_000) Object.assign(attempt, { count: 0, since: now });
  if (attempt.count >= 10) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  attempt.count += 1;
  loginAttempts.set(key, attempt);
  next();
}

function cleanText(value, field, max = 180) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`${field} é obrigatório.`), { status: 400 });
  if (text.length > max) throw Object.assign(new Error(`${field} excede ${max} caracteres.`), { status: 400 });
  return text;
}

function optionalText(value, max = 500) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw Object.assign(new Error(`Texto excede ${max} caracteres.`), { status: 400 });
  return text;
}

function numeric(value, field, { min = 0, allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || (!allowZero && number === 0)) {
    throw Object.assign(new Error(`${field} possui um valor inválido.`), { status: 400 });
  }
  return number;
}

function bool(value) {
  return value === true || value === 1 || value === '1';
}

function userPayload(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    groupId: user.group_id,
    groupName: user.group_name,
    permissions: user.permissions
  };
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'forjix-estoque' }));

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const email = cleanText(req.body.email, 'E-mail').toLowerCase();
  const password = cleanText(req.body.password, 'Senha', 200);
  const user = db.prepare(`SELECT u.*, g.name AS group_name FROM users u
    JOIN access_groups g ON g.id = u.group_id WHERE u.email = ?`).get(email);
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  user.permissions = db.prepare('SELECT permission_code FROM group_permissions WHERE group_id = ?')
    .all(user.group_id).map(item => item.permission_code);
  const token = issueToken(user);
  setSessionCookie(res, token);
  loginAttempts.delete(req.ip);
  audit(db, user.id, 'LOGIN', 'USER', user.id);
  res.json({ user: userPayload(user), token });
});

app.post('/api/auth/logout', authenticate, (req, res) => {
  audit(db, req.user.id, 'LOGOUT', 'USER', req.user.id);
  clearSessionCookie(res);
  res.status(204).end();
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: userPayload(req.user) }));

app.get('/api/dashboard', authenticate, permit('dashboard.view'), (req, res) => {
  const canSeeSales = req.user.permissions.includes('dashboard.view_sales');
  const canSeeInventory = req.user.permissions.includes('dashboard.view_inventory');
  const stats = {};
  let lowStock = null;
  let recentSales = null;
  let salesByDay = null;

  if (req.user.permissions.includes('products.view')) {
    stats.productCount = db.prepare('SELECT COUNT(*) AS total FROM products WHERE active = 1').get().total;
  }
  if (canSeeInventory) {
    Object.assign(stats, db.prepare(`SELECT
      (SELECT COUNT(*) FROM products WHERE active = 1 AND stock <= min_stock) AS lowStockCount,
      (SELECT COALESCE(SUM(stock * cost), 0) FROM products WHERE active = 1) AS inventoryCost`).get());
    lowStock = db.prepare(`SELECT id, sku, name, stock, min_stock FROM products
      WHERE active = 1 AND stock <= min_stock ORDER BY stock - min_stock LIMIT 6`).all();
  }
  if (canSeeSales) {
    Object.assign(stats, db.prepare(`SELECT
      (SELECT COALESCE(SUM(total), 0) FROM sales WHERE status = 'COMPLETED' AND date(created_at, 'localtime') = date('now', 'localtime')) AS salesToday,
      (SELECT COUNT(*) FROM sales WHERE status = 'COMPLETED' AND date(created_at, 'localtime') = date('now', 'localtime')) AS salesCountToday`).get());
    recentSales = db.prepare(`SELECT s.id, s.number, s.total, s.payment_method, s.status, s.created_at, u.name AS user_name
      FROM sales s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 6`).all();
    salesByDay = db.prepare(`WITH RECURSIVE days(day) AS (
      SELECT date('now', '-6 days') UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < date('now')
    ) SELECT days.day, COALESCE(SUM(s.total), 0) AS total FROM days
      LEFT JOIN sales s ON date(s.created_at, 'localtime') = days.day AND s.status = 'COMPLETED'
      GROUP BY days.day ORDER BY days.day`).all();
  }
  res.json({ stats, lowStock, recentSales, salesByDay });
});

app.get('/api/categories', authenticate, permit('products.view'), (_req, res) => {
  res.json(db.prepare('SELECT id, name, active, created_at FROM categories ORDER BY name').all());
});

app.post('/api/categories', authenticate, permit('categories.manage'), (req, res) => {
  const name = cleanText(req.body.name, 'Nome da categoria');
  const result = db.prepare('INSERT INTO categories(name) VALUES (?)').run(name);
  audit(db, req.user.id, 'CREATE', 'CATEGORY', result.lastInsertRowid, { name });
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/categories/:id', authenticate, permit('categories.manage'), (req, res) => {
  const name = cleanText(req.body.name, 'Nome da categoria');
  const result = db.prepare('UPDATE categories SET name = ?, active = ? WHERE id = ?')
    .run(name, bool(req.body.active) ? 1 : 0, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Categoria não encontrada.' });
  audit(db, req.user.id, 'UPDATE', 'CATEGORY', req.params.id, { name, active: bool(req.body.active) });
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

app.get('/api/products', authenticate, (req, res) => {
  if (!req.user.permissions.some(code => ['products.view', 'stock.view', 'sales.create'].includes(code))) {
    return res.status(403).json({ error: 'Sem permissão para consultar produtos.' });
  }
  const search = `%${String(req.query.search || '').trim()}%`;
  const active = req.query.active === 'all' ? null : req.query.active === 'false' ? 0 : 1;
  const categoryId = Number(req.query.categoryId) || null;
  const products = db.prepare(`SELECT p.*, c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE (@active IS NULL OR p.active = @active)
      AND (@categoryId IS NULL OR p.category_id = @categoryId)
      AND (p.name LIKE @search OR p.sku LIKE @search OR COALESCE(p.barcode, '') LIKE @search)
    ORDER BY p.name`).all({ active, categoryId, search });
  res.json(products.map(product => productPayload(product, req.user)));
});

app.post('/api/products', authenticate, permit('products.create'), (req, res) => {
  const requestedStock = numeric(req.body.stock || 0, 'Estoque inicial');
  if (requestedStock > 0 && !req.user.permissions.includes('stock.entry')) {
    return res.status(403).json({ error: 'Sem permissão para registrar o estoque inicial.' });
  }
  const data = parseProduct({
    ...req.body,
    cost: req.user.permissions.includes('products.view_cost') ? req.body.cost : 0,
    stock: requestedStock,
    minStock: req.user.permissions.includes('products.view_stock') ? req.body.minStock : 0
  });
  const create = db.transaction(() => {
    const result = db.prepare(`INSERT INTO products
      (sku, barcode, name, description, category_id, cost, price, stock, min_stock)
      VALUES (@sku, @barcode, @name, @description, @categoryId, @cost, @price, @stock, @minStock)`).run(data);
    if (data.stock > 0) db.prepare(`INSERT INTO stock_movements
      (product_id, type, quantity, previous_stock, resulting_stock, unit_cost, note, user_id)
      VALUES (?, 'ENTRY', ?, 0, ?, ?, 'Estoque inicial', ?)`).run(result.lastInsertRowid, data.stock, data.stock, data.cost, req.user.id);
    audit(db, req.user.id, 'CREATE', 'PRODUCT', result.lastInsertRowid, { sku: data.sku, name: data.name });
    return result.lastInsertRowid;
  });
  const id = create();
  res.status(201).json(productPayload(getProduct(id), req.user));
});

app.put('/api/products/:id', authenticate, permit('products.edit'), (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Produto não encontrado.' });
  const requestedActive = bool(req.body.active ?? existing.active) ? 1 : 0;
  if (requestedActive !== existing.active && !req.user.permissions.includes('products.deactivate')) {
    return res.status(403).json({ error: 'Sem permissão para alterar o status do produto.' });
  }
  const data = parseProduct({
    ...req.body,
    cost: req.user.permissions.includes('products.view_cost') ? req.body.cost : existing.cost,
    minStock: req.user.permissions.includes('products.view_stock') ? req.body.minStock : existing.min_stock
  }, existing);
  db.prepare(`UPDATE products SET sku=@sku, barcode=@barcode, name=@name, description=@description,
    category_id=@categoryId, cost=@cost, price=@price, min_stock=@minStock, active=@active,
    updated_at=CURRENT_TIMESTAMP WHERE id=@id`).run({ ...data, active: requestedActive, id: req.params.id });
  audit(db, req.user.id, 'UPDATE', 'PRODUCT', req.params.id, { sku: data.sku, name: data.name });
  res.json(productPayload(getProduct(req.params.id), req.user));
});

app.delete('/api/products/:id', authenticate, permit('products.deactivate'), (req, res) => {
  const result = db.prepare('UPDATE products SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Produto não encontrado.' });
  audit(db, req.user.id, 'DEACTIVATE', 'PRODUCT', req.params.id);
  res.status(204).end();
});

app.get('/api/stock/movements', authenticate, permit('stock.view'), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const movements = db.prepare(`SELECT m.*, p.name AS product_name, p.sku, u.name AS user_name
    FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.user_id
    ORDER BY m.id DESC LIMIT ?`).all(limit);
  if (!req.user.permissions.includes('products.view_cost')) movements.forEach(item => delete item.unit_cost);
  res.json(movements);
});

app.post('/api/stock/movements', authenticate, (req, res) => {
  const product = getProduct(req.body.productId);
  if (!product || !product.active) return res.status(404).json({ error: 'Produto não encontrado ou inativo.' });
  const type = cleanText(req.body.type, 'Tipo').toUpperCase();
  if (!['ENTRY', 'EXIT', 'ADJUSTMENT'].includes(type)) throw Object.assign(new Error('Tipo de movimentação inválido.'), { status: 400 });
  const requiredPermission = { ENTRY: 'stock.entry', EXIT: 'stock.exit', ADJUSTMENT: 'stock.adjust' }[type];
  if (!req.user.permissions.includes(requiredPermission)) return res.status(403).json({ error: 'Sem permissão para esta operação de estoque.' });
  const inputQuantity = numeric(req.body.quantity, 'Quantidade');
  const resultingStock = type === 'ENTRY' ? product.stock + inputQuantity
    : type === 'EXIT' ? product.stock - inputQuantity
    : inputQuantity;
  if (resultingStock < 0) return res.status(409).json({ error: 'Estoque insuficiente para esta saída.' });
  const movementQuantity = type === 'ADJUSTMENT' ? resultingStock - product.stock : inputQuantity;
  const unitCost = !req.user.permissions.includes('products.view_cost') || req.body.unitCost === '' || req.body.unitCost == null
    ? product.cost
    : numeric(req.body.unitCost, 'Custo unitário');
  const note = optionalText(req.body.note, 300);
  const create = db.transaction(() => {
    db.prepare('UPDATE products SET stock = ?, cost = CASE WHEN ? = \'ENTRY\' THEN ? ELSE cost END, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(resultingStock, type, unitCost, product.id);
    const result = db.prepare(`INSERT INTO stock_movements
      (product_id, type, quantity, previous_stock, resulting_stock, unit_cost, note, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(product.id, type, movementQuantity, product.stock, resultingStock, unitCost, note, req.user.id);
    audit(db, req.user.id, 'CREATE', 'STOCK_MOVEMENT', result.lastInsertRowid, { productId: product.id, type, quantity: movementQuantity });
    return result.lastInsertRowid;
  });
  const id = create();
  res.status(201).json(db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(id));
});

app.get('/api/sales', authenticate, permit('sales.view'), (req, res) => {
  const from = String(req.query.from || '2000-01-01');
  const to = String(req.query.to || '2999-12-31');
  res.json(db.prepare(`SELECT s.*, u.name AS user_name,
    (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
    FROM sales s JOIN users u ON u.id = s.user_id
    WHERE date(s.created_at, 'localtime') BETWEEN date(?) AND date(?) ORDER BY s.id DESC LIMIT 500`).all(from, to));
});

app.get('/api/sales/:id', authenticate, permit('sales.details'), (req, res) => {
  const sale = db.prepare(`SELECT s.*, u.name AS user_name FROM sales s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });
  sale.items = db.prepare(`SELECT si.*, p.name AS product_name, p.sku FROM sale_items si
    JOIN products p ON p.id=si.product_id WHERE si.sale_id=?`).all(sale.id);
  res.json(sale);
});

app.post('/api/sales', authenticate, permit('sales.create'), (req, res) => {
  if (!Array.isArray(req.body.items) || !req.body.items.length) throw Object.assign(new Error('Adicione ao menos um item à venda.'), { status: 400 });
  const discount = numeric(req.body.discount || 0, 'Desconto');
  if (discount > 0 && !req.user.permissions.includes('sales.discount')) {
    return res.status(403).json({ error: 'Sem permissão para aplicar descontos.' });
  }
  const paymentMethod = cleanText(req.body.paymentMethod, 'Forma de pagamento', 40);
  const grouped = new Map();
  for (const item of req.body.items) {
    const id = Number(item.productId);
    const quantity = numeric(item.quantity, 'Quantidade', { min: 0, allowZero: false });
    grouped.set(id, (grouped.get(id) || 0) + quantity);
  }
  const saleId = db.transaction(() => {
    const resolved = [...grouped].map(([productId, quantity]) => {
      const product = getProduct(productId);
      if (!product?.active) throw Object.assign(new Error('Um produto da venda não está mais disponível.'), { status: 409 });
      if (product.stock < quantity) throw Object.assign(new Error(`Estoque insuficiente para ${product.name}.`), { status: 409 });
      return { product, quantity, total: product.price * quantity };
    });
    const subtotal = resolved.reduce((sum, item) => sum + item.total, 0);
    if (discount > subtotal) throw Object.assign(new Error('O desconto não pode superar o subtotal.'), { status: 400 });
    const number = `VD-${new Date().toISOString().slice(0,10).replaceAll('-', '')}-${String(db.prepare('SELECT COALESCE(MAX(id),0)+1 AS next FROM sales').get().next).padStart(5, '0')}`;
    const result = db.prepare(`INSERT INTO sales(number, subtotal, discount, total, payment_method, user_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run(number, subtotal, discount, subtotal - discount, paymentMethod, req.user.id);
    const addItem = db.prepare('INSERT INTO sale_items(sale_id, product_id, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?)');
    const updateStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at=CURRENT_TIMESTAMP WHERE id = ?');
    const addMovement = db.prepare(`INSERT INTO stock_movements
      (product_id, type, quantity, previous_stock, resulting_stock, unit_cost, note, user_id)
      VALUES (?, 'EXIT', ?, ?, ?, ?, ?, ?)`);
    for (const item of resolved) {
      addItem.run(result.lastInsertRowid, item.product.id, item.quantity, item.product.price, item.total);
      updateStock.run(item.quantity, item.product.id);
      addMovement.run(item.product.id, item.quantity, item.product.stock, item.product.stock - item.quantity, item.product.cost, `Venda ${number}`, req.user.id);
    }
    audit(db, req.user.id, 'CREATE', 'SALE', result.lastInsertRowid, { number, total: subtotal - discount });
    return result.lastInsertRowid;
  })();
  res.status(201).json(db.prepare('SELECT * FROM sales WHERE id=?').get(saleId));
});

app.post('/api/sales/:id/cancel', authenticate, permit('sales.cancel'), (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' });
  if (sale.status === 'CANCELLED') return res.status(409).json({ error: 'Esta venda já foi cancelada.' });
  db.transaction(() => {
    const items = db.prepare(`SELECT si.*, p.stock, p.cost FROM sale_items si JOIN products p ON p.id=si.product_id WHERE sale_id=?`).all(sale.id);
    for (const item of items) {
      db.prepare('UPDATE products SET stock=stock+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(item.quantity, item.product_id);
      db.prepare(`INSERT INTO stock_movements(product_id,type,quantity,previous_stock,resulting_stock,unit_cost,note,user_id)
        VALUES (?,'ENTRY',?,?,?,?,?,?)`).run(item.product_id, item.quantity, item.stock, item.stock + item.quantity, item.cost, `Cancelamento ${sale.number}`, req.user.id);
    }
    db.prepare(`UPDATE sales SET status='CANCELLED', cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE id=?`).run(req.user.id, sale.id);
    audit(db, req.user.id, 'CANCEL', 'SALE', sale.id, { number: sale.number });
  })();
  res.json(db.prepare('SELECT * FROM sales WHERE id=?').get(sale.id));
});

app.get('/api/reports/summary', authenticate, permit('reports.view'), (req, res) => {
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));
  let sales = null;
  let inventory = null;
  if (req.user.permissions.includes('reports.sales')) {
    const summary = db.prepare(`SELECT COUNT(*) AS saleCount, COALESCE(SUM(total),0) AS revenue,
      COALESCE(AVG(total),0) AS averageTicket FROM sales WHERE status='COMPLETED'
      AND date(created_at,'localtime') BETWEEN date(?) AND date(?)`).get(from, to);
    const topProducts = db.prepare(`SELECT p.name, p.sku, SUM(si.quantity) AS quantity, SUM(si.total) AS revenue
      FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN products p ON p.id=si.product_id
      WHERE s.status='COMPLETED' AND date(s.created_at,'localtime') BETWEEN date(?) AND date(?)
      GROUP BY p.id ORDER BY quantity DESC LIMIT 10`).all(from, to);
    const daily = db.prepare(`SELECT date(created_at,'localtime') AS day, COUNT(*) AS count, SUM(total) AS total
      FROM sales WHERE status='COMPLETED' AND date(created_at,'localtime') BETWEEN date(?) AND date(?)
      GROUP BY day ORDER BY day`).all(from, to);
    sales = { summary, topProducts, daily };
  }
  if (req.user.permissions.includes('reports.inventory')) {
    inventory = { lowStock: db.prepare(`SELECT id, sku, name, stock, min_stock FROM products
      WHERE active=1 AND stock<=min_stock ORDER BY stock-min_stock`).all() };
  }
  res.json({ from, to, sales, inventory });
});

app.get('/api/users', authenticate, permit('users.view'), (_req, res) => {
  res.json(db.prepare(`SELECT u.id,u.name,u.email,u.active,u.group_id,u.created_at,g.name AS group_name
    FROM users u JOIN access_groups g ON g.id=u.group_id ORDER BY u.name`).all());
});

app.post('/api/users', authenticate, permit('users.create'), (req, res) => {
  const name = cleanText(req.body.name, 'Nome');
  const email = cleanText(req.body.email, 'E-mail').toLowerCase();
  const password = cleanText(req.body.password, 'Senha', 200);
  if (password.length < 8) throw Object.assign(new Error('A senha deve ter ao menos 8 caracteres.'), { status: 400 });
  const groupId = numeric(req.body.groupId, 'Grupo', { allowZero: false });
  const result = db.prepare('INSERT INTO users(name,email,password_hash,group_id) VALUES (?,?,?,?)')
    .run(name, email, bcrypt.hashSync(password, 12), groupId);
  audit(db, req.user.id, 'CREATE', 'USER', result.lastInsertRowid, { name, email, groupId });
  res.status(201).json({ id: result.lastInsertRowid, name, email, groupId });
});

app.put('/api/users/:id', authenticate, permit('users.edit'), (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (demoMode && protectedDemoUsers.has(existing.email)) {
    return res.status(403).json({ error: 'Os usuários padrão são protegidos na demonstração pública.' });
  }
  const name = cleanText(req.body.name, 'Nome');
  const email = cleanText(req.body.email, 'E-mail').toLowerCase();
  const groupId = numeric(req.body.groupId, 'Grupo', { allowZero: false });
  const active = bool(req.body.active) ? 1 : 0;
  if (Number(req.params.id) === req.user.id && !active) throw Object.assign(new Error('Você não pode desativar seu próprio usuário.'), { status: 400 });
  if (req.body.password) {
    const password = cleanText(req.body.password, 'Senha', 200);
    if (password.length < 8) throw Object.assign(new Error('A senha deve ter ao menos 8 caracteres.'), { status: 400 });
    db.prepare('UPDATE users SET name=?,email=?,group_id=?,active=?,password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name, email, groupId, active, bcrypt.hashSync(password, 12), req.params.id);
  } else {
    db.prepare('UPDATE users SET name=?,email=?,group_id=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name, email, groupId, active, req.params.id);
  }
  audit(db, req.user.id, 'UPDATE', 'USER', req.params.id, { name, email, groupId, active: Boolean(active) });
  res.json({ id: Number(req.params.id), name, email, groupId, active });
});

app.get('/api/groups', authenticate, (req, res) => {
  const canViewGroups = req.user.permissions.includes('groups.view');
  if (!canViewGroups && !req.user.permissions.includes('users.view')) {
    return res.status(403).json({ error: 'Sem permissão para visualizar grupos.' });
  }
  const groups = db.prepare('SELECT * FROM access_groups ORDER BY name').all();
  const byGroup = db.prepare('SELECT permission_code FROM group_permissions WHERE group_id=?');
  res.json(groups.map(group => ({ ...group, permissions: canViewGroups ? byGroup.all(group.id).map(item => item.permission_code) : undefined })));
});

app.get('/api/permissions', authenticate, permit('groups.view'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM permissions ORDER BY module,label').all());
});

app.post('/api/groups', authenticate, permit('groups.create'), (req, res) => {
  const name = cleanText(req.body.name, 'Nome do grupo');
  const description = optionalText(req.body.description, 300);
  const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  const id = db.transaction(() => {
    const result = db.prepare('INSERT INTO access_groups(name,description) VALUES (?,?)').run(name, description);
    const grant = db.prepare('INSERT INTO group_permissions(group_id,permission_code) VALUES (?,?)');
    permissions.forEach(code => grant.run(result.lastInsertRowid, code));
    audit(db, req.user.id, 'CREATE', 'GROUP', result.lastInsertRowid, { name, permissions });
    return result.lastInsertRowid;
  })();
  res.status(201).json({ id, name, description, permissions });
});

app.put('/api/groups/:id', authenticate, permit('groups.edit'), (req, res) => {
  const group = db.prepare('SELECT * FROM access_groups WHERE id=?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado.' });
  if (demoMode && group.is_system) {
    return res.status(403).json({ error: 'Os grupos padrão são protegidos na demonstração pública.' });
  }
  const name = cleanText(req.body.name, 'Nome do grupo');
  const description = optionalText(req.body.description, 300);
  const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  if (group.name === 'Administradores' && (!permissions.includes('groups.view') || !permissions.includes('groups.edit'))) {
    throw Object.assign(new Error('O grupo Administradores deve manter acesso ao menu e à gestão de permissões.'), { status: 400 });
  }
  db.transaction(() => {
    db.prepare('UPDATE access_groups SET name=?,description=? WHERE id=?').run(name, description, group.id);
    db.prepare('DELETE FROM group_permissions WHERE group_id=?').run(group.id);
    const grant = db.prepare('INSERT INTO group_permissions(group_id,permission_code) VALUES (?,?)');
    permissions.forEach(code => grant.run(group.id, code));
    audit(db, req.user.id, 'UPDATE', 'GROUP', group.id, { name, permissions });
  })();
  res.json({ id: group.id, name, description, permissions });
});

app.get('/api/audit', authenticate, permit('audit.view'), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const logs = db.prepare(`SELECT a.*,u.name AS user_name FROM audit_logs a
    LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?`).all(limit);
  if (!req.user.permissions.includes('audit.details')) logs.forEach(log => delete log.details);
  res.json(logs);
});

function parseProduct(body, existing = null) {
  return {
    sku: cleanText(body.sku, 'SKU', 60).toUpperCase(),
    barcode: optionalText(body.barcode, 80) || null,
    name: cleanText(body.name, 'Nome do produto'),
    description: optionalText(body.description),
    categoryId: body.categoryId ? numeric(body.categoryId, 'Categoria', { allowZero: false }) : null,
    cost: numeric(body.cost ?? existing?.cost, 'Custo'),
    price: numeric(body.price ?? existing?.price, 'Preço'),
    stock: existing?.stock ?? numeric(body.stock || 0, 'Estoque inicial'),
    minStock: numeric(body.minStock ?? existing?.min_stock ?? 0, 'Estoque mínimo')
  };
}

function productPayload(product, user) {
  const result = { ...product };
  if (!user.permissions.includes('products.view_cost')) delete result.cost;
  const canSeeStock = user.permissions.some(code => ['products.view_stock', 'stock.view', 'sales.create'].includes(code));
  if (!canSeeStock) delete result.stock;
  if (!user.permissions.includes('products.view_stock') && !user.permissions.includes('stock.view')) delete result.min_stock;
  return result;
}

function getProduct(id) {
  return db.prepare(`SELECT p.*,c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`).get(id);
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint não encontrado.' }));
app.use(express.static(path.join(root, 'public')));
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(root, 'public', 'index.html'));
  next();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'Já existe um registro com esses dados ou há uma referência inválida.' });
  }
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível concluir a operação.' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => console.log(`Forjix Estoque disponível em http://localhost:${port}`));
}

export { app, db };
