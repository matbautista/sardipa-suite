"use client";

import { useActionState } from "react";
import { resetPasswordFormAction, type ResetPasswordFormState } from "./actions";

const initialState: ResetPasswordFormState = { error: null, success: null };

export function ResetPasswordButton({ userId }: { userId: string }) {
  const [state, formAction, isPending] = useActionState(resetPasswordFormAction, initialState);

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="targetUserId" value={userId} />
        <button
          type="submit"
          disabled={isPending}
          className="text-xs text-gray-500 underline hover:text-gray-800 disabled:opacity-50"
        >
          {isPending ? "Resetting…" : "Reset password"}
        </button>
      </form>

      {state.error && <p className="mt-1 text-xs text-red-700">{state.error}</p>}

      {state.success && (
        <div className="mt-2 rounded-md border border-green-200 bg-green-50 p-2 text-xs">
          <p className="text-green-700">New temporary password — shown once:</p>
          <code className="mt-1 block rounded bg-white px-2 py-1 font-mono text-sm tracking-wide text-gray-900">
            {state.success.temporaryPassword}
          </code>
        </div>
      )}
    </div>
  );
}
