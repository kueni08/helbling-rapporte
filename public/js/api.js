// ── API Client ───────────────────────────────────────────────────────────
const API = {
  async _req(method, url, body, isFormData) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body && !isFormData) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (isFormData) {
      opts.body = body;
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  get:    (url)         => API._req('GET',    url),
  post:   (url, body)   => API._req('POST',   url, body),
  put:    (url, body)   => API._req('PUT',    url, body),
  delete: (url)         => API._req('DELETE', url),
  upload: (url, form)   => API._req('POST',   url, form, true),

  // Auth
  login:          (u, p)  => API.post('/api/auth/login', { username: u, password: p }),
  logout:         ()      => API.post('/api/auth/logout'),
  me:             ()      => API.get('/api/auth/me'),
  changePassword: (cur, n)=> API.post('/api/auth/change-password', { currentPassword: cur, newPassword: n }),

  // Users (admin)
  getUsers:    () => API.get('/api/users'),
  createUser:  (d) => API.post('/api/users', d),
  updateUser:  (id, d) => API.put(`/api/users/${id}`, d),
  deleteUser:  (id) => API.delete(`/api/users/${id}`),

  // Email-Agent
  emailAgentStatus:    ()      => API.get('/api/email-agent/status'),
  getInbox:            (p)     => API.get(`/api/email-agent/inbox${p ? '?' + new URLSearchParams(p) : ''}`),
  getEmail:            (id)    => API.get(`/api/email-agent/inbox/${id}`),
  uploadEmls:          (form)  => API.upload('/api/email-agent/upload', form),
  pollGraph:           ()      => API.post('/api/email-agent/poll'),
  setEmailStatus:      (id, s) => API.put(`/api/email-agent/inbox/${id}/status`, { status: s }),
  reclassifyEmail:     (id)    => API.post(`/api/email-agent/inbox/${id}/reclassify`),
  saveDraft:           (id, d) => API.put(`/api/email-agent/inbox/${id}/draft`, { draft: d }),
  regenerateDraft:     (id)    => API.post(`/api/email-agent/inbox/${id}/regenerate-draft`),
  getEmailAgentSettings: ()    => API.get('/api/email-agent/settings'),
  saveEmailAgentSettings:(d)   => API.post('/api/email-agent/settings', d),
  deleteEmail:         (id)    => API.delete(`/api/email-agent/inbox/${id}`),
  attachmentUrl:       (fn)    => `/api/email-agent/attachment/${fn}`,
};
