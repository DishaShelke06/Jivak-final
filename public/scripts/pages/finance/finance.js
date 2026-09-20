(() => {
  const $ = s => document.querySelector(s);
  let activeFilter = 'all';
  let allEntries = [];

  const { money, fmtDate, safe, today } = window.JivakUtils;
  const month = () => today().slice(0,7);

  async function apiFetch(method, path, body) { return JivakAPI.request(method, path, body); }

  async function loadEntries() {
    try {
      allEntries = await apiFetch('GET', '/expenses');
      if (!Array.isArray(allEntries)) allEntries = [];
    } catch(e) { console.error('Finance load error:', e); allEntries = []; }
  }

  function render() {
    const current = allEntries.filter(r => (r.expense_date||'').startsWith(month()));
    const income  = current.filter(r => r.type==='income').reduce((s,r) => s+Number(r.amount),0);
    const expense = current.filter(r => r.type==='expense').reduce((s,r) => s+Number(r.amount),0);

    $('#financeIncome').textContent  = money(income);
    $('#financeExpense').textContent = money(expense);
    $('#financeProfit').textContent  = money(income - expense);

    const shown = allEntries.filter(r => activeFilter==='all' || r.type===activeFilter);

    $('#financeTableBody').innerHTML = shown.map(r => `
      <tr>
        <td><strong>${fmtDate(r.expense_date)}</strong></td>
        <td><span class="status ${r.type==='income'?'completed':'due'}">${r.type==='income'?'Income':'Expense'}</span></td>
        <td>${safe(r.description||'—')}</td>
        <td>${safe(r.category||'—')}</td>
        <td class="${r.type}">${r.type==='income'?'+':'−'}${money(r.amount)}</td>
        <td><div class="row-actions">
          ${r.source_type ? '<span class="status">Linked</span>' : `<button class="link-button danger" data-delete-entry="${r.id}">Delete</button>`}
        </div></td>
      </tr>`).join('');

    $('#financeEmptyState').hidden = allEntries.length > 0;
    if (window.reloadIncomeBreakdown) window.reloadIncomeBreakdown();
  }

  async function init() {
    await loadEntries();
    render();
  }

  // Add transaction
  $('#addTransactionBtn').onclick = () => {
    $('#transactionForm').reset();
    $('#transactionDate').value = today();
    $('#transactionDialog').showModal();
  };

  $('#transactionForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!e.currentTarget.checkValidity()) return e.currentTarget.reportValidity();
    try {
      await apiFetch('POST', '/expenses', {
        type:        $('#transactionType').value,
        category:    $('#transactionCategory').value.trim(),
        amount:      Number($('#transactionAmount').value),
        description: $('#transactionDescription').value.trim(),
        expense_date:$('#transactionDate').value,
      });
      $('#transactionDialog').close();
      await loadEntries();
      render();
    } catch(e) { alert('Error saving: ' + e.message); }
  });

  // Delete entry
  $('#financeTableBody').addEventListener('click', async e => {
    const id = e.target.dataset.deleteEntry;
    if (!id || !confirm('Delete this entry?')) return;
    try {
      await apiFetch('DELETE', `/expenses/${id}`);
      await loadEntries();
      render();
    } catch(e) { alert('Error deleting: ' + e.message); }
  });

  // Export CSV
  $('#exportFinanceBtn').onclick = () => {
    const rows = [['Date','Type','Description','Category','Amount'],
      ...allEntries.map(r => [r.expense_date, r.type, r.description||'', r.category||'', r.amount])];
    const blob = new Blob([rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n')], {type:'text/csv'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`finance-${month()}.csv`; a.click();
  };

  // Tabs
  document.querySelectorAll('.finance-tab').forEach(btn => btn.onclick = () => {
    activeFilter = btn.dataset.financeType;
    document.querySelectorAll('.finance-tab').forEach(t => t.classList.toggle('active', t===btn));
    render();
  });

  // Dialogs
  $('#closeTransactionDialog').onclick  = () => $('#transactionDialog').close();
  $('#cancelTransactionDialog').onclick = () => $('#transactionDialog').close();
  $('#transactionDialog').addEventListener('click', e => { if(e.target===$('#transactionDialog')) $('#transactionDialog').close(); });

  // Hook into nav
  document.querySelectorAll('[data-view]').forEach(a => {
    if (a.dataset.view==='finance') a.addEventListener('click', () => setTimeout(init, 100));
  });
  window.addEventListener('hashchange', () => { if(location.hash==='#finance') init(); });

  // Expose for other modules
  window.JivakFinance = { render, reload: init };

  window.addEventListener('jivak:authenticated', () => { if (location.hash==='#finance') init(); });
  if (location.hash==='#finance' && window.JivakAuth?.isAuthenticated?.()) init();
})();
