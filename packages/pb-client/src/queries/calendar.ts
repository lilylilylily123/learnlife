import type PocketBase from "pocketbase";
import type { CalRecord, CreateCalEntryPayload } from "../types";

/**
 * Fetch calendar events visible to the current user.
 *
 * Access control is handled by the PocketBase List API rule on the
 * `calendar` collection, so the client only needs to pass `sort`.
 *
 * Expected PB List/View rule:
 *   created_by = @request.auth.id ||
 *   (type = "event" && (@request.auth.role = "lg" || @request.auth.role = "admin")) ||
 *   (type = "event" && @request.auth.learner.program != "" && programs ~ @request.auth.learner.program)
 *
 * Two load-bearing details:
 *   - The `type = "event"` gate keeps learners' personal `type = "class"`
 *     records private to their creator. Without it, guides/admins see every
 *     learner's private schedule.
 *   - The `~` (substring) operator is used instead of `?=` on the multi-select
 *     `programs` field. The `?=` operator does not match in our PB version.
 *     Substring is safe here because the three program codes (chmk/cre/exp)
 *     are disjoint — no code is a substring of another. If a fourth code is
 *     ever added, verify it is also disjoint or this rule will mis-match.
 */
export async function fetchCalendarEvents(
  pb: PocketBase,
): Promise<CalRecord[]> {
  return pb.collection("calendar").getFullList<CalRecord>({
    sort: "start",
  });
}

export async function createCalendarEntry(
  pb: PocketBase,
  data: CreateCalEntryPayload,
): Promise<CalRecord> {
  return pb.collection("calendar").create<CalRecord>(data);
}

export async function getCalendarEntry(
  pb: PocketBase,
  id: string,
): Promise<CalRecord> {
  return pb.collection("calendar").getOne<CalRecord>(id);
}

export async function updateCalendarEntry(
  pb: PocketBase,
  id: string,
  data: Partial<CreateCalEntryPayload>,
): Promise<CalRecord> {
  return pb.collection("calendar").update<CalRecord>(id, data);
}

export async function deleteCalendarEntry(
  pb: PocketBase,
  id: string,
): Promise<void> {
  await pb.collection("calendar").delete(id);
}
