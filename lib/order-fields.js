const FIELD_DEFINITIONS = {
  status:               { label: 'Status', roles: ['admin', 'planer', 'monteur'] },
  customer_id:          { label: 'Kunde', roles: ['admin', 'planer'] },
  customer_name:        { label: 'Kundenname', roles: ['admin', 'planer'] },
  customer_address:     { label: 'Kundenadresse', roles: ['admin', 'planer'] },
  installation_address:{ label: 'Montageadresse', roles: ['admin', 'planer'] },
  orderer:              { label: 'Besteller', roles: ['admin', 'planer'] },
  on_site_contact:      { label: 'Kontakt vor Ort', roles: ['admin', 'planer'] },
  on_site_contact_phone:{ label: 'Telefon Kontakt', roles: ['admin', 'planer'] },
  arrival_time:         { label: 'Ankunftszeit', roles: ['admin', 'planer'] },
  planned_date:         { label: 'Montagedatum', roles: ['admin', 'planer'] },
  latest_date:          { label: 'Spätestes Datum', roles: ['admin', 'planer'] },
  earliest_delivery_date:{ label: 'Frühster Liefertermin', roles: ['admin', 'planer'] },
  zylinder_status:      { label: 'Zylinderstatus', roles: ['admin', 'planer'] },
  work_types:           { label: 'Geplante Arbeiten', roles: ['admin', 'planer'] },
  notes_planer:         { label: 'Planer-Bemerkungen', roles: ['admin', 'planer'] },
  assigned_to:          { label: 'Zugewiesener Monteur', roles: ['admin', 'planer'] },
  sort_order:           { label: 'Reihenfolge', roles: ['admin', 'planer'] },
  project_number:       { label: 'Projektnummer', roles: ['admin', 'planer'] },
  ls_number:            { label: 'Lieferscheinnummer', roles: ['admin', 'planer'] },
  executed_work:        { label: 'Ausgeführte Arbeiten', roles: ['admin', 'planer', 'monteur'] },
  items_table:          { label: 'Positionen', roles: ['admin', 'planer', 'monteur'] },
  additional_material:  { label: 'Zusätzliches Material', roles: ['admin', 'planer', 'monteur'] },
  extra_material:       { label: 'Nicht auf LS aufgeführtes Material', roles: ['admin', 'planer', 'monteur'] },
  extra_aufwand:        { label: 'Mehraufwand', roles: ['admin', 'planer', 'monteur'] },
  extra_argumentation:  { label: 'Begründung Mehraufwand', roles: ['admin', 'planer', 'monteur'] },
  notes_monteur:        { label: 'Monteur-Bemerkungen', roles: ['admin', 'planer', 'monteur'] },
  rings_data:           { label: 'Halteringe', roles: ['admin', 'planer', 'monteur'] },
  keys_data:            { label: 'Schlüssel', roles: ['admin', 'planer', 'monteur'] },
  work_date:            { label: 'Arbeitsdatum', roles: ['admin', 'planer', 'monteur'] },
  work_time_from:       { label: 'Arbeitsbeginn', roles: ['admin', 'planer', 'monteur'] },
  work_time_to:         { label: 'Arbeitsende', roles: ['admin', 'planer', 'monteur'] },
  work_sessions:        { label: 'Arbeitseinsätze', roles: ['admin', 'planer', 'monteur'] },
  travel_time:          { label: 'Fahrzeit', roles: ['admin', 'planer', 'monteur'] },
  travel_km:            { label: 'Kilometer', roles: ['admin', 'planer', 'monteur'] },
  technician_name:      { label: 'Techniker', roles: ['admin', 'planer', 'monteur'] },
  technician_block:     { label: 'Name Unterzeichner', roles: ['admin', 'planer', 'monteur'] },
  agb_accepted:         { label: 'AGB akzeptiert', roles: ['admin', 'planer', 'monteur'] },
  signature_data:       { label: 'Kundenunterschrift', roles: ['monteur'], protected: true },
};

const JSON_FIELDS = new Set(['work_types','executed_work','items_table','additional_material','extra_material','rings_data','keys_data','work_sessions']);

function allowedFields(role) {
  return new Set(Object.entries(FIELD_DEFINITIONS).filter(([, d]) => d.roles.includes(role)).map(([key]) => key));
}

module.exports = { FIELD_DEFINITIONS, JSON_FIELDS, allowedFields };
