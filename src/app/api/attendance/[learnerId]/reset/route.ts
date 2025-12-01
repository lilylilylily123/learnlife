import { NextRequest, NextResponse } from "next/server";
import { getAdminPb } from "../../../lib/pb-admin";

/**
 * POST /api/attendance/[learnerId]/reset
 * Reset a learner's attendance record for a specific date (for testing)
 * 
 * Body:
 *   - date: ISO date string (YYYY-MM-DD) - defaults to today
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> }
) {
  const { learnerId } = await params;
  
  try {
    const pb = await getAdminPb();
    const body = await req.json().catch(() => ({}));
    const date = body.date || new Date().toISOString().split("T")[0];
    
    // Find the record - use ~ for partial date match
    // PocketBase stores dates as "YYYY-MM-DD 00:00:00.000Z"
    try {
      const record = await pb.collection("attendance").getFirstListItem(
        `learner = "${learnerId}" && date ~ "${date}"`
      );
      
      // Reset all fields
      const updated = await pb.collection("attendance").update(record.id, {
        time_in: null,
        time_out: null,
        lunch_out: null,
        lunch_in: null,
        status: null,
        lunch_status: null,
      }, { expand: "learner" });
      
      return NextResponse.json({
        status: "reset",
        attendance: updated,
      });
    } catch {
      // No record to reset
      return NextResponse.json({
        status: "no_record",
        message: "No attendance record found for this date",
      });
    }
  } catch (err: any) {
    console.error("[attendance/reset] failed:", err.message || err);
    return NextResponse.json(
      { error: err.message || "Failed to reset attendance" },
      { status: 500 }
    );
  }
}
