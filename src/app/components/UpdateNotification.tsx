'use client';

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

interface UpdateInfo {
  current: string;
  latest: string;
  notes?: string;
}

export function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    // Listen for update events from Rust backend
    const unlisten = listen<UpdateInfo>('update-available', (event) => {
      console.log('Update available:', event.payload);
      setUpdateAvailable(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (!updateAvailable) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 max-w-md">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0">
            <svg
              className="w-6 h-6 text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Update Available
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Version {updateAvailable.latest} is now available
              <span className="text-gray-400"> (current: {updateAvailable.current})</span>
            </p>
            {updateAvailable.notes && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {updateAvailable.notes}
              </p>
            )}
          </div>
        </div>
        
        {isInstalling ? (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Installing update...
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                setIsInstalling(true);
                // The update is already being installed automatically
                // This just shows the UI feedback
              }}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Restart to Update
            </button>
            <button
              onClick={() => setUpdateAvailable(null)}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
