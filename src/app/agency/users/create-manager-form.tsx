"use client";

import { useActionState, useRef, useEffect } from "react";
import { createManagerFormAction, type CreateUserFormState } from "./actions";

const initialState: CreateUserFormState = { error: null, success: null };

export function CreateManagerForm() {
  const [state, formAction, isPending] = useActionState(createManagerFormAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <div>
      <form ref={formRef} action={formAction} className="space-y-4">
        <div>
          <label htmlFor="managerName" className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="managerName"
            name="name"
            type="text"
            required
            className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="managerEmail" className="block text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="managerEmail"
            name="email"
            type="email"
            required
            className="mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
          />
        </div>

        {state.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="inline-block min-w-[170px] rounded-md btn-primary px-4 py-2 text-center text-sm font-medium disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create manager"}
        </button>
      </form>

      {state.success && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-medium text-green-800">Manager account for {state.success.email} created.</p>
          <p className="mt-1 text-green-700">
            Temporary password — shown once, relay it to them directly. They&apos;ll be
            prompted to change it on first login.
          </p>
          <code className="mt-2 block rounded bg-white px-3 py-2 font-mono text-base tracking-wide text-gray-900">
            {state.success.temporaryPassword}
          </code>
        </div>
      )}
    </div>
  );
}
