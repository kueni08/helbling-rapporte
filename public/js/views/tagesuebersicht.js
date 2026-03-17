// ── Tagesübersicht View ───────────────────────────────────────────────────
const TagesuebersichtView = {

  async render(date) {
    const today = date || new Date().toISOString().split('T')[0];
    const role  = App.state.role;
    const el    = document.getElementById('main-content');

    el.innerHTML = `
      <div class="page-header">
        <h2>📊 Tagesübersicht</h2>
        <div class="flex gap-2">
          <input type="date" id="tu-date" value="${today}" style="width:160px"
            onchange="TagesuebersichtView.render(this.value)">
          ${role !== 'monteur' ? `
          <select id="tu-tech" style="min-width:160px" onchange="TagesuebersichtView.render(document.getElementById('tu-date').value)">
            <option value="">Alle Techniker</option>
          </select>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="TagesuebersichtView.exportDay(document.getElementById('tu-date').value)">⬇ Export</button>
        </div>
      </div>
      <div id="tu-content">Lade…</div>`;

    await TagesuebersichtView.load(today);
  },

  async load(date) {
    const role   = App.state.role;
    const techEl = document.getElementById('tu-tech');
    const techId = techEl ? techEl.value : '';
    let url = `/api/orders/tagesuebersicht?date=${date}`;
    if (techId) url += `&technicianId=${techId}`;

    let data;
    try { data = await API.get(url); }
    catch(e) { document.getElementById('tu-content').innerHTML = `<div class="card" style="color:red">${e.message}</div>`; return; }

    // Populate technician filter (admin/planer)
    if (techEl && techEl.options.length === 1 && data.technicians.length) {
      const cur = techEl.value;
      data.technicians.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id; o.textContent = t.full_name;
        techEl.appendChild(o);
      });
      if (cur) techEl.value = cur;
    }

    const { rows } = data;
    if (!rows.length) {
      document.getElementById('tu-content').innerHTML = `
        <div class="card" style="text-align:center;padding:40px;color:#888">
          Keine Aufträge für ${date}
        </div>`;
      return;
    }

    // Group by technician
    const groups = {};
    for (const r of rows) {
      const key = r.technician_name || '(Kein Techniker)';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }

    const fmtDur = h => h != null ? (h < 0 ? '<span style="color:red">–</span>' : `${h} h`) : '–';
    const fmtArr = arr => Array.isArray(arr) ? arr.join(', ') : (arr || '–');
    const esc = s => UI.esc(s);

    let html = '';
    for (const [tech, orders] of Object.entries(groups)) {
      const totalWork   = orders.reduce((s, o) => s + (o.duration_h || 0), 0);
      const totalTravel = orders.reduce((s, o) => s + (o.travel_time || 0), 0);
      const totalKm     = orders.reduce((s, o) => s + (o.travel_km || 0), 0);

      html += `
        <div class="card" style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            <div>
              <span style="font-size:18px">👤</span>
              <strong style="font-size:16px;margin-left:6px">${esc(tech)}</strong>
              <span style="color:#666;margin-left:8px;font-size:13px">${date}</span>
            </div>
            <div style="display:flex;gap:16px;font-size:13px">
              ${totalWork   ? `<span>⏱ Arbeitszeit: <strong>${Math.round(totalWork*100)/100} h</strong></span>` : ''}
              ${totalTravel ? `<span>🚗 Fahrzeit: <strong>${totalTravel} h</strong></span>` : ''}
              ${totalKm     ? `<span>📍 ${totalKm} km</span>` : ''}
            </div>
          </div>
          <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="background:#f0f4ff;border-bottom:2px solid #ddd">
                <th style="padding:8px;text-align:center;white-space:nowrap;width:32px">#</th>
                <th style="padding:8px;text-align:left;white-space:nowrap">Auftrag</th>
                <th style="padding:8px;text-align:left">Kunde / Adresse</th>
                <th style="padding:8px;text-align:left;white-space:nowrap">Von</th>
                <th style="padding:8px;text-align:left;white-space:nowrap">Bis</th>
                <th style="padding:8px;text-align:left;white-space:nowrap">Fahrzeit</th>
                <th style="padding:8px;text-align:left;white-space:nowrap">Dauer</th>
                <th style="padding:8px;text-align:left;white-space:nowrap">km</th>
                <th style="padding:8px;text-align:left">Ausgeführte Arbeiten</th>
                <th style="padding:8px;text-align:left">Status</th>
              </tr>
            </thead>
            <tbody>
              ${orders.map((o, i) => {
                // Calculate travel time = gap between end of previous order and start of this order
                const prevOrder = i > 0 ? orders[i-1] : null;
                let transferMin = null;
                if (prevOrder && prevOrder.work_time_to && o.work_time_from) {
                  const [ph, pm] = prevOrder.work_time_to.split(':').map(Number);
                  const [ch, cm] = o.work_time_from.split(':').map(Number);
                  transferMin = (ch * 60 + cm) - (ph * 60 + pm);
                  if (transferMin < 0) transferMin = null; // overnight / negative gap
                }
                const fmtTransfer = transferMin != null
                  ? `<span title="Fahrzeit von letztem Auftrag">${Math.floor(transferMin/60)}h${String(transferMin%60).padStart(2,'0')}min</span>`
                  : (o.travel_time != null ? o.travel_time+' h' : '–');
                return `
                <tr style="${i % 2 === 1 ? 'background:#fafafa' : ''}">
                  <td style="padding:8px;text-align:center;font-weight:700;color:#1a3a6b;font-size:14px">${i+1}</td>
                  <td style="padding:8px;white-space:nowrap">
                    <a href="#" onclick="MonteurViews.renderWorkForm(${o.id});App.navigate('monteur-orders');return false"
                       style="font-weight:600;color:#1a3a6b;text-decoration:none">${esc(o.order_number||String(o.id))}</a>
                  </td>
                  <td style="padding:8px">
                    <div style="font-weight:500">${esc(o.customer_name||'–')}</div>
                    <div style="color:#666;font-size:12px">${esc(o.installation_address||'')}</div>
                  </td>
                  <td style="padding:8px">${esc(o.work_time_from||'–')}</td>
                  <td style="padding:8px">${esc(o.work_time_to||'–')}</td>
                  <td style="padding:8px;white-space:nowrap">${fmtTransfer}</td>
                  <td style="padding:8px">${fmtDur(o.duration_h)}</td>
                  <td style="padding:8px">${o.travel_km != null ? o.travel_km : '–'}</td>
                  <td style="padding:8px">${esc(fmtArr(o.executed_work))}</td>
                  <td style="padding:8px">
                    <span style="padding:2px 8px;border-radius:12px;font-size:11px;background:${
                      o.status==='abgeschlossen' ? '#e8f5e9' :
                      o.status==='in_bearbeitung'? '#fff8e1' : '#e8f0fe'
                    };color:${
                      o.status==='abgeschlossen' ? '#2d7a2d' :
                      o.status==='in_bearbeitung'? '#c67a00' : '#1a3a6b'
                    }">${esc(o.status)}</span>
                  </td>
                </tr>
                ${o.notes_monteur ? `
                <tr style="${i % 2 === 1 ? 'background:#fafafa' : ''}">
                  <td></td>
                  <td></td>
                  <td colspan="8" style="padding:4px 8px 8px;font-size:12px;color:#555;font-style:italic">
                    💬 ${esc(o.notes_monteur)}
                  </td>
                </tr>` : ''}
              `}).join('')}
            </tbody>
            <tfoot>
              <tr style="border-top:2px solid #ddd;font-weight:700;background:#f0f4ff">
                <td colspan="5" style="padding:8px">Total</td>
                <td style="padding:8px">${totalTravel ? totalTravel+' h' : '–'}</td>
                <td style="padding:8px">${totalWork ? Math.round(totalWork*100)/100+' h' : '–'}</td>
                <td style="padding:8px">${totalKm || '–'}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>`;
    }

    document.getElementById('tu-content').innerHTML = html;
  },

  exportDay(date) {
    const techEl = document.getElementById('tu-tech');
    const techId = techEl ? techEl.value : '';
    let url = `/api/orders/tagesuebersicht/export?date=${date}`;
    if (techId) url += `&technicianId=${techId}`;
    window.open(url, '_blank');
  },
};
