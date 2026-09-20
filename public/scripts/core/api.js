(() => {
  let token = null;

  async function request(method, path, body) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) options.body = JSON.stringify(body);

    const response = await fetch(`/api${path}`, options);
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (response.status === 401 || response.status === 403) {
      token = null;
      window.dispatchEvent(new CustomEvent('jivak:auth-required'));
    }

    if (!response.ok) {
      throw new Error(data?.error || data || `Request failed (${response.status}).`);
    }
    return data;
  }

  window.JivakAPI = {
    request,
    get: path => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: path => request('DELETE', path),
    setToken: value => { token = value || null; },
    getToken: () => token,
    clearToken: () => { token = null; },
  };
})();
