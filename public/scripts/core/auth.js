(() => {
  let user = null;
  let authenticated = false;

  const escapeHtml = value => {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  };

  function displayDoctor() {
    const name = document.querySelector('#doctorName');
    if (name) name.textContent = user?.name || user?.username || 'Doctor';
  }

  function unlock() {
    authenticated = true;
    document.querySelector('.auth-gate')?.remove();
    document.documentElement.classList.remove('auth-pending');
    displayDoctor();
    window.dispatchEvent(new CustomEvent('jivak:authenticated', { detail: { user } }));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  function showGate(message = '') {
    authenticated = false;
    JivakAPI.clearToken();
    document.documentElement.classList.add('auth-pending');
    document.querySelector('.auth-gate')?.remove();

    const gate = document.createElement('section');
    gate.className = 'auth-gate';
    gate.innerHTML = `
      <div class="auth-card">
        <img class="auth-logo" src="assets/jivak-logo.png" alt="Jivak Chikitsalay logo">
        <p class="eyebrow">Secure clinic workspace</p>
        <h1>Welcome to Jivak Chikitsalay</h1>
        <p>Sign in to access patient records and clinic data.</p>
        <form class="auth-form" id="loginForm">
          <label class="field">Doctor <input id="loginUsername" required autocomplete="username" value="doctor"></label>
          <label class="field">Password <input id="loginPassword" required type="password" autocomplete="current-password" placeholder="Enter your password"></label>
          <p class="auth-error ${message ? 'visible' : ''}" id="authError">${escapeHtml(message)}</p>
          <button class="primary" type="submit">Sign in securely</button>
        </form>
        <p class="auth-footnote">Clinic records are stored in the SQLite database.</p>
      </div>`;
    document.body.append(gate);

    gate.querySelector('#loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      const error = gate.querySelector('#authError');
      const submit = gate.querySelector('button[type="submit"]');
      submit.disabled = true;
      error.textContent = '';
      error.classList.remove('visible');

      try {
        const result = await JivakAPI.post('/auth/login', {
          username: gate.querySelector('#loginUsername').value.trim(),
          password: gate.querySelector('#loginPassword').value,
        });
        if (!result.token) throw new Error('Login failed.');
        JivakAPI.setToken(result.token);
        user = result.user || { username: gate.querySelector('#loginUsername').value.trim() };
        unlock();
      } catch (err) {
        error.textContent = err.message;
        error.classList.add('visible');
        submit.disabled = false;
      }
    });
  }

  function logout() {
    JivakAPI.clearToken();
    user = null;
    showGate();
  }

  function boot() {
    document.querySelector('#logoutBtn')?.addEventListener('click', logout);
    window.addEventListener('jivak:auth-required', () => {
      if (authenticated) showGate('Your session is no longer valid. Please sign in again.');
    });
    showGate();
  }

  document.addEventListener('DOMContentLoaded', boot);
  window.JivakAuth = { isAuthenticated: () => authenticated, getUser: () => user, logout };
})();
