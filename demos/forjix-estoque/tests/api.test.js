import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-with-enough-entropy-for-demo';

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
    body: JSON.stringify({ name: 'Consulta teste', description: 'Somente catálogo', permissions: ['products.view'] })
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
  assert.equal((await request('/products', { token: limitedToken })).response.status, 200);
  assert.equal((await request('/users', { token: limitedToken })).response.status, 403);

  const audit = await request('/audit', { token: adminToken });
  assert.ok(audit.body.some(item => item.entity === 'SALE' && item.action === 'CANCEL'));
});

test.after(() => {
  server.close();
  db.close();
});
