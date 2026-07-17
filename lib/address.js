'use strict';

function cleanAddress(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, '')
    .replace(/\r\n|\r|\n/g, ', ')
    .replace(/\b(?:Schweiz|Switzerland|Suisse|Svizzera)\b/gi, '')
    .replace(/\s*,\s*/g, ', ').replace(/(?:,\s*){2,}/g, ', ')
    .replace(/\s{2,}/g, ' ').replace(/^,\s*|,\s*$/g, '').trim();
}

function parseSwissAddress(value) {
  const clean = cleanAddress(value);
  const empty = { name: '', street: '', postalCode: '', city: '' };
  if (!clean) return empty;
  const postal = clean.match(/\b([1-9]\d{3})\s+([^,]+)/);
  if (!postal) return { ...empty, street: clean };
  const parts = clean.slice(0, postal.index).replace(/,\s*$/, '').trim()
    .split(',').map(part => part.trim()).filter(Boolean);
  const street = parts.pop() || '';
  return { name: parts.join(', '), street, postalCode: postal[1], city: postal[2].trim() };
}

function formatSwissAddress(parts = {}) {
  const location = [parts.postalCode, parts.city].filter(Boolean).join(' ');
  return [parts.name, parts.street, location].map(v => String(v || '').trim()).filter(Boolean).join(', ');
}

function syncOrderAddressParts(db, orderId, value) {
  const parsed = parseSwissAddress(value);
  const formatted = formatSwissAddress(parsed) || cleanAddress(value) || null;
  db.prepare(`UPDATE orders SET installation_address=?, installation_name=?, installation_street=?,
    installation_postal_code=?, installation_city=? WHERE id=?`)
    .run(formatted, parsed.name || null, parsed.street || null, parsed.postalCode || null, parsed.city || null, orderId);
  return { ...parsed, formatted };
}

module.exports = { cleanAddress, parseSwissAddress, formatSwissAddress, syncOrderAddressParts };
