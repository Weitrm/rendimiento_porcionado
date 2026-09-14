import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = resolve("data", "rendimientos.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_date TEXT NOT NULL,
      list_type TEXT NOT NULL,
      source_file_name TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL,
      total_kg REAL NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS physical_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      area TEXT NOT NULL CHECK(area IN ('porcionado', 'logs', 'compartido')),
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS product_catalog (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      physical_group_id INTEGER REFERENCES physical_groups(id),
      area TEXT CHECK(area IN ('porcionado', 'logs', 'compartido')),
      logs_stage TEXT NOT NULL DEFAULT 'sin_clasificar'
        CHECK(logs_stage IN ('elaboracion', 'desmolde', 'sin_clasificar')),
      is_shared_byproduct INTEGER NOT NULL DEFAULT 0,
      is_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS raw_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
      movement_date TEXT NOT NULL,
      list_type TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      packages REAL,
      units REAL,
      net_kg REAL NOT NULL,
      source_prod_date TEXT,
      source_slaughter_date TEXT,
      row_hash TEXT NOT NULL UNIQUE,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS adjustment_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_movement_id INTEGER NOT NULL REFERENCES raw_movements(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS adjustment_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      revision_id INTEGER NOT NULL REFERENCES adjustment_revisions(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      list_type TEXT NOT NULL,
      net_kg REAL NOT NULL,
      physical_group_id INTEGER REFERENCES physical_groups(id),
      logs_stage TEXT NOT NULL DEFAULT 'sin_clasificar'
        CHECK(logs_stage IN ('elaboracion', 'desmolde', 'sin_clasificar')),
      is_excluded INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS daily_batches (
      movement_date TEXT PRIMARY KEY,
      common_count INTEGER NOT NULL DEFAULT 0,
      philly_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  seedSharedGroups();
}

function seedSharedGroups() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO physical_groups (name, area, notes)
    VALUES (?, ?, ?)
  `);

  [
    ["Sin clasificar", "compartido", "Grupo operativo para códigos pendientes"],
    ["Subproductos compartidos", "compartido", "Trimming, grasa, hueso y decomisos sin reparto automático"],
    ["Logs", "logs", "Familia general de Logs hasta confirmar reglas"],
    ["Asados y Porcionado", "porcionado", "Grupo inicial para revisar y dividir por corte"]
  ].forEach((row) => insert.run(...row));
}
