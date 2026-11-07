import type { Role, Status, Ticket } from './types';

export const manualStatuses: Status[] = ['waiting', 'called', 'seated', 'playing', 'finished', 'hold', 'cancelled'];
export const assignedStatuses: Status[] = ['called', 'seated', 'playing'];

export function manualStatusPaymentIssue(ticket: Ticket, target: Status): string | null {
  if (target === ticket.status) return null;
  if (ticket.paid && ['waiting', 'hold', 'cancelled'].includes(target)) return '入金済みです。取り消す場合は、責任者が編集画面の「返金して取消」を行ってください。';
  if (!ticket.paid && ['seated', 'playing', 'finished'].includes(target)) return '先に呼び出しと入金の登録を行ってください。';
  return null;
}

export function manualStatusIssue(ticket: Ticket, target: Status, role: Role): string | null {
  if (role !== 'admin' && role !== 'reception' && role !== 'operator') return '責任者または受付スタッフのみ変更できます。';
  if (target === ticket.status) return null;
  if (role !== 'admin' && (['playing', 'finished'].includes(ticket.status) || ['playing', 'finished'].includes(target))) return 'プレイ中・終了に関する変更は責任者が行ってください。';
  const paymentIssue = manualStatusPaymentIssue(ticket, target);
  if (paymentIssue) return paymentIssue;
  if (target === 'finished' && (!assignedStatuses.includes(ticket.status) || !ticket.table_id || ticket.seat === null)) return '席が割り当てられている受付のみ終了できます。';
  return null;
}
