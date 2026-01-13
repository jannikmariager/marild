import { Topbar } from '@/components/layout/topbar';
import { SettingsForm } from '@/components/settings/settings-form';

export default function SettingsPage() {
  return (
    <div>
      <Topbar title="Settings" />
      <div className="p-6">
        <div className="max-w-2xl">
          <SettingsForm />
        </div>
      </div>
    </div>
  );
}
