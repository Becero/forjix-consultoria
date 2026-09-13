export const PERMISSIONS = [
  ['dashboard.view', 'Visualizar menu do painel', 'Painel'],
  ['dashboard.view_sales', 'Visualizar indicadores e histórico de vendas', 'Painel'],
  ['dashboard.view_inventory', 'Visualizar indicadores e alertas de estoque', 'Painel'],
  ['products.view', 'Visualizar menu de produtos', 'Produtos'],
  ['products.view_cost', 'Visualizar custos dos produtos', 'Produtos'],
  ['products.view_stock', 'Visualizar saldos e estoque mínimo', 'Produtos'],
  ['products.create', 'Cadastrar produtos', 'Produtos'],
  ['products.edit', 'Editar produtos', 'Produtos'],
  ['products.deactivate', 'Desativar produtos', 'Produtos'],
  ['categories.manage', 'Gerenciar categorias', 'Produtos'],
  ['stock.view', 'Visualizar menu e movimentações', 'Estoque'],
  ['stock.entry', 'Registrar entradas', 'Estoque'],
  ['stock.exit', 'Registrar saídas', 'Estoque'],
  ['stock.adjust', 'Realizar ajustes de inventário', 'Estoque'],
  ['sales.view', 'Visualizar menu e histórico de vendas', 'Vendas'],
  ['sales.create', 'Visualizar e operar a frente de caixa', 'Vendas'],
  ['sales.discount', 'Aplicar descontos nas vendas', 'Vendas'],
  ['sales.details', 'Visualizar itens e detalhes das vendas', 'Vendas'],
  ['sales.cancel', 'Cancelar vendas', 'Vendas'],
  ['reports.view', 'Visualizar menu de relatórios', 'Relatórios'],
  ['reports.sales', 'Visualizar relatórios financeiros e de vendas', 'Relatórios'],
  ['reports.inventory', 'Visualizar relatórios de estoque', 'Relatórios'],
  ['users.view', 'Visualizar menu e lista de usuários', 'Administração'],
  ['users.create', 'Cadastrar usuários', 'Administração'],
  ['users.edit', 'Editar e desativar usuários', 'Administração'],
  ['groups.view', 'Visualizar menu de grupos de acesso', 'Administração'],
  ['groups.create', 'Cadastrar grupos de acesso', 'Administração'],
  ['groups.edit', 'Alterar permissões dos grupos', 'Administração'],
  ['audit.view', 'Visualizar menu e registros de auditoria', 'Administração'],
  ['audit.details', 'Visualizar detalhes da auditoria', 'Administração']
];

export const DEFAULT_GROUPS = {
  Administradores: PERMISSIONS.map(([code]) => code),
  Vendas: [
    'dashboard.view', 'dashboard.view_sales', 'products.view', 'products.view_stock',
    'sales.view', 'sales.create', 'sales.discount', 'sales.details'
  ],
  Estoque: [
    'dashboard.view', 'dashboard.view_inventory', 'products.view', 'products.view_cost', 'products.view_stock',
    'products.create', 'products.edit', 'products.deactivate', 'categories.manage',
    'stock.view', 'stock.entry', 'stock.exit', 'stock.adjust', 'reports.view', 'reports.inventory'
  ]
};
