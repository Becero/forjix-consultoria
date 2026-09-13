const state = { user: null, currentView: 'dashboard', products: [], categories: [], cart: new Map() };
const $ = selector => document.querySelector(selector);
const content = $('#content');
const titles = {
  dashboard: ['VISÃO GERAL', 'Painel'], products: ['CATÁLOGO', 'Produtos'], stock: ['MOVIMENTAÇÕES', 'Estoque'],
  pos: ['ATENDIMENTO', 'Frente de caixa'], sales: ['HISTÓRICO', 'Vendas'], reports: ['ANÁLISES', 'Relatórios'],
  users: ['ADMINISTRAÇÃO', 'Usuários'], groups: ['ADMINISTRAÇÃO', 'Grupos de acesso'], audit: ['SEGURANÇA', 'Auditoria']
};
const permissionForView = {
  dashboard: 'dashboard.view', products: 'products.view', stock: 'stock.view', pos: 'sales.create', sales: 'sales.view',
  reports: 'reports.view', users: 'users.view', groups: 'groups.view', audit: 'audit.view'
};

const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const number = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(value || 0));
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(`${value.replace(' ', 'T')}Z`)) : '—';
const h = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const has = permission => state.user?.permissions.includes(permission);
const activeBadge = active => `<span class="badge ${active ? 'success' : 'danger'}">${active ? 'Ativo' : 'Inativo'}</span>`;

async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401 && !url.startsWith('/auth/login')) {
    showLogin();
    throw new Error('Sua sessão expirou.');
  }
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || 'Não foi possível concluir a operação.');
  return body;
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 3500);
}

function showLogin() {
  state.user = null;
  $('#app-shell').hidden = true;
  $('#login-screen').hidden = false;
}

function showApp(user) {
  state.user = user;
  $('#login-screen').hidden = true;
  $('#app-shell').hidden = false;
  $('#user-name').textContent = user.name;
  $('#user-group').textContent = user.groupName;
  $('#user-avatar').textContent = user.name.charAt(0).toUpperCase();
  document.querySelectorAll('[data-permission]').forEach(element => element.hidden = !has(element.dataset.permission));
  const adminDivider = document.querySelector('[data-admin]');
  adminDivider.hidden = !['users.view', 'groups.view', 'audit.view'].some(has);
  const firstView = has('dashboard.view') ? 'dashboard' : Object.keys(permissionForView).find(view => has(permissionForView[view]));
  if (firstView) navigate(firstView);
  else {
    $('#page-kicker').textContent = 'ACESSO RESTRITO';
    $('#page-title').textContent = 'Sem áreas liberadas';
    content.innerHTML = empty('Nenhum menu disponível', 'Solicite ao administrador a inclusão das permissões necessárias em seu grupo de acesso.');
  }
}

async function navigate(view) {
  if (!has(permissionForView[view])) return;
  state.currentView = view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#page-kicker').textContent = titles[view][0];
  $('#page-title').textContent = titles[view][1];
  $('#sidebar').classList.remove('open');
  content.innerHTML = '<div class="empty-state">Carregando informações…</div>';
  try {
    await views[view]();
    content.focus();
  } catch (error) {
    content.innerHTML = `<div class="empty-state"><strong>Não foi possível carregar esta área.</strong>${h(error.message)}</div>`;
    toast(error.message, 'error');
  }
}

const views = {
  async dashboard() {
    const data = await api('/dashboard');
    const max = Math.max(...(data.salesByDay || []).map(item => item.total), 1);
    const stats = [
      data.stats.salesToday != null ? stat('Vendas de hoje', money(data.stats.salesToday), `${data.stats.salesCountToday} venda(s)`) : '',
      data.stats.productCount != null ? stat('Produtos ativos', number(data.stats.productCount), 'itens cadastrados') : '',
      data.stats.inventoryCost != null ? stat('Custo do estoque', money(data.stats.inventoryCost), 'valor pelo custo atual') : '',
      data.stats.lowStockCount != null ? stat('Estoque baixo', number(data.stats.lowStockCount), 'itens pedindo atenção', data.stats.lowStockCount ? 'warning' : '') : ''
    ].join('');
    const salesPanel = data.salesByDay ? `<section class="panel"><div class="panel-header"><h2>Vendas nos últimos 7 dias</h2><span>VALOR TOTAL</span></div>
      <div class="panel-body"><div class="bar-chart">${data.salesByDay.map(item => `<div class="bar-item"><div class="bar" style="height:${Math.max(3, item.total / max * 145)}px" title="${money(item.total)}"></div><span>${item.day.slice(5).split('-').reverse().join('/')}</span></div>`).join('')}</div></div></section>` : '';
    const inventoryPanel = data.lowStock ? `<section class="panel"><div class="panel-header"><h2>Itens com estoque baixo</h2><span>${data.lowStock.length} EXIBIDOS</span></div>
      <div class="panel-body"><div class="alert-list">${data.lowStock.length ? data.lowStock.map(item => `<div class="alert-item"><div><strong>${h(item.name)}</strong><br><span>${h(item.sku)}</span></div><span class="badge warning">${number(item.stock)} / mín. ${number(item.min_stock)}</span></div>`).join('') : empty('Estoque em dia', 'Nenhum item abaixo do mínimo.')}</div></div></section>` : '';
    content.innerHTML = `
      ${stats ? `<div class="stat-grid">${stats}</div>` : ''}
      ${salesPanel || inventoryPanel ? `<div class="panel-grid">${salesPanel}${inventoryPanel}</div>` : ''}
      ${data.recentSales ? `<section class="panel" style="margin-top:18px"><div class="panel-header"><h2>Vendas recentes</h2><span>ÚLTIMAS OPERAÇÕES</span></div><div class="table-wrap">${salesTable(data.recentSales, false)}</div></section>` : ''}`;
  },

  async products() {
    [state.products, state.categories] = await Promise.all([api('/products?active=all'), api('/categories')]);
    renderProducts();
  },

  async stock() {
    state.products = await api('/products');
    const movements = await api('/stock/movements');
    content.innerHTML = `
      <div class="page-actions"><p>Acompanhe entradas, saídas e acertos de inventário.</p>${['stock.entry', 'stock.exit', 'stock.adjust'].some(has) ? '<button class="button primary" id="new-movement">+ Nova movimentação</button>' : ''}</div>
      <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>DATA</th><th>PRODUTO</th><th>TIPO</th><th>QUANTIDADE</th><th>SALDO ANTERIOR</th><th>NOVO SALDO</th><th>RESPONSÁVEL</th><th>OBSERVAÇÃO</th></tr></thead><tbody>
      ${movements.map(item => `<tr><td>${dateTime(item.created_at)}</td><td><div class="product-cell"><strong>${h(item.product_name)}</strong><span>${h(item.sku)}</span></div></td><td>${movementBadge(item.type)}</td><td>${item.quantity > 0 ? '+' : ''}${number(item.quantity)}</td><td>${number(item.previous_stock)}</td><td><strong>${number(item.resulting_stock)}</strong></td><td>${h(item.user_name)}</td><td>${h(item.note || '—')}</td></tr>`).join('') || `<tr><td colspan="8">${empty('Sem movimentações', 'As operações de estoque aparecerão aqui.')}</td></tr>`}
      </tbody></table></div></section>`;
    $('#new-movement')?.addEventListener('click', openMovementModal);
  },

  async pos() {
    state.products = await api('/products');
    renderPos();
  },

  async sales() {
    const sales = await api('/sales');
    content.innerHTML = `<div class="page-actions"><p>Consulte vendas concluídas e canceladas.</p></div><section class="panel"><div class="table-wrap">${salesTable(sales, true)}</div></section>`;
    content.querySelectorAll('[data-cancel-sale]').forEach(button => button.addEventListener('click', () => cancelSale(button.dataset.cancelSale)));
    content.querySelectorAll('[data-view-sale]').forEach(button => button.addEventListener('click', () => viewSale(button.dataset.viewSale)));
  },

  async reports() { await renderReports(); },

  async users() {
    const [users, groups] = await Promise.all([api('/users'), api('/groups')]);
    const canEdit = has('users.edit');
    content.innerHTML = `<div class="page-actions"><p>Cadastre pessoas e vincule cada uma ao grupo adequado.</p>${has('users.create') ? '<button class="button primary" id="new-user">+ Novo usuário</button>' : ''}</div>
      <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>USUÁRIO</th><th>GRUPO</th><th>STATUS</th><th>CRIADO EM</th>${canEdit ? '<th>AÇÕES</th>' : ''}</tr></thead><tbody>
      ${users.map(user => `<tr><td><div class="product-cell"><strong>${h(user.name)}</strong><span>${h(user.email)}</span></div></td><td>${h(user.group_name)}</td><td>${activeBadge(user.active)}</td><td>${dateTime(user.created_at)}</td>${canEdit ? `<td><button class="button secondary small" data-edit-user="${user.id}">Editar</button></td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;
    $('#new-user')?.addEventListener('click', () => openUserModal(null, groups));
    content.querySelectorAll('[data-edit-user]').forEach(button => button.addEventListener('click', () => openUserModal(users.find(item => item.id === Number(button.dataset.editUser)), groups)));
  },

  async groups() {
    const [groups, permissions] = await Promise.all([api('/groups'), api('/permissions')]);
    const canEdit = has('groups.edit');
    content.innerHTML = `<div class="page-actions"><p>Defina quais menus, informações e ações cada perfil pode utilizar.</p>${has('groups.create') ? '<button class="button primary" id="new-group">+ Novo grupo</button>' : ''}</div>
      <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>GRUPO</th><th>DESCRIÇÃO</th><th>PERMISSÕES</th><th>TIPO</th>${canEdit ? '<th>AÇÕES</th>' : ''}</tr></thead><tbody>
      ${groups.map(group => `<tr><td><strong>${h(group.name)}</strong></td><td>${h(group.description || '—')}</td><td>${group.permissions.length} permissões</td><td>${group.is_system ? '<span class="badge">Padrão</span>' : '<span class="badge success">Personalizado</span>'}</td>${canEdit ? `<td><button class="button secondary small" data-edit-group="${group.id}">Configurar</button></td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;
    $('#new-group')?.addEventListener('click', () => openGroupModal(null, permissions));
    content.querySelectorAll('[data-edit-group]').forEach(button => button.addEventListener('click', () => openGroupModal(groups.find(item => item.id === Number(button.dataset.editGroup)), permissions)));
  },

  async audit() {
    const logs = await api('/audit');
    const canSeeDetails = has('audit.details');
    content.innerHTML = `<div class="page-actions"><p>Registro das ações importantes realizadas no sistema.</p></div><section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>DATA</th><th>USUÁRIO</th><th>AÇÃO</th><th>ENTIDADE</th><th>IDENTIFICADOR</th>${canSeeDetails ? '<th>DETALHES</th>' : ''}</tr></thead><tbody>
      ${logs.map(log => `<tr><td>${dateTime(log.created_at)}</td><td>${h(log.user_name || 'Sistema')}</td><td><span class="badge">${h(log.action)}</span></td><td>${h(log.entity)}</td><td>${h(log.entity_id || '—')}</td>${canSeeDetails ? `<td title="${h(log.details)}">${h(log.details).slice(0, 75)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${canSeeDetails ? 6 : 5}">${empty('Sem registros', 'A trilha de auditoria aparecerá aqui.')}</td></tr>`}</tbody></table></div></section>`;
  }
};

function stat(label, value, detail, className = '') { return `<article class="stat-card ${className}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`; }
function empty(title, description) { return `<div class="empty-state"><strong>${title}</strong>${description}</div>`; }
function movementBadge(type) {
  const map = { ENTRY: ['Entrada', 'success'], EXIT: ['Saída', 'danger'], ADJUSTMENT: ['Ajuste', 'warning'] };
  return `<span class="badge ${map[type]?.[1] || ''}">${map[type]?.[0] || h(type)}</span>`;
}

function renderProducts(filtered = state.products) {
  const canSeeCost = has('products.view_cost');
  const canSeeStock = has('products.view_stock');
  const hasActions = has('products.edit') || has('products.deactivate');
  content.innerHTML = `
    <div class="page-actions"><p>Catálogo, preços e níveis atuais de estoque.</p><div class="action-group">${has('categories.manage') ? '<button class="button secondary" id="categories-button">Categorias</button>' : ''}${has('products.create') ? '<button class="button primary" id="new-product">+ Novo produto</button>' : ''}</div></div>
    <div class="filters"><input id="product-search" type="search" placeholder="Buscar por nome, SKU ou código…"><select id="product-category"><option value="">Todas as categorias</option>${state.categories.filter(item => item.active).map(item => `<option value="${item.id}">${h(item.name)}</option>`).join('')}</select><select id="product-status"><option value="all">Todos os status</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></div>
    <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>PRODUTO</th><th>CATEGORIA</th><th>PREÇO</th>${canSeeCost ? '<th>CUSTO</th>' : ''}${canSeeStock ? '<th>ESTOQUE</th><th>MÍNIMO</th>' : ''}<th>STATUS</th>${hasActions ? '<th>AÇÕES</th>' : ''}</tr></thead><tbody id="products-body">${productRows(filtered)}</tbody></table></div></section>`;
  const apply = () => {
    const search = $('#product-search').value.toLowerCase();
    const category = $('#product-category').value;
    const status = $('#product-status').value;
    const rows = state.products.filter(item => (!search || `${item.name} ${item.sku} ${item.barcode || ''}`.toLowerCase().includes(search)) && (!category || item.category_id === Number(category)) && (status === 'all' || Boolean(item.active) === (status === 'active')));
    $('#products-body').innerHTML = productRows(rows);
    bindProductActions();
  };
  ['#product-search', '#product-category', '#product-status'].forEach(selector => $(selector).addEventListener('input', apply));
  $('#new-product')?.addEventListener('click', () => openProductModal());
  $('#categories-button')?.addEventListener('click', openCategoriesModal);
  bindProductActions();
}

function productRows(products) {
  const canSeeCost = has('products.view_cost');
  const canSeeStock = has('products.view_stock');
  const hasActions = has('products.edit') || has('products.deactivate');
  const columnCount = 4 + Number(canSeeCost) + Number(canSeeStock) * 2 + Number(hasActions);
  return products.map(item => `<tr><td><div class="product-cell"><strong>${h(item.name)}</strong><span>${h(item.sku)}${item.barcode ? ` · ${h(item.barcode)}` : ''}</span></div></td><td>${h(item.category_name || 'Sem categoria')}</td><td><strong>${money(item.price)}</strong></td>${canSeeCost ? `<td>${money(item.cost)}</td>` : ''}${canSeeStock ? `<td><span class="badge ${item.stock <= item.min_stock ? 'warning' : 'success'}">${number(item.stock)}</span></td><td>${number(item.min_stock)}</td>` : ''}<td>${activeBadge(item.active)}</td>${hasActions ? `<td><div class="table-actions">${has('products.edit') ? `<button class="button secondary small" data-edit-product="${item.id}">Editar</button>` : ''}${item.active && has('products.deactivate') ? `<button class="button danger small" data-delete-product="${item.id}">Desativar</button>` : ''}</div></td>` : ''}</tr>`).join('') || `<tr><td colspan="${columnCount}">${empty('Nenhum produto encontrado', 'Ajuste os filtros ou cadastre um novo item.')}</td></tr>`;
}

function bindProductActions() {
  content.querySelectorAll('[data-edit-product]').forEach(button => button.addEventListener('click', () => openProductModal(state.products.find(item => item.id === Number(button.dataset.editProduct)))));
  content.querySelectorAll('[data-delete-product]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Deseja desativar este produto?')) return;
    try { await api(`/products/${button.dataset.deleteProduct}`, { method: 'DELETE' }); toast('Produto desativado.'); await views.products(); } catch (error) { toast(error.message, 'error'); }
  }));
}

function openModal({ title, kicker = 'CADASTRO', body, submitText = 'Salvar', onSubmit }) {
  $('#modal-title').textContent = title;
  $('#modal-kicker').textContent = kicker;
  $('#modal-body').innerHTML = body;
  $('#modal-submit').textContent = submitText;
  $('#modal-submit').hidden = !onSubmit;
  $('#modal-form').onsubmit = async event => {
    event.preventDefault();
    if (event.submitter?.value === 'cancel' || !onSubmit) return $('#modal').close();
    const button = $('#modal-submit');
    button.disabled = true;
    try { await onSubmit(new FormData(event.currentTarget)); $('#modal').close(); } catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; }
  };
  $('#modal').showModal();
}

function openProductModal(product = null) {
  const categoryOptions = state.categories.filter(item => item.active || item.id === product?.category_id).map(item => `<option value="${item.id}" ${item.id === product?.category_id ? 'selected' : ''}>${h(item.name)}</option>`).join('');
  openModal({ title: product ? 'Editar produto' : 'Novo produto', body: `<div class="form-grid">
    <label>Nome<input name="name" value="${h(product?.name || '')}" required></label><label>SKU<input name="sku" value="${h(product?.sku || '')}" required></label>
    <label>Código de barras<input name="barcode" value="${h(product?.barcode || '')}"></label><label>Categoria<select name="categoryId"><option value="">Sem categoria</option>${categoryOptions}</select></label>
    ${has('products.view_cost') ? `<label>Custo<input name="cost" type="number" min="0" step="0.01" value="${product?.cost ?? 0}" required></label>` : ''}<label>Preço de venda<input name="price" type="number" min="0" step="0.01" value="${product?.price ?? 0}" required></label>
    ${!product && has('stock.entry') ? '<label>Estoque inicial<input name="stock" type="number" min="0" step="0.001" value="0" required></label>' : ''}${has('products.view_stock') ? `<label>Estoque mínimo<input name="minStock" type="number" min="0" step="0.001" value="${product?.min_stock ?? 0}" required></label>` : ''}
    <label class="full">Descrição<textarea name="description">${h(product?.description || '')}</textarea></label>${product && has('products.deactivate') ? `<label class="check-row full"><input type="checkbox" name="active" ${product.active ? 'checked' : ''}> Produto ativo</label>` : ''}
  </div>`, onSubmit: async form => {
    const payload = Object.fromEntries(form);
    if (product && has('products.deactivate')) payload.active = form.has('active');
    await api(product ? `/products/${product.id}` : '/products', { method: product ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    toast(product ? 'Produto atualizado.' : 'Produto cadastrado.');
    await views.products();
  }});
}

function openCategoriesModal() {
  openModal({ title: 'Nova categoria', kicker: 'ORGANIZAÇÃO DO CATÁLOGO', body: `<label>Nome da categoria<input name="name" required></label><div style="margin-top:18px" class="alert-list">${state.categories.map(item => `<div class="alert-item"><strong>${h(item.name)}</strong>${activeBadge(item.active)}</div>`).join('')}</div>`, submitText: 'Adicionar categoria', onSubmit: async form => {
    await api('/categories', { method: 'POST', body: JSON.stringify({ name: form.get('name') }) });
    toast('Categoria adicionada.'); await views.products();
  }});
}

function openMovementModal() {
  const operations = [
    has('stock.entry') ? '<option value="ENTRY">Entrada</option>' : '',
    has('stock.exit') ? '<option value="EXIT">Saída</option>' : '',
    has('stock.adjust') ? '<option value="ADJUSTMENT">Ajuste de inventário</option>' : ''
  ].join('');
  openModal({ title: 'Movimentar estoque', kicker: 'ENTRADA, SAÍDA OU AJUSTE', body: `<div class="form-grid">
    <label class="full">Produto<select name="productId" required><option value="">Selecione…</option>${state.products.map(item => `<option value="${item.id}">${h(item.name)} · saldo ${number(item.stock)}</option>`).join('')}</select></label>
    <label>Operação<select name="type" required>${operations}</select></label>
    <label>Quantidade<input name="quantity" type="number" min="0" step="0.001" required></label>${has('products.view_cost') ? '<label>Custo unitário<input name="unitCost" type="number" min="0" step="0.01" placeholder="Opcional"></label>' : ''}
    <label class="full">Observação<textarea name="note" placeholder="Ex.: compra do fornecedor ou correção da contagem"></textarea></label></div>
    <p style="margin-top:12px;color:var(--muted);font-size:10px">Em “Ajuste”, informe a quantidade total contada no estoque.</p>`, submitText: 'Registrar movimentação', onSubmit: async form => {
    await api('/stock/movements', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    toast('Movimentação registrada.'); await views.stock();
  }});
}

function renderPos(filter = '') {
  const available = state.products.filter(item => item.stock > 0 && `${item.name} ${item.sku} ${item.barcode || ''}`.toLowerCase().includes(filter.toLowerCase()));
  content.innerHTML = `<div class="pos-layout"><section class="product-browser"><div class="page-actions"><div><strong>Selecionar produtos</strong><p style="color:var(--muted);font-size:10px">Clique para adicionar ao carrinho.</p></div></div><input id="pos-search" type="search" placeholder="Buscar produto, SKU ou código de barras…" value="${h(filter)}"><div class="product-grid">${available.map(item => `<button class="product-tile" data-add-cart="${item.id}"><strong>${h(item.name)}</strong><span>${h(item.sku)} · ${number(item.stock)} em estoque</span><b>${money(item.price)}</b></button>`).join('') || empty('Nenhum item disponível', 'Verifique a busca ou o saldo em estoque.')}</div></section><aside class="cart"><h2>Venda atual</h2><div class="cart-items" id="cart-items"></div><div id="cart-summary"></div></aside></div>`;
  $('#pos-search').addEventListener('input', event => renderPos(event.target.value));
  content.querySelectorAll('[data-add-cart]').forEach(button => button.addEventListener('click', () => addToCart(Number(button.dataset.addCart))));
  renderCart();
}

function addToCart(id) {
  const product = state.products.find(item => item.id === id);
  const current = state.cart.get(id) || 0;
  if (current >= product.stock) return toast('Não há mais unidades disponíveis.', 'error');
  state.cart.set(id, current + 1); renderCart();
}

function changeCart(id, delta) {
  const product = state.products.find(item => item.id === id);
  const next = (state.cart.get(id) || 0) + delta;
  if (next <= 0) state.cart.delete(id); else if (next <= product.stock) state.cart.set(id, next); else return toast('Quantidade acima do estoque disponível.', 'error');
  renderCart();
}

function renderCart() {
  const items = [...state.cart].map(([id, quantity]) => ({ product: state.products.find(item => item.id === id), quantity }));
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  $('#cart-items').innerHTML = items.length ? items.map(item => `<div class="cart-item"><div><strong>${h(item.product.name)}</strong><br><span>${money(item.product.price)} cada</span></div><div class="quantity-control"><button data-cart-change="${item.product.id}" data-delta="-1">−</button><b>${number(item.quantity)}</b><button data-cart-change="${item.product.id}" data-delta="1">+</button></div></div>`).join('') : empty('Carrinho vazio', 'Selecione um produto para começar.');
  $('#cart-summary').innerHTML = `<div class="cart-summary">${has('sales.discount') ? '<label>Desconto<input id="sale-discount" type="number" min="0" step="0.01" value="0"></label>' : ''}<label>Pagamento<select id="payment-method"><option>Dinheiro</option><option>PIX</option><option>Cartão de débito</option><option>Cartão de crédito</option></select></label><div class="summary-row"><span>Subtotal</span><span>${money(subtotal)}</span></div><div class="summary-row total"><span>Total</span><span id="sale-total">${money(subtotal)}</span></div><button class="button primary" id="finish-sale" ${items.length ? '' : 'disabled'}>Finalizar venda</button></div>`;
  content.querySelectorAll('[data-cart-change]').forEach(button => button.addEventListener('click', () => changeCart(Number(button.dataset.cartChange), Number(button.dataset.delta))));
  $('#sale-discount')?.addEventListener('input', event => $('#sale-total').textContent = money(Math.max(0, subtotal - Number(event.target.value || 0))));
  $('#finish-sale').addEventListener('click', finishSale);
}

async function finishSale() {
  const items = [...state.cart].map(([productId, quantity]) => ({ productId, quantity }));
  try {
    const sale = await api('/sales', { method: 'POST', body: JSON.stringify({ items, discount: $('#sale-discount')?.value || 0, paymentMethod: $('#payment-method').value }) });
    state.cart.clear(); toast(`Venda ${sale.number} concluída: ${money(sale.total)}.`); await views.pos();
  } catch (error) { toast(error.message, 'error'); }
}

function salesTable(sales, actions) {
  const hasActions = actions && (has('sales.details') || has('sales.cancel'));
  return `<table class="data-table"><thead><tr><th>VENDA</th><th>DATA</th><th>OPERADOR</th><th>PAGAMENTO</th><th>ITENS</th><th>TOTAL</th><th>STATUS</th>${hasActions ? '<th>AÇÕES</th>' : ''}</tr></thead><tbody>${sales.map(sale => `<tr><td><strong>${h(sale.number)}</strong></td><td>${dateTime(sale.created_at)}</td><td>${h(sale.user_name)}</td><td>${h(sale.payment_method)}</td><td>${sale.item_count ?? '—'}</td><td><strong>${money(sale.total)}</strong></td><td><span class="badge ${sale.status === 'COMPLETED' ? 'success' : 'danger'}">${sale.status === 'COMPLETED' ? 'Concluída' : 'Cancelada'}</span></td>${hasActions ? `<td><div class="table-actions">${has('sales.details') ? `<button class="button secondary small" data-view-sale="${sale.id}">Detalhes</button>` : ''}${sale.status === 'COMPLETED' && has('sales.cancel') ? `<button class="button danger small" data-cancel-sale="${sale.id}">Cancelar</button>` : ''}</div></td>` : ''}</tr>`).join('') || `<tr><td colspan="${hasActions ? 8 : 7}">${empty('Nenhuma venda', 'As vendas realizadas aparecerão aqui.')}</td></tr>`}</tbody></table>`;
}

async function viewSale(id) {
  try {
    const sale = await api(`/sales/${id}`);
    openModal({ title: sale.number, kicker: 'DETALHES DA VENDA', body: `<div class="stat-grid" style="grid-template-columns:1fr 1fr"><div class="stat-card"><span>Total</span><strong>${money(sale.total)}</strong></div><div class="stat-card"><span>Status</span><strong style="font-size:18px">${sale.status === 'COMPLETED' ? 'Concluída' : 'Cancelada'}</strong></div></div><div class="alert-list">${sale.items.map(item => `<div class="alert-item"><div><strong>${h(item.product_name)}</strong><br><span>${h(item.sku)} · ${number(item.quantity)} × ${money(item.unit_price)}</span></div><strong>${money(item.total)}</strong></div>`).join('')}</div>` });
  } catch (error) { toast(error.message, 'error'); }
}

async function cancelSale(id) {
  if (!confirm('Cancelar esta venda? Os itens voltarão ao estoque.')) return;
  try { await api(`/sales/${id}/cancel`, { method: 'POST' }); toast('Venda cancelada e estoque devolvido.'); await views.sales(); } catch (error) { toast(error.message, 'error'); }
}

async function renderReports(from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10), to = new Date().toISOString().slice(0,10)) {
  const report = await api(`/reports/summary?from=${from}&to=${to}`);
  const exportOptions = `${report.sales && report.inventory ? '<option value="complete">Relatório completo</option>' : ''}${report.sales ? '<option value="sales">Somente vendas</option>' : ''}${report.inventory ? '<option value="inventory">Somente estoque</option>' : ''}`;
  const salesSection = report.sales ? renderSalesReport(report.sales) : '';
  const inventorySection = report.inventory ? renderInventoryReport(report.inventory) : '';
  content.innerHTML = `<div class="report-toolbar"><div><strong>Central de relatórios</strong><p>Analise o período e gere documentos prontos para compartilhar.</p></div>${exportOptions ? `<div class="export-actions"><select id="export-type" aria-label="Conteúdo da exportação">${exportOptions}</select><button class="button secondary" data-export="xlsx">↓ Excel</button><button class="button secondary" data-export="pdf">↓ PDF</button></div>` : ''}</div>
    <div class="filters report-filters"><label>Data inicial<input id="report-from" type="date" value="${h(from)}"></label><label>Data final<input id="report-to" type="date" value="${h(to)}"></label><button class="button primary" id="apply-report">Atualizar análise</button><div class="period-shortcuts"><button data-period="7">7 dias</button><button data-period="30">30 dias</button><button data-period="90">90 dias</button></div></div>
    ${salesSection || inventorySection ? `${salesSection}${inventorySection}` : empty('Sem conteúdo liberado', 'O grupo pode abrir Relatórios, mas ainda não recebeu acesso aos relatórios de vendas ou estoque.')}`;
  $('#apply-report').addEventListener('click', () => renderReports($('#report-from').value, $('#report-to').value));
  content.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    const end = new Date();
    const start = new Date(Date.now() - (Number(button.dataset.period) - 1) * 86400000);
    renderReports(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  }));
  content.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => downloadReport(button.dataset.export, $('#export-type').value, from, to, button)));
}

function renderSalesReport(sales) {
  const max = Math.max(...sales.daily.map(item => item.total), 1);
  return `<section class="report-section"><div class="report-heading"><div><span>DESEMPENHO COMERCIAL</span><h2>Vendas no período</h2></div><small>${sales.summary.saleCount} venda(s) concluída(s)</small></div>
    <div class="stat-grid">${stat('Faturamento',money(sales.summary.revenue),'receita líquida')}${stat('Vendas',number(sales.summary.saleCount),'operações concluídas')}${stat('Ticket médio',money(sales.summary.averageTicket),'valor por venda')}${stat('Descontos',money(sales.summary.discounts),'total concedido')}</div>
    <div class="panel-grid"><section class="panel"><div class="panel-header"><h2>Evolução das vendas</h2><span>FATURAMENTO DIÁRIO</span></div><div class="panel-body"><div class="bar-chart">${sales.daily.map(item=>`<div class="bar-item"><div class="bar" style="height:${Math.max(3,item.total/max*145)}px" title="${money(item.total)}"></div><span>${item.day.slice(5).split('-').reverse().join('/')}</span></div>`).join('')||empty('Sem dados','Não houve venda no período.')}</div></div></section>
    <section class="panel"><div class="panel-header"><h2>Formas de pagamento</h2><span>PARTICIPAÇÃO</span></div><div class="panel-body"><div class="metric-list">${sales.paymentMethods.map(item=>`<div><span>${h(item.method)}<small>${item.count} venda(s)</small></span><strong>${money(item.total)}</strong></div>`).join('')||empty('Sem pagamentos','Não houve venda no período.')}</div></div></section></div>
    <div class="panel-grid report-panels"><section class="panel"><div class="panel-header"><h2>Produtos mais vendidos</h2><span>TOP 10</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>PRODUTO</th><th>QUANTIDADE</th><th>RECEITA</th></tr></thead><tbody>${sales.topProducts.map(item=>`<tr><td><div class="product-cell"><strong>${h(item.name)}</strong><span>${h(item.sku)}</span></div></td><td>${number(item.quantity)}</td><td>${money(item.revenue)}</td></tr>`).join('')||`<tr><td colspan="3">${empty('Sem vendas no período','Altere as datas ou realize uma venda.')}</td></tr>`}</tbody></table></div></section>
    <section class="panel"><div class="panel-header"><h2>Vendas recentes</h2><span>NO PERÍODO</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>VENDA</th><th>DATA</th><th>PAGAMENTO</th><th>TOTAL</th></tr></thead><tbody>${sales.transactions.slice(0,10).map(item=>`<tr><td><strong>${h(item.number)}</strong><br><small>${h(item.user_name)}</small></td><td>${dateTime(item.created_at)}</td><td>${h(item.payment_method)}</td><td><strong>${money(item.total)}</strong></td></tr>`).join('')||`<tr><td colspan="4">${empty('Sem vendas','Nenhuma venda concluída no período.')}</td></tr>`}</tbody></table></div></section></div></section>`;
}

function renderInventoryReport(inventory) {
  return `<section class="report-section"><div class="report-heading"><div><span>POSIÇÃO ATUAL</span><h2>Estoque e reposição</h2></div><small>Atualizado agora</small></div>
    <div class="stat-grid">${stat('Produtos ativos',number(inventory.summary.productCount),'itens no catálogo')}${stat('Unidades em estoque',number(inventory.summary.totalStock),'saldo total')}${stat('Estoque baixo',number(inventory.summary.lowStockCount),'itens para repor',inventory.summary.lowStockCount?'warning':'')}${inventory.summary.inventoryValue != null?stat('Valor do estoque',money(inventory.summary.inventoryValue),'calculado pelo custo'):''}</div>
    <div class="panel-grid"><section class="panel"><div class="panel-header"><h2>Estoque por categoria</h2><span>VISÃO CONSOLIDADA</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>CATEGORIA</th><th>PRODUTOS</th><th>UNIDADES</th>${inventory.canSeeCost?'<th>VALOR</th>':''}</tr></thead><tbody>${inventory.categorySummary.map(item=>`<tr><td><strong>${h(item.category)}</strong></td><td>${number(item.productCount)}</td><td>${number(item.totalStock)}</td>${inventory.canSeeCost?`<td>${money(item.inventoryValue)}</td>`:''}</tr>`).join('')}</tbody></table></div></section>
    <section class="panel"><div class="panel-header"><h2>Reposição necessária</h2><span>ESTOQUE MÍNIMO</span></div><div class="panel-body"><div class="alert-list">${inventory.lowStock.map(item=>`<div class="alert-item"><div><strong>${h(item.name)}</strong><br><span>${h(item.sku)}</span></div><span class="badge warning">${number(item.stock)} / ${number(item.min_stock)}</span></div>`).join('')||empty('Estoque em dia','Nenhum item abaixo do mínimo.')}</div></div></section></div></section>`;
}

async function downloadReport(format, type, from, to, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Gerando…';
  try {
    const response = await fetch(`/api/reports/export?format=${encodeURIComponent(format)}&type=${encodeURIComponent(type)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error || 'Não foi possível gerar o arquivo.');
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `forjix-relatorio.${format}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    toast(`Relatório ${format.toUpperCase()} gerado com sucesso.`);
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = original; }
}

function openUserModal(user, groups) {
  openModal({ title: user ? 'Editar usuário' : 'Novo usuário', body: `<div class="form-grid"><label>Nome<input name="name" value="${h(user?.name||'')}" required></label><label>E-mail<input type="email" name="email" value="${h(user?.email||'')}" required></label><label>Grupo<select name="groupId" required>${groups.map(group=>`<option value="${group.id}" ${group.id===user?.group_id?'selected':''}>${h(group.name)}</option>`).join('')}</select></label><label>${user?'Nova senha (opcional)':'Senha'}<input type="password" name="password" minlength="8" ${user?'':'required'}></label>${user?`<label class="check-row full"><input type="checkbox" name="active" ${user.active?'checked':''}> Usuário ativo</label>`:''}</div>`, onSubmit: async form=>{
    const payload=Object.fromEntries(form); payload.active=form.has('active'); await api(user?`/users/${user.id}`:'/users',{method:user?'PUT':'POST',body:JSON.stringify(payload)}); toast(user?'Usuário atualizado.':'Usuário criado.'); await views.users();
  }});
}

function openGroupModal(group, permissions) {
  const modules=[...new Set(permissions.map(item=>item.module))];
  openModal({ title: group?'Configurar grupo':'Novo grupo', kicker:'PERMISSÕES DE ACESSO', body:`<div class="form-grid"><label>Nome<input name="name" value="${h(group?.name||'')}" required></label><label>Descrição<input name="description" value="${h(group?.description||'')}"></label></div><p class="permission-help">As permissões <strong>Menu</strong> mostram a área na navegação. As demais controlam informações e ações dentro dela. A API também bloqueia acessos diretos.</p>${modules.map(module=>`<h3 style="font-size:11px;margin:20px 0 8px">${h(module)}</h3><div class="permission-grid">${permissions.filter(item=>item.module===module).map(item=>`<label class="permission-item"><input type="checkbox" name="permissions" value="${h(item.code)}" ${group?.permissions.includes(item.code)?'checked':''}><span><strong>${h(item.label)}</strong>${item.code.endsWith('.view') || ['dashboard.view','products.view','stock.view','sales.view','sales.create','reports.view','users.view','groups.view','audit.view'].includes(item.code) ? '<em>Menu</em>' : '<em>Ação/conteúdo</em>'}<small>${h(item.code)}</small></span></label>`).join('')}</div>`).join('')}`, onSubmit:async form=>{
    const payload={name:form.get('name'),description:form.get('description'),permissions:form.getAll('permissions')}; await api(group?`/groups/${group.id}`:'/groups',{method:group?'PUT':'POST',body:JSON.stringify(payload)}); toast(group?'Grupo atualizado.':'Grupo criado.'); await views.groups();
  }});
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-error').textContent = '';
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try { const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); showApp(result.user); }
  catch (error) { $('#login-error').textContent = error.message; }
  finally { button.disabled = false; }
});
document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => { $('#login-form [name="email"]').value = button.dataset.demo; $('#login-form [name="password"]').value = 'Forjix@123'; }));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
$('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#logout-button').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST' }); } finally { showLogin(); } });

try { const session = await api('/auth/me'); showApp(session.user); } catch { showLogin(); }
