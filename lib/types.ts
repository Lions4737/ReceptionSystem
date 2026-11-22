export type Kind = "beginner" | "expert";
export interface TargetTag { id: Kind; name: string; open: number; version: number }
export const DEFAULT_TAGS: TargetTag[] = [{id:'beginner',name:'初心者',open:1,version:0},{id:'expert',name:'経験者',open:1,version:0}];
export const targetTags = (data?: {settings: Pick<Settings, 'beginner_open' | 'expert_open'>} | null): TargetTag[] => DEFAULT_TAGS.map(tag=>({...tag,open:data ? tag.id==='beginner' ? data.settings.beginner_open : data.settings.expert_open : tag.open}));
export type Role = "player" | "reception" | "dealer" | "operator" | "admin";
export const canManageSettings = (role?: Role) => role === "admin" || role === "operator";
export type Status = "waiting" | "called" | "seated" | "playing" | "finished" | "hold" | "cancelled";
export interface Ticket {
  id: number; daily_number: number; player_id: string; day: string; nickname: string; kind: Kind; status: Status;
  queued_at: number; created_at: number; called_at: number | null; table_id: string | null; seat: number | null;
  reentry_count?: number;
  paid: number; fee: number; minutes: number; initial_chips: number; final_chips: number | null; lecture_at?: number | null;
  started_at: number | null; ends_at: number | null; finished_at: number | null; paused_ms: number; version: number; last_op: string;
}
export interface GameTable { id: string; name: string; kind: Kind; seat_count: number; assignment_locked: number; archived_at: number | null; paused_at: number | null; version: number }
export const DEFAULT_TABLE_SEATS = 9;
export const MAX_TABLE_SEATS = 9;
export const MAX_TABLE_NAME_LENGTH = 30;
export const tableName = (tables: GameTable[], id: string | null) => tables.find(t=>t.id===id)?.name ?? `テーブル ${id ?? '—'}`;
export interface Settings { reentry_fee: number; fee: number; minutes: number; chips: number; beginner_open: number; expert_open: number; event_name: string; tags_json: string }
export interface Session { user_id: string; role: Role; table_id: string | null; expires_at: number }
export interface ParticipationStats {
  kind: Kind;
  participants: number;
  revenue: number;
  highScore: number | null;
}
export interface Snapshot {
  serverNow: number; day: string; settings: Settings; tables: GameTable[]; tags?: TargetTag[];
  tickets: Ticket[]; me: Session | null; revenue?: number; total?: number; called?: {code: string; table_id: string | null; seat: number | null}[];
  queues?: Record<Kind,number>; occupancy?: Record<string,number>; waitMinutes?: Record<Kind,number | null>;
  position?: number; mineWaitMinutes?: number | null;
  archivedTables?: GameTable[];
  participationStats?: ParticipationStats[];
  merchandise?: {
    products: {id:string;name:string;price:number;sold:number;revenue:number}[];
    sales: {id:string;name:string;quantity:number;unit_price:number;created_at:number;voided_at:number|null}[];
  };
}
export const acceptsKind = (data: Snapshot, kind: Kind) => Boolean(targetTags(data).find(t=>t.id===kind)?.open);
export const kindLabel = (kind: Kind, tags: TargetTag[] = DEFAULT_TAGS) => tags.find(t=>t.id===kind)?.name ?? kind;
export const code = (ticket: Pick<Ticket,"daily_number"|"kind">) => `${ticket.kind === "beginner" ? "B" : ticket.kind === "expert" ? "E" : "T"}-${String(ticket.daily_number).padStart(3,"0")}`;
export const statusLabel: Record<Status,string> = { waiting:"待機中",called:"呼び出し中",seated:"着席・開始待ち",playing:"プレイ中",finished:"終了",hold:"不在・保留",cancelled:"キャンセル" };
/** Paid, called beginner attending the lecture before seat assignment. */
export const inLecture = (t: Pick<Ticket,'status'|'paid'|'lecture_at'>) => t.status === 'called' && !!t.paid && t.lecture_at != null;
export const ticketStatusLabel = (t: Pick<Ticket,'status'|'paid'|'lecture_at'>) => inLecture(t) ? '初心者講習中' : statusLabel[t.status];
export const ticketStatusClass = (t: Pick<Ticket,'status'|'paid'|'lecture_at'>) => inLecture(t) ? 'lecture' : t.status;
export const active = (t: Ticket) => !["finished","cancelled"].includes(t.status);
export function remaining(ticket: Ticket, now: number, table?: GameTable) {
  return ticket.ends_at === null ? ticket.minutes * 60_000 : ticket.ends_at - (table?.paused_at ?? now);
}
export function clockText(ms: number) {
  const n = Math.max(0,Math.ceil(ms/1000)); return `${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`;
}
export function dayKey(now=Date.now()) { return new Date(now+9*3600000).toISOString().slice(0,10); }
export function estimateWait(kind: Kind, tables: GameTable[], tickets: Ticket[], now: number, minutes: number, ahead?: number): number | null {
  const slots: number[] = [];
  for (const table of tables.filter(t=>t.kind===kind && !t.paused_at && !t.assignment_locked)) {
    for(let seat=1;seat<=table.seat_count;seat++) {
      const t=tickets.find(t=>t.table_id===table.id && t.seat===seat && ["called","seated","playing"].includes(t.status));
      slots.push(!t ? now : t.status==="playing" ? Math.max(now,t.ends_at ?? now)+300000 : now+(t.minutes+5)*60000);
    }
  }
  if(!slots.length) return null;
  const calledUnassigned = tickets.filter(t=>t.kind===kind && t.status==="called" && t.table_id===null).length;
  const waiting = calledUnassigned + (ahead ?? tickets.filter(t=>t.kind===kind && t.status==="waiting").length);
  for(let i=0;i<waiting;i++) { slots.sort((a,b)=>a-b); slots[0]+=(minutes+5)*60000; }
  return Math.max(0,Math.ceil((Math.min(...slots)-now)/60000));
}

/** Form value for final chips: blank means "no score recorded" (null). */
export function scoreValue(value: FormDataEntryValue | null): number | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : Number(text);
}
