// ── UI Helpers ───────────────────────────────────────────────────────────
const UI = {
  _dirty: false,
  trackDirty(container) {
    UI._dirty = false;
    if (!container) return;
    const mark = () => { UI._dirty = true; };
    container.querySelectorAll('input,select,textarea').forEach(el => {
      el.addEventListener('input', mark);
      el.addEventListener('change', mark);
    });
  },
  markClean() { UI._dirty = false; },
  guardDiscard() {
    if (!UI._dirty) return true;
    const ok = window.confirm('Es gibt ungespeicherte Änderungen. Wirklich verlassen?');
    if (ok) UI._dirty = false;
    return ok;
  },
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

  // Render multiselect checkboxes
  multiCheck(name, options, selected = []) {
    return `<div class="multi-check" id="mc-${name}">
      ${options.map(o => `
        <label>
          <input type="checkbox" name="${name}" value="${o.key}" ${selected.includes(o.key) ? 'checked' : ''}>
          ${o.label}
        </label>`).join('')}
    </div>`;
  },

  getMultiCheck(name) {
    return [...document.querySelectorAll(`#mc-${name} input:checked`)].map(i => i.value);
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

  // Status badge
  statusBadge(s) {
    const map = {
      geplant:       ['badge-blue',   'Geplant'],
      in_bearbeitung:['badge-orange', 'In Bearbeitung'],
      abgeschlossen: ['badge-green',  'Zu verrechnen'],
      abgerechnet:   ['badge-purple', 'Abgerechnet'],
      archiviert:    ['badge-gray',   'Archiviert'],
    };
    const [cls, label] = map[s] || ['badge-gray', s];
    return `<span class="badge ${cls}">${label}</span>`;
  },

  roleName(r) {
    return { admin: 'Administrator', planer: 'Planer', monteur: 'Monteur' }[r] || r;
  },

  // Simple signature pad
  initSignaturePad(canvasEl) {
    const ctx = canvasEl.getContext('2d');
    canvasEl.width = canvasEl.offsetWidth * window.devicePixelRatio;
    canvasEl.height = 150 * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.lineCap = 'round';

    let drawing = false, lastX = 0, lastY = 0;

    function getPos(e) {
      const rect = canvasEl.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return [(t.clientX - rect.left), (t.clientY - rect.top)];
    }

    canvasEl.addEventListener('pointerdown', e => {
      drawing = true; [lastX, lastY] = getPos(e);
      canvasEl.setPointerCapture(e.pointerId);
    });
    canvasEl.addEventListener('pointermove', e => {
      if (!drawing) return;
      const [x, y] = getPos(e);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke();
      [lastX, lastY] = [x, y];
    });
    canvasEl.addEventListener('pointerup',   () => drawing = false);
    canvasEl.addEventListener('pointerout',  () => drawing = false);

    return {
      clear: () => ctx.clearRect(0, 0, canvasEl.offsetWidth, 150),
      getData: () => {
        // Check if empty
        const d = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
        const hasContent = d.some((v, i) => i % 4 === 3 && v > 0);
        return hasContent ? canvasEl.toDataURL('image/png') : null;
      },
      setData: (dataUrl) => {
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, canvasEl.offsetWidth, 150);
        img.src = dataUrl;
      }
    };
  },

  // Escape HTML
  esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
};
