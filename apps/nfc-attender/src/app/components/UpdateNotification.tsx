'use client';

import { useEffect, useState, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type Phase =
  | { status: 'idle' }
  | { status: 'available'; update: Update }
  | { status: 'downloading'; progress: number }
  | { status: 'ready' }
  | { status: 'error'; message: string };

export function UpdateNotification() {
  const [phase, setPhase] = useState<Phase>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const downloadedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    check()
      .then((update) => {
        if (cancelled || !update) return;
        setPhase({ status: 'available', update });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Update check failed:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpdate() {
    if (phase.status !== 'available') return;
    const { update } = phase;

    downloadedRef.current = 0;
    setPhase({ status: 'downloading', progress: 0 });

    try {
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloadedRef.current += event.data.chunkLength;
            if (contentLength > 0) {
              setPhase({
                status: 'downloading',
                progress: Math.round(
                  (downloadedRef.current / contentLength) * 100
                ),
              });
            }
            break;
          case 'Finished':
            break;
        }
      });

      setPhase({ status: 'ready' });
    } catch (err) {
      setPhase({
        status: 'error',
        message: err instanceof Error ? err.message : 'Download failed',
      });
    }
  }

  if (phase.status === 'idle' || dismissed) return null;

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
            {phase.status === 'available' && (
              <>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Update Available
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  Version {phase.update.version} is ready to install
                </p>
                {phase.update.body && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {phase.update.body}
                  </p>
                )}
              </>
            )}

            {phase.status === 'downloading' && (
              <>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Downloading Update...
                </h3>
                <div className="mt-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${phase.progress}%` }}
                  />
                </div>
                {phase.progress > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {phase.progress}%
                  </p>
                )}
              </>
            )}

            {phase.status === 'ready' && (
              <>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Update Ready
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  Restart to apply the update.
                </p>
              </>
            )}

            {phase.status === 'error' && (
              <>
                <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
                  Update Failed
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {phase.message}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {phase.status === 'available' && (
            <button
              onClick={handleUpdate}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Update Now
            </button>
          )}

          {phase.status === 'ready' && (
            <button
              onClick={() => relaunch()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Restart Now
            </button>
          )}

          {phase.status !== 'downloading' && (
            <button
              onClick={() => setDismissed(true)}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
