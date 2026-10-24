// Proves a visitor really owns the Nitro Type account they say they do,
// without ever asking for their real Nitro Type password - see schema.sql's
// comment above verification_challenges/account_links for the full
// rationale. This function is the ONLY thing allowed to write those two
// tables (both have RLS on with no client-write policy at all); everything
// here runs with the service-role key, which bypasses RLS by design.
//
// POST body: { action: "start", username: string } | { action: "check" }
// Auth: the caller's Supabase session JWT, sent automatically by
// supabase.functions.invoke() from a signed-in browser session. The
// auth_user_id used everywhere below comes from THAT verified JWT, never
// from anything the client's request body claims - a client cannot act as
// a different user by lying in the request.

import { createClient } from "npm:@supabase/supabase-js@2";

const CHALLENGE_MINUTES = 10;

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

// Same honest, identified fetch pattern as src/ingest.js - this is the
// exact same public, unauthenticated team endpoint that script already
// polls on a schedule; this function just needs a LIVE read at the moment
// of the check, not whatever was last batch-synced.
async function fetchTeamMembers(tag: string) {
  const res = await fetch(`https://www.nitrotype.com/api/v2/teams/${encodeURIComponent(tag)}`, {
    headers: {
      "User-Agent": "nitro-type-team-tracker/0.1 (+https://github.com/thevoidracer/nitro-type-team-tracker)",
    },
  });
  if (!res.ok) throw new Error(`Nitro Type API returned HTTP ${res.status} for tag "${tag}"`);
  const data = await res.json();
  if (data.status !== "OK" || !data.results) {
    throw new Error(`Nitro Type API did not return a valid team for tag "${tag}"`);
  }
  return data.results.members || [];
}

function findMemberCarId(members: any[], nt_user_id: number): number | null {
  const m = members.find((x) => x.userID === nt_user_id);
  return m && typeof m.carID === "number" ? m.carID : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Resolve the caller from their own JWT - this is the one source of
  // truth for "who is making this request", independent of anything in
  // the request body.
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in first." }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Sign in first." }, 401);
  const authUserId = userData.user.id;

  // Service-role client: bypasses RLS, used for every actual table read
  // and write below (both target tables have no client-facing write
  // policy at all, by design).
  const db = createClient(supabaseUrl, serviceRoleKey);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // no body / not JSON - fine for "check", invalid for "start" (caught below)
  }

  if (body.action === "start") {
    const username = typeof body.username === "string" ? body.username.trim() : "";
    if (!username) return json({ error: "Enter your Nitro Type username." }, 400);

    const { data: racer, error: racerErr } = await db
      .from("racers")
      .select("nt_user_id, team_tag, username")
      .ilike("username", username)
      .maybeSingle();
    if (racerErr) return json({ error: "Lookup failed, try again." }, 500);
    if (!racer || !racer.team_tag) {
      return json(
        { error: "We don't track that racer yet - ask your captain to get your team added first." },
        404
      );
    }

    // Already linked to someone else?
    const { data: existingLink } = await db
      .from("account_links")
      .select("auth_user_id")
      .eq("nt_user_id", racer.nt_user_id)
      .maybeSingle();
    if (existingLink && existingLink.auth_user_id !== authUserId) {
      return json({ error: "That racer is already linked to a different TypeTrack account." }, 409);
    }

    // This TypeTrack account already linked to a DIFFERENT racer?
    const { data: callerLink } = await db
      .from("account_links")
      .select("nt_user_id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (callerLink && callerLink.nt_user_id !== racer.nt_user_id) {
      return json({ error: "Your TypeTrack account is already linked to a different racer." }, 409);
    }

    let members: any[];
    try {
      members = await fetchTeamMembers(racer.team_tag);
    } catch (err) {
      console.error("fetchTeamMembers failed (start):", err && (err as Error).message);
      return json({ error: "Couldn't reach Nitro Type right now - try again shortly." }, 502);
    }
    const baselineCarId = findMemberCarId(members, racer.nt_user_id);
    if (baselineCarId === null) {
      return json({ error: "Couldn't find your current car - are you still on that team?" }, 404);
    }

    const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60 * 1000).toISOString();
    const { error: upsertErr } = await db.from("verification_challenges").upsert({
      auth_user_id: authUserId,
      nt_user_id: racer.nt_user_id,
      nt_username: racer.username,
      baseline_car_id: baselineCarId,
      expires_at: expiresAt,
    });
    if (upsertErr) return json({ error: "Could not start verification, try again." }, 500);

    return json({
      nt_username: racer.username,
      baseline_car_id: baselineCarId,
      expires_at: expiresAt,
      minutes: CHALLENGE_MINUTES,
    });
  }

  if (body.action === "check") {
    const { data: challenge, error: chErr } = await db
      .from("verification_challenges")
      .select("*")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (chErr) return json({ error: "Lookup failed, try again." }, 500);
    if (!challenge) return json({ error: "No verification in progress - start one first." }, 404);

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      await db.from("verification_challenges").delete().eq("auth_user_id", authUserId);
      return json({ error: "That verification expired after 10 minutes - start again." }, 410);
    }

    const { data: racer } = await db
      .from("racers")
      .select("team_tag")
      .eq("nt_user_id", challenge.nt_user_id)
      .maybeSingle();
    if (!racer || !racer.team_tag) {
      return json({ error: "Couldn't find your team - are you still tracked?" }, 404);
    }

    let members: any[];
    try {
      members = await fetchTeamMembers(racer.team_tag);
    } catch (err) {
      console.error("fetchTeamMembers failed (check):", err && (err as Error).message);
      return json({ error: "Couldn't reach Nitro Type right now - try again shortly." }, 502);
    }
    const currentCarId = findMemberCarId(members, challenge.nt_user_id);
    if (currentCarId === null) {
      return json({ error: "Couldn't find your current car - are you still on that team?" }, 404);
    }

    if (currentCarId === challenge.baseline_car_id) {
      return json({
        verified: false,
        message: "Your car hasn't changed yet - change it in Nitro Type, then check again.",
      });
    }

    const { error: linkErr } = await db.from("account_links").upsert({
      auth_user_id: authUserId,
      nt_user_id: challenge.nt_user_id,
      verified_at: new Date().toISOString(),
    });
    if (linkErr) return json({ error: "Verified, but saving the link failed - try again." }, 500);

    await db.from("verification_challenges").delete().eq("auth_user_id", authUserId);

    return json({ verified: true, nt_username: challenge.nt_username });
  }

  return json({ error: "Unknown action." }, 400);
});
