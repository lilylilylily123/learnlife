'use client';

import { useEffect, useState, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { HEADING, KICKER, Kicker } from './ll-ui';
import { debug } from '@/lib/debug';

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
          debug.error('Update check failed:', err);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: 'rgba(31, 27, 22, 0.55)',
        backdropFilter: 'blur(2px)',
        padding: 24,
      }}
    >
      <div
        className="w-full"
        style={{
          maxWidth: 480,
          background: 'var(--ll-surface)',
          border: '1.5px solid var(--ll-ink)',
          padding: 28,
          color: 'var(--ll-ink)',
        }}
      >
        {phase.status === 'available' && (
          <>
            <Kicker>Update required</Kicker>
            <div style={{ ...HEADING, fontSize: 26, lineHeight: 1.1, marginTop: 4 }}>
              Version {phase.update.version} is available
            </div>
            <p
              style={{
                marginTop: 10,
                fontSize: 14,
                lineHeight: 1.55,
                color: 'var(--ll-ink-2)',
              }}
            >
              Install before continuing. The reader stays paused while the new
              build downloads.
            </p>
            {phase.update.body && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  background: 'var(--ll-bg)',
                  border: '1px solid var(--ll-divider)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: 'var(--ll-ink-2)',
                  whiteSpace: 'pre-line',
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                {phase.update.body}
              </div>
            )}
            <button
              onClick={handleUpdate}
              className="cursor-pointer w-full"
              style={{
                marginTop: 22,
                background: 'var(--ll-ink)',
                color: 'var(--ll-bg)',
                border: '1.5px solid var(--ll-ink)',
                padding: '11px 16px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Install update →
            </button>
          </>
        )}

        {phase.status === 'downloading' && (
          <>
            <Kicker>Downloading</Kicker>
            <div style={{ ...HEADING, fontSize: 26, lineHeight: 1.1, marginTop: 4 }}>
              Fetching new build…
            </div>
            <p
              style={{
                marginTop: 10,
                fontSize: 14,
                color: 'var(--ll-ink-2)',
              }}
            >
              Don&apos;t close the app.
            </p>
            <div
              style={{
                marginTop: 18,
                height: 6,
                background: 'var(--ll-surface-2)',
                border: '1px solid var(--ll-divider)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${phase.progress}%`,
                  background: 'var(--ll-accent)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div
              style={{
                ...KICKER,
                marginTop: 8,
                color: 'var(--ll-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {phase.progress}%
            </div>
          </>
        )}

        {phase.status === 'ready' && (
          <>
            <Kicker>Ready</Kicker>
            <div style={{ ...HEADING, fontSize: 26, lineHeight: 1.1, marginTop: 4 }}>
              Restart to finish
            </div>
            <p
              style={{
                marginTop: 10,
                fontSize: 14,
                color: 'var(--ll-ink-2)',
              }}
            >
              The new build is downloaded. Relaunch to apply.
            </p>
            <button
              onClick={() => relaunch()}
              className="cursor-pointer w-full"
              style={{
                marginTop: 22,
                background: 'var(--ll-accent)',
                color: 'var(--ll-accent-ink)',
                border: '1.5px solid var(--ll-ink)',
                padding: '11px 16px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Restart now ↻
            </button>
          </>
        )}

        {phase.status === 'error' && (
          <>
            <Kicker style={{ color: 'var(--ll-warm)' }}>Update failed</Kicker>
            <div style={{ ...HEADING, fontSize: 26, lineHeight: 1.1, marginTop: 4 }}>
              Couldn&apos;t install
            </div>
            <p
              style={{
                marginTop: 10,
                fontSize: 14,
                color: 'var(--ll-ink-2)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {phase.message}
            </p>
            <button
              onClick={() => setPhase({ status: 'idle' })}
              className="cursor-pointer w-full"
              style={{
                marginTop: 22,
                background: 'transparent',
                color: 'var(--ll-ink)',
                border: '1.5px solid var(--ll-ink)',
                padding: '11px 16px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Continue without updating
            </button>
          </>
        )}
      </div>
    </div>
  );
}
