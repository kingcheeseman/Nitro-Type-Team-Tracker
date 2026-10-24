// Turns a verified-but-anonymous Supabase Auth session into a real,
// permanent TypeTrack login (synthetic email + a password the visitor
// picks). This is the ONLY place that ever sets that email, and it has
// to run server-side with the service-role key: auth.admin.updateUserById
// can set email_confirm: true in the same call, which is what skips
// Supabase's normal "click the link we emailed you" confirmation flow
// entirely - no email is sent, nothing is queued, nothing can hit the
// project's email rate limit.
//
// That matters because the address this assigns (see syntheticEmail
// below) is never real and nobody can ever read it - it exists purely so
// Supabase Auth has *an* email to key a password login on. The client
// used to call auth.updateUser({ email, password }) directly with the
// anon key, which goes through the normal "secure email change" flow:
// Supabase tried to send a confirmation email to that fake address on
// every single account claim, which (a) could never be clicked, so the
// email was never actually un-confirmed from the user's perspective, and
// (b) burns the project's shared-SMTP rate limit (a handful of emails
// per hour on the free tier) until every claim attempt starts failing
// with "email rate limit exceeded" - exactly what surfaced in testing.
//
// POST body: { password: string }
// Auth: the caller's Supabase session JWT, same pattern as
// verify-car-swap - auth_user_id comes from that verified JWT, and the
// nt_user_id this assigns an email for is read from THIS user's own
// account_links row, never trusted from the request body. A visitor can
// only ever claim the account they already proved ownership of via the
// car-swap check.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Mirrors src/client/app.js's syntheticEmail() - keep the two in sync.
function syntheticEmail(ntUserId: number) {
  return `nt${ntUserId}@racers.typetrack.internal`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in first." }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Sign in first." }, 401);
  const authUserId = userData.user.id;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // handled below
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || password.length < 6) {
    return json({ error: "Pick a password of at least 6 characters." }, 400);
  }

  const db = createClient(supabaseUrl, serviceRoleKey);

  const { data: link, error: linkErr } = await db
    .from("account_links")
    .select("nt_user_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (linkErr) return json({ error: "Lookup failed, try again." }, 500);
  if (!link) {
    return json({ error: "Verify your Nitro Type account first - start the car-swap check again." }, 404);
  }

  const { error: updateErr } = await db.auth.admin.updateUserById(authUserId, {
    email: syntheticEmail(link.nt_user_id),
    password,
    email_confirm: true,
  });
  if (updateErr) {
    console.error("claim-account: admin.updateUserById failed:", updateErr.message);
    return json({ error: "Could not finish setting up your account, try again." }, 500);
  }

  return json({ ok: true });
});
