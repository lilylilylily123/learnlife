import { NextRequest, NextResponse } from "next/server";
import { getAdminPb } from "../../../lib/pb-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  // Reset all daily timestamps and status
  try {
    const updated = await pb.collection("learners").update(id, {
      time_in: null,
      time_out: null,
      lunch_in: null,
      lunch_out: null,
      status: null,
    });
    return NextResponse.json({
      status: "reset",
      learner: updated,
    });
  } catch (err: any) {
    console.error("[reset] update failed:", err.message || err);
    return NextResponse.json(
      { error: "Failed to reset learner", details: err.message },
      { status: 500 }
    );
  }
}
