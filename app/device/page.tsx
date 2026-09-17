import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeviceApproval } from "@/components/device-approval";
import { auth } from "@/lib/auth";

/**
 * Where `ai-tutor login` sends the user: the signed-in session here is what
 * approves the code, so the gate runs before anything is rendered.
 */
export default async function DevicePage({
  searchParams,
}: PageProps<"/device">) {
  const { user_code } = await searchParams;
  const code = typeof user_code === "string" ? user_code : "";

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const next = `/device${code ? `?user_code=${encodeURIComponent(code)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return <DeviceApproval initialCode={code} email={session.user.email} />;
}
