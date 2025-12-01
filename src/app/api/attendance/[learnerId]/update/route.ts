import { NextRequest, NextResponse } from "next/server";
import { getAdminPb } from "../../../lib/pb-admin";

const TIMESTAMP_FIELDS = ["time_in", "time_out", "lunch_out", "lunch_in"] as const;
const STATUS_FIELDS = ["status", "lunch_status"] as const;
const ALLOWED_STATUSES = ["present", "late", "absent"] as const;

interface UpdateRequestBody {
  date?: string; // ISO date (YYYY-MM-DD), defaults to today
  field: string;
  value?: string; // For status fields
  timestamp?: string; // For timestamp fields - if not provided, uses current time
  force?: boolean; // If true, overwrite existing values (for editing)
}

/**
 * POST /api/attendance/[learnerId]/update
 * Update a specific field on a learner's attendance record
 * Creates the record if it doesn't exist
 * 
 * Body:
 *   - date: ISO date string (YYYY-MM-DD) - defaults to today
 *   - field: field to update (time_in, time_out, lunch_out, lunch_in, status, lunch_status)
 *   - value: for status fields (present/late/absent)
 *   - timestamp: for timestamp fields (ISO datetime) - defaults to now
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> }
) {
  const { learnerId } = await params;
  
  let body: UpdateRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  
  const { field, value, timestamp, force } = body;
  const date = body.date || new Date().toISOString().split("T")[0];
  
  // Validate field
  const isTimestampField = TIMESTAMP_FIELDS.includes(field as any);
  const isStatusField = STATUS_FIELDS.includes(field as any);
  
  if (!isTimestampField && !isStatusField) {
    return NextResponse.json(
      { error: `Invalid field. Allowed: ${[...TIMESTAMP_FIELDS, ...STATUS_FIELDS].join(", ")}` },
      { status: 400 }
    );
  }
  
  // Validate status value if it's a status field
  if (isStatusField && value && !ALLOWED_STATUSES.includes(value as any)) {
    return NextResponse.json(
      { error: `Invalid status value. Allowed: ${ALLOWED_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }
  
  try {
    const pb = await getAdminPb();
    
    // First, verify the learner exists
    try {
      await pb.collection("learners").getOne(learnerId);
    } catch {
      return NextResponse.json(
        { error: `Learner not found: ${learnerId}` },
        { status: 404 }
      );
    }
    
    // Get or create the attendance record
    let attendance;
    
    // First, try to find existing record
    // PocketBase date field may store as full datetime, so we need flexible matching
    const allForLearner = await pb.collection("attendance").getFullList({
      filter: `learner = "${learnerId}"`,
    });
    
    // Find record matching this date (handle different date formats)
    attendance = allForLearner.find(r => {
      const recordDate = r.date?.split?.(" ")?.[0] || r.date?.split?.("T")?.[0] || r.date;
      return recordDate === date;
    });
    
    if (attendance) {
      console.log(`[attendance/update] Found existing record: ${attendance.id} with date ${attendance.date}`);
    } else {
      // Create new record
      console.log(`[attendance/update] No record found for learner ${learnerId} on ${date}, creating new...`);
      console.log(`[attendance/update] Existing records:`, allForLearner.map(r => ({ id: r.id, date: r.date })));
      attendance = await pb.collection("attendance").create({
        learner: learnerId,
        date: date,
      });
      console.log(`[attendance/update] Created attendance record: ${attendance.id}`);
    }
    
    // Check if timestamp field already has a value (no overwrites unless force=true)
    if (isTimestampField && attendance[field] && !force) {
      return NextResponse.json({
        status: "already_set",
        field,
        existingValue: attendance[field],
        attendance,
      }, { status: 409 });
    }
    
    // Determine the value to set
    let updateValue: string;
    if (isTimestampField) {
      updateValue = timestamp || new Date().toISOString();
    } else {
      updateValue = value!;
    }
    
    // Update the record
    const updated = await pb.collection("attendance").update(
      attendance.id,
      { [field]: updateValue },
      { expand: "learner" }
    );
    
    return NextResponse.json({
      status: "updated",
      field,
      value: updateValue,
      attendance: updated,
    });
  } catch (err: any) {
    console.error("[attendance/update] failed:", err.message || err);
    return NextResponse.json(
      { error: err.message || "Failed to update attendance", details: err.data },
      { status: 500 }
    );
  }
}
