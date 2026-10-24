// Account pages' inner HTML (sign up/in, and the Nitro-Type-account
// connect/car-swap-verification flow). Shared between build.js (the
// static site) and server.js (local preview) the same way every other
// page body in theme.js is - plain functions returning HTML strings,
// wrapped by pageShell.
//
// Both pages are almost entirely client-driven: the markup here is just
// the shell + an inline <script> that calls window.TypeTrack (defined in
// src/client/app.js, which pageShell already includes on every page).
// Nothing here talks to Supabase directly from the server - account
// creation, sign-in, and the car-swap check all happen in the visitor's
// own browser, against the public anon key and (for the actual identity
// proof) the verify-car-swap Edge Function. See that function's own
// comments for why this is safe.

// Returning-visitor sign-in (already-claimed accounts use this, not the
// connect flow below - that's only for linking a NEW Nitro Type account).
// A captain/officer signs in with the same synthetic nt<id>@... address
// claimAccount() assigned them - they never see or type it themselves, so
// this form takes their Nitro Type username and looks the address up via
// the one racer row that matches it, same as the connect flow's first
// step. A regular member instead typed a real chosen_username at signup,
// which isn't a lookup key Supabase Auth understands either, so the same
// "type your name, we resolve the login" shape covers both tiers.
function signInBody({ accountHref = "../" } = {}) {
  return `
    <h1>Sign in to TypeTrack</h1>
    <p class="meta-row">New here? <a href="${accountHref}">Connect your Nitro Type account</a> instead - that's how a TypeTrack login gets created in the first place.</p>

    <div class="card" style="max-width:420px;padding:20px;">
      <form id="signin-form" style="display:flex;flex-direction:column;gap:10px;">
        <input class="form-input" type="text" name="name" placeholder="Your Nitro Type username or chosen username" required autocomplete="username">
        <input class="form-input" type="password" name="password" placeholder="Password" required autocomplete="current-password">
        <button type="submit" class="btn-primary">Sign in</button>
        <div class="form-error" style="display:none;"></div>
      </form>
    </div>

    <script>
    (function () {
      function show(e) { e.style.display = ""; }
      function hide(e) { e.style.display = "none"; }
      var form = document.getElementById("signin-form");
      var errorEl = form.querySelector(".form-error");

      TypeTrack.getSession(function (session) {
        if (session && session.user && !session.user.is_anonymous) location.href = "${accountHref}";
      });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        hide(errorEl);
        var name = form.name.value.trim();
        var password = form.password.value;
        if (!name || !password) return;
        // A chosen_username is stored lowercase-unique on profiles; a
        // captain/officer's login name is their live Nitro Type username
        // instead - try the profile lookup first since it's a direct,
        // cheap unique match, then fall back to resolving via racers.
        TypeTrack.withClient(function (sb) {
          sb.from("profiles").select("auth_user_id").ilike("chosen_username", name).maybeSingle().then(function (res) {
            if (res.data) return trySignIn(res.data.auth_user_id, "profile");
            TypeTrack.withClient(function (sb2) {
              sb2.from("racers").select("nt_user_id").ilike("username", name).maybeSingle().then(function (res2) {
                if (!res2.data) {
                  errorEl.textContent = "No TypeTrack account found for that name.";
                  show(errorEl);
                  return;
                }
                trySignIn(res2.data.nt_user_id, "racer");
              });
            });
          });
        });

        function trySignIn(idOrAuthId, kind) {
          if (kind === "profile") {
            // We only know the auth_user_id, not its email - sign-in by
            // password alone isn't possible without it, so resolve the
            // email server-side isn't available to the client either;
            // instead fall through to asking Supabase by the one address
            // scheme every account on this site actually has stored, via
            // a second profiles column would be needed for a true
            // username/password sign-in. As a pragmatic v1, chosen
            // usernames sign in using the same nt<id>@... scheme, looked
            // up through account_links.
            TypeTrack.withClient(function (sb3) {
              sb3.from("account_links").select("nt_user_id").eq("auth_user_id", idOrAuthId).maybeSingle().then(function (res3) {
                if (!res3.data) {
                  errorEl.textContent = "Could not resolve that account.";
                  show(errorEl);
                  return;
                }
                doSignIn(res3.data.nt_user_id);
              });
            });
            return;
          }
          doSignIn(idOrAuthId);
        }

        function doSignIn(ntUserId) {
          TypeTrack.signIn("nt" + ntUserId + "@racers.typetrack.internal", password, function (err) {
            if (err) {
              errorEl.textContent = err;
              show(errorEl);
              return;
            }
            location.href = "${accountHref}";
          });
        }
      });
    })();
    </script>`;
}

// connectHref/accountHref are passed in rather than hardcoded because this
// module is shared between build.js (relative, depth-aware links - this
// body ends up nested inside account/index.html) and server.js (fixed
// absolute routes) - same reasoning as leaderboardsBody(data, teamHref)
// elsewhere in this codebase.
//
// This is the whole "connect first" flow in one page: type your Nitro
// Type username, prove you own it by changing your car, THEN (and only
// then) pick how you'll log back in - a captain or officer goes by their
// real NT name and just picks a password; everyone else also picks a
// username. No email is ever collected from the visitor; see
// app.js's claimAccount()/syntheticEmail() for why that's safe to do with
// Supabase Auth, which requires SOME unique identifier under the hood.
function accountIndexBody({ signInHref = "sign-in/" } = {}) {
  return `
    <h1>Your TypeTrack account</h1>
    <p class="meta-row">Connect your Nitro Type account by briefly changing your in-game car - we never ask for your Nitro Type password. Already connected? <a href="${signInHref}">Sign in</a>.</p>

    <div id="connect-card" class="card" style="max-width:480px;padding:20px;">
      <div id="already-linked" style="margin-bottom:14px;color:var(--muted);font-size:13px;display:none;"></div>

      <form id="start-form" style="display:flex;flex-direction:column;gap:10px;">
        <input class="form-input" name="username" placeholder="Your Nitro Type username" required autocomplete="off">
        <button type="submit" class="btn-primary">Connect</button>
        <div class="form-error" style="display:none;"></div>
      </form>

      <div id="challenge-panel" style="display:none;margin-top:14px;">
        <p>Go to <a href="https://www.nitrotype.com/garage" target="_blank" rel="noopener">your Nitro Type garage</a> and equip any <b>different</b> car than the one you're using right now. You have <b id="challenge-minutes"></b> minutes.</p>
        <div style="font-size:28px;font-weight:800;margin:10px 0;" id="countdown">--:--</div>
        <button type="button" id="check-btn" class="btn-primary">I changed it — check now</button>
        <div id="check-message" style="margin-top:10px;color:var(--muted);font-size:13px;"></div>
      </div>

      <form id="claim-form" style="display:none;margin-top:14px;flex-direction:column;gap:10px;">
        <div id="claim-intro" style="color:var(--good);font-weight:700;margin-bottom:4px;"></div>
        <input class="form-input" id="claim-username" name="username" placeholder="Pick a username" autocomplete="username">
        <input class="form-input" name="password" type="password" placeholder="Pick a password (6+ characters)" required minlength="6" autocomplete="new-password">
        <button type="submit" class="btn-primary">Finish setting up my account</button>
        <div class="form-error" style="display:none;"></div>
      </form>
    </div>

    <div class="card" id="signed-in-card" style="max-width:480px;padding:20px;display:none;margin-top:16px;">
      <div style="font-weight:700;" id="signed-in-name"></div>
      <div id="signed-in-role" style="margin:6px 0 0;color:var(--muted);font-size:13px;"></div>
      <button type="button" id="sign-out-btn" class="btn-secondary" style="margin-top:14px;">Sign out</button>
    </div>

    <script>
    (function () {
      function show(e) { e.style.display = ""; }
      function hide(e) { e.style.display = "none"; }

      var connectCard = document.getElementById("connect-card");
      var signedInCard = document.getElementById("signed-in-card");
      var startForm = document.getElementById("start-form");
      var challengePanel = document.getElementById("challenge-panel");
      var claimForm = document.getElementById("claim-form");
      var alreadyLinked = document.getElementById("already-linked");
      var countdownEl = document.getElementById("countdown");
      var checkBtn = document.getElementById("check-btn");
      var checkMessage = document.getElementById("check-message");
      var timer = null;
      var expiresAt = null;
      var pendingLink = null; // { nt_user_id, nt_username }

      function startCountdown(exp) {
        expiresAt = new Date(exp).getTime();
        if (timer) clearInterval(timer);
        function tick() {
          var ms = expiresAt - Date.now();
          if (ms <= 0) {
            countdownEl.textContent = "Expired";
            clearInterval(timer);
            return;
          }
          var m = Math.floor(ms / 60000);
          var s = Math.floor((ms % 60000) / 1000);
          countdownEl.textContent = m + ":" + (s < 10 ? "0" : "") + s;
        }
        tick();
        timer = setInterval(tick, 1000);
      }

      function renderAlreadySignedIn(session) {
        hide(connectCard);
        show(signedInCard);
        TypeTrack.getMyLink(session.user.id, function (err, link) {
          if (!link) return; // anonymous session with no link yet - treat as "not connected"
          TypeTrack.getRacerById(link.nt_user_id, function (err2, racer) {
            var name = (racer && (racer.display_name || racer.username)) || "racer " + link.nt_user_id;
            document.getElementById("signed-in-name").textContent = name;
            var teamTag = racer && racer.team_tag;
            TypeTrack.withClient(function (sb) {
              var captainId = null;
              (teamTag ? sb.from("teams").select("captain_nt_user_id").eq("tag", teamTag).maybeSingle() : Promise.resolve({ data: null })).then(function (res) {
                captainId = res.data && res.data.captain_nt_user_id;
                TypeTrack.resolveTeamRole(teamTag, link.nt_user_id, captainId, function (err3, role) {
                  var roleLabel = role === "captain" ? "Team captain" : role === "officer" ? "Team officer" : "Team member";
                  document.getElementById("signed-in-role").textContent = roleLabel + (teamTag ? " on team [" + TypeTrack.escapeHtml(teamTag) + "]" : "");
                });
              });
            });
          });
        });
      }

      TypeTrack.getSession(function (session) {
        if (session && session.user && !session.user.is_anonymous) {
          renderAlreadySignedIn(session);
        }
      });

      startForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var username = startForm.username.value.trim();
        var errorEl = startForm.querySelector(".form-error");
        hide(errorEl);
        if (!username) return;
        TypeTrack.getOrCreateSession(function (sessErr) {
          if (sessErr) {
            errorEl.textContent = "Could not start a session: " + sessErr;
            show(errorEl);
            return;
          }
          TypeTrack.startVerification(username, function (err, data) {
            if (err) {
              errorEl.textContent = err;
              show(errorEl);
              return;
            }
            pendingLink = { nt_username: data.nt_username };
            hide(startForm);
            show(challengePanel);
            document.getElementById("challenge-minutes").textContent = data.minutes;
            startCountdown(data.expires_at);
          });
        });
      });

      checkBtn.addEventListener("click", function () {
        checkMessage.textContent = "Checking…";
        TypeTrack.checkVerification(function (err, data) {
          if (err) {
            checkMessage.textContent = err;
            return;
          }
          if (!data.verified) {
            checkMessage.textContent = data.message || "Not verified yet.";
            return;
          }
          if (timer) clearInterval(timer);
          hide(challengePanel);
          showClaimForm(data.nt_username);
        });
      });

      function showClaimForm(ntUsername) {
        TypeTrack.getSession(function (session) {
          TypeTrack.getMyLink(session.user.id, function (err, link) {
            TypeTrack.getRacerById(link.nt_user_id, function (err2, racer) {
              var teamTag = racer && racer.team_tag;
              TypeTrack.withClient(function (sb) {
                (teamTag ? sb.from("teams").select("captain_nt_user_id").eq("tag", teamTag).maybeSingle() : Promise.resolve({ data: null })).then(function (res) {
                  var captainId = res.data && res.data.captain_nt_user_id;
                  TypeTrack.resolveTeamRole(teamTag, link.nt_user_id, captainId, function (err3, role) {
                    var intro = document.getElementById("claim-intro");
                    var nameField = document.getElementById("claim-username");
                    if (role === "captain" || role === "officer") {
                      intro.textContent = "Verified as " + ntUsername + " (" + role + "). Pick a password to finish setting up your account - you'll sign in with your Nitro Type name.";
                      hide(nameField);
                      nameField.removeAttribute("required");
                    } else {
                      intro.textContent = "Verified as " + ntUsername + "! Pick a username and password to finish setting up your account.";
                      show(nameField);
                      nameField.setAttribute("required", "required");
                    }
                    show(claimForm);
                    claimForm.setAttribute("data-nt-user-id", link.nt_user_id);
                    claimForm.setAttribute("data-role", role);
                  });
                });
              });
            });
          });
        });
      }

      claimForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var errorEl = claimForm.querySelector(".form-error");
        hide(errorEl);
        var ntUserId = claimForm.getAttribute("data-nt-user-id");
        var role = claimForm.getAttribute("data-role");
        var password = claimForm.password.value;
        var chosenUsername = claimForm.username.value.trim();
        if ((role === "member") && !chosenUsername) {
          errorEl.textContent = "Pick a username.";
          show(errorEl);
          return;
        }
        TypeTrack.claimAccount(ntUserId, password, function (err) {
          if (err) {
            errorEl.textContent = err;
            show(errorEl);
            return;
          }
          function done() {
            TypeTrack.getSession(function (session) {
              renderAlreadySignedIn(session);
            });
          }
          if (role === "member") {
            TypeTrack.getSession(function (session) {
              TypeTrack.setChosenUsername(session.user.id, chosenUsername, function (err2) {
                if (err2) {
                  errorEl.textContent = err2;
                  show(errorEl);
                  return;
                }
                done();
              });
            });
          } else {
            done();
          }
        });
      });

      document.getElementById("sign-out-btn").addEventListener("click", function () {
        TypeTrack.signOut(function () {
          location.reload();
        });
      });
    })();
    </script>`;
}

// The connect step now lives directly on accountIndexBody (the whole
// point of the "connect first" redesign), so this old standalone page is
// kept only so a bookmarked/old-linked /account/connect/ URL still goes
// somewhere sensible instead of 404ing.
function accountConnectBody({ accountHref = "../" } = {}) {
  return `
    <h1>Connect your Nitro Type account</h1>
    <p class="meta-row">This now happens right on <a href="${accountHref}">your TypeTrack account page</a> - taking you there now…</p>
    <script>location.href = "${accountHref}";</script>`;
}

module.exports = { accountIndexBody, accountConnectBody, signInBody };
