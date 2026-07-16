'use strict';

const Portal = {
  csrf: null,
  me: null,
  orders: [],
  installPrompt: null,
  saveTimers: new Map(),

  async request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.csrf && options.method && options.method !== 'GET') headers.set('x-csrf-token', this.csrf);
    if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
    const response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await response.json() : null;
    if (!response.ok) { const error = new Error(data?.error || 'Anfrage fehlgeschlagen'); error.status = response.status; error.data = data; throw error; }
    return data;
  },

  show(id) {
    ['login-view', 'password-view', 'portal-view'].forEach(view => document.getElementById(view).classList.toggle('hidden', view !== id));
    document.getElementById('logout-btn').classList.toggle('hidden', id === 'login-view');
  },

  async init() {
    document.getElementById('login-form').addEventListener('submit', event => this.login(event));
    document.getElementById('password-form').addEventListener('submit', event => this.changePassword(event));
    document.getElementById('logout-btn').addEventListener('click', () => this.logout());
    document.getElementById('new-order-btn').addEventListener('click', () => this.createOrder());
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault(); this.installPrompt = event; document.getElementById('install-tip').classList.remove('hidden');
    });
    document.getElementById('install-btn').addEventListener('click', async () => {
      if (!this.installPrompt) return; await this.installPrompt.prompt(); this.installPrompt = null;
      document.getElementById('install-tip').classList.add('hidden');
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/kundenportal-sw.js', { scope: '/kundenportal' }).catch(() => {});
    try { await this.loadMe(); } catch { this.show('login-view'); }
  },

  async login(event) {
    event.preventDefault();
    const form = event.currentTarget; const error = document.getElementById('login-error'); error.classList.add('hidden');
    try {
      const result = await this.request('/api/kundenportal/login', { method: 'POST', body: JSON.stringify({ email: form.email.value, password: form.password.value }) });
      this.csrf = result.csrfToken; await this.loadMe(); form.reset();
    } catch (e) { error.textContent = e.message; error.classList.remove('hidden'); }
  },

  async loadMe() {
    this.me = await this.request('/api/kundenportal/me'); this.csrf = this.me.csrfToken;
    if (this.me.mustChangePassword) { this.show('password-view'); return; }
    document.getElementById('customer-name').textContent = `${this.me.customer.name} · ${this.me.fullName}`;
    this.show('portal-view'); await this.loadOrders();
  },

  async changePassword(event) {
    event.preventDefault(); const form = event.currentTarget; const error = document.getElementById('password-error'); error.classList.add('hidden');
    if (form.password.value !== form.confirm.value) { error.textContent = 'Passwörter stimmen nicht überein'; error.classList.remove('hidden'); return; }
    try { await this.request('/api/kundenportal/password', { method: 'PUT', body: JSON.stringify({ password: form.password.value }) }); form.reset(); await this.loadMe(); }
    catch (e) { error.textContent = e.message; error.classList.remove('hidden'); }
  },

  async logout() {
    try { await this.request('/api/kundenportal/logout', { method: 'POST', body: '{}' }); } catch {}
    this.csrf = null; this.me = null; this.orders = []; this.show('login-view');
  },

  async loadOrders() {
    this.orders = await this.request('/api/kundenportal/orders'); this.renderOrders();
  },

  async createOrder() {
    try {
      const order = await this.request('/api/kundenportal/orders', { method: 'POST', body: '{}' });
      this.orders.unshift(order); this.renderOrders(order.id);
    } catch (e) { alert(e.message); }
  },

  statusLabel(status) {
    return ({ in_erfassung: 'Erfassung unvollständig', freigegeben: 'Für Helbling freigegeben', rueckfrage: 'Rückfrage', uebernommen: 'In Planung' })[status] || status;
  },

  renderOrders(openId = null) {
    const list = document.getElementById('orders-list'); list.innerHTML = '';
    if (!this.orders.length) { list.innerHTML = '<div class="auth-card"><p>Noch keine Aufträge. Legen Sie den ersten Auftrag an.</p></div>'; return; }
    for (const order of this.orders) {
      const card = document.getElementById('order-template').content.firstElementChild.cloneNode(true);
      card.dataset.id = order.id;
      card.querySelector('.order-object').textContent = order.object_name || 'Neuer Auftrag';
      card.querySelector('.order-meta').textContent = [order.order_number, order.street, [order.postal_code, order.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
      card.querySelector('.order-state').textContent = this.statusLabel(order.portal_status);
      card.querySelector('.order-summary').addEventListener('click', () => this.toggleCard(card, order.id));
      list.appendChild(card);
      if (openId === order.id) this.openCard(card, order.id);
    }
  },

  async toggleCard(card, orderId) {
    if (card.classList.contains('open')) { card.classList.remove('open'); card.querySelector('.order-body').classList.add('hidden'); return; }
    document.querySelectorAll('.order-card.open').forEach(other => { other.classList.remove('open'); other.querySelector('.order-body').classList.add('hidden'); });
    await this.openCard(card, orderId);
  },

  async openCard(card, orderId) {
    try {
      const order = await this.request(`/api/kundenportal/orders/${orderId}`);
      const index = this.orders.findIndex(item => item.id === order.id); if (index >= 0) this.orders[index] = { ...this.orders[index], ...order };
      card.classList.add('open'); card.querySelector('.order-body').classList.remove('hidden'); this.fillForm(card, order);
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { alert(e.message); }
  },

  fillForm(card, order) {
    const form = card.querySelector('.order-form');
    const set = (name, value) => { const element = form.elements[name]; if (element) element.value = value ?? ''; };
    const values = {
      project_number: order.project_number, object_name: order.object_name, street: order.street, postal_code: order.postal_code,
      city: order.city, contact_name: order.contact_name, contact_phone: order.contact_phone, contact_email: order.contact_email,
      term_option: order.term_option, term_from: order.term_from, power_available: order.power_available,
      power_notes: order.power_notes, parking_available: order.parking_available, restricted_hours: order.restricted_hours,
      additional_boxes: order.additional_boxes, notes: order.notes,
    };
    Object.entries(values).forEach(([key, value]) => set(key, value));
    ['parking_permit_required', 'access_permit_required'].forEach(name => { form.elements[name].checked = Boolean(order[name]); });
    form.querySelectorAll('.facades input').forEach(input => { input.checked = order.facade_types.includes(input.value); });
    this.updateTermVisibility(form);
    this.renderPhotos(card, order.photos || []); this.renderAttachments(card, order.attachments || []);
    const note = card.querySelector('.readonly-note'); note.classList.toggle('hidden', order.editable); note.textContent = 'Dieser Auftrag ist für Änderungen gesperrt.';
    [...form.elements].forEach(element => { if (!element.classList.contains('release')) element.disabled = !order.editable; });
    card.querySelector('.release').disabled = !order.editable;
    if (order.editable) {
      form.addEventListener('input', () => this.scheduleSave(card, order.id));
      form.addEventListener('change', event => { this.handleFacadeExclusivity(form, event.target); this.updateTermVisibility(form); this.scheduleSave(card, order.id, 250); });
      card.querySelector('.photo-input').addEventListener('change', event => this.uploadPhotos(card, order.id, event.target.files));
      card.querySelector('.attachment-input').addEventListener('change', event => this.uploadAttachments(card, order.id, event.target.files));
      card.querySelector('.release').addEventListener('click', () => this.release(card, order.id));
    }
  },

  handleFacadeExclusivity(form, changed) {
    if (!changed.closest('.facades') || !changed.checked) return;
    const boxes = [...form.querySelectorAll('.facades input')];
    if (changed.value === 'unbekannt') boxes.filter(b => b !== changed).forEach(b => b.checked = false);
    else boxes.find(b => b.value === 'unbekannt').checked = false;
  },

  updateTermVisibility(form) { form.querySelector('.term-from').classList.toggle('hidden', form.elements.term_option.value !== 'ab_datum'); },

  collect(form) {
    const nullableBoolean = name => form.elements[name].value === '' ? null : form.elements[name].value === '1';
    return {
      project_number: form.elements.project_number.value, installation_name: form.elements.object_name.value,
      installation_street: form.elements.street.value, installation_postal_code: form.elements.postal_code.value,
      installation_city: form.elements.city.value, on_site_contact: form.elements.contact_name.value,
      on_site_contact_phone: form.elements.contact_phone.value, on_site_contact_email: form.elements.contact_email.value,
      customer_term_option: form.elements.term_option.value, customer_term_from: form.elements.term_from.value,
      customer_power_available: nullableBoolean('power_available'), customer_power_notes: form.elements.power_notes.value,
      customer_parking_available: nullableBoolean('parking_available'),
      customer_parking_permit_required: form.elements.parking_permit_required.checked,
      customer_access_permit_required: form.elements.access_permit_required.checked,
      customer_restricted_hours: form.elements.restricted_hours.value,
      customer_additional_boxes: form.elements.additional_boxes.value,
      facade_types: [...form.querySelectorAll('.facades input:checked')].map(input => input.value), customer_notes: form.elements.notes.value,
    };
  },

  scheduleSave(card, orderId, delay = 700) {
    clearTimeout(this.saveTimers.get(orderId)); const state = card.querySelector('.save-state'); state.textContent = 'Wird gespeichert…'; state.classList.add('saving');
    this.saveTimers.set(orderId, setTimeout(() => this.save(card, orderId), delay));
  },

  async save(card, orderId) {
    const state = card.querySelector('.save-state');
    try {
      const order = await this.request(`/api/kundenportal/orders/${orderId}`, { method: 'PUT', body: JSON.stringify(this.collect(card.querySelector('.order-form'))) });
      const index = this.orders.findIndex(item => item.id === order.id); if (index >= 0) this.orders[index] = { ...this.orders[index], ...order };
      card.querySelector('.order-object').textContent = order.object_name || 'Neuer Auftrag'; state.textContent = 'Alle Änderungen gespeichert'; state.classList.remove('saving');
      state.style.color = ''; return true;
    } catch (e) { state.textContent = e.message; state.classList.remove('saving'); state.style.color = '#b42318'; return false; }
  },

  async uploadPhotos(card, orderId, files) {
    if (!files.length) return; const form = new FormData(); [...files].forEach(file => form.append('photos', file));
    try { const photos = await this.request(`/api/kundenportal/orders/${orderId}/photos`, { method: 'POST', body: form }); this.renderPhotos(card, photos); }
    catch (e) { alert(e.message); }
  },

  renderPhotos(card, photos) {
    const container = card.querySelector('.photo-preview'); container.innerHTML = photos.map(photo => `<div class="photo"><img src="${photo.url}" alt="Montageposition"><button type="button" data-photo="${photo.id}" aria-label="Foto löschen">×</button></div>`).join('');
    container.querySelectorAll('button').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('Foto löschen?')) return; const orderId = Number(card.dataset.id);
      try { await this.request(`/api/kundenportal/orders/${orderId}/photos/${button.dataset.photo}`, { method: 'DELETE', body: '{}' }); button.closest('.photo').remove(); }
      catch (e) { alert(e.message); }
    }));
  },

  async uploadAttachments(card, orderId, files) {
    if (!files.length) return; const form = new FormData(); [...files].forEach(file => form.append('attachments', file));
    try { const rows = await this.request(`/api/kundenportal/orders/${orderId}/attachments`, { method: 'POST', body: form }); this.renderAttachments(card, rows); }
    catch (e) { alert(e.message); }
  },

  renderAttachments(card, rows) { card.querySelector('.attachment-list').innerHTML = rows.map(row => `<a href="${row.url}" target="_blank" rel="noopener">${this.escape(row.original_name)}</a>`).join(''); },

  async release(card, orderId) {
    clearTimeout(this.saveTimers.get(orderId));
    if (!await this.save(card, orderId)) return;
    const errorBox = card.querySelector('.release-error'); errorBox.classList.add('hidden');
    try { await this.request(`/api/kundenportal/orders/${orderId}/release`, { method: 'POST', body: '{}' }); await this.loadOrders(); }
    catch (e) {
      errorBox.textContent = e.data?.missing?.length ? `Bitte ergänzen: ${e.data.missing.map(item => item.label).join(', ')}` : e.message;
      errorBox.classList.remove('hidden'); const first = e.data?.missing?.[0]?.field;
      const map = { installation_name: 'object_name', installation_street: 'street', installation_postal_code: 'postal_code', installation_city: 'city', on_site_contact: 'contact_name', on_site_contact_phone: 'contact_phone' };
      const element = card.querySelector(`[name="${map[first] || first}"]`) || (first === 'photos' ? card.querySelector('.photo-input') : null); element?.focus();
    }
  },

  escape(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; },
};

document.addEventListener('DOMContentLoaded', () => Portal.init());
