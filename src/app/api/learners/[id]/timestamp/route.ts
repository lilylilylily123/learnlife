import { NextRequest, NextResponse } from "next/server";
import { getAdminPb } from "../../../lib/pb-admin";

const ALLOWED_FIELDS = ["time_in", "time_out", "lunch_in", "lunch_out"] as const;
type TimestampField = (typeof ALLOWED_FIELDS)[number];

interface TimestampRequestBody {
  field: string;
  dryRun?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: TimestampRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { field } = body;

  if (!field || !ALLOWED_FIELDS.includes(field as TimestampField)) {
    return NextResponse.json(
      { error: `Invalid field. Allowed: ${ALLOWED_FIELDS.join(", ")}` },
      { status: 400 }
    );
  }

  // Get cached authenticated PocketBase instance
  const pb = await getAdminPb();

  // Fetch the learner record
  let learner: any;
  try {
    learner = await pb.collection("learners").getOne(id);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Learner not found", details: err.message },
      { status: 404 }
    );
  }

  // Check if field is already set — if so, return 409 Conflict (no overwrite)
  const existingValue = learner[field];
  if (existingValue && existingValue !== "") {
    return NextResponse.json(
      {
        status: "skipped",
        reason: "field_already_set",
        field,
        existingValue,
        learner,
      },
      { status: 409 }
    );
  }

  // Compute server timestamp (ISO)
  const serverNow = new Date();
  const isoTimestamp = serverNow.toISOString();

  // Perform the update (dryRun no longer skips writes - we always write now)
  try {
    console.log(`[timestamp] Updating learner ${id}, field ${field} = ${isoTimestamp}`);
    console.log(`[timestamp] Auth valid: ${pb.authStore.isValid}`);
    const updated = await pb.collection("learners").update(id, {
      [field]: isoTimestamp,
    });
    console.log(`[timestamp] Update successful`);
    return NextResponse.json({
      status: "updated",
      field,
      value: isoTimestamp,
      learner: updated,
    });
  } catch (err: any) {
    console.error("[timestamp] update failed:", err);
    console.error("[timestamp] error response:", err.response);
    console.error("[timestamp] error data:", err.data);
    return NextResponse.json(
      { error: "Failed to update learner", details: err.message, data: err.data },
      { status: 500 }
    );
  }
}
