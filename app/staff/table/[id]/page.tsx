import { Dealer } from '../../../../components/festival';
import { requireStaffPage } from '../../../../lib/staff-page';

export default async function Page({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  await requireStaffPage('/staff/table/' + encodeURIComponent(id));
  return <Dealer key={id} id={id}/>;
}
