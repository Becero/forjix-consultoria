# Forjix Estoque

Sistema web demonstrativo e funcional para controle de estoque, operação de
caixa e administração de acessos.

## Funcionalidades

- autenticação com sessão segura e token compatível com clientes mobile;
- painel com vendas do dia, custo do estoque e alertas de reposição;
- cadastro e edição de produtos e categorias;
- entradas, saídas e ajustes de inventário;
- frente de caixa com carrinho, desconto e formas de pagamento;
- baixa automática do estoque durante a venda;
- cancelamento de venda com devolução dos itens ao estoque;
- relatórios por período, ticket médio e produtos mais vendidos;
- usuários, grupos e permissões configuráveis;
- trilha de auditoria das operações relevantes.

## Executar

Requer Node.js 22 ou superior.

```bash
npm install
npm start
```

Acesse `http://localhost:3333`.

### Usuários demonstrativos

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `admin@forjix.local` | `Forjix@123` |
| Vendas | `vendas@forjix.local` | `Forjix@123` |
| Estoque | `estoque@forjix.local` | `Forjix@123` |

O banco é criado automaticamente em `data/forjix-estoque.db` com produtos de
exemplo. Para reiniciar a demonstração, pare o servidor e remova somente esse
arquivo de banco.

## Arquitetura e futuro aplicativo híbrido

O frontend não acessa o banco diretamente. Toda operação passa pela API REST em
`/api`, que aceita sessão por cookie para o navegador e `Authorization: Bearer`
para um futuro cliente mobile. Isso permite empacotar ou reconstruir a interface
com Capacitor, React Native, Flutter ou .NET MAUI sem duplicar regras de estoque,
vendas e permissões.

As permissões são atribuídas aos grupos e verificadas novamente pela API. Ocultar
um menu no frontend é apenas uma melhoria de interface; não é a barreira de
segurança.

## Preparação para produção

Esta entrega é uma demonstração funcional, não uma configuração universal de
produção. Antes de implantar para um cliente:

1. Defina `NODE_ENV=production` e um `JWT_SECRET` longo e exclusivo.
2. Publique exclusivamente com HTTPS e backups automáticos do banco.
3. Troque as senhas demonstrativas e configure os grupos do cliente.
4. Migre para PostgreSQL quando houver múltiplas unidades ou alto volume.
5. Configure monitoramento, logs externos e política de retenção.
6. Faça homologação das regras específicas do negócio.

O caixa atual é **gerencial e não fiscal**. NFC-e, SAT, TEF, impressão fiscal,
cadastro tributário e integrações contábeis devem ser tratados como módulos
específicos da implantação.

## Demo online no Render

O arquivo `render.yaml`, na raiz do repositório, cria automaticamente um serviço
Node gratuito com `demos/forjix-estoque` como diretório da aplicação. O segredo de
autenticação é gerado pelo Render e `DEMO_MODE=true` protege os usuários e grupos
padrão contra alterações.

No plano gratuito, o banco SQLite é demonstrativo: os dados adicionados podem ser
reiniciados quando o serviço dorme, reinicia ou recebe uma nova implantação. Para
persistência real, use um serviço pago com disco persistente ou migre para
PostgreSQL.

## Testes

```bash
npm test
```

O teste cobre autenticação, cadastro de produto, movimentação, venda, cancelamento,
devolução ao estoque, auditoria e bloqueio por permissão.
