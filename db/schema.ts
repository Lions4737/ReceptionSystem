import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(), fee: integer("fee").notNull().default(500),
  minutes: integer("minutes").notNull().default(30), chips: integer("chips").notNull().default(1000),
  beginnerOpen: integer("beginner_open").notNull().default(1), expertOpen: integer("expert_open").notNull().default(1),
  tagsJson: text("tags_json").notNull().default('[{"id":"beginner","name":"初心者","open":1,"version":0},{"id":"expert","name":"経験者","open":1,"version":0}]'),
  eventName: text("event_name").notNull().default("POKER FESTIVAL"),
});
export const tables = sqliteTable("game_tables", {
  id: text("id").primaryKey(), name: text("name").notNull(), kind: text("kind").notNull(),
  seatCount: integer("seat_count").notNull().default(9), archivedAt: integer("archived_at"),
  assignmentLocked: integer("assignment_locked").notNull().default(0),
  pausedAt: integer("paused_at"), version: integer("version").notNull().default(0), lastOp: text("last_op"),
});
export const sessions = sqliteTable("sessions", {
  hash: text("hash").primaryKey(), userId: text("user_id").notNull(), role: text("role").notNull(),
  tableId: text("table_id"), expiresAt: integer("expires_at").notNull(),
}, t => [index("idx_sessions_expiry").on(t.expiresAt)]);
export const invites = sqliteTable("invites", {
  hash: text("hash").primaryKey(), role: text("role").notNull(), tableId: text("table_id"),
  expiresAt: integer("expires_at").notNull(), usedAt: integer("used_at"),
});
export const playerRecovery = sqliteTable("player_recovery", {
  hash: text("hash").primaryKey(), playerId: text("player_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const tickets = sqliteTable("tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }), playerId: text("player_id").notNull(),
  day: text("day").notNull(), nickname: text("nickname").notNull(), kind: text("kind").notNull(),
  status: text("status").notNull().default("waiting"), queuedAt: integer("queued_at").notNull(),
  createdAt: integer("created_at").notNull(), calledAt: integer("called_at"),
  tableId: text("table_id").references(() => tables.id), seat: integer("seat"),
  paid: integer("paid").notNull().default(0), fee: integer("fee").notNull(), minutes: integer("minutes").notNull(),
  initialChips: integer("initial_chips").notNull(), finalChips: integer("final_chips"),
  startedAt: integer("started_at"), endsAt: integer("ends_at"), finishedAt: integer("finished_at"),
  pausedMs: integer("paused_ms").notNull().default(0), version: integer("version").notNull().default(0),
  lastOp: text("last_op").notNull(),
}, t => [
  index("idx_tickets_queue").on(t.day, t.kind, t.status, t.queuedAt, t.id),
  index("idx_tickets_player").on(t.playerId, t.id),
  uniqueIndex("one_active_ticket_per_player").on(t.playerId).where(sql`${t.status} IN ('waiting','called','seated','playing','hold')`),
  uniqueIndex("one_active_player_per_seat").on(t.tableId, t.seat).where(sql`${t.status} IN ('called','seated','playing')`),
  check("valid_seat", sql`${t.seat} IS NULL OR ${t.seat} BETWEEN 1 AND 9`),
  check("valid_kind", sql`length(${t.kind}) BETWEEN 1 AND 100`),
  check("valid_status", sql`${t.status} IN ('waiting','called','seated','playing','finished','hold','cancelled')`),
  check("assigned_seat", sql`${t.status} NOT IN ('seated','playing') OR (${t.tableId} IS NOT NULL AND ${t.seat} IS NOT NULL)`),
  check("nonnegative_score", sql`${t.finalChips} IS NULL OR ${t.finalChips} >= 0`),
]);
export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(), ticketId: integer("ticket_id").notNull().references(() => tickets.id),
  amount: integer("amount").notNull(), type: text("type").notNull(), createdAt: integer("created_at").notNull(), actor: text("actor").notNull(),
}, t => [index("idx_payments_ticket").on(t.ticketId), uniqueIndex("one_payment_type_per_ticket").on(t.ticketId,t.type)]);
export const operations = sqliteTable("operations", {
  id: text("id").primaryKey(), actor: text("actor").notNull(), action: text("action").notNull(),
  ticketId: integer("ticket_id"), before: text("before_json"), after: text("after_json"), reason: text("reason"), createdAt: integer("created_at").notNull(),
}, t => [index("idx_operations_created").on(t.createdAt)]);
export const attempts = sqliteTable("attempts", {
  key: text("key").primaryKey(), count: integer("count").notNull(), until: integer("until").notNull(),
});
