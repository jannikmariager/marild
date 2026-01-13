'use client';

import { Bell } from 'lucide-react';

export default function AlertsPlaceholderCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-blue-50 rounded-lg">
          <Bell className="w-6 h-6 text-blue-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            Smart Alerts
          </h3>
          <p className="text-sm text-gray-600">
            Coming soon • Get notified of important signals
          </p>
        </div>
      </div>
    </div>
  );
}
