(() => {
  const $ = selector => document.querySelector(selector);
  let visits = [];
  let medicines = [];

  const COMMON_DISEASES = [
    'Fever', 'Frozen shoulder', 'Common cold', 'Cough', 'Migraine', 'Headache',
    'Back pain', 'Knee pain', 'Joint pain', 'Acidity', 'Indigestion', 'Constipation',
    'Diarrhea', 'Skin allergy', 'Eczema', 'Psoriasis', 'Sinusitis', 'Asthma',
    'Bronchitis', 'Hypertension', 'Diabetes', 'Thyroid disorder', 'Insomnia',
    'Anxiety', 'Arthritis', 'Sciatica', 'Piles', 'Kidney stones', 'PCOD',
    'Menstrual disorder', 'Hair fall', 'Anemia', 'Urinary infection', 'Gastritis',
    'Ulcer', 'Vertigo', 'Allergic rhinitis', 'Obesity', 'Weight loss'
  ];

  function diagnosisSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const historical = visits.map(v => v.diagnosis).filter(Boolean);
    return [...new Set([...COMMON_DISEASES, ...historical])]
      .filter(item => item.toLowerCase().startsWith(q)).slice(0, 7);
  }

  function medicineSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [...new Set(medicines.map(m => m.name).filter(Boolean))]
      .filter(name => name.toLowerCase().startsWith(q)).slice(0, 7);
  }

  async function refreshData() {
    if (!window.JivakAPI || !window.JivakAuth?.isAuthenticated?.()) return;
    try { visits = await JivakAPI.get('/visits'); } catch {}
    try { medicines = await JivakAPI.get('/medicines'); } catch {}
  }

  function attachAutocomplete(input, getSuggestions) {
    if (!input || input.dataset.autocompleteBound) return;
    input.dataset.autocompleteBound = 'true';
    input.setAttribute('autocomplete', 'off');

    const wrapper = document.createElement('div');
    wrapper.className = 'autocomplete-wrap';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const box = document.createElement('div');
    box.className = 'autocomplete-list';
    box.hidden = true;
    wrapper.appendChild(box);

    let items = [];
    let activeIndex = -1;

    function render(matches) {
      items = matches;
      activeIndex = -1;
      if (!matches.length) {
        box.hidden = true;
        box.innerHTML = '';
        return;
      }
      box.innerHTML = matches.map((value, index) =>
        `<div class="autocomplete-item" data-index="${index}">${String(value).replace(/</g, '&lt;')}</div>`
      ).join('');
      box.hidden = false;
    }

    function highlight() {
      [...box.children].forEach((child, index) => child.classList.toggle('active', index === activeIndex));
    }

    function select(value) {
      input.value = value;
      box.hidden = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }

    input.addEventListener('input', () => render(getSuggestions(input.value)));
    input.addEventListener('focus', () => { if (input.value) render(getSuggestions(input.value)); });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    input.addEventListener('keydown', event => {
      if (box.hidden || !items.length) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); highlight(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlight(); }
      else if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); select(items[activeIndex]); }
      else if (event.key === 'Escape') box.hidden = true;
    });
    box.addEventListener('mousedown', event => {
      const item = event.target.closest('.autocomplete-item');
      if (item) select(items[Number(item.dataset.index)]);
    });
  }

  window.JivakAutocomplete = {
    attach: attachAutocomplete,
    diseases: diagnosisSuggestions,
    medicines: medicineSuggestions,
    refresh: refreshData,
  };

  function bindDiagnosis() {
    const diagnosis = $('#diagnosis');
    if (diagnosis) attachAutocomplete(diagnosis, diagnosisSuggestions);
    const rows = $('#medicineRows');
    if (!rows) return;
    const bindRow = row => {
      const nameInput = row.querySelector('.med-name');
      if (nameInput) attachAutocomplete(nameInput, medicineSuggestions);
    };
    rows.querySelectorAll('.medicine-row').forEach(bindRow);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1 && node.classList.contains('medicine-row')) bindRow(node);
    }))).observe(rows, { childList: true });
  }

  function boot() {
    bindDiagnosis();
    refreshData();
  }

  document.addEventListener('jivak:authenticated', () => {
    refreshData();
    bindDiagnosis();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
