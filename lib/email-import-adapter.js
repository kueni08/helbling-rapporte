/**
 * Provider-neutral contract for a future mailbox import.
 * No provider, credentials or mailbox are configured here intentionally.
 */
class EmailImportAdapter {
  async listUnreadPdfMessages() { throw new Error('E-Mail-Adapter nicht konfiguriert'); }
  async downloadPdfAttachment() { throw new Error('E-Mail-Adapter nicht konfiguriert'); }
  async archiveMessage() { throw new Error('E-Mail-Adapter nicht konfiguriert'); }
}

function normalizeMessage(message) {
  return {
    provider_message_id: String(message.provider_message_id || ''),
    received_at: message.received_at || null,
    sender: message.sender || null,
    subject: message.subject || null,
    attachments: (message.attachments || []).filter(a => a.content_type === 'application/pdf').map(a => ({
      provider_attachment_id: String(a.provider_attachment_id || ''),
      filename: a.filename || 'lieferschein.pdf',
      content_type: 'application/pdf',
    })),
  };
}

module.exports = { EmailImportAdapter, normalizeMessage };
