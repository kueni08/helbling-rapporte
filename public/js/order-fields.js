const OrderFields = {
  definitions: {
    planner: ['customer_name','customer_address','orderer','on_site_contact','on_site_contact_phone','installation_address','arrival_time','planned_date','latest_date','earliest_delivery_date','zylinder_status','work_types','notes_planer','assigned_to','sort_order','project_number','ls_number'],
    rapport: ['executed_work','items_table','additional_material','extra_material','extra_aufwand','extra_argumentation','notes_monteur','rings_data','keys_data','work_date','work_time_from','work_time_to','work_sessions','travel_time','travel_km','technician_name','technician_block','agb_accepted'],
    protected: ['signature_data'],
  },
  canEdit(field, role = App.state?.role) {
    if (this.definitions.protected.includes(field)) return role === 'monteur';
    if (this.definitions.rapport.includes(field)) return ['admin','planer','monteur'].includes(role);
    return ['admin','planer'].includes(role);
  }
};
