import type PocketBase from "pocketbase";
import type { CalRecord, CreateCalEntryPayload } from "../types";

export async function fetchCalendarEvents(
  pb: PocketBase,
  userId: string,
): Promise<CalRecord[]> {
  return pb.collection("calendar").getFullList<CalRecord>({
    filter: `created_by = "${userId}"`,
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
