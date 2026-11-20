import type { Role, Status, Ticket } from './types';

export const manualStatuses: Status[] = ['waiting', 'called', 'seated', 'playing', 'finished', 'hold', 'cancelled'];
export const assignedStatuses: Status[] = ['called', 'seated', 'playing'];

// Called is before payment; seated/playing/finished are after payment.
export function manualStatusPaid(ticket: Ticket, target: Status): number {
  return target === ticket.status ? ticket.paid : Number(['seated','playing','finished'].includes(target));
}

export function manualStatusIssue(ticket: Ticket, target: Status, role: Role): string | null {
  if (role !== 'admin' && role !== 'reception' && role !== 'operator') return '責任者または受付スタッフのみ変更できます。';
  if (target === ticket.status) return null;
  return null;
}

export function manualStatusWarning(ticket: Ticket, target: Status): string | null {
  if (target === ticket.status) return '変更内容を確認してください。保存すると受付情報と関連する集計に反映されます。';
  const warnings: string[] = [];
  if (ticket.status === 'playing' && target !== 'finished') warnings.push('進行中のタイマーと経過時間をリセットします。');
  if (ticket.status === 'finished') warnings.push('確定済みの終了時刻・最終チップ数を消去します。');
  if (target === 'playing') warnings.push(`変更した時点から${ticket.minutes}分のプレイ時間を新しく開始します。`);
  if (target === 'finished') warnings.push('入力した最終チップ数で終了を確定し、席を解放します。');
  if (assignedStatuses.includes(ticket.status) && ['waiting','called','hold','cancelled'].includes(target)) warnings.push('現在の席を解放します。');
  if (manualStatusPaid(ticket,target) !== ticket.paid) warnings.push(manualStatusPaid(ticket,target) ? `入金済みに修正し、参加料${ticket.fee}円を売上に加算します。現金の受け取り状況を確認してください。` : `未入金に修正し、参加料${ticket.fee}円を売上から差し引きます。現金の返却状況も確認してください。`);
  return warnings.length ? warnings.join(' ') : '変更内容を確認してください。保存すると受付情報と関連する集計に反映されます。';
}
