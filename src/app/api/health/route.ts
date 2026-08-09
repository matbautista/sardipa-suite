import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Reliability foundations (Section 9 of the plan): what the process
// supervisor (scripts/watchdog.mjs) polls to decide whether the app needs
// restarting. Deliberately public — excluded from auth in src/proxy.ts,
// since the supervisor has no session and shouldn't need one just to check
// liveness.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", uptime: process.uptime() });
  } catch (error) {
    // Log the real error server-side for whoever's watching the process
    // output, but this endpoint is public (no auth) — never echo internal
    // details like file paths or query text back in the response, same
    // principle as every other user-facing message in Section 9.
    console.error("[health check] DB connectivity check failed:", error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
