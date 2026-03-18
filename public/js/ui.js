// ── UI Helpers ───────────────────────────────────────────────────────────
const UI = {
  toast(msg, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), duration);
  },

  modal(title, bodyHtml, footerHtml = '') {
    const container = document.getElementById('modal-container');
    container.innerHTML = `
      <div class="modal-overlay" id="active-modal">
        <div class="modal">
          <div class="modal-header">
            <h3>${title}</h3>
            <button class="btn btn-ghost btn-sm" onclick="UI.closeModal()">✕</button>
          </div>
          <div class="modal-body">${bodyHtml}</div>
          ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
        </div>
      </div>`;
    document.getElementById('active-modal').addEventListener('click', e => {
      if (e.target.id === 'active-modal') UI.closeModal();
    });
  },

  closeModal() {
    document.getElementById('modal-container').innerHTML = '';
  },

  confirm(msg) {
    return new Promise(resolve => {
      UI.modal('Bestätigung',
        `<p>${msg}</p>`,
        `<button class="btn btn-ghost" onclick="UI.closeModal(); window._confirmResolve(false)">Abbrechen</button>
         <button class="btn btn-danger" onclick="UI.closeModal(); window._confirmResolve(true)">Löschen</button>`
      );
      window._confirmResolve = resolve;
    });
  },

  // Format date DE
  fmtDate(d) {
    if (!d) return '–';
    try { return new Date(d).toLocaleDateString('de-CH'); } catch { return d; }
  },

  fmtDateTime(d) {
    if (!d) return '–';
    try { return new Date(d).toLocaleString('de-CH'); } catch { return d; }
  },

  roleName(r) {
    return { admin: 'Administrator', planer: 'Planer' }[r] || r;
  },

  // Escape HTML
  esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
};
