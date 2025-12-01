import { NextRequest, NextResponse } from "next/server";
import { getAdminPb } from "../../../lib/pb-admin";

// Note: These must match EXACTLY what's configured in PocketBase select field
const ALLOWED_STATUSES = ["present", "late", "absent"] as const;
const ALLOWED_FIELDS = ["status", "lunch_status"] as const;

interface StatusRequestBody {
  field: string;
  value: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: StatusRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { field, value } = body;

  if (!field || !ALLOWED_FIELDS.includes(field as any)) {
    return NextResponse.json(
      { error: `Invalid field. Allowed: ${ALLOWED_FIELDS.join(", ")}` },
      { status: 400 }
    );
  }

  if (!value || !ALLOWED_STATUSES.includes(value as any)) {
    return NextResponse.json(
      { error: `Invalid value. Allowed: ${ALLOWED_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  // Get cached authenticated PocketBase instance
  const pb = await getAdminPb();

  // Perform the update
  try {
    const updated = await pb.collection("learners").update(id, { [field]: value });
    return NextResponse.json({
      status: "updated",
      learner: updated,
    });
  } catch (err: any) {
    console.error(`[status] update ${field} failed:`, err.message || err);
    return NextResponse.json(
      { error: "Failed to update status", details: err.message, data: err.data },
      { status: 500 }
    );
  }
}
