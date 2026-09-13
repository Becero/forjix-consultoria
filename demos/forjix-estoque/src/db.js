import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_GROUPS, PERMISSIONS } from './permissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export function createDatabase(filename = path.join(dataDir, 'forjix-estoque.db')) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS permissions (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      module TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS access_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS group_permissions (
      group_id INTEGER NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
      permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
      PRIMARY KEY (group_id, permission_code)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      group_id INTEGER NOT NULL REFERENCES access_groups(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category_id INTEGER REFERENCES categories(id),
      cost REAL NOT NULL DEFAULT 0 CHECK(cost >= 0),
      price REAL NOT NULL CHECK(price >= 0),
      stock REAL NOT NULL DEFAULT 0 CHECK(stock >= 0),
      min_stock REAL NOT NULL DEFAULT 0 CHECK(min_stock >= 0),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      type TEXT NOT NULL CHECK(type IN ('ENTRY','EXIT','ADJUSTMENT')),
      quantity REAL NOT NULL,
      previous_stock REAL NOT NULL,
      resulting_stock REAL NOT NULL,
      unit_cost REAL,
      note TEXT NOT NULL DEFAULT '',
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      subtotal REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('COMPLETED','CANCELLED')),
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancelled_at TEXT,
      cancelled_by INTEGER REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL CHECK(quantity > 0),
      unit_price REAL NOT NULL,
      total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);

  seed(db);
  return db;
}

function seed(db) {
  const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions(code, label, module) VALUES (?, ?, ?)');
  const insertGroup = db.prepare('INSERT OR IGNORE INTO access_groups(name, description, is_system) VALUES (?, ?, 1)');
  const findGroup = db.prepare('SELECT id FROM access_groups WHERE name = ?');
  const grant = db.prepare('INSERT OR IGNORE INTO group_permissions(group_id, permission_code) VALUES (?, ?)');

  db.transaction(() => {
    for (const permission of PERMISSIONS) insertPermission.run(...permission);
    for (const [name, permissions] of Object.entries(DEFAULT_GROUPS)) {
      insertGroup.run(name, `Grupo padrão: ${name}`);
      const groupId = findGroup.get(name).id;
      for (const code of permissions) grant.run(groupId, code);
    }
  })();

  if (db.prepare('SELECT COUNT(*) AS total FROM users').get().total === 0) {
    const addUser = db.prepare('INSERT INTO users(name, email, password_hash, group_id) VALUES (?, ?, ?, ?)');
    const password = bcrypt.hashSync('Forjix@123', 12);
    addUser.run('Administrador Forjix', 'admin@forjix.local', password, findGroup.get('Administradores').id);
    addUser.run('Operador de Vendas', 'vendas@forjix.local', password, findGroup.get('Vendas').id);
    addUser.run('Responsável pelo Estoque', 'estoque@forjix.local', password, findGroup.get('Estoque').id);
  }

  if (db.prepare('SELECT COUNT(*) AS total FROM categories').get().total === 0) {
    const addCategory = db.prepare('INSERT INTO categories(name) VALUES (?)');
    ['Alimentos', 'Bebidas', 'Higiene e limpeza'].forEach(name => addCategory.run(name));
  }

  if (db.prepare('SELECT COUNT(*) AS total FROM products').get().total === 0) {
    const categories = Object.fromEntries(db.prepare('SELECT id, name FROM categories').all().map(item => [item.name, item.id]));
    const addProduct = db.prepare(`INSERT INTO products
      (sku, barcode, name, description, category_id, cost, price, stock, min_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const samples = [
      ['ALI-001', '7891000000011', 'Arroz Tipo 1 - 5 kg', 'Pacote de arroz branco', categories.Alimentos, 19.9, 27.9, 24, 8],
      ['ALI-002', '7891000000028', 'Feijão Carioca - 1 kg', 'Pacote de feijão carioca', categories.Alimentos, 6.5, 9.5, 7, 10],
      ['BEB-001', '7891000000035', 'Água Mineral - 500 ml', 'Garrafa sem gás', categories.Bebidas, 1.2, 3, 48, 12],
      ['BEB-002', '7891000000042', 'Suco Integral - 1 L', 'Suco integral de uva', categories.Bebidas, 8.9, 13.9, 16, 5],
      ['HIG-001', '7891000000059', 'Detergente Neutro', 'Frasco de 500 ml', categories['Higiene e limpeza'], 1.8, 3.5, 32, 10],
      ['HIG-002', '7891000000066', 'Papel Higiênico - 12 rolos', 'Folha dupla', categories['Higiene e limpeza'], 12.5, 19.9, 5, 6]
    ];
    db.transaction(() => samples.forEach(item => addProduct.run(...item)))();
  }
}

export function audit(db, userId, action, entity, entityId, details = {}) {
  db.prepare(`INSERT INTO audit_logs(user_id, action, entity, entity_id, details)
    VALUES (?, ?, ?, ?, ?)`).run(userId ?? null, action, entity, String(entityId ?? ''), JSON.stringify(details));
}
