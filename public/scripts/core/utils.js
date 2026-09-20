(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const safe = value => {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  };
  const money = value => new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  // Accepts either a date-only value ("2026-08-25", as visit_date/dose_date
  // are stored) or a full datetime ("2026-08-25 12:30:57", as created_at/
  // updated_at are stored). Date-only values get an explicit local midnight
  // so they aren't shifted a day by UTC parsing.
  const fmtDate = value => {
    if (!value) return '';
    const raw = String(value);
    const input = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw.replace(' ', 'T');
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return raw;
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(parsed);
  };

  window.JivakUtils = { $, $$, safe, money, today, fmtDate };
})();
