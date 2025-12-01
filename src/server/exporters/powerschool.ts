import fetch from "node-fetch";

/**
 * Minimal PowerSchool exporter skeleton.
 * - Does not assume a particular PowerSchool API shape (install/host differs per district).
 * - Provides mapping helper and a send function with retries & idempotency hooks.
 *
 * TODO: Replace fetch calls with the district's PowerSchool API endpoints and auth scheme.
 */

export type PSConfig = {
  baseUrl: string; // e.g. https://powerschool.example.edu
  username?: string;
  password?: string;
  apiKey?: string; // if token-based
  schoolId?: string;
};

export type LearnerRecord = {
  id: string;
  name?: string;
  NFC_ID?: string | null;
  time_in?: string | null; // ISO
  time_out?: string | null; // ISO
  status?: string | null;
  program?: string | null;
  [k: string]: any;
};

export function mapLearnerToPowerSchoolPayload(learner: LearnerRecord) {
  // This mapping is intentionally generic. Adjust to your district's PowerSchool payload.
  return {
    externalStudentId: learner.NFC_ID || learner.id,
    studentName: learner.name,
    attendanceDate: learner.time_in ? learner.time_in.substring(0, 10) : undefined,
    checkInTime: learner.time_in || undefined,
    checkOutTime: learner.time_out || undefined,
    status: learner.status || undefined,
    program: learner.program || undefined,
  };
}

async function doRequest(url: string, opts: any, retries = 2): Promise<any> {
  try {
    const res = await fetch(url, opts);
    const txt = await res.text();
    let json: any = null;
    try { json = txt ? JSON.parse(txt) : null; } catch (_) { json = txt; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(txt).slice(0,200)}`);
    return json;
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return doRequest(url, opts, retries - 1);
    }
    throw err;
  }
}

export async function sendAttendanceExport(config: PSConfig, batch: LearnerRecord[]) {
  // Build a generic payload
  const payload = batch.map(mapLearnerToPowerSchoolPayload);

  // Example endpoint - replace with actual PowerSchool endpoint
  const url = `${config.baseUrl.replace(/\/$/,"")}/api/attendance/import`;

  const headers: any = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  // If PowerSchool requires basic auth
  const auth = (config.username && config.password) ? { username: config.username, password: config.password } : null;

  const opts: any = {
    method: "POST",
    headers,
    body: JSON.stringify({ schoolId: config.schoolId, records: payload }),
  };

  if (auth) {
    const token = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    opts.headers["Authorization"] = `Basic ${token}`;
  }

  const resp = await doRequest(url, opts);
  return resp;
}

export default {
  mapLearnerToPowerSchoolPayload,
  sendAttendanceExport,
};
