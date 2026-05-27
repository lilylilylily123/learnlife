// Save text content as a file. In the Tauri desktop build, anchor downloads
// (<a download>) don't trigger anything in WKWebView — the user clicks Export
// and nothing happens. The Tauri build path routes through the dialog/fs
// plugins so the user gets a native save sheet and a real file on disk.
// In the browser (pnpm dev or web preview) we fall back to the blob-anchor
// pattern, which works fine outside Tauri.

interface SaveFilter {
  name: string;
  extensions: string[];
}

export interface SaveTextFileOptions {
  defaultPath: string;
  content: string;
  mime?: string;
  filters?: SaveFilter[];
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri 2 exposes this on the global window. Older API surfaces (e.g.
    // window.__TAURI__) may also exist but the internals key is the most
    // reliable cross-version marker.
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

export async function saveTextFile({
  defaultPath,
  content,
  mime = "text/plain;charset=utf-8",
  filters,
}: SaveTextFileOptions): Promise<{ saved: boolean; path?: string }> {
  if (isTauri()) {
    // Dynamic imports keep the Tauri plugin code out of the browser bundle
    // and prevent build failures when the plugin packages aren't installed
    // in the calendar app's transitive dep graph.
    const [{ save }, { writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({
      defaultPath,
      filters,
    });
    if (!path) return { saved: false };
    await writeTextFile(path, content);
    return { saved: true, path };
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultPath;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { saved: true };
}
