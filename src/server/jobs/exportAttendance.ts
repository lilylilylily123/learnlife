import exporters from "../exporters/powerschool";
import fs from "fs";

/**
 * Job wrapper to run attendance exports. In production this should be executed
 * from a background worker (BullMQ, or serverless scheduled task) and not on the
 * request path.
 */

export async function runAttendanceExport(batch: any[]) {
  // Load config from environment (do not hardcode credentials)
  const cfg = {
    baseUrl: process.env.PS_BASE_URL || "",
    username: process.env.PS_USERNAME,
    password: process.env.PS_PASSWORD,
    apiKey: process.env.PS_API_KEY,
    schoolId: process.env.PS_SCHOOL_ID,
  };

  if (!cfg.baseUrl) throw new Error("PowerSchool base URL is not configured (PS_BASE_URL).");

  // In a real job, add batching, idempotency keys and log the result to a job store
  const resp = await exporters.sendAttendanceExport(cfg as any, batch as any);

  // simple local log for now
  try {
    fs.appendFileSync("./logs/powerschool_export.log", `${new Date().toISOString()} - exported ${batch.length} records -> ${JSON.stringify(resp)}\n`);
  } catch (e) {
    // swallow log errors
  }

  return resp;
}

export default runAttendanceExport;
