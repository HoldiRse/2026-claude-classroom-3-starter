import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin, so the client needs no baseURL. The device plugin adds the
// calls app/device makes to verify, approve and deny a CLI's code.
export const authClient = createAuthClient({
  plugins: [deviceAuthorizationClient()],
});
