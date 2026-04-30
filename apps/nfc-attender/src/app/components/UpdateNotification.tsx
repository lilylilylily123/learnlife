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

  if (phase.status === 'idle') return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6">
      <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-8">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 rounded-full bg-blue-100 dark:bg-blue-900/40 p-4">
            <svg
              className="w-10 h-10 text-blue-600 dark:text-blue-400"
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

          {phase.status === 'available' && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Update Required
              </h2>
              <p className="mt-2 text-base text-gray-600 dark:text-gray-300">
                Version {phase.update.version} must be installed before you can
                continue using Attender.
              </p>
              {phase.update.body && (
                <p className="mt-4 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-line">
                  {phase.update.body}
                </p>
              )}
              <button
                onClick={handleUpdate}
                className="mt-6 w-full px-4 py-3 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Install Update
              </button>
            </>
          )}

          {phase.status === 'downloading' && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Downloading Update…
              </h2>
              <p className="mt-2 text-base text-gray-600 dark:text-gray-300">
                Please don&apos;t close the app.
              </p>
              <div className="mt-6 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${phase.progress}%` }}
                />
              </div>
              {phase.progress > 0 && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {phase.progress}%
                </p>
              )}
            </>
          )}

          {phase.status === 'ready' && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Update Ready
              </h2>
              <p className="mt-2 text-base text-gray-600 dark:text-gray-300">
                Restart now to finish installing.
              </p>
              <button
                onClick={() => relaunch()}
                className="mt-6 w-full px-4 py-3 text-base font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Restart Now
              </button>
            </>
          )}

          {phase.status === 'error' && (
            <>
              <h2 className="text-2xl font-bold text-red-600 dark:text-red-400">
                Update Failed
              </h2>
              <p className="mt-2 text-base text-gray-600 dark:text-gray-300">
                {phase.message}
              </p>
              <button
                onClick={() => setPhase({ status: 'idle' })}
                className="mt-6 w-full px-4 py-3 text-base font-semibold text-white bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Continue Without Updating
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
