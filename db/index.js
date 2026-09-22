const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const cfg = require('../config');

const DB_PATH = cfg.DB_PATH;
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db = null;
let lastInsertRowId = null;
let transactionDepth = 0;

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  // sql.js resets some connection pragmas during export. Re-enable FK
  // enforcement on the live in-memory database after every disk write.
  db.run('PRAGMA foreign_keys = ON;');
}

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('Database loaded from:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('New database created at:', DB_PATH);
  }

  // sql.js does not enable foreign-key enforcement by default.
  db.run('PRAGMA foreign_keys = ON;');

  // This is the clean initial schema for a new Jivak installation.
  // Clinic data lives only in SQLite; there is no browser-side database.
  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      age INTEGER,
      gender TEXT,
      phone TEXT NOT NULL UNIQUE,
      address TEXT,
      blood_group TEXT,
      medical_history TEXT,
      patient_code TEXT UNIQUE,
      mrd_number TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER NOT NULL DEFAULT 10,
      expiry_date TEXT,
      purchase_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      visit_date TEXT NOT NULL DEFAULT (date('now','localtime')),
      complaints TEXT,
      diagnosis TEXT,
      notes TEXT,
      consultation_fee REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash' CHECK(payment_method IN ('cash','upi')),
      bp TEXT,
      bsl TEXT,
      temp TEXT,
      weight TEXT,
      followup_required INTEGER NOT NULL DEFAULT 0 CHECK(followup_required IN (0,1)),
      followup_sent INTEGER NOT NULL DEFAULT 0 CHECK(followup_sent IN (0,1)),
      followup_date TEXT,
      mrd_number TEXT,
      visit_seq INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS prescription_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
      medicine_id INTEGER REFERENCES medicines(id) ON DELETE SET NULL,
      medicine_name TEXT,
      dosage TEXT,
      frequency TEXT,
      duration TEXT,
      quantity_given INTEGER NOT NULL DEFAULT 0,
      quantity_returned INTEGER NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      morning INTEGER NOT NULL DEFAULT 0 CHECK(morning IN (0,1)),
      afternoon INTEGER NOT NULL DEFAULT 0 CHECK(afternoon IN (0,1)),
      evening INTEGER NOT NULL DEFAULT 0 CHECK(evening IN (0,1)),
      night INTEGER NOT NULL DEFAULT 0 CHECK(night IN (0,1))
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      category TEXT,
      amount REAL NOT NULL CHECK(amount >= 0),
      description TEXT,
      expense_date TEXT NOT NULL DEFAULT (date('now','localtime')),
      visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
      source_type TEXT,
      source_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(source_type, source_id)
    );

    CREATE TABLE IF NOT EXISTS sp_children (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dob TEXT,
      age_at_registration INTEGER,
      registration_date TEXT,
      parent_name TEXT,
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sp_doses (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES sp_children(id) ON DELETE CASCADE,
      dose_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS pk_courses (
      id TEXT PRIMARY KEY,
      patient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      linked_patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      therapies TEXT NOT NULL,
      start_date TEXT NOT NULL,
      total_days INTEGER NOT NULL DEFAULT 7,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS pk_days (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES pk_courses(id) ON DELETE CASCADE,
      day_number INTEGER,
      date TEXT,
      therapy TEXT,
      payment REAL NOT NULL DEFAULT 0 CHECK(payment >= 0),
      notes TEXT,
      done INTEGER NOT NULL DEFAULT 1 CHECK(done IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
    CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
    CREATE INDEX IF NOT EXISTS idx_patients_mrd ON patients(mrd_number);

    CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);
    CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);
    CREATE INDEX IF NOT EXISTS idx_visits_followup ON visits(followup_required, followup_sent, followup_date);

    CREATE INDEX IF NOT EXISTS idx_prescription_visit ON prescription_items(visit_id);
    CREATE INDEX IF NOT EXISTS idx_prescription_medicine ON prescription_items(medicine_id);

    CREATE INDEX IF NOT EXISTS idx_medicines_name ON medicines(name);
    CREATE INDEX IF NOT EXISTS idx_medicines_expiry ON medicines(expiry_date);

    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
    CREATE INDEX IF NOT EXISTS idx_expenses_source ON expenses(source_type, source_id);

    CREATE INDEX IF NOT EXISTS idx_sp_children_name ON sp_children(name);
    CREATE INDEX IF NOT EXISTS idx_sp_children_phone ON sp_children(phone);
    CREATE INDEX IF NOT EXISTS idx_sp_children_status ON sp_children(status);
    CREATE INDEX IF NOT EXISTS idx_sp_doses_child ON sp_doses(child_id);
    CREATE INDEX IF NOT EXISTS idx_sp_doses_date ON sp_doses(dose_date);

    CREATE INDEX IF NOT EXISTS idx_pk_courses_status ON pk_courses(status);
    CREATE INDEX IF NOT EXISTS idx_pk_courses_patient ON pk_courses(linked_patient_id);
    CREATE INDEX IF NOT EXISTS idx_pk_days_course ON pk_days(course_id);
    CREATE INDEX IF NOT EXISTS idx_pk_days_date ON pk_days(date);
  `);

  // Set this after schema creation as well so foreign-key enforcement is
  // definitely enabled for every subsequent write connection state.
  db.run('PRAGMA foreign_keys = ON;');

  // Existing clinic databases need this migration only once. Older records
  // are safely classified as cash because that was the former implicit value.
  try {
    db.run("ALTER TABLE visits ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash' CHECK(payment_method IN ('cash','upi'))");
  } catch {}

  save();
  console.log('Database ready.');
}

function run(sql, params = []) {
  db.run(sql, params);

  try {
    const result = db.exec('SELECT last_insert_rowid() AS id');
    lastInsertRowId = result?.[0]?.values?.[0]?.[0] ?? null;
  } catch {
    lastInsertRowId = null;
  }

  if (transactionDepth === 0) save();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    return stmt.step() ? stmt.getAsObject() : null;
  } finally {
    stmt.free();
  }
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function lastId() {
  return lastInsertRowId;
}

function transaction(callback) {
  db.run('BEGIN TRANSACTION');
  transactionDepth += 1;

  try {
    const result = callback();
    db.run('COMMIT');
    return result;
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  } finally {
    transactionDepth -= 1;
    if (transactionDepth === 0) save();
  }
}

function exportBuffer() {
  return db ? Buffer.from(db.export()) : null;
}

process.on('exit', save);
process.on('SIGINT', () => {
  save();
  process.exit();
});

module.exports = {
  initDb,
  save,
  run,
  get,
  all,
  lastId,
  transaction,
  exportBuffer,
};
