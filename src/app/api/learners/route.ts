import { NextResponse } from "next/server";
import { getAdminPb, clearAdminPbCache } from "../lib/pb-admin";

export async function GET(req: Request) {
  let lastError: any;
  
  // Retry up to 2 times for transient failures
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const pb = await getAdminPb();

      const url = new URL(req.url);
      const page = Number(url.searchParams.get("page") || "1");
      const perPage = Number(url.searchParams.get("perPage") || "8");
      const search = (url.searchParams.get("search") || "").trim();
      const program = url.searchParams.get("program") || "all";

      const filterParts: string[] = [];
      if (search) {
        const safe = search.replace(/"/g, '\\"');
        filterParts.push(`name ~ "${safe}"`);
      }
      if (program && program !== "all") {
        const safe = program.replace(/"/g, '\\"');
        filterParts.push(`program = "${safe}"`);
      }

      const opts: any = { sort: "-time_in" };
      if (filterParts.length > 0) opts.filter = filterParts.join(" && ");

      const response = await pb.collection("learners").getList(page, perPage, opts);

      return NextResponse.json({
        items: response.items,
        totalItems: response.totalItems,
        totalPages: Math.max(1, Math.ceil((response.totalItems || 0) / perPage)),
      });
    } catch (err: any) {
      lastError = err;
      console.error(`[learners] Attempt ${attempt + 1} failed:`, err.message || err);
      // Clear cache so next attempt gets fresh auth
      clearAdminPbCache();
    }
  }

  console.error("[learners] All attempts failed:", lastError);
  return NextResponse.json(
    { error: lastError?.message || "Failed to fetch learners" },
    { status: 500 }
  );
}
