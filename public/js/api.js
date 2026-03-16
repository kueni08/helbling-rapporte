// ── API Client ───────────────────────────────────────────────────────────
const API = {
  async _req(method, url, body, isFormData) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body && !isFormData) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (isFormData) {
      opts.body = body; // FormData – let browser set Content-Type
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  get:    (url)         => API._req('GET',    url),
  post:   (url, body)   => API._req('POST',   url, body),
  put:    (url, body)   => API._req('PUT',    url, body),
  patch:  (url, body)   => API._req('PATCH',  url, body),
  delete: (url)         => API._req('DELETE', url),
  upload: (url, form)   => API._req('POST',   url, form, true),

  // Auth
  login:          (u, p)  => API.post('/api/auth/login', { username: u, password: p }),
  logout:         ()      => API.post('/api/auth/logout'),
  me:             ()      => API.get('/api/auth/me'),
  changePassword: (cur, n)=> API.post('/api/auth/change-password', { currentPassword: cur, newPassword: n }),

  // Users (admin)
  getUsers:             ()      => API.get('/api/users'),
  getMonteure:          ()      => API.get('/api/users/monteure'),
  createUser:           (d)     => API.post('/api/users', d),
  updateUser:           (id, d) => API.put(`/api/users/${id}`, d),
  deleteUser:           (id)    => API.delete(`/api/users/${id}`),
  deleteInactiveUsers:  ()      => API.delete('/api/users/inactive'),

  // Orders
  getOrders:      ()      => API.get('/api/orders'),
  getOrder:       (id)    => API.get(`/api/orders/${id}`),
  createOrder:    (d)     => API.post('/api/orders', d),
  updateOrder:    (id, d) => API.put(`/api/orders/${id}`, d),
  deleteOrder:    (id)    => API.delete(`/api/orders/${id}`),
  reorderOrders:  (items) => API.patch('/api/orders/reorder', { items }),
  importOrders:        (form) => API.upload('/api/orders/import', form),
  orderCustomerForm:   (id)   => API.post(`/api/orders/${id}/customer-form`),

  // Settings
  getOptions:         ()           => API.get('/api/settings/options'),
  getOptionsByField:  (f)          => API.get(`/api/settings/options/${f}`),
  createOption:       (d)          => API.post('/api/settings/options', d),
  updateOption:       (id, d)      => API.put(`/api/settings/options/${id}`, d),
  deleteOption:       (id)         => API.delete(`/api/settings/options/${id}`),
  getArticles:        ()           => API.get('/api/settings/articles'),
  createArticle:      (d)          => API.post('/api/settings/articles', d),
  updateArticle:      (id, d)      => API.put(`/api/settings/articles/${id}`, d),
  deleteArticle:      (id)         => API.delete(`/api/settings/articles/${id}`),
  getCustomers:       ()           => API.get('/api/settings/customers'),
  createCustomer:     (d)          => API.post('/api/settings/customers', d),
  updateCustomer:     (id, d)      => API.put(`/api/settings/customers/${id}`, d),

  // Files
  uploadAttachments: (orderId, form) => API.upload(`/api/files/${orderId}/attachments`, form),
  uploadPhotos:      (orderId, form) => API.upload(`/api/files/${orderId}/photos`, form),
  deleteAttachment:  (orderId, id)   => API.delete(`/api/files/${orderId}/attachments/${id}`),
  deletePhoto:       (orderId, id)   => API.delete(`/api/files/${orderId}/photos/${id}`),
  fileUrl:           (orderId, fn)   => `/api/files/${orderId}/${fn}`,

  // Email
  sendEmail:      (d)     => API.post('/api/email/send', d),
  emailStatus:    ()      => API.get('/api/email/config-status'),

  // Settings – Article Import & SMTP
  importArticles: (form) => API.upload('/api/settings/articles/import', form),
  getSmtp:        ()     => API.get('/api/settings/smtp'),
  saveSmtp:       (d)    => API.put('/api/settings/smtp', d),

  // Kundenanfragen
  getAnfragen:         ()         => API.get('/api/anfragen'),
  getAnfrage:          (id)       => API.get(`/api/anfragen/${id}`),
  updateAnfrage:       (id, d)    => API.put(`/api/anfragen/${id}`, d),
  setAnfrageStatus:    (id, s)    => API.put(`/api/anfragen/${id}/status`, { status: s }),
  generateAnfrageToken:(id)       => API.post(`/api/anfragen/${id}/generate-token`),
  linkAnfrageOrder:    (id, oid)  => API.post(`/api/anfragen/${id}/link-order`, { order_id: oid }),
  convertAnfrage:      (id)       => API.post(`/api/anfragen/${id}/convert`),
  deleteAnfrage:       (id)       => API.delete(`/api/anfragen/${id}`),

  // Lieferschein Auto-Import
  getLsStatus:         ()         => API.get('/api/lieferschein/status'),
  getLsImports:        ()         => API.get('/api/lieferschein/imports'),
  getLsDriveStatus:    ()         => API.get('/api/lieferschein/drive-status'),
  uploadLieferschein:  (form)     => API.upload('/api/lieferschein/upload', form),
  retryLsImport:       (id)       => API.post(`/api/lieferschein/retry/${id}`),
  deleteLsImport:      (id)       => API.delete(`/api/lieferschein/imports/${id}`),
};
