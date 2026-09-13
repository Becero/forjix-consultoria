import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-with-enough-entropy-for-demo';
process.env.DEMO_MODE = 'false';

const { app, db } = await import('../server.js');
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;

async function request(path, { token, ...options } = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

test('fluxo completo: autenticação, estoque, venda, cancelamento e permissões', async () => {
  const health = await request('/health');
  assert.equal(health.response.status, 200);

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@forjix.local', password: 'Forjix@123' })
  });
  assert.equal(login.response.status, 200);
  const adminToken = login.body.token;

  const category = await request('/categories', { token: adminToken });
  const createdProduct = await request('/products', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({
      sku: 'TESTE-001', barcode: '123456789', name: 'Produto de teste', description: 'Integração',
      categoryId: category.body[0].id, cost: 5, price: 10, stock: 10, minStock: 2
    })
  });
  assert.equal(createdProduct.response.status, 201);
  assert.equal(createdProduct.body.stock, 10);

  const movement = await request('/stock/movements', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({ productId: createdProduct.body.id, type: 'ENTRY', quantity: 5, unitCost: 5.5, note: 'Compra teste' })
  });
  assert.equal(movement.response.status, 201);
  assert.equal(movement.body.resulting_stock, 15);

  const sale = await request('/sales', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: createdProduct.body.id, quantity: 3 }], discount: 1, paymentMethod: 'PIX' })
  });
  assert.equal(sale.response.status, 201);
  assert.equal(sale.body.total, 29);

  const afterSale = await request('/products?search=TESTE-001', { token: adminToken });
  assert.equal(afterSale.body[0].stock, 12);

  const cancelled = await request(`/sales/${sale.body.id}/cancel`, { token: adminToken, method: 'POST' });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.status, 'CANCELLED');
  const afterCancel = await request('/products?search=TESTE-001', { token: adminToken });
  assert.equal(afterCancel.body[0].stock, 15);

  const group = await request('/groups', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({
      name: 'Consulta teste', description: 'Catálogo, caixa sem desconto e auditoria sem detalhes',
      permissions: ['products.view', 'products.edit', 'sales.create', 'audit.view']
    })
  });
  assert.equal(group.response.status, 201);
  const user = await request('/users', {
    token: adminToken,
    method: 'POST',
    body: JSON.stringify({ name: 'Leitor Teste', email: 'leitor@teste.local', password: 'Teste@123', groupId: group.body.id })
  });
  assert.equal(user.response.status, 201);
  const limitedLogin = await request('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'leitor@teste.local', password: 'Teste@123' })
  });
  const limitedToken = limitedLogin.body.token;
  const limitedProducts = await request('/products', { token: limitedToken });
  assert.equal(limitedProducts.response.status, 200);
  assert.equal('cost' in limitedProducts.body[0], false);
  assert.equal('stock' in limitedProducts.body[0], true, 'O caixa precisa do saldo para vender');
  assert.equal('min_stock' in limitedProducts.body[0], false);
  assert.equal((await request('/users', { token: limitedToken })).response.status, 403);
  const protectedEdit = await request(`/products/${createdProduct.body.id}`, {
    token: limitedToken,
    method: 'PUT',
    body: JSON.stringify({
      sku: createdProduct.body.sku, barcode: createdProduct.body.barcode, name: createdProduct.body.name,
      description: createdProduct.body.description, categoryId: createdProduct.body.category_id,
      cost: 999, price: createdProduct.body.price, minStock: 999
    })
  });
  assert.equal(protectedEdit.response.status, 200);
  const protectedFields = await request('/products?search=TESTE-001', { token: adminToken });
  assert.equal(protectedFields.body[0].cost, 5.5);
  assert.equal(protectedFields.body[0].min_stock, 2);
  assert.equal((await request(`/products/${createdProduct.body.id}`, {
    token: limitedToken,
    method: 'PUT',
    body: JSON.stringify({ ...protectedEdit.body, categoryId: protectedEdit.body.category_id, minStock: 2, active: false })
  })).response.status, 403);
  assert.equal((await request('/stock/movements', {
    token: limitedToken,
    method: 'POST',
    body: JSON.stringify({ productId: createdProduct.body.id, type: 'ENTRY', quantity: 1 })
  })).response.status, 403);
  assert.equal((await request('/sales', {
    token: limitedToken,
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: createdProduct.body.id, quantity: 1 }], discount: 1, paymentMethod: 'PIX' })
  })).response.status, 403);
  const limitedAudit = await request('/audit', { token: limitedToken });
  assert.equal(limitedAudit.response.status, 200);
  assert.equal('details' in limitedAudit.body[0], false);

  const permissions = await request('/permissions', { token: adminToken });
  assert.ok(permissions.body.some(item => item.code === 'products.view_cost'));
  assert.ok(permissions.body.some(item => item.code === 'groups.edit'));

  const salesOperator = await request('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'vendas@forjix.local', password: 'Forjix@123' })
  });
  const salesDashboard = await request('/dashboard', { token: salesOperator.body.token });
  assert.equal('salesToday' in salesDashboard.body.stats, true);
  assert.equal('inventoryCost' in salesDashboard.body.stats, false);

  const stockOperator = await request('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'estoque@forjix.local', password: 'Forjix@123' })
  });
  const stockReport = await request('/reports/summary', { token: stockOperator.body.token });
  assert.equal(stockReport.body.sales, null);
  assert.ok(stockReport.body.inventory.lowStock);

  const audit = await request('/audit', { token: adminToken });
  assert.ok(audit.body.some(item => item.entity === 'SALE' && item.action === 'CANCEL'));
});

test.after(() => {
  server.close();
  db.close();
});
