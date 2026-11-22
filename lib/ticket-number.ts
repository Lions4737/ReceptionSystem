// Count every registration, including cancellations, within its original JST day.
// Internal IDs order simultaneous registrations and remain the operation keys.
// Event scoping also namespaces the inner tickets table.
export const dailyNumberSql = '(SELECT COUNT(*) FROM tickets numbered WHERE numbered.day=tickets.day AND numbered.id<=tickets.id)';
