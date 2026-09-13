export const PERMISSIONS = [
  ['dashboard.view', 'Visualizar painel', 'Painel'],
  ['products.view', 'Visualizar produtos', 'Produtos'],
  ['products.manage', 'Cadastrar e editar produtos', 'Produtos'],
  ['stock.view', 'Visualizar movimentações', 'Estoque'],
  ['stock.manage', 'Registrar movimentações', 'Estoque'],
  ['sales.view', 'Visualizar vendas', 'Vendas'],
  ['sales.create', 'Realizar vendas', 'Vendas'],
  ['sales.cancel', 'Cancelar vendas', 'Vendas'],
  ['reports.view', 'Visualizar relatórios', 'Relatórios'],
  ['users.manage', 'Gerenciar usuários', 'Administração'],
  ['groups.manage', 'Gerenciar grupos e permissões', 'Administração'],
  ['audit.view', 'Visualizar auditoria', 'Administração']
];

export const DEFAULT_GROUPS = {
  Administradores: PERMISSIONS.map(([code]) => code),
  Vendas: ['dashboard.view', 'products.view', 'sales.view', 'sales.create'],
  Estoque: ['dashboard.view', 'products.view', 'products.manage', 'stock.view', 'stock.manage', 'reports.view']
};
