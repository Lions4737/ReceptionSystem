import { Display } from '../../components/festival';
import { requireStaffPage } from '../../lib/staff-page';

export default async function Page() {
  await requireStaffPage('/display');
  return <Display/>;
}
