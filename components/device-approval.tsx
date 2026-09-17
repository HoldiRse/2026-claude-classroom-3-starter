"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthCard } from "@/components/ui/auth-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { authClient } from "@/lib/auth-client";

/** The code is shown and typed in fours; the server matches it either way. */
const normalise = (code: string) =>
  code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
const group = (code: string) => (code.match(/.{1,4}/g) ?? [code]).join("-");

type Step =
  | { name: "enter" }
  | { name: "review"; code: string; clientId: string }
  | { name: "settled"; approved: boolean };

/**
 * The approval half of the CLI's device flow. Verifying a code claims it for
 * this session, so only this user can then approve or deny it.
 */
export function DeviceApproval({
  initialCode,
  email,
}: {
  initialCode: string;
  email: string;
}) {
  const [code, setCode] = useState(group(normalise(initialCode)));
  const [step, setStep] = useState<Step>({ name: "enter" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const userCode = normalise(code);
    const { data, error: verifyError } = await authClient.device({
      query: { user_code: userCode },
    });
    setPending(false);

    if (verifyError || !data) {
      setError("That code is not one this app is waiting for, or it expired.");
      return;
    }
    if (!data.client_id) {
      setError("That code was already claimed in another browser session.");
      return;
    }
    if (data.status !== "pending") {
      setError(`That code was already ${data.status}.`);
      return;
    }

    setStep({ name: "review", code: userCode, clientId: data.client_id });
  }

  async function settle(approved: boolean) {
    if (step.name !== "review") return;
    setError(null);
    setPending(true);

    const { error: settleError } = approved
      ? await authClient.device.approve({ userCode: step.code })
      : await authClient.device.deny({ userCode: step.code });
    setPending(false);

    if (settleError) {
      setError("That did not go through. The code may have expired.");
      return;
    }
    setStep({ name: "settled", approved });
  }

  const footer = (
    <Link href="/" className="font-semibold text-accent hover:underline">
      Back to Bartholomew
    </Link>
  );

  if (step.name === "settled") {
    return (
      <AuthCard title="Terminal sign-in" footer={footer}>
        <p className="text-base text-ink">
          {step.approved
            ? "Approved. Return to your terminal; ai-tutor signs itself in from here."
            : "Denied. The terminal will report that the sign-in was refused."}
        </p>
      </AuthCard>
    );
  }

  if (step.name === "review") {
    return (
      <AuthCard
        title="Terminal sign-in"
        footer={footer}
        onSubmit={(event) => {
          event.preventDefault();
          void settle(true);
        }}
      >
        <p className="text-base text-ink">
          <span className="font-semibold">{step.clientId}</span> is asking to
          sign in as {email} and to keep your to-do list for you.
        </p>
        <p className="text-sm text-ink-soft">
          Check that your terminal shows {group(step.code)}. Approve this only
          if you started it yourself; nobody legitimate will send you a code to
          enter here.
        </p>
        <FormError message={error} />
        <div className="flex gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Working…" : "Approve"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void settle(false)}
          >
            Deny
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Terminal sign-in" footer={footer} onSubmit={onVerify}>
      <p className="text-sm text-ink-soft">
        Enter the code your terminal is showing. It signs that terminal in as{" "}
        {email}.
      </p>
      <Field
        id="user_code"
        label="Code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="ABCD-EFGH"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
      />
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </AuthCard>
  );
}
