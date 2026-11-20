import { Display } from '@/components/festival';
import { requireStaffPage } from '@/lib/staff-page';

export default async function Page({params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  await requireStaffPage('/display', slug);
  return <Display/>;
}
