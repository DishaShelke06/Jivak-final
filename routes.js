const express = require('express');
const jwt     = require('jsonwebtoken');
const db      = require('./db');
const auth    = require('./middleware/auth');
const cfg     = require('./config');
const router  = express.Router();

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateString, offsetDays) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === cfg.DOCTOR_USERNAME && password === cfg.DOCTOR_PASSWORD) {
    const token = jwt.sign({ username }, cfg.JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, user: { username, name: cfg.DOCTOR_NAME || username } });
  }
  res.status(401).json({ error: 'Invalid username or password.' });
});

// ── PATIENTS ──────────────────────────────────────────────────────────────────
router.get('/patients', auth, (req, res) => {
  try {
    const { search } = req.query;
    const rows = search
      ? db.all('SELECT * FROM patients WHERE name LIKE ? OR phone LIKE ? ORDER BY name', [`%${search}%`, `%${search}%`])
      : db.all('SELECT * FROM patients ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/patients/:id', auth, (req, res) => {
  try {
    const patient = db.get('SELECT * FROM patients WHERE id=?', [req.params.id]);
    if (!patient) return res.status(404).json({ error: 'Not found' });
    const visits = db.all('SELECT * FROM visits WHERE patient_id=? ORDER BY visit_date DESC', [req.params.id]);
    visits.forEach(v => {
      v.items = db.all('SELECT * FROM prescription_items WHERE visit_id=?', [v.id]);
    });
    res.json({ ...patient, visits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/patients', auth, (req, res) => {
  const { name, age, gender, phone, address, blood_group, medical_history } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone required.' });
  try {
    db.run('INSERT INTO patients (name,age,gender,phone,address,blood_group,medical_history) VALUES (?,?,?,?,?,?,?)',
      [name, age||null, gender||null, phone, address||null, blood_group||null, medical_history||null]);
    const id = db.lastId();
    db.run('UPDATE patients SET patient_code=? WHERE id=?', [`JIV-${String(id).padStart(6, '0')}`, id]);
    const patient = db.get('SELECT * FROM patients WHERE id=?', [id]);
    res.status(201).json(patient);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Phone already registered.' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/patients/:id', auth, (req, res) => {
  const { name, age, gender, phone, address, blood_group, medical_history } = req.body;
  try {
    db.run("UPDATE patients SET name=?,age=?,gender=?,phone=?,address=?,blood_group=?,medical_history=?,updated_at=datetime('now','localtime') WHERE id=?",
      [name, age||null, gender||null, phone, address||null, blood_group||null, medical_history||null, req.params.id]);
    res.json(db.get('SELECT * FROM patients WHERE id=?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/patients/:id', auth, (req, res) => {
  try {
    db.transaction(() => {
      const visits = db.all('SELECT id FROM visits WHERE patient_id=?', [req.params.id]);
      for (const visit of visits) {
        const items = db.all(
          'SELECT medicine_id,quantity_given,quantity_returned FROM prescription_items WHERE visit_id=? AND medicine_id IS NOT NULL',
          [visit.id]
        );
        for (const item of items) {
          const restock = Math.max(0, Number(item.quantity_given || 0) - Number(item.quantity_returned || 0));
          if (restock > 0) db.run('UPDATE medicines SET quantity=quantity+? WHERE id=?', [restock, item.medicine_id]);
        }
      }
      db.run('DELETE FROM patients WHERE id=?', [req.params.id]);
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VISITS ────────────────────────────────────────────────────────────────────
router.get('/visits', auth, (req, res) => {
  try {
    const visits = db.all('SELECT v.*,p.name as patient_name,p.phone as patient_phone,p.patient_code as patient_code FROM visits v JOIN patients p ON v.patient_id=p.id ORDER BY v.visit_date DESC LIMIT 50');
    visits.forEach(v => { v.items = db.all('SELECT * FROM prescription_items WHERE visit_id=?', [v.id]); });
    res.json(visits);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/visits', auth, (req, res) => {
  const {
    patient_id, visit_date, complaints, diagnosis, notes, consultation_fee,
    bp, bsl, temp, weight, followup_required, prescription_items
  } = req.body;
  if (!patient_id) return res.status(400).json({ error: 'Patient required.' });

  try {
    const patient = db.get('SELECT * FROM patients WHERE id=?', [patient_id]);
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    const vdate = visit_date || localDate();
    const followupDate = followup_required ? addDays(vdate, 7) : null;

    const visitId = db.transaction(() => {
      const items = [];
      const requested = new Map();

      for (const item of (prescription_items || [])) {
        const name = String(item.medicine_name || '').trim();
        let medicine = item.medicine_id ? db.get('SELECT * FROM medicines WHERE id=?', [item.medicine_id]) : null;
        if (!medicine && name) medicine = db.get('SELECT * FROM medicines WHERE lower(name)=lower(?)', [name]);

        const quantity = Math.max(0, Math.floor(Number(item.quantity_given) || 0));
        const medicineName = medicine?.name || name;
        if (!medicineName) continue;

        if (medicine && quantity > 0) {
          requested.set(medicine.id, (requested.get(medicine.id) || 0) + quantity);
        }
        items.push({ item, medicine, quantity, medicineName });
      }

      for (const [medicineId, quantity] of requested) {
        const medicine = db.get('SELECT name, quantity FROM medicines WHERE id=?', [medicineId]);
        if (!medicine || quantity > Number(medicine.quantity || 0)) {
          throw new Error(`Only ${medicine?.quantity || 0} unit(s) of ${medicine?.name || 'this medicine'} are in stock.`);
        }
      }

      db.run(
        `INSERT INTO visits
          (patient_id,visit_date,complaints,diagnosis,notes,consultation_fee,bp,bsl,temp,weight,followup_required,followup_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [patient_id, vdate, complaints || null, diagnosis || null, notes || null, Number(consultation_fee) || 0,
         bp || null, bsl || null, temp || null, weight || null, followup_required ? 1 : 0, followupDate]
      );
      const id = db.lastId();

      let mrdNumber = patient.mrd_number;
      if (!mrdNumber) {
        const prefix = `MRD-${vdate.slice(0, 7).replace('-', '')}-`;
        const rows = db.all('SELECT mrd_number FROM patients WHERE mrd_number LIKE ?', [`${prefix}%`]);
        const next = rows.reduce((max, row) => {
          const n = parseInt(String(row.mrd_number).slice(prefix.length), 10);
          return Number.isFinite(n) && n > max ? n : max;
        }, 0) + 1;
        mrdNumber = prefix + String(next).padStart(4, '0');
        db.run('UPDATE patients SET mrd_number=? WHERE id=?', [mrdNumber, patient_id]);
      }

      const seq = db.get(
        "SELECT COALESCE(MAX(visit_seq),0) AS max_seq FROM visits WHERE substr(visit_date,1,7)=?",
        [vdate.slice(0, 7)]
      );
      db.run('UPDATE visits SET mrd_number=?,visit_seq=? WHERE id=?', [mrdNumber, Number(seq?.max_seq || 0) + 1, id]);

      let medicineTotal = 0;
      const sold = [];
      for (const { item, medicine, quantity, medicineName } of items) {
        const price = medicine ? Number(medicine.selling_price || 0) : 0;
        const lineTotal = medicine && quantity > 0 ? price * quantity : 0;

        db.run(
          `INSERT INTO prescription_items
           (visit_id,medicine_id,medicine_name,dosage,frequency,duration,quantity_given,quantity_returned,selling_price,line_total,morning,afternoon,evening,night)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, medicine?.id || null, medicineName, item.dosage || null, item.frequency || null, item.duration || null,
           quantity, 0, price, lineTotal, item.morning ? 1 : 0, item.afternoon ? 1 : 0, item.evening ? 1 : 0, item.night ? 1 : 0]
        );

        if (medicine && quantity > 0) {
          db.run('UPDATE medicines SET quantity=quantity-? WHERE id=?', [quantity, medicine.id]);
          medicineTotal += lineTotal;
          sold.push(`${medicine.name} × ${quantity}`);
        }
      }

      if (Number(consultation_fee) > 0) {
        db.run(
          `INSERT INTO expenses (type,category,amount,description,expense_date,visit_id,source_type,source_id)
           VALUES ('income','Consultation',?,?,?,?,'visit_consultation',?)`,
          [Number(consultation_fee), `Consultation - ${patient.name}`, vdate, id, String(id)]
        );
      }

      if (medicineTotal > 0) {
        db.run(
          `INSERT INTO expenses (type,category,amount,description,expense_date,visit_id,source_type,source_id)
           VALUES ('income','Medicine Sales',?,?,?,?,'visit_medicine_sale',?)`,
          [medicineTotal, `Medicine sale - ${patient.name}: ${sold.join(', ')}`, vdate, id, String(id)]
        );
      }

      return id;
    });

    const visit = db.get('SELECT v.*,p.name as patient_name,p.phone as patient_phone,p.patient_code as patient_code FROM visits v JOIN patients p ON v.patient_id=p.id WHERE v.id=?', [visitId]);
    visit.items = db.all('SELECT * FROM prescription_items WHERE visit_id=?', [visitId]);
    res.status(201).json(visit);
  } catch (e) {
    const status = /stock/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

router.delete('/visits/:id', auth, (req, res) => {
  try {
    db.transaction(() => {
      const visit = db.get('SELECT id FROM visits WHERE id=?', [req.params.id]);
      if (!visit) throw new Error('Visit not found.');

      const items = db.all(
        'SELECT medicine_id,quantity_given,quantity_returned FROM prescription_items WHERE visit_id=? AND medicine_id IS NOT NULL',
        [req.params.id]
      );
      for (const item of items) {
        const restock = Math.max(0, Number(item.quantity_given || 0) - Number(item.quantity_returned || 0));
        if (restock > 0) db.run('UPDATE medicines SET quantity=quantity+? WHERE id=?', [restock, item.medicine_id]);
      }
      db.run('DELETE FROM visits WHERE id=?', [req.params.id]);
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'Visit not found.' ? 404 : 500).json({ error: e.message });
  }
});

router.post('/prescription-items/:id/return', auth, (req, res) => {
  const quantity = Math.floor(Number(req.body.quantity) || 0);
  if (quantity <= 0) return res.status(400).json({ error: 'Return quantity must be at least 1.' });
  try {
    const result = db.transaction(() => {
      const item = db.get('SELECT * FROM prescription_items WHERE id=?', [req.params.id]);
      if (!item) throw new Error('Prescription medicine not found.');
      if (!item.medicine_id) throw new Error('This medicine was not supplied from inventory.');
      const available = Number(item.quantity_given || 0) - Number(item.quantity_returned || 0);
      if (quantity > available) throw new Error(`Only ${available} unit(s) can be returned.`);

      db.run('UPDATE prescription_items SET quantity_returned=quantity_returned+? WHERE id=?', [quantity, item.id]);
      db.run('UPDATE medicines SET quantity=quantity+? WHERE id=?', [quantity, item.medicine_id]);

      const refund = quantity * Number(item.selling_price || 0);
      const sale = db.get(
        "SELECT * FROM expenses WHERE source_type='visit_medicine_sale' AND source_id=? AND type='income' LIMIT 1",
        [String(item.visit_id)]
      );
      if (sale && refund > 0) {
        const amount = Math.max(0, Number(sale.amount) - refund);
        if (amount === 0) db.run('DELETE FROM expenses WHERE id=?', [sale.id]);
        else db.run('UPDATE expenses SET amount=?,description=? WHERE id=?', [amount, `${sale.description} (return: ${item.medicine_name} × ${quantity})`, sale.id]);
      }
      return { returned: quantity, refund, remaining: available - quantity };
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(/not found|inventory|Only/.test(e.message) ? 400 : 500).json({ error: e.message });
  }
});

// ── MEDICINES ─────────────────────────────────────────────────────────────────
router.get('/medicines', auth, (req, res) => {
  try {
    const { search, expiring, low_stock } = req.query;
    let q = 'SELECT * FROM medicines WHERE 1=1', p = [];
    if (search)          { q += ' AND (name LIKE ? OR brand LIKE ?)'; p.push(`%${search}%`,`%${search}%`); }
    if (expiring==='true') q += " AND expiry_date <= date('now','localtime','+30 days') AND expiry_date >= date('now','localtime')";
    if (low_stock==='true') q += ' AND quantity <= low_stock_threshold';
    res.json(db.all(q + ' ORDER BY expiry_date ASC', p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/medicines/alerts', auth, (req, res) => {
  try {
    res.json({
      expiring:     db.all("SELECT * FROM medicines WHERE expiry_date <= date('now','localtime','+30 days') AND expiry_date >= date('now','localtime') ORDER BY expiry_date"),
      expired:      db.all("SELECT * FROM medicines WHERE expiry_date < date('now','localtime')"),
      low_stock:    db.all('SELECT * FROM medicines WHERE quantity <= low_stock_threshold AND quantity > 0'),
      out_of_stock: db.all('SELECT * FROM medicines WHERE quantity = 0'),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/medicines', auth, (req, res) => {
  const { name, brand, category, quantity, low_stock_threshold, expiry_date, purchase_price, selling_price } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required.' });
  try {
    const id = db.transaction(() => {
      db.run('INSERT INTO medicines (name,brand,category,quantity,low_stock_threshold,expiry_date,purchase_price,selling_price) VALUES (?,?,?,?,?,?,?,?)',
        [name, brand||null, category||null, quantity||0, low_stock_threshold||10, expiry_date||null, purchase_price||0, selling_price||0]);
      const medicineId = db.lastId();
      if (Number(purchase_price) > 0 && Number(quantity) > 0) {
        db.run("INSERT INTO expenses (type,category,amount,description,source_type,source_id) VALUES ('expense','Medicine Purchase',?,?,'medicine_purchase',?)",
          [Number(purchase_price)*Number(quantity), `Purchased ${quantity} units of ${name}`, String(medicineId)]);
      }
      return medicineId;
    });
    res.status(201).json(db.get('SELECT * FROM medicines WHERE id=?', [id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/medicines/:id', auth, (req, res) => {
  const { name, brand, category, quantity, low_stock_threshold, expiry_date, purchase_price, selling_price } = req.body;
  try {
    db.run("UPDATE medicines SET name=?,brand=?,category=?,quantity=?,low_stock_threshold=?,expiry_date=?,purchase_price=?,selling_price=?,updated_at=datetime('now','localtime') WHERE id=?",
      [name, brand||null, category||null, quantity, low_stock_threshold||10, expiry_date||null, purchase_price||0, selling_price||0, req.params.id]);
    res.json(db.get('SELECT * FROM medicines WHERE id=?', [req.params.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/medicines/:id', auth, (req, res) => {
  try {
    db.transaction(() => {
      db.run("DELETE FROM expenses WHERE source_type='medicine_purchase' AND source_id=?", [String(req.params.id)]);
      db.run('DELETE FROM medicines WHERE id=?', [req.params.id]);
    });
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/medicines/:id/sell', auth, (req, res) => {
  const { quantity, sale_date } = req.body;
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be a positive whole number.' });

  try {
    const result = db.transaction(() => {
      const medicine = db.get('SELECT * FROM medicines WHERE id=?', [req.params.id]);
      if (!medicine) throw new Error('Medicine not found.');
      if (qty > Number(medicine.quantity)) throw new Error(`Only ${medicine.quantity} units in stock.`);

      const amount = qty * Number(medicine.selling_price || 0);
      const sourceId = `medicine-sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      db.run("UPDATE medicines SET quantity=?,updated_at=datetime('now','localtime') WHERE id=?",
        [Number(medicine.quantity) - qty, medicine.id]);
      db.run("INSERT INTO expenses (type,category,amount,description,expense_date,source_type,source_id) VALUES ('income','Medicine sale',?,?,?,'medicine_sale',?)",
        [amount, `Medicine sale — ${medicine.name} × ${qty}`, sale_date || localDate(), sourceId]);

      return { medicineId: medicine.id, quantity: qty, amount };
    });
    res.status(201).json({ ok: true, ...result, medicine: db.get('SELECT * FROM medicines WHERE id=?', [result.medicineId]) });
  } catch (e) {
    res.status(/not found|Only/.test(e.message) ? 400 : 500).json({ error: e.message });
  }
});

// ── EXPENSES ──────────────────────────────────────────────────────────────────
router.get('/expenses', auth, (req, res) => {
  try {
    const { month, year, type } = req.query;
    let q = 'SELECT * FROM expenses WHERE 1=1', p = [];
    if (month && year) { q += " AND strftime('%m',expense_date)=? AND strftime('%Y',expense_date)=?"; p.push(String(month).padStart(2,'0'), String(year)); }
    else if (year)     { q += " AND strftime('%Y',expense_date)=?"; p.push(String(year)); }
    if (type)          { q += ' AND type=?'; p.push(type); }
    res.json(db.all(q + ' ORDER BY expense_date DESC', p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/expenses/summary', auth, (req, res) => {
  try {
    const m = String(req.query.month||new Date().getMonth()+1).padStart(2,'0');
    const y = String(req.query.year||new Date().getFullYear());
    const today = localDate();

    const rows  = db.all("SELECT type,SUM(amount) as total FROM expenses WHERE strftime('%m',expense_date)=? AND strftime('%Y',expense_date)=? GROUP BY type", [m, y]);
    const trend = db.all("SELECT strftime('%m',expense_date) as month,strftime('%Y',expense_date) as year,SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM expenses WHERE strftime('%Y',expense_date)=? GROUP BY month,year ORDER BY year,month", [y]);

    // Daily income (specific date or today)
    const selectedDate = req.query.date || today;
    const dailyRows = db.all("SELECT type,SUM(amount) as total FROM expenses WHERE expense_date=? GROUP BY type", [selectedDate]);
    const daily = {income:0, expense:0};
    dailyRows.forEach(r => { daily[r.type] = Number(r.total)||0; });

    // Yearly income
    const yearlyRows = db.all("SELECT type,SUM(amount) as total FROM expenses WHERE strftime('%Y',expense_date)=? GROUP BY type", [y]);
    const yearly = {income:0, expense:0};
    yearlyRows.forEach(r => { yearly[r.type] = Number(r.total)||0; });

    // Monthly breakdown for current year (all months)
    const allMonths = db.all("SELECT strftime('%m',expense_date) as month, SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM expenses WHERE strftime('%Y',expense_date)=? GROUP BY month ORDER BY month", [y]);

    // Top income categories this month
    const topCategories = db.all("SELECT category, SUM(amount) as total FROM expenses WHERE type='income' AND strftime('%m',expense_date)=? AND strftime('%Y',expense_date)=? GROUP BY category ORDER BY total DESC LIMIT 5", [m, y]);

    const t = {income:0, expense:0};
    rows.forEach(r => { t[r.type] = Number(r.total)||0; });

    res.json({
      month:m, year:y,
      income:t.income, expense:t.expense, profit:t.income-t.expense,
      monthly_trend: trend,
      daily_income:   daily.income,
      daily_expense:  daily.expense,
      daily_profit:   daily.income - daily.expense,
      yearly_income:  yearly.income,
      yearly_expense: yearly.expense,
      yearly_profit:  yearly.income - yearly.expense,
      all_months:     allMonths,
      top_categories: topCategories,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/expenses', auth, (req, res) => {
  const { type, category, amount, description, expense_date, source_type, source_id } = req.body;
  if (!type||!amount) return res.status(400).json({ error: 'Type and amount required.' });
  try {
    db.run('INSERT INTO expenses (type,category,amount,description,expense_date,source_type,source_id) VALUES (?,?,?,?,?,?,?)',
      [type, category||null, amount, description||null, expense_date||localDate(), source_type||null, source_id||null]);
    res.status(201).json(db.get('SELECT * FROM expenses WHERE id=?', [db.lastId()]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/expenses/:id', auth, (req, res) => {
  try {
    const expense = db.get('SELECT * FROM expenses WHERE id=?', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Transaction not found.' });
    if (expense.source_type) {
      return res.status(400).json({ error: 'This transaction is linked to another record. Edit or delete the original record instead.' });
    }
    db.run('DELETE FROM expenses WHERE id=?', [req.params.id]);
    res.json({ ok:true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
router.get('/dashboard', auth, (req, res) => {
  try {
    const finance = db.get("SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM expenses WHERE strftime('%m',expense_date)=strftime('%m','now','localtime') AND strftime('%Y',expense_date)=strftime('%Y','now','localtime')");
    res.json({
      today_visits:        db.get("SELECT COUNT(*) as c FROM visits WHERE visit_date=date('now','localtime')").c,
      total_patients:      db.get('SELECT COUNT(*) as c FROM patients').c,
      expiring_medicines:  db.get("SELECT COUNT(*) as c FROM medicines WHERE expiry_date<=date('now','localtime','+30 days') AND expiry_date>=date('now','localtime')").c,
      low_stock_medicines: db.get('SELECT COUNT(*) as c FROM medicines WHERE quantity<=low_stock_threshold').c,
      monthly_income:      finance?.income||0,
      monthly_expense:     finance?.expense||0,
      monthly_profit:      (finance?.income||0)-(finance?.expense||0),
      pending_followups:   db.all("SELECT v.*,p.name as patient_name,p.phone as patient_phone,p.patient_code as patient_code FROM visits v JOIN patients p ON v.patient_id=p.id WHERE v.followup_required=1 AND v.followup_sent=0 AND v.followup_date<=date('now','localtime') ORDER BY v.followup_date ASC LIMIT 10"),
      recent_visits:       db.all('SELECT v.id,v.visit_date,v.diagnosis,v.consultation_fee,v.patient_id,p.name as patient_name FROM visits v JOIN patients p ON v.patient_id=p.id ORDER BY v.created_at DESC LIMIT 5'),
      expiring_list:       db.all("SELECT * FROM medicines WHERE expiry_date<=date('now','localtime','+30 days') AND expiry_date>=date('now','localtime') ORDER BY expiry_date LIMIT 5"),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FOLLOW-UPS ────────────────────────────────────────────────────────────────
router.get('/followups/pending', auth, (req, res) => {
  try {
    res.json(db.all("SELECT v.*,p.name as patient_name,p.phone as patient_phone,p.patient_code as patient_code FROM visits v JOIN patients p ON v.patient_id=p.id WHERE v.followup_required=1 AND v.followup_sent=0 ORDER BY v.followup_date ASC"));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/followups/send/:visitId', auth, async (req, res) => {
  try {
    const visit = db.get("SELECT v.*,p.name as patient_name,p.phone as patient_phone,p.patient_code as patient_code FROM visits v JOIN patients p ON v.patient_id=p.id WHERE v.id=?", [req.params.visitId]);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });
    await sendFollowup(visit);
    db.run('UPDATE visits SET followup_sent=1 WHERE id=?', [req.params.visitId]);
    res.json({ message: `Follow-up sent to ${visit.patient_name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enable, reschedule, or turn off a reminder on an existing consultation.
// (Previously the only way to set followup_required/followup_date was at
// the moment a visit was first created — there was no way to add or edit a
// reminder afterwards.)
router.put('/visits/:id/followup', auth, (req, res) => {
  const { followup_required, followup_date } = req.body;
  try {
    const visit = db.get('SELECT * FROM visits WHERE id=?', [req.params.id]);
    if (!visit) return res.status(404).json({ error: 'Visit not found.' });
    const required = followup_required ? 1 : 0;
    const date = required
      ? (followup_date || (() => { const d = new Date(`${visit.visit_date}T00:00:00`); d.setDate(d.getDate() + 7); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })())
      : null;
    db.run('UPDATE visits SET followup_required=?,followup_date=?,followup_sent=0 WHERE id=?', [required, date, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark a reminder as done without actually sending a WhatsApp/SMS message —
// useful when the doctor called the patient directly, or Twilio isn't set up.
router.post('/followups/complete/:visitId', auth, (req, res) => {
  try {
    db.run('UPDATE visits SET followup_sent=1 WHERE id=?', [req.params.visitId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function sendFollowup(visit) {
  if (!cfg.TWILIO_SID || !cfg.TWILIO_TOKEN) throw new Error('Twilio not configured in config.js');
  const twilio = require('twilio')(cfg.TWILIO_SID, cfg.TWILIO_TOKEN);
  const msg = `Dear ${visit.patient_name}, this is a reminder from your doctor's clinic. It has been 7 days since your visit on ${new Date(visit.visit_date).toLocaleDateString('en-IN')}. Please schedule a follow-up if needed. Contact: ${cfg.CLINIC_PHONE}.`;
  const to  = `+91${visit.patient_phone.replace(/\D/g,'').slice(-10)}`;
  try {
    await twilio.messages.create({ from: cfg.TWILIO_WA_FROM, to: `whatsapp:${to}`, body: msg });
  } catch {
    await twilio.messages.create({ from: cfg.TWILIO_SMS_FROM, to, body: msg });
  }
}

// ── SUVARNAPRASHAN ────────────────────────────────────────────────────────────
// A child registers once (sp_children) and keeps returning monthly until ~5-6
// years old; every visit is a "dose" (sp_doses) linked to that one profile —
// never a fresh, disconnected record.

function spChildWithStats(child) {
  const doses = db.all('SELECT * FROM sp_doses WHERE child_id=? ORDER BY dose_date DESC', [child.id]);
  child.doses = doses;
  child.dose_count = doses.length;
  child.last_dose_date = doses[0]?.dose_date || null;
  child.total_paid = doses.reduce((s, d) => s + Number(d.amount || 0), 0);
  return child;
}

// List / search child profiles (used for the main table and for autocomplete
// when reception is deciding whether a kid is already registered).
router.get('/suvarnaprashan/children', auth, (req, res) => {
  try {
    const { search, status } = req.query;
    let rows = search
      ? db.all('SELECT * FROM sp_children WHERE name LIKE ? OR phone LIKE ? ORDER BY name', [`%${search}%`, `%${search}%`])
      : db.all('SELECT * FROM sp_children ORDER BY created_at DESC');
    if (status) rows = rows.filter(c => c.status === status);
    res.json(rows.map(spChildWithStats));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/suvarnaprashan/children/:id', auth, (req, res) => {
  try {
    const child = db.get('SELECT * FROM sp_children WHERE id=?', [req.params.id]);
    if (!child) return res.status(404).json({ error: 'Not found' });
    res.json(spChildWithStats(child));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Register a new child. Optionally record their first dose in the same call.
router.post('/suvarnaprashan/children', auth, (req, res) => {
  const { name, dob, age_at_registration, parent_name, phone, notes, first_dose_date, first_dose_amount } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Child name and phone required.' });
  try {
    const id = `spc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const regDate = first_dose_date || localDate();
    db.transaction(() => {
      db.run('INSERT INTO sp_children (id,name,dob,age_at_registration,registration_date,parent_name,phone,notes) VALUES (?,?,?,?,?,?,?,?)',
        [id, name, dob || null, age_at_registration || null, regDate, parent_name || null, phone, notes || null]);
      if (first_dose_date) {
        const doseId = `spd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        db.run('INSERT INTO sp_doses (id,child_id,dose_date,amount) VALUES (?,?,?,?)',
          [doseId, id, first_dose_date, first_dose_amount || 0]);
        if (Number(first_dose_amount) > 0) {
          db.run("INSERT INTO expenses (type,category,amount,description,expense_date,source_type,source_id) VALUES ('income','सुवर्णप्राशन',?,?,?,'suvarnaprashan_dose',?)",
            [first_dose_amount, `सुवर्णप्राशन — ${name}`, first_dose_date, doseId]);
        }
      }
    });
    res.status(201).json(spChildWithStats(db.get('SELECT * FROM sp_children WHERE id=?', [id])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/suvarnaprashan/children/:id', auth, (req, res) => {
  const { name, dob, age_at_registration, parent_name, phone, status, notes } = req.body;
  try {
    db.run(`UPDATE sp_children SET name=?,dob=?,age_at_registration=?,parent_name=?,phone=?,status=?,notes=?,
            updated_at=datetime('now','localtime') WHERE id=?`,
      [name, dob || null, age_at_registration || null, parent_name || null, phone, status || 'active', notes || null, req.params.id]);
    const child = db.get('SELECT * FROM sp_children WHERE id=?', [req.params.id]);
    if (!child) return res.status(404).json({ error: 'Not found' });
    res.json(spChildWithStats(child));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/suvarnaprashan/children/:id', auth, (req, res) => {
  try {
    db.transaction(() => {
      const child = db.get('SELECT id FROM sp_children WHERE id=?', [req.params.id]);
      if (!child) throw new Error('Child not found.');
      db.run("DELETE FROM expenses WHERE source_type='suvarnaprashan_dose' AND source_id IN (SELECT id FROM sp_doses WHERE child_id=?)", [req.params.id]);
      db.run('DELETE FROM sp_children WHERE id=?', [req.params.id]);
    });
    res.json({ ok: true });
  } catch (e) { res.status(e.message === 'Child not found.' ? 404 : 500).json({ error: e.message }); }
});

// Add a single dose (one monthly visit) to an existing child's history.
router.post('/suvarnaprashan/children/:id/doses', auth, (req, res) => {
  const { dose_date, amount, notes } = req.body;
  if (!dose_date) return res.status(400).json({ error: 'Dose date required.' });
  try {
    db.transaction(() => {
      const child = db.get('SELECT * FROM sp_children WHERE id=?', [req.params.id]);
      if (!child) throw new Error('Child not found.');
      const doseId = `spd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      db.run('INSERT INTO sp_doses (id,child_id,dose_date,amount,notes) VALUES (?,?,?,?,?)', [doseId, req.params.id, dose_date, amount || 0, notes || null]);
      if (Number(amount) > 0) {
        db.run("INSERT INTO expenses (type,category,amount,description,expense_date,source_type,source_id) VALUES ('income','सुवर्णप्राशन',?,?,?,'suvarnaprashan_dose',?)",
          [amount, `सुवर्णप्राशन — ${child.name}`, dose_date, doseId]);
      }
    });
    res.status(201).json(spChildWithStats(db.get('SELECT * FROM sp_children WHERE id=?', [req.params.id])));
  } catch (e) { res.status(e.message === 'Child not found.' ? 404 : 500).json({ error: e.message }); }
});

router.post('/suvarnaprashan/doses/bulk', auth, (req, res) => {
  const { dose_date, entries } = req.body;
  if (!dose_date || !Array.isArray(entries) || !entries.length) return res.status(400).json({ error: 'Dose date and at least one child are required.' });
  try {
    const created = db.transaction(() => {
      const ids = [];
      for (const entry of entries) {
        const child = db.get('SELECT * FROM sp_children WHERE id=?', [entry.child_id]);
        if (!child) continue;
        const doseId = `spd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${ids.length}`;
        db.run('INSERT INTO sp_doses (id,child_id,dose_date,amount,notes) VALUES (?,?,?,?,?)', [doseId, child.id, dose_date, entry.amount || 0, entry.notes || null]);
        if (Number(entry.amount) > 0) {
          db.run("INSERT INTO expenses (type,category,amount,description,expense_date,source_type,source_id) VALUES ('income','सुवर्णप्राशन',?,?,?,'suvarnaprashan_dose',?)",
            [entry.amount, `सुवर्णप्राशन — ${child.name}`, dose_date, doseId]);
        }
        ids.push(doseId);
      }
      return ids;
    });
    res.status(201).json({ ok: true, created: created.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/suvarnaprashan/doses/:id', auth, (req, res) => {
  const { dose_date, amount, notes } = req.body;
  try {
    db.transaction(() => {
      const dose = db.get('SELECT d.*,c.name AS child_name FROM sp_doses d JOIN sp_children c ON c.id=d.child_id WHERE d.id=?', [req.params.id]);
      if (!dose) throw new Error('Dose not found.');
      db.run('UPDATE sp_doses SET dose_date=?,amount=?,notes=? WHERE id=?', [dose_date, amount || 0, notes || null, req.params.id]);
      const finance = db.get("SELECT id FROM expenses WHERE source_type='suvarnaprashan_dose' AND source_id=? LIMIT 1", [String(req.params.id)]);
      if (Number(amount) > 0) {
        const description = `सुवर्णप्राशन — ${dose.child_name}`;
        if (finance) db.run('UPDATE expenses SET amount=?,description=?,expense_date=? WHERE id=?', [amount, description, dose_date, finance.id]);
        else db.run("INSERT INTO expenses (type,category,amount,description,expense_date,source_type,source_id) VALUES ('income','सुवर्णप्राशन',?,?,?,'suvarnaprashan_dose',?)", [amount, description, dose_date, req.params.id]);
      } else if (finance) db.run('DELETE FROM expenses WHERE id=?', [finance.id]);
    });
    res.json({ ok: true });
  } catch (e) { res.status(e.message === 'Dose not found.' ? 404 : 500).json({ error: e.message }); }
});

router.delete('/suvarnaprashan/doses/:id', auth, (req, res) => {
  try {
    db.transaction(() => {
      const dose = db.get('SELECT id FROM sp_doses WHERE id=?', [req.params.id]);
      if (!dose) throw new Error('Dose not found.');
      db.run("DELETE FROM expenses WHERE source_type='suvarnaprashan_dose' AND source_id=?", [String(req.params.id)]);
      db.run('DELETE FROM sp_doses WHERE id=?', [req.params.id]);
    });
    res.json({ ok: true });
  } catch (e) { res.status(e.message === 'Dose not found.' ? 404 : 500).json({ error: e.message }); }
});

// ── PANCHAKARMA ───────────────────────────────────────────────────────────────
router.get('/panchakarma', auth, (req, res) => {
  try {
    const courses = db.all('SELECT * FROM pk_courses ORDER BY start_date DESC');
    courses.forEach(c => {
      c.therapies = JSON.parse(c.therapies || '[]');
      c.days = db.all('SELECT * FROM pk_days WHERE course_id=? ORDER BY day_number ASC', [c.id]);
    });
    res.json(courses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/panchakarma/course', auth, (req, res) => {
  const { id, patient_name, phone, linked_patient_id, therapies, start_date, total_days, status } = req.body;
  if (!patient_name || !phone) return res.status(400).json({ error: 'Patient name and phone required.' });
  try {
    db.run('INSERT OR REPLACE INTO pk_courses (id,patient_name,phone,linked_patient_id,therapies,start_date,total_days,status) VALUES (?,?,?,?,?,?,?,?)',
      [id || `pk${Date.now()}`, patient_name, phone, linked_patient_id||null, JSON.stringify(therapies||[]), start_date, total_days||7, status||'active']);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/panchakarma/course/:id', auth, (req, res) => {
  const { patient_name, phone, linked_patient_id, therapies, start_date, total_days, status } = req.body;
  try {
    db.run('UPDATE pk_courses SET patient_name=?,phone=?,linked_patient_id=?,therapies=?,start_date=?,total_days=?,status=? WHERE id=?',
      [patient_name, phone, linked_patient_id||null, JSON.stringify(therapies||[]), start_date, total_days||7, status||'active', req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/panchakarma/course/:id', auth, (req, res) => {
  try {
    db.transaction(() => {
      const course = db.get('SELECT id FROM pk_courses WHERE id=?', [req.params.id]);
      if (!course) throw new Error('Panchakarma course not found.');
      db.run("DELETE FROM expenses WHERE source_type='panchakarma_day' AND source_id IN (SELECT id FROM pk_days WHERE course_id=?)", [req.params.id]);
      db.run('DELETE FROM pk_courses WHERE id=?', [req.params.id]);
    });
    res.json({ ok: true });
  } catch (e) { res.status(e.message.includes('course') ? 404 : 500).json({ error: e.message }); }
});

router.post('/panchakarma/day', auth, (req, res) => {
  const { id, course_id, day_number, date, therapy, payment, notes, done } = req.body;
  try {
    db.transaction(() => {
      const course = db.get('SELECT patient_name FROM pk_courses WHERE id=?', [course_id]);
      if (!course) throw new Error('Panchakarma course not found.');
      const dayId = id || `pkd${Date.now()}`;
      db.run('INSERT OR REPLACE INTO pk_days (id,course_id,day_number,date,therapy,payment,notes,done) VALUES (?,?,?,?,?,?,?,?)',
        [dayId, course_id, day_number, date, therapy, payment || 0, notes || null, done ? 1 : 0]);

      const finance = db.get("SELECT id FROM expenses WHERE source_type='panchakarma_day' AND source_id=? LIMIT 1", [String(dayId)]);
      if (Number(payment) > 0) {
        const description = `पंचकर्म — ${therapy} — ${course.patient_name} (Day ${day_number})`;
        if (finance) db.run('UPDATE expenses SET amount=?,description=?,expense_date=? WHERE id=?', [payment, description, date || localDate(), finance.id]);
        else db.run("INSERT INTO expenses (type,category,amount,description,expense_date,source_type,source_id) VALUES ('income','पंचकर्म',?,?,?,'panchakarma_day',?)", [payment, description, date || localDate(), dayId]);
      } else if (finance) db.run('DELETE FROM expenses WHERE id=?', [finance.id]);
    });
    res.status(201).json({ ok: true });
  } catch (e) { res.status(e.message.includes('course') ? 404 : 500).json({ error: e.message }); }
});

router.put('/panchakarma/day/:id', auth, (req, res) => {
  const { day_number, date, therapy, payment, notes, done } = req.body;
  try {
    db.transaction(() => {
      const day = db.get('SELECT d.*,c.patient_name FROM pk_days d JOIN pk_courses c ON c.id=d.course_id WHERE d.id=?', [req.params.id]);
      if (!day) throw new Error('Panchakarma day not found.');
      db.run('UPDATE pk_days SET day_number=?,date=?,therapy=?,payment=?,notes=?,done=? WHERE id=?',
        [day_number, date, therapy, payment || 0, notes || null, done ? 1 : 0, req.params.id]);

      const finance = db.get("SELECT id FROM expenses WHERE source_type='panchakarma_day' AND source_id=? LIMIT 1", [String(req.params.id)]);
      if (Number(payment) > 0) {
        const description = `पंचकर्म — ${therapy} — ${day.patient_name} (Day ${day_number})`;
        if (finance) db.run('UPDATE expenses SET amount=?,description=?,expense_date=? WHERE id=?', [payment, description, date || localDate(), finance.id]);
        else db.run("INSERT INTO expenses (type,category,amount,description,expense_date,source_type,source_id) VALUES ('income','पंचकर्म',?,?,?,'panchakarma_day',?)", [payment, description, date || localDate(), req.params.id]);
      } else if (finance) db.run('DELETE FROM expenses WHERE id=?', [finance.id]);
    });
    res.json({ ok: true });
  } catch (e) { res.status(e.message.includes('day') ? 404 : 500).json({ error: e.message }); }
});

router.delete('/panchakarma/day/:id', auth, (req, res) => {
  try {
    db.transaction(() => {
      const day = db.get('SELECT id FROM pk_days WHERE id=?', [req.params.id]);
      if (!day) throw new Error('Panchakarma day not found.');
      db.run("DELETE FROM expenses WHERE source_type='panchakarma_day' AND source_id=?", [String(req.params.id)]);
      db.run('DELETE FROM pk_days WHERE id=?', [req.params.id]);
    });
    res.json({ ok: true });
  } catch (e) { res.status(e.message.includes('day') ? 404 : 500).json({ error: e.message }); }
});

router.get('/admin/backup', auth, (req, res) => {
  try {
    const buffer = db.exportBuffer();
    if (!buffer) return res.status(500).json({ error: 'Database is not initialized.' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="clinic-${localDate()}.db"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: RESET ALL CLINIC DATA ────────────────────────────────────────────
// A safe, single-click way to wipe every clinic record (patients, visits,
// prescriptions, finance, follow-ups, suvarnaprashan, panchakarma) instead of
// hand-editing the SQLite file — which is unreliable while the server is
// running, since sql.js keeps the DB in memory while the application is open.
// Deletion order matters even with foreign_keys enabled, so children are
// cleared before their parents.
router.post('/admin/reset', auth, (req, res) => {
  if (req.body?.confirm !== 'DELETE ALL DATA') {
    return res.status(400).json({ error: "Type the confirmation phrase exactly: DELETE ALL DATA" });
  }
  try {
    const tables = ['sp_doses','sp_children','pk_days','pk_courses','prescription_items','visits','patients','expenses','medicines'];
    db.transaction(() => {
      tables.forEach(table => db.run(`DELETE FROM ${table}`));
      try { db.run('DELETE FROM sqlite_sequence'); } catch {}
    });
    res.json({ ok: true, cleared: tables });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.sendFollowup = sendFollowup;
