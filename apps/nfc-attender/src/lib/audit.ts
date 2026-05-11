import { pb } from "@/app/pb";
import { debug } from "@/lib/debug";

// Best-effort audit logger. Writes to the `audit_log` collection on
// PocketBase if it exists; on any failure (collection missing, offline,
// permission denied) it logs locally in dev and otherwise stays silent so
// the user-visible action (e.g. a CSV download) is never blocked.
//
// PB collection schema (set up manually in admin):
//   actor   (relation → users, optional — null for anonymous)
//   action  (text, required) — short stable identifier, e.g. "csv_export"
//   details (json, optional) — arbitrary structured context
//
// Create rule: @request.auth.role = "lg" || @request.auth.role = "admin"
// List/View rule: @request.auth.role = "admin"
// Update/Delete rule: "" (block all — append-only collection)

export type AuditAction =
  | "csv_export"
  | "history_admin_view"
  | "bulk_attendance_edit";

export async function logAuditEvent(
  action: AuditAction,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    const actorId = pb.authStore.record?.id ?? null;
    await pb.collection("audit_log").create({
      actor: actorId,
      action,
      details,
    });
  } catch (err) {
    // Don't surface to the user — auditing is observability, not a gate.
    debug.warn("[audit] failed to record", action, err);
  }
}
