const AUTH_RETURN_PATH_KEY = "shared-groups:return-path";

let groupsClient;

function unwrap(result) {
  if (result?.error) throw new Error(result.error.message);
  return result?.data;
}

/** Create and retain the browser client used by the shared-groups auth helpers. */
export function createGroupsClient(config) {
  const factory = window.supabase?.createClient;
  if (typeof factory !== "function") {
    throw new Error("Supabase browser client is unavailable");
  }
  groupsClient = factory(config.url, config.anonKey);
  return groupsClient;
}

/** Start Google OAuth and restore this local route once the callback has a session. */
export async function signInWithGoogle(returnPath) {
  if (!groupsClient) throw new Error("Create the Supabase client before signing in");
  sessionStorage.setItem(AUTH_RETURN_PATH_KEY, returnPath);
  return unwrap(await groupsClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}${location.pathname}` }
  }));
}

/** Consume the saved route only after Supabase confirms an authenticated session. */
export async function consumeAuthReturn() {
  if (!groupsClient) throw new Error("Create the Supabase client before reading auth state");
  const session = unwrap(await groupsClient.auth.getSession())?.session;
  if (!session) return null;
  const returnPath = sessionStorage.getItem(AUTH_RETURN_PATH_KEY);
  if (returnPath === null) return null;
  sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
  return returnPath;
}
