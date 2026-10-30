"use client";
import { useActionState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { login } from "./actions";

function Form() {
  const [state, action, pending] = useActionState(login, null);
  const next = useSearchParams().get("next") ?? "/";
  return (
    <form action={action} className="login">
      <h2>📺 TG Index</h2>
      <input type="hidden" name="next" value={next} />
      <input type="password" name="password" placeholder="Password" autoFocus required aria-invalid={!!state?.error} className={state?.error ? "bad" : ""} />
      <button disabled={pending}>{pending ? "Checking…" : "Enter"}</button>
      {state?.error && (
        <p className="error" role="alert">
          ⚠ {state.error}
        </p>
      )}
    </form>
  );
}
export default function LoginPage() {
  return (
    <Suspense>
      <Form />
    </Suspense>
  );
}
