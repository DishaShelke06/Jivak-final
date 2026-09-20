(() => {
  const $ = s => document.querySelector(s);
  const { money, today } = window.JivakUtils;

  async function apiFetch(method, path, body) { return JivakAPI.request(method, path, body); }

  function getMedicines() {
    return window.JivakInventory?.getMedicines?.() || [];
  }

  function selected() {
    const id = $('#saleMedicine').value;
    return getMedicines().find(m => String(m.id) === String(id));
  }

  function update() {
    const m = selected();
    const q = Number($('#saleQuantity').value) || 1;
    if (!m) { $('#saleTotal').textContent = 'Select a medicine to calculate total.'; return; }
    const total = q * Number(m.selling_price);
    $('#saleTotal').textContent = `Total: ${money(total)} (${m.quantity} units in stock)`;
  }

  function open() {
    const meds = getMedicines().filter(m => m.quantity > 0);
    if (!meds.length) { alert('No medicines in stock.'); return; }
    $('#saleForm').reset();
    $('#saleDate').value = today();
    $('#saleMedicine').innerHTML = '<option value="" disabled selected>Select medicine</option>' +
      meds.map(m => `<option value="${m.id}">${m.name} — ${money(m.selling_price)} (${m.quantity} left)</option>`).join('');
    update();
    $('#saleDialog').showModal();
  }

  $('#recordSaleBtn').onclick  = open;
  $('#saleMedicine').onchange  = update;
  $('#saleQuantity').oninput   = update;
  $('#closeSaleDialog').onclick  = () => $('#saleDialog').close();
  $('#cancelSaleDialog').onclick = () => $('#saleDialog').close();

  $('#saleForm').onsubmit = async e => {
    e.preventDefault();
    if (!e.currentTarget.checkValidity()) return e.currentTarget.reportValidity();
    const m = selected();
    const q = Number($('#saleQuantity').value);
    if (!m) { alert('Select a medicine.'); return; }
    if (q > m.quantity) { alert(`Only ${m.quantity} units in stock.`); return; }

    try {
      // Stock deduction and Finance income are one backend transaction.
      await apiFetch('POST', `/medicines/${m.id}/sell`, {
        quantity: q,
        sale_date: $('#saleDate').value,
      });
      $('#saleDialog').close();
      if (window.JivakInventory?.refresh) await window.JivakInventory.refresh();
      if (window.JivakFinance?.reload) await window.JivakFinance.reload();
      // Toast
      const t = $('#toast'); if(t){t.textContent='Sale recorded!';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);}
    } catch(err) { alert('Error recording sale: ' + err.message); }
  };
})();
