import { Dealer } from '@/components/festival';
import { requireStaffPage } from '@/lib/staff-page';

export default async function Page({params}: {params: Promise<{id: string; slug: string}>}) {
  const {id, slug} = await params;
  await requireStaffPage('/staff/table/' + encodeURIComponent(id), slug);
  return <Dealer key={id} id={id}/>;
}
