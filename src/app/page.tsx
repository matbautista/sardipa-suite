import { redirect } from "next/navigation";

// Middleware (src/middleware.ts) already blocks unauthenticated requests
// before they reach here, so any request that gets this far is signed in —
// there's nothing else for "/" to show yet.
export default function Home() {
  redirect("/dashboard");
}
