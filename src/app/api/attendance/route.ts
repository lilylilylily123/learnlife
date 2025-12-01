import { NextRequest, NextResponse } from "next/server";
import { getAdminPb, clearAdminPbCache } from "../lib/pb-admin";

/**
 * GET /api/attendance
 * Fetch attendance records, optionally filtered by date and/or learner
 * Query params:
 *   - date: ISO date string (YYYY-MM-DD) - defaults to today
 *   - learnerId: specific learner ID
 *   - page, perPage: pagination
 */
export async function GET(req: NextRequest) {
  let lastError: any;
  
  // Retry up to 2 times for transient failures
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pb = await getAdminPb();
      const url = new URL(req.url);
      
      // Parse query params
      const dateParam = url.searchParams.get("date");
      const learnerId = url.searchParams.get("learnerId");
      const page = Number(url.searchParams.get("page") || "1");
      const perPage = Number(url.searchParams.get("perPage") || "50");
      
      // Default to today if no date provided
      const date = dateParam || new Date().toISOString().split("T")[0];
      
      // Build filter - PocketBase stores date as "YYYY-MM-DD 00:00:00.000Z"
      // Use startswith to match the date portion
      const filterParts: string[] = [`date ~ "${date}"`];
      if (learnerId) {
        filterParts.push(`learner = "${learnerId}"`);
      }
      
      const response = await pb.collection("attendance").getList(page, perPage, {
        filter: filterParts.join(" && "),
        expand: "learner",
        sort: "-created",
      });
      
      return NextResponse.json({
        items: response.items,
        totalItems: response.totalItems,
        totalPages: response.totalPages,
        date,
      });
    } catch (err: any) {
      lastError = err;
      console.error(`[attendance] Attempt ${attempt + 1} failed:`, err.message || err);
      // Clear cache so next attempt gets fresh auth
      clearAdminPbCache();
    }
  }
  
  console.error("[attendance] All attempts failed:", lastError);
  return NextResponse.json(
    { error: lastError?.message || "Failed to fetch attendance", details: lastError?.data },
    { status: 500 }
  );
}
