(() => {
  const { $, safe, money, today, fmtDate } = window.JivakUtils;
  const currency = money; // this file refers to it as currency() in places
  let visits = [];
  let patients = [];
  let inventory = [];

  function normalizeVisit(v) {
    return {
      id: String(v.id),
      patientId: String(v.patient_id),
      patientName: v.patient_name || '',
      patientPhone: v.patient_phone || '',
      patientCode: v.patient_code || '',
      mrdNumber: v.mrd_number || '',
      visitSeq: v.visit_seq,
      date: v.visit_date || '',
      fee: Number(v.consultation_fee || 0),
      bp: v.bp || '',
      bsl: v.bsl || '',
      temp: v.temp || '',
      weight: v.weight || '',
      complaints: v.complaints || '',
      diagnosis: v.diagnosis || '',
      instructions: v.notes || '',
      medicines: (v.items || []).map(item => ({
        id: item.id,
        medicineId: item.medicine_id ? String(item.medicine_id) : null,
        name: item.medicine_name || '',
        quantity: Number(item.quantity_given || 0),
        quantityReturned: Number(item.quantity_returned || 0),
        dosage: item.dosage || '',
        duration: item.duration || '',
        frequency: item.frequency || '',
        sellingPrice: Number(item.selling_price || 0),
        lineTotal: Number(item.line_total || 0),
        morning: Boolean(item.morning),
        afternoon: Boolean(item.afternoon),
        evening: Boolean(item.evening),
        night: Boolean(item.night),
      })),
    };
  }

  async function loadData() {
    if (!window.JivakAuth?.isAuthenticated?.()) return;
    const [patientData, visitData, medicineData] = await Promise.all([
      JivakAPI.get('/patients'),
      JivakAPI.get('/visits'),
      JivakAPI.get('/medicines'),
    ]);
    patients = Array.isArray(patientData) ? patientData : [];
    inventory = Array.isArray(medicineData) ? medicineData : [];
    visits = Array.isArray(visitData) ? visitData.map(normalizeVisit) : [];
    renderVisits();
  }

  function refreshInventory() {
    JivakAPI.get('/medicines').then(data => { inventory = Array.isArray(data) ? data : []; }).catch(() => {});
  }

  // ── Medicine row with Morning/Afternoon/Evening/Night ────────────────────
  function medicineRow(m = {}) {
    const row = document.createElement('div');
    row.className = 'medicine-row';

    const dosageOpts = ['1 tab','2 tabs','1/2 tab','5 ml','10 ml','15 ml','1 tsp','2 tsp','1 sachet','1 capsule','2 capsules'];
    const durationOpts = ['3 days','5 days','7 days','10 days','14 days','1 month','2 months','3 months','As needed','Ongoing'];
    const freqOpts = ['Before meals','After meals','With meals','Empty stomach','Before sleep','With warm water','With milk','With honey','With ghee'];

    const dosageSel = (v) => dosageOpts.map(o => `<option ${v===o?'selected':''}>${o}</option>`).join('') + `<option value="custom">Other...</option>`;
    const durSel    = (v) => durationOpts.map(o => `<option ${v===o?'selected':''}>${o}</option>`).join('') + `<option value="custom">Other...</option>`;
    const frqSel    = (v) => freqOpts.map(o => `<option ${v===o?'selected':''}>${o}</option>`).join('');

    row.innerHTML = `
      <input class="med-name" required maxlength="100" placeholder="Medicine name" value="${safe(m.name||'')}">
      <input class="med-quantity" type="number" min="1" step="1" value="${m.quantity || 1}" aria-label="Quantity sold" title="Quantity supplied from inventory">
      <select class="med-dosage"><option value="">Dosage</option>${dosageSel(m.dosage||'')}</select>
      <select class="med-duration"><option value="">Duration</option>${durSel(m.duration||'')}</select>
      <select class="med-frequency"><option value="">Meals / When</option>${frqSel(m.frequency||'')}</select>
      <div class="med-timing-group">
        <label class="med-timing-check ${m.morning  ?'checked':''}" title="Morning"><input type="checkbox" class="med-morning"   ${m.morning  ?'checked':''}>M</label>
        <label class="med-timing-check ${m.afternoon?'checked':''}" title="Afternoon"><input type="checkbox" class="med-afternoon" ${m.afternoon?'checked':''}>A</label>
        <label class="med-timing-check ${m.evening  ?'checked':''}" title="Evening"><input type="checkbox" class="med-evening"   ${m.evening  ?'checked':''}>E</label>
        <label class="med-timing-check ${m.night    ?'checked':''}" title="Night"><input type="checkbox" class="med-night"     ${m.night    ?'checked':''}>N</label>
      </div>
      <button class="remove-medicine" type="button" aria-label="Remove">×</button>`;

    const ds = row.querySelector('.med-dosage');
    const dr = row.querySelector('.med-duration');

    // Add custom existing values
    if (m.dosage && !dosageOpts.includes(m.dosage)) {
      const o = new Option(m.dosage, m.dosage, true, true);
      ds.insertBefore(o, ds.lastElementChild);
    }
    if (m.duration && !durationOpts.includes(m.duration)) {
      const o = new Option(m.duration, m.duration, true, true);
      dr.insertBefore(o, dr.lastElementChild);
    }

    ds.addEventListener('change', () => {
      if (ds.value !== 'custom') return;
      const v = prompt('Enter dosage:');
      if (v) { const o = new Option(v,v,true,true); ds.insertBefore(o, ds.lastElementChild); ds.value = v; }
      else ds.value = '';
    });
    dr.addEventListener('change', () => {
      if (dr.value !== 'custom') return;
      const v = prompt('Enter duration:');
      if (v) { const o = new Option(v,v,true,true); dr.insertBefore(o, dr.lastElementChild); dr.value = v; }
      else dr.value = '';
    });

    row.querySelectorAll('.med-timing-check').forEach(label => {
      label.querySelector('input').addEventListener('change', e => label.classList.toggle('checked', e.target.checked));
    });

    row.querySelector('.remove-medicine').onclick = () => {
      if (document.querySelectorAll('.medicine-row').length > 1) row.remove();
      else {
        row.querySelector('.med-name').value = '';
        row.querySelectorAll('select').forEach(x => x.selectedIndex = 0);
        row.querySelectorAll('input[type=checkbox]').forEach(x => { x.checked = false; x.closest('.med-timing-check').classList.remove('checked'); });
      }
    };
    $('#medicineRows').append(row);
  }

  function renderVisits() {
    const rows = [...visits].sort((a, b) => b.date.localeCompare(a.date));
    $('#visitTableBody').innerHTML = rows.map(v => `
      <tr data-visit-id="${v.id}">
        <td>${fmtDate(v.date)}</td>
        <td><span class="patient-name">${safe(v.patientName)}</span><span class="patient-id">${safe(visitMrdCode(v))} · ${safe(v.patientCode || `JIV-${v.id}`)}</span></td>
        <td><span class="patient-name">${safe(v.diagnosis)}</span><span class="patient-id">${safe(v.complaints)}</span></td>
        <td>${currency(v.fee)}</td>
        <td><div class="row-actions"><button class="link-button" data-view-visit="${v.id}">View prescription</button></div></td>
      </tr>`).join('');
    $('#visitEmptyState').hidden = visits.length > 0;
    $('#visitResultsText').textContent = visits.length ? `${visits.length} consultation${visits.length===1?'':'s'} recorded` : 'No visits have been recorded yet.';
    $('#visitCount').textContent = visits.length;
    const prefix = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    const thisMonth = visits.filter(v => v.date.startsWith(prefix));
    $('#visitMonthCount').textContent = thisMonth.length;
    $('#feeThisMonth').textContent = currency(thisMonth.reduce((s,v) => s+Number(v.fee),0));
  }

  async function openVisit() {
    if (!patients.length) {
      try { patients = await JivakAPI.get('/patients'); } catch {}
    }
    if (!patients.length) { alert('Please add a patient first.'); location.hash='#patients'; return; }

    $('#visitForm').reset();
    $('#visitDate').value = today();
    $('#visitPatient').innerHTML = '<option value="" disabled selected>Select a patient</option>' +
      patients.map(p => `<option value="${p.id}">${safe(p.name)} — ${safe(p.phone)}</option>`).join('');
    $('#medicineRows').innerHTML = '';
    medicineRow();
    await refreshInventory();
    $('#visitDialog').showModal();
  }

  function show(view) {
    const isVisits = view === 'visits';
    $('#patientsView').hidden = isVisits;
    $('#visitsView').hidden = !isVisits;
    if (isVisits) renderVisits();
  }

  function prescription(v) {
    const p = patients.find(x => String(x.id) === String(v.patientId)) || { name: v.patientName, age: '', gender: '', patient_code: v.patientCode, phone: v.patientPhone };
    const safe2 = s => s || '';

    $('#prescriptionContent').innerHTML = `
    <div class="rx-sheet">

      <!-- Background letterhead -->
      <div class="rx-bg"></div>

      <!-- Overlay fields -->
      <div class="rx-overlay">

        <!-- Patient Name + Date -->
        <div class="rx-field rx-field-underline" style="top:25.3%;left:26.5%;width:46%">
          <span class="rx-label">Patient Name:</span>
          <span class="rx-data">${safe(v.patientName)}</span>
        </div>
        <div class="rx-field rx-field-underline" style="top:25.3%;left:75%;width:21%">
          <span class="rx-label">Date:</span>
          <span class="rx-data">${fmtDate(v.date)}</span>
        </div>

        <!-- Row 2: BP BSL Temp -->
        <div class="rx-field" style="top:28.3%;left:26.5%;width:21%">
          <span class="rx-label">BP:</span>
          <span class="rx-data">${safe2(v.bp)}</span>
        </div>
        <div class="rx-field" style="top:28.3%;left:48.7%;width:21%">
          <span class="rx-label">BSL:</span>
          <span class="rx-data">${safe2(v.bsl)}</span>
        </div>
        <div class="rx-field" style="top:28.3%;left:71%;width:25%">
          <span class="rx-label">Temp:</span>
          <span class="rx-data">${safe2(v.temp)}</span>
        </div>

        <!-- Row 3: Age Wt -->
        <div class="rx-field" style="top:30.9%;left:26.5%;width:21%">
          <span class="rx-label">Age:</span>
          <span class="rx-data">${p ? safe(String(p.age)) : ''}</span>
        </div>
        <div class="rx-field" style="top:30.9%;left:48.7%;width:21%">
          <span class="rx-label">Wt:</span>
          <span class="rx-data">${safe2(v.weight)}</span>
        </div>

        <!-- Rx symbol -->
        <div class="rx-print-symbol" style="top:33.4%;left:26.5%">℞</div>

        <!-- Rx content area -->
        <div class="rx-content-area" style="top:38%;left:26.5%;width:69%">
          ${v.complaints ? `<div class="rx-content-section"><div class="rx-content-label">Complaints / Symptoms</div><div class="rx-content-val">${safe(v.complaints)}</div></div>` : ''}
          ${v.diagnosis  ? `<div class="rx-content-section"><div class="rx-content-label">Diagnosis</div><div class="rx-content-val">${safe(v.diagnosis)}</div></div>` : ''}

          ${v.medicines && v.medicines.length ? `
          <div class="rx-content-section">
            <div class="rx-content-label">Medicines Prescribed</div>
            <table class="rx-med-table">
              <thead><tr>
                <th>Medicine</th><th>Dosage</th>
                <th>M</th><th>A</th><th>E</th><th>N</th>
                <th>When</th><th>Duration</th>
              </tr></thead>
              <tbody>
                ${v.medicines.map(m=>`<tr>
                  <td>${safe(m.name)}</td>
                  <td>${safe(m.dosage)||'—'}</td>
                  <td class="rx-tick">${m.morning  ?'✓':''}</td>
                  <td class="rx-tick">${m.afternoon?'✓':''}</td>
                  <td class="rx-tick">${m.evening  ?'✓':''}</td>
                  <td class="rx-tick">${m.night    ?'✓':''}</td>
                  <td>${safe(m.frequency)||'—'}</td>
                  <td>${safe(m.duration)||'—'}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>` : ''}

          ${v.instructions ? `<div class="rx-content-section"><div class="rx-content-label">Instructions</div><div class="rx-content-val">${safe(v.instructions)}</div></div>` : ''}

          <div class="rx-fee-line">Consultation fee: ${currency(v.fee)} &nbsp;·&nbsp; Ph: ${safe(v.patientPhone)}</div>
        </div>

      </div>

      <div class="prescription-actions">
        <button class="secondary" id="closePrescription">Close</button>
        <button class="primary" id="printPrescription">🖨️ Print / Save PDF</button>
      </div>
    </div>`;
    $('#prescriptionDialog').showModal();
    $('#closePrescription').onclick = () => $('#prescriptionDialog').close();
    $('#printPrescription').onclick = () => {
      // Open prescription in new window for clean printing
      const sheet = document.querySelector('.rx-sheet').cloneNode(true);
      // Remove actions bar from clone
      sheet.querySelector('.prescription-actions')?.remove();
      const win = window.open('', '_blank', 'width=900,height=1100');
      win.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Prescription - ${v.patientName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background: white; }
  .rx-sheet { position:relative; width:210mm; height:297mm; }
  .rx-bg {
    width:210mm; height:297mm;
    background-image:url('${location.origin}/assets/letterhead.jpg');
    background-size:210mm 297mm;
    background-repeat:no-repeat;
    print-color-adjust:exact;
    -webkit-print-color-adjust:exact;
  }
  .rx-overlay { position:absolute; top:0; left:0; width:100%; height:100%; }
  .rx-field { position:absolute; display:flex; align-items:flex-end; gap:1.5mm; padding-bottom:1px; }
  .rx-label { font-size:3mm; font-weight:700; color:#1a5c2a; white-space:nowrap; font-family:'Nunito','Segoe UI',Arial,sans-serif; }
  .rx-data { font-size:3.5mm; font-weight:600; color:#111; font-family:'Nunito','Segoe UI',Arial,sans-serif; line-height:1.35; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .rx-field-underline { border-bottom:.3mm solid #b8c9b8; padding-bottom:1mm; }
  .rx-print-symbol { position:absolute; font-size:7mm; line-height:1; font-weight:700; color:#1a5c2a; font-family:Georgia,serif; }
  .rx-content-area { position:absolute; font-family:'Nunito','Segoe UI',Arial,sans-serif; }
  .rx-content-section { margin-bottom:3mm; }
  .rx-content-label { font-size:2.5mm; font-weight:700; text-transform:uppercase; letter-spacing:.8px; color:#1a5c2a; margin-bottom:1mm; }
  .rx-content-val { font-size:3.2mm; color:#111; line-height:1.4; }
  .rx-med-table { width:100%; border-collapse:collapse; }
  .rx-med-table th { background:#e8f5e9; color:#1a5c2a; font-weight:700; padding:.8mm 1mm; border:1px solid #c8e6c8; font-size:2.3mm; text-transform:uppercase; text-align:left; }
  .rx-med-table td { padding:.8mm 1mm; border:1px solid #e0e0e0; font-size:2.6mm; }
  .rx-med-table tr:nth-child(even) td { background:#f9fdf9; }
  .rx-tick { text-align:center; color:#1a5c2a; font-weight:700; }
  .rx-fee-line { margin-top:3mm; font-size:3mm; font-weight:600; color:#1a5c2a; }
  .rx-blank { display:inline-block; width:15mm; border-bottom:1px solid #333; vertical-align:bottom; }
  @page { size:A4; margin:0; }
  @media print { body { margin:0; } }
</style>
</head><body>${sheet.outerHTML}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
      win.document.close();
    };
  }


  // ── Events ───────────────────────────────────────────────────────────────
  $('#addVisitBtn').onclick = openVisit;
  $('#emptyAddVisitBtn').onclick = openVisit;
  $('#closeVisitDialog').onclick = () => $('#visitDialog').close();
  $('#cancelVisitDialog').onclick = () => $('#visitDialog').close();
  $('#addMedicineBtn').onclick = () => medicineRow();
  $('#visitDialog').addEventListener('click', e => { if (e.target === $('#visitDialog')) $('#visitDialog').close(); });
  $('#prescriptionDialog').addEventListener('click', e => { if (e.target === $('#prescriptionDialog')) $('#prescriptionDialog').close(); });

  $('#visitForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();

    const patientId = $('#visitPatient').value;
    if (!patientId) return alert('Please select a patient.');

    const meds = [...document.querySelectorAll('.medicine-row')].map(row => {
      const name = row.querySelector('.med-name').value.trim();
      const stockMedicine = inventory.find(m => m.name?.toLowerCase() === name.toLowerCase());
      return {
        medicine_id: stockMedicine?.id || null,
        medicine_name: name,
        quantity_given: Number(row.querySelector('.med-quantity').value) || 0,
        dosage: row.querySelector('.med-dosage').value,
        duration: row.querySelector('.med-duration').value,
        frequency: row.querySelector('.med-frequency').value,
        morning: row.querySelector('.med-morning').checked,
        afternoon: row.querySelector('.med-afternoon').checked,
        evening: row.querySelector('.med-evening').checked,
        night: row.querySelector('.med-night').checked,
      };
    }).filter(m => m.medicine_name);

    try {
      const button = $('#saveVisitBtn') || form.querySelector('button[type=submit]');
      if (button) button.disabled = true;

      const saved = await JivakAPI.post('/visits', {
        patient_id: Number(patientId),
        visit_date: $('#visitDate').value,
        complaints: $('#complaints').value.trim(),
        diagnosis: $('#diagnosis').value.trim(),
        notes: $('#instructions').value.trim(),
        consultation_fee: Number($('#visitFee').value) || 0,
        bp: $('#visitBP').value.trim(),
        bsl: $('#visitBSL').value.trim(),
        temp: $('#visitTemp').value.trim(),
        weight: $('#visitWeight').value.trim(),
        followup_required: Boolean($('#followupRequired')?.checked),
        prescription_items: meds,
      });

      const normalized = normalizeVisit(saved);
      visits.unshift(normalized);
      visits = [...new Map(visits.map(v => [String(v.id), v])).values()];
      $('#visitDialog').close();
      renderVisits();
      prescription(normalized);
      window.dispatchEvent(new CustomEvent('jivak:visit-saved', { detail: { visit: normalized } }));
      window.JivakInventory?.refresh?.();
      window.JivakFinance?.reload?.();
    } catch (error) {
      alert('Could not save visit: ' + error.message);
    } finally {
      const button = $('#saveVisitBtn') || form.querySelector('button[type=submit]');
      if (button) button.disabled = false;
    }
  });

  $('#visitTableBody').onclick = e => {
    const id = e.target.dataset.viewVisit;
    if (id) {
      const visit = visits.find(v => String(v.id) === String(id));
      if (visit) prescription(visit);
    }
  };

  window.addEventListener('jivak:authenticated', () => {
    loadData().catch(error => console.error('Visits load error:', error));
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#visits') {
      show('visits');
      refreshInventory();
    }
  });
  window.addEventListener('jivak:open-prescription', async event => {
    const id = String(event.detail.visitId);
    let visit = visits.find(v => String(v.id) === id);
    if (!visit) {
      try { visit = normalizeVisit(await JivakAPI.get('/visits').then(list => list.find(v => String(v.id) === id))); } catch {}
    }
    if (visit) prescription(visit);
  });

  if (window.JivakAuth?.isAuthenticated?.()) loadData().catch(error => console.error('Visits load error:', error));
  show(location.hash === '#visits' ? 'visits' : 'patients');
})();
