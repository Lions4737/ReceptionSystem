import { SettingsPage } from '../../../components/festival';
import { requireStaffPage } from '../../../lib/staff-page';

export default async function Page() {
  await requireStaffPage('/staff/settings');
  return <SettingsPage/>;
}
