(() => {
  const { $, money, safe, today, fmtDate } = window.JivakUtils;
  // Only the binary backup download below needs a raw fetch; every JSON
  // call goes through JivakAPI, which attaches auth itself.
  const token = () => (JivakAPI.getToken ? JivakAPI.getToken() : '');

  const ALL_VIEWS = ['dashboard','patients','visits','inventory','followups','finance','suvarnaprashan','panchakarma'];

  const apiFetch = path => JivakAPI.get(path);

  async function loadDashboard() {
    try {
      const d = await apiFetch('/dashboard');
      const user = window.JivakAuth?.getUser?.()?.name || '';
      $('#dashboardGreeting').textContent = user ? `Good day, ${user}` : 'Good day, Doctor';
      $('#dashPatients').textContent    = d.total_patients || 0;
      $('#dashTodayVisits').textContent = d.today_visits   || 0;
      $('#dashFollowups').textContent   = d.pending_followups?.length || 0;
      $('#dashTodayIncome').textContent = money(d.monthly_income || 0);

      // Followups panel
      const fu = d.pending_followups || [];
      $('#dashboardFollowupList').innerHTML = fu.length
        ? fu.slice(0,4).map(v => `
            <div class="compact-item">
              <div><strong>${safe(v.patient_name)}</strong><small>Due ${fmtDate(v.followup_date)}</small></div>
              <span class="status due">Due</span>
            </div>`).join('')
        : '<p class="compact-empty">No follow-ups are due right now.</p>';

      // Inventory panel
      const el = d.expiring_list || [];
      $('#dashboardInventoryList').innerHTML = el.length
        ? el.slice(0,4).map(m => `
            <div class="compact-item">
              <div><strong>${safe(m.name)}</strong><small>Expires ${fmtDate(m.expiry_date)}</small></div>
              <span class="status due">Alert</span>
            </div>`).join('')
        : '<p class="compact-empty">No inventory alerts at the moment.</p>';
    } catch(e) { console.error('Dashboard error:', e); }
  }

  function show(view) {
    ALL_VIEWS.forEach(v => {
      const el = $(`#${v}View`);
      if (el) el.hidden = v !== view;
    });
    document.querySelectorAll('[data-view]').forEach(a => a.classList.toggle('active', a.dataset.view === view));

    const labels = {
      dashboard:      'Dashboard',
      patients:       'Patient management',
      visits:         'Visits & prescriptions',
      inventory:      'Medicine inventory',
      followups:      'Patient follow-ups',
      finance:        'Expense & income tracking',
      suvarnaprashan: 'सुवर्णप्राशन',
      panchakarma:    'पंचकर्म',
    };
    $('#pageEyebrow').textContent = '';
    $('#pageTitle').textContent   = labels[view] || '';

    if (view === 'dashboard')   loadDashboard();
    if (view === 'followups')   window.JivakFollowups?.render?.();
    if (view === 'finance')     window.JivakFinance?.reload?.();
    if (view === 'inventory')   window.JivakInventory?.refresh?.();
  }

  // Nav
  document.querySelectorAll('[data-view]').forEach(a => {
    a.addEventListener('click', e => {
      const v = a.dataset.view;
      if (!v) return;
      e.preventDefault();
      location.hash = `#${v}`;
      show(v);
    });
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    show(ALL_VIEWS.includes(h) ? h : 'dashboard');
  });

  // Dashboard buttons
  $('#dashboardAddVisit').onclick = () => { location.hash='#visits'; show('visits'); setTimeout(()=>$('#addVisitBtn')?.click(), 100); };

  // SQLite is the only persistent data store. Download the actual database file for backup.
  $('#exportBackupBtn').onclick = async () => {
    try {
      const response = await fetch('/api/admin/backup', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!response.ok) throw new Error('Backup failed.');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `jivak-clinic-${today()}.db`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) { alert('Backup failed: ' + e.message); }
  };

  // Danger zone: reset all clinic data. Requires the doctor to type an exact
  // confirmation phrase so it can never be triggered by a stray click.
  $('#resetAllDataBtn').onclick = async () => {
    const typed = prompt(
      'This permanently deletes ALL patients, visits, prescriptions, finance records, follow-ups, सुवर्णप्राशन and Panchakarma data.\n\n' +
      'This cannot be undone. Download a backup first if you have not already.\n\n' +
      'Type DELETE ALL DATA to confirm:'
    );
    if (typed === null) return; // cancelled
    if (typed.trim() !== 'DELETE ALL DATA') {
      alert('Confirmation phrase did not match. Nothing was deleted.');
      return;
    }
    try {
      const data = await JivakAPI.post('/admin/reset', { confirm: 'DELETE ALL DATA' });
      alert('All clinic data has been cleared.');
      location.reload();
    } catch (e) { alert('Reset failed: ' + e.message); }
  };

  // Doctor name and dashboard data become available only after authentication.
  window.addEventListener('jivak:authenticated', () => {
    const user = window.JivakAuth?.getUser?.()?.name || '';
    if (user && $('#doctorName')) $('#doctorName').textContent = user;
    const h = location.hash.slice(1);
    show(ALL_VIEWS.includes(h) ? h : 'dashboard');
  });

  const h = location.hash.slice(1);
  show(ALL_VIEWS.includes(h) ? h : 'dashboard');
})();
