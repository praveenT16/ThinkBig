require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const CRM_PIN = String(process.env.CRM_PIN || '1998').trim();

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer Config for PDF Proposals (Max 5MB)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed!'));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// --- 1. PIN SECURITY AUTH (PIN: 1998) ---
app.post('/api/auth', (req, res) => {
  const userPin = String(req.body.pin || '').trim();
  if (userPin === CRM_PIN || userPin === '1998') {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Invalid PIN' });
});

// --- 2. DYNAMIC SERVICES ROUTES ---
app.get('/api/services', (req, res) => {
  db.all(`SELECT * FROM services ORDER BY id ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/services', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Service name required' });
  db.run(`INSERT OR IGNORE INTO services (name) VALUES (?)`, [name.trim()], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name: name.trim() });
  });
});

app.delete('/api/services/:id', (req, res) => {
  db.run(`DELETE FROM services WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// --- 3. LEADS CRUD ROUTES ---
app.get('/api/leads', (req, res) => {
  db.all(`SELECT * FROM leads ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/leads', upload.single('proposal'), (req, res) => {
  const {
    name, firm_name, service_type, billing_type, phone, email, source, status,
    deal_value, amount_paid, payment_status, followup_date, notes
  } = req.body;

  const proposal_pdf = req.file ? `/uploads/${req.file.filename}` : '';
  const proposal_name = req.file ? req.file.originalname : '';

  const query = `
    INSERT INTO leads 
    (name, firm_name, service_type, billing_type, phone, email, source, status, deal_value, amount_paid, payment_status, followup_date, proposal_pdf, proposal_name, notes) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    name, firm_name || '', service_type || 'SMM', billing_type || 'One-Time',
    phone || '', email || '', source || 'Direct', status || 'New',
    Number(deal_value) || 0, Number(amount_paid) || 0, payment_status || 'Unpaid',
    followup_date || '', proposal_pdf, proposal_name, notes || ''
  ];

  db.run(query, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, proposal_pdf, proposal_name });
  });
});

app.put('/api/leads/:id', upload.single('proposal'), (req, res) => {
  const leadId = req.params.id;
  const {
    name, firm_name, service_type, billing_type, phone, email, source, status,
    deal_value, amount_paid, payment_status, followup_date, notes
  } = req.body;

  db.get(`SELECT proposal_pdf, proposal_name FROM leads WHERE id = ?`, [leadId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });

    let proposal_pdf = row ? row.proposal_pdf : '';
    let proposal_name = row ? row.proposal_name : '';

    if (req.file) {
      if (proposal_pdf) {
        const oldPath = path.join(__dirname, proposal_pdf);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      proposal_pdf = `/uploads/${req.file.filename}`;
      proposal_name = req.file.originalname;
    }

    const query = `
      UPDATE leads SET 
        name = ?, firm_name = ?, service_type = ?, billing_type = ?, phone = ?, email = ?, source = ?, 
        status = ?, deal_value = ?, amount_paid = ?, payment_status = ?, 
        followup_date = ?, proposal_pdf = ?, proposal_name = ?, notes = ?
      WHERE id = ?
    `;

    const params = [
      name, firm_name || '', service_type || 'SMM', billing_type || 'One-Time',
      phone || '', email || '', source || 'Direct', status || 'New',
      Number(deal_value) || 0, Number(amount_paid) || 0, payment_status || 'Unpaid',
      followup_date || '', proposal_pdf, proposal_name, notes || '', leadId
    ];

    db.run(query, params, function(updateErr) {
      if (updateErr) return res.status(500).json({ error: updateErr.message });
      res.json({ updated: this.changes, proposal_pdf, proposal_name });
    });
  });
});

app.patch('/api/leads/:id/stage', (req, res) => {
  const { status } = req.body;
  db.run(`UPDATE leads SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: this.changes });
  });
});

app.delete('/api/leads/:id', (req, res) => {
  db.get(`SELECT proposal_pdf FROM leads WHERE id = ?`, [req.params.id], (err, row) => {
    if (row && row.proposal_pdf) {
      const filePath = path.join(__dirname, row.proposal_pdf);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.run(`DELETE FROM leads WHERE id = ?`, req.params.id, function(delErr) {
      if (delErr) return res.status(500).json({ error: delErr.message });
      res.json({ deleted: this.changes });
    });
  });
});

// --- 4. DEVELOPER & SKILLED TEAM EXPENSES ROUTES ---
app.get('/api/expenses', (req, res) => {
  db.all(`SELECT * FROM expenses ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/expenses', (req, res) => {
  const { lead_id, firm_name, person_name, role, phone, total_fee, amount_paid, payment_status, payment_date, notes } = req.body;
  const query = `
    INSERT INTO expenses (lead_id, firm_name, person_name, role, phone, total_fee, amount_paid, payment_status, payment_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    lead_id || null,
    firm_name || 'General Agency',
    person_name,
    role || 'Web Developer',
    phone || '',
    Number(total_fee) || 0,
    Number(amount_paid) || 0,
    payment_status || 'Unpaid',
    payment_date || '',
    notes || ''
  ];
  db.run(query, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put('/api/expenses/:id', (req, res) => {
  const { lead_id, firm_name, person_name, role, phone, total_fee, amount_paid, payment_status, payment_date, notes } = req.body;
  const query = `
    UPDATE expenses SET
      lead_id = ?, firm_name = ?, person_name = ?, role = ?, phone = ?,
      total_fee = ?, amount_paid = ?, payment_status = ?, payment_date = ?, notes = ?
    WHERE id = ?
  `;
  const params = [
    lead_id || null,
    firm_name || 'General Agency',
    person_name,
    role || 'Web Developer',
    phone || '',
    Number(total_fee) || 0,
    Number(amount_paid) || 0,
    payment_status || 'Unpaid',
    payment_date || '',
    notes || '',
    req.params.id
  ];
  db.run(query, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: this.changes });
  });
});

app.delete('/api/expenses/:id', (req, res) => {
  db.run(`DELETE FROM expenses WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// --- 5. WEBHOOK ENDPOINT (For n8n / Website Lead Forms) ---
app.post('/api/webhooks/lead', (req, res) => {
  const { name, firm_name, service_type, phone, email, source, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const query = `
    INSERT INTO leads (name, firm_name, service_type, phone, email, source, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, 'New', ?)
  `;
  db.run(query, [
    name, firm_name || '', service_type || 'SMM', phone || '',
    email || '', source || 'Webhook / Automation', notes || ''
  ], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT} (Admin PIN: ${CRM_PIN})`);
});