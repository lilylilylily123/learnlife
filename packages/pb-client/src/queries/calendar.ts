import type PocketBase from "pocketbase";
import type { CalRecord, CreateCalEntryPayload } from "../types";

/**
 * Fetch calendar events visible to the current user.
 *
 * Access control is handled by the PocketBase List API rule on the
 * `calendar` collection, so the client only needs to pass `sort`.
 *
 * Expected PB List rule:
 *   created_by = @request.auth.id ||
 *   @request.auth.role = "lg" || @request.auth.role = "admin" ||
 *   (@request.auth.learner.program != "" && programs ?= @request.auth.learner.program)
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

export async function deleteCalendarEntry(
  pb: PocketBase,
  id: string,
): Promise<void> {
  await pb.collection("calendar").delete(id);
}
