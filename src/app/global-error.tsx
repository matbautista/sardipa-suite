"use client";

// Catches errors thrown by the root layout itself (error.tsx doesn't reach
// those — Next.js requires this separate boundary, which has to render its
// own <html>/<body> since it replaces the root layout entirely when it
// fires). Same reasoning as error.tsx; deliberately minimal since the
// layout itself failing means globals.css/fonts may not be available either.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isLockTimeout = /P1008|timed out/i.test(error.message);

  return (
    <html lang="en">
      <body style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.5rem", color: "#4b5563" }}>
            {isLockTimeout
              ? "The system is busy — please try again in a moment."
              : "An unexpected error occurred. If this keeps happening, contact your Super Admin."}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: "1rem", borderRadius: "0.375rem", background: "#111827", color: "white", padding: "0.5rem 0.75rem", fontSize: "0.875rem" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
