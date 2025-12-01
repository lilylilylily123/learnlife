import { NextRequest, NextResponse } from "next/server";
import { getAdminPb } from "../../lib/pb-admin";

/**
 * GET /api/attendance/[learnerId]
 * Get attendance record for a specific learner on a specific date
 * Query params:
 *   - date: ISO date string (YYYY-MM-DD) - defaults to today
 * 
 * POST /api/attendance/[learnerId]
 * Get or create attendance record for a learner on a specific date
 * Body:
 *   - date: ISO date string (YYYY-MM-DD) - defaults to today
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> }
) {
  const { learnerId } = await params;
  
  try {
    const pb = await getAdminPb();
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");
    const date = dateParam || new Date().toISOString().split("T")[0];
    
    // Try to find existing record - use ~ for partial date match
    // PocketBase stores dates as "YYYY-MM-DD 00:00:00.000Z"
    try {
      const record = await pb.collection("attendance").getFirstListItem(
        `learner = "${learnerId}" && date ~ "${date}"`,
        { expand: "learner" }
      );
      return NextResponse.json({ attendance: record, exists: true });
    } catch {
      // No record found
      return NextResponse.json({ attendance: null, exists: false, date });
    }
  } catch (err: any) {
    console.error("[attendance/learner] GET failed:", err.message || err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch attendance" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> }
) {
  const { learnerId } = await params;
  
  try {
    const pb = await getAdminPb();
    const body = await req.json().catch(() => ({}));
    const date = body.date || new Date().toISOString().split("T")[0];
    
    // Try to find existing record first - use ~ for partial date match
    try {
      const existing = await pb.collection("attendance").getFirstListItem(
        `learner = "${learnerId}" && date ~ "${date}"`,
        { expand: "learner" }
      );
      return NextResponse.json({ attendance: existing, created: false });
    } catch {
      // Create new record
      const created = await pb.collection("attendance").create(
        {
          learner: learnerId,
          date: date,
          status: null,
          lunch_status: null,
        },
        { expand: "learner" }
      );
      return NextResponse.json({ attendance: created, created: true });
    }
  } catch (err: any) {
    console.error("[attendance/learner] POST failed:", err.message || err);
    return NextResponse.json(
      { error: err.message || "Failed to create attendance" },
      { status: 500 }
    );
  }
}
