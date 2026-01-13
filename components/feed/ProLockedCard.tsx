'use client';

import { LockIcon } from 'lucide-react';
import { UpgradeButton } from '@/components/billing/upgrade-button';

interface ProLockedCardProps {
  isLocked: boolean;
  children: React.ReactNode;
  featureName?: string;
  description?: string;
}

export default function ProLockedCard({
  isLocked,
  children,
  featureName,
  description,
}: ProLockedCardProps) {
  if (!isLocked) {
    return <>{children}</>;
  }

  // Locked: show only the paywall card; do not render underlying content
  return (
    <div className="flex items-center justify-center">
      <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-lg max-w-sm mx-4">
        {/* Lock Icon */}
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-emerald-50 rounded-full">
            <LockIcon className="w-8 h-8 text-emerald-600" />
          </div>
        </div>

        {/* PRO Badge */}
        <div className="flex justify-center mb-3">
          <div className="px-3 py-1 bg-emerald-600 rounded-full">
            <span className="text-white text-xs font-bold tracking-wide">
              MARILD PRO
            </span>
          </div>
        </div>

        {/* Feature Name */}
        {featureName && (
          <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
            {featureName}
          </h3>
        )}

        {/* Description */}
        {description && (
          <p className="text-sm text-gray-600 text-center mb-5">
            {description}
          </p>
        )}

        {/* CTA Button */}
        <UpgradeButton
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          Upgrade to PRO
        </UpgradeButton>
      </div>
    </div>
  );
}
