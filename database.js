require('dotenv').config();
const path = require('path');

const DEFAULT_TURSO_URL = 'libsql://thinkbig-crm-praveent.aws-ap-south-1.turso.io';
const DEFAULT_TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTQ3NDk5ODIsImlkIjoiMDFhMWRmNmUtODkwMS03ZjQyLTgxNWMtOWMzODRmZjBkNjIwIiwia2lkIjoiSEdnZHFKRm8wMnZKbV9tbnNuLVJBTGxZaHR1NnNNdlRGVHlULWlrM3dpdyIsInJpZCI6IjFhZWQ3N2M1LTgxMDMtNDU4Zi05ZDgwLTI4NzE3Y2JjMGFkOSJ9.JzWunYpxhU3Z-bVCGmzgQx97clAoqRRYw_mso_AAYC7i3_EJgSxS0H8BwriDKg_F6TJH100LUxccCogaHj2yAA';

const tursoUrl = process.env.TURSO_DATABASE_URL || DEFAULT_TURSO_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN || DEFAULT_TURSO_TOKEN;

let db;

function parseArgs(params, cb) {
  if (typeof params === 'function') {
    return { args: [], callback: params };
  }
  let args = [];
  if (Array.isArray(params)) {
    args = params;
  } else if (params !== undefined && params !== null) {
    args = [params];
  }
  // Sanitize undefined to null because libsql rejects undefined
  args = args.map(a => (a === undefined ? null : a));
  return { args, callback: cb || (() => {}) };
}

if (tursoUrl && tursoToken) {
  const { createClient } = require('@libsql/client');
  const client = createClient({
    url: tursoUrl,
    authToken: tursoToken
  });

  console.log(`Connected to Turso Cloud Database (${tursoUrl}).`);

  db = {
    client,
    isTurso: true,
    all(sql, params, cb) {
      const { args, callback } = parseArgs(params, cb);
      client.execute({ sql, args })
        .then(res => callback(null, res.rows))
        .catch(err => callback(err));
    },
    get(sql, params, cb) {
      const { args, callback } = parseArgs(params, cb);
      client.execute({ sql, args })
        .then(res => callback(null, res.rows && res.rows.length > 0 ? res.rows[0] : undefined))
        .catch(err => callback(err));
    },
    run(sql, params, cb) {
      const { args, callback } = parseArgs(params, cb);
      client.execute({ sql, args })
        .then(res => {
          const context = {
            lastID: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : 0,
            changes: res.rowsAffected || 0
          };
          callback.call(context, null);
        })
        .catch(err => {
          const context = { lastID: 0, changes: 0 };
          callback.call(context, err);
        });
    },
    serialize(fn) {
      if (typeof fn === 'function') fn();
    }
  };

  // Ensure tables and default data exist in Turso
  (async () => {
    try {
      await client.execute(`CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        firm_name TEXT,
        service_type TEXT,
        billing_type TEXT DEFAULT 'One-Time',
        phone TEXT,
        email TEXT,
        source TEXT DEFAULT 'Direct',
        status TEXT DEFAULT 'New',
        deal_value REAL DEFAULT 0,
        amount_paid REAL DEFAULT 0,
        payment_status TEXT DEFAULT 'Unpaid',
        followup_date TEXT,
        proposal_pdf TEXT,
        proposal_name TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      await client.execute(`CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      )`);

      const defaultServices = ['SMM', 'Web Development', 'SEO', 'AI Automation'];
      for (const service of defaultServices) {
        await client.execute({
          sql: `INSERT OR IGNORE INTO services (name) VALUES (?)`,
          args: [service]
        });
      }

      await client.execute(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER,
        firm_name TEXT DEFAULT 'General Agency',
        person_name TEXT NOT NULL,
        role TEXT DEFAULT 'Web Developer',
        phone TEXT,
        total_fee REAL DEFAULT 0,
        amount_paid REAL DEFAULT 0,
        payment_status TEXT DEFAULT 'Unpaid',
        payment_date TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    } catch (err) {
      console.error('Error initializing Turso schema:', err.message);
    }
  })();
} else {
  // Local SQLite fallback
  const sqlite3 = require('sqlite3').verbose();
  const dbFile = path.join(__dirname, 'leads.db');
  db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
    } else {
      console.log('Connected to SQLite database (leads.db).');
      db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS leads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          firm_name TEXT,
          service_type TEXT,
          billing_type TEXT DEFAULT 'One-Time',
          phone TEXT,
          email TEXT,
          source TEXT DEFAULT 'Direct',
          status TEXT DEFAULT 'New',
          deal_value REAL DEFAULT 0,
          amount_paid REAL DEFAULT 0,
          payment_status TEXT DEFAULT 'Unpaid',
          followup_date TEXT,
          proposal_pdf TEXT,
          proposal_name TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS services (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL
        )`, () => {
          const defaultServices = ['SMM', 'Web Development', 'SEO', 'AI Automation'];
          defaultServices.forEach(service => {
            db.run(`INSERT OR IGNORE INTO services (name) VALUES (?)`, [service]);
          });
        });

        db.run(`CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lead_id INTEGER,
          firm_name TEXT DEFAULT 'General Agency',
          person_name TEXT NOT NULL,
          role TEXT DEFAULT 'Web Developer',
          phone TEXT,
          total_fee REAL DEFAULT 0,
          amount_paid REAL DEFAULT 0,
          payment_status TEXT DEFAULT 'Unpaid',
          payment_date TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
      });
    }
  });
}

module.exports = db;
