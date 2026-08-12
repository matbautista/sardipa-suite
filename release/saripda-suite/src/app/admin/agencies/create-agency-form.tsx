"use client";

import { useActionState, useRef, useEffect } from "react";
import { createAgencyFormAction, type CreateAgencyFormState } from "./actions";

const initialState: CreateAgencyFormState = { error: null, success: null };

export function CreateAgencyForm() {
  const [state, formAction, isPending] = useActionState(createAgencyFormAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a successful create — the temp password display
  // below takes over as the confirmation, so stale field values (and an
  // easy accidental double-submit of the same agency) aren't left sitting.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <div>
      <form ref={formRef} action={formAction} className="space-y-4">
        <div>
          <label htmlFor="agencyName" className="block text-sm font-medium text-gray-700">
            Agency name
          </label>
          <input
            id="agencyName"
            name="agencyName"
            type="text"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="headName" className="block text-sm font-medium text-gray-700">
            Agency Head&apos;s name
          </label>
          <input
            id="headName"
            name="headName"
            type="text"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="headEmail" className="block text-sm font-medium text-gray-700">
            Agency Head&apos;s email
          </label>
          <input
            id="headEmail"
            name="headEmail"
            type="email"
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>

        {state.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create agency"}
        </button>
      </form>

      {state.success && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-medium text-green-800">
            Agency &quot;{state.success.agencyName}&quot; created.
          </p>
          <p className="mt-1 text-green-700">
            Temporary password for {state.success.headEmail} — shown once, relay it to them
            directly. They&apos;ll be prompted to change it on first login.
          </p>
          <code className="mt-2 block rounded bg-white px-3 py-2 font-mono text-base tracking-wide text-gray-900">
            {state.success.temporaryPassword}
          </code>
        </div>
      )}
    </div>
  );
}
