"use client";

// App-wide error boundary (Section 10 phase 15 / Section 9): before this,
// any unhandled throw — including the SQLite lock-timeout case
// src/lib/prisma.ts's retry wrapper already documented but never actually
// surfaced anywhere — fell through to Next.js's raw crash screen instead
// of one of Section 9's specific, actionable messages. Next.js redacts
// `error.message` to a generic string in production builds (a deliberate
// security measure, not a bug) — this can only special-case the lock-
// timeout wording in development, where the real message is visible; the
// production fallback is Section 9's own generic-but-honest phrasing for
// "we can't tell you more than this."
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isLockTimeout = /P1008|timed out/i.test(error.message);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-600">
          {isLockTimeout
            ? "The system is busy — please try again in a moment."
            : "An unexpected error occurred. If this keeps happening, contact your Super Admin."}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-md btn-primary px-3 py-2 text-sm font-medium"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
