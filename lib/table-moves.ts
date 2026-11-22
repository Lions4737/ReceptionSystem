import { assignedStatuses } from './manual-status';
import type { GameTable, Ticket } from './types';

export interface TableMove {
  ticket_id: number;
  ticket_version: number;
  table_id: string;
  table_version: number;
  seat: number;
}

// Use the same deterministic plan for the confirmation screen and the server.
export function planTableMoves(source: GameTable, tables: GameTable[], tickets: Ticket[]) {
  const occupants = tickets.filter(t => t.table_id === source.id && assignedStatuses.includes(t.status))
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0) || a.id - b.id);
  const destinations = tables.filter(t => t.id !== source.id &&
    t.archived_at === null && !t.assignment_locked).map(table => {
    const used = tickets.filter(t => t.table_id === table.id && assignedStatuses.includes(t.status));
    const seats = Array.from({ length: table.seat_count }, (_, i) => i + 1).filter(seat => !used.some(t => t.seat === seat));
    return { table, seats, count: used.length };
  });
  const available = destinations.reduce((sum, t) => sum + t.seats.length, 0);
  const moves: TableMove[] = [];
  if (available >= occupants.length) {
    for (const ticket of occupants) {
      // Prefer tables of the same kind; spill over to the other kind only when they are full.
      const destination = destinations.filter(t => t.seats.length).sort((a, b) =>
        Number(a.table.kind !== source.kind) - Number(b.table.kind !== source.kind) || a.count - b.count || a.table.id.length - b.table.id.length || a.table.id.localeCompare(b.table.id))[0];
      moves.push({ ticket_id: ticket.id, ticket_version: ticket.version,
        table_id: destination.table.id, table_version: destination.table.version, seat: destination.seats.shift()! });
      destination.count++;
    }
  }
  return { occupants, available, moves };
}
