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

// connectHref/accountHref are passed in rather than hardcoded because this
// module is shared between build.js (relative, depth-aware links - this
// body ends up nested inside account/index.html) and server.js (fixed
// absolute routes) - same reasoning as leaderboardsBody(data, teamHref)
// elsewhere in this codebase.
function accountIndexBody({ connectHref = "connect/" } = {}) {
  return `
    <h1>Your TypeTrack account</h1>
    <p class="meta-row">Sign in to connect your Nitro Type account. Once you're verified, your team's real captain can manage Events for your team right here on the site.</p>

    <div class="card" id="auth-card" style="max-width:420px;padding:20px;">
      <form id="auth-form" style="display:flex;flex-direction:column;gap:10px;">
        <input class="form-input" type="email" name="email" placeholder="Email" required autocomplete="email">
        <input class="form-input" type="password" name="password" placeholder="Password (6+ characters)" required minlength="6" autocomplete="current-password">
        <div style="display:flex;gap:8px;">
          <button type="submit" class="btn-primary" style="flex:1;">Sign in</button>
          <button type="button" data-mode="signup" class="btn-secondary" style="flex:1;">Create account</button>
        </div>
        <div class="form-error" style="display:none;"></div>
        <div class="form-note" style="display:none;"></div>
      </form>
    </div>

    <div class="card" id="signed-in-card" style="max-width:420px;padding:20px;display:none;">
      <div style="font-weight:700;" id="signed-in-email"></div>
      <div id="link-status" style="margin:10px 0;color:var(--muted);font-size:13px;">Checking your Nitro Type link…</div>
      <a id="connect-link" class="view-btn" href="${connectHref}" style="display:none;">Connect your Nitro Type account →</a>
      <div>
        <button type="button" id="sign-out-btn" class="btn-secondary" style="margin-top:14px;">Sign out</button>
      </div>
    </div>

    <script>
    (function () {
      function show(e) { e.style.display = ""; }
      function hide(e) { e.style.display = "none"; }
      var authCard = document.getElementById("auth-card");
      var signedInCard = document.getElementById("signed-in-card");
      var form = document.getElementById("auth-form");
      var errorEl = form.querySelector(".form-error");
      var noteEl = form.querySelector(".form-note");

      function renderSignedIn(session) {
        hide(authCard);
        show(signedInCard);
        document.getElementById("signed-in-email").textContent = session.user.email;
        var statusEl = document.getElementById("link-status");
        var connectLink = document.getElementById("connect-link");
        TypeTrack.getMyLink(session.user.id, function (err, link) {
          if (err) {
            statusEl.textContent = "Could not check your link status.";
            return;
          }
          if (!link) {
            statusEl.textContent = "Not linked to a Nitro Type account yet.";
            show(connectLink);
            return;
          }
          hide(connectLink);
          TypeTrack.getRacerById(link.nt_user_id, function (err2, racer) {
            if (racer) {
              statusEl.innerHTML =
                "Linked to <b>" +
                TypeTrack.escapeHtml(racer.display_name || racer.username) +
                "</b>" +
                (racer.team_tag ? " on team [" + TypeTrack.escapeHtml(racer.team_tag) + "]" : "");
            } else {
              statusEl.textContent = "Linked (racer " + link.nt_user_id + ").";
            }
          });
        });
      }

      TypeTrack.getSession(function (session) {
        if (session) renderSignedIn(session);
      });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = form.email.value.trim();
        var password = form.password.value;
        hide(errorEl);
        hide(noteEl);
        TypeTrack.signIn(email, password, function (err, data) {
          if (err) {
            errorEl.textContent = err;
            show(errorEl);
            return;
          }
          renderSignedIn(data.session);
        });
      });

      form.querySelector('[data-mode="signup"]').addEventListener("click", function () {
        var email = form.email.value.trim();
        var password = form.password.value;
        hide(errorEl);
        hide(noteEl);
        if (!email || password.length < 6) {
          errorEl.textContent = "Enter an email and a password of at least 6 characters.";
          show(errorEl);
          return;
        }
        TypeTrack.signUp(email, password, function (err, data) {
          if (err) {
            errorEl.textContent = err;
            show(errorEl);
            return;
          }
          if (data.session) {
            renderSignedIn(data.session);
            return;
          }
          noteEl.textContent = "Account created — check your email to confirm, then sign in.";
          show(noteEl);
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

function accountConnectBody({ accountHref = "../" } = {}) {
  return `
    <h1>Connect your Nitro Type account</h1>
    <p class="meta-row">Prove you own a Nitro Type account by briefly changing your in-game car. We never ask for your Nitro Type password.</p>

    <div id="need-auth-card" class="card" style="max-width:480px;padding:20px;display:none;">
      You need to <a href="${accountHref}">sign in to TypeTrack</a> first.
    </div>

    <div id="connect-card" class="card" style="max-width:480px;padding:20px;display:none;">
      <div id="already-linked" style="margin-bottom:14px;color:var(--muted);font-size:13px;display:none;"></div>

      <form id="start-form" style="display:flex;flex-direction:column;gap:10px;">
        <input class="form-input" name="username" placeholder="Your Nitro Type username" required autocomplete="off">
        <button type="submit" class="btn-primary">Start verification</button>
        <div class="form-error" style="display:none;"></div>
      </form>

      <div id="challenge-panel" style="display:none;margin-top:14px;">
        <p>Go to <a href="https://www.nitrotype.com/garage" target="_blank" rel="noopener">your Nitro Type garage</a> and equip any <b>different</b> car than the one you're using right now. You have <b id="challenge-minutes"></b> minutes.</p>
        <div style="font-size:28px;font-weight:800;margin:10px 0;" id="countdown">--:--</div>
        <button type="button" id="check-btn" class="btn-primary">I changed it — check now</button>
        <div id="check-message" style="margin-top:10px;color:var(--muted);font-size:13px;"></div>
      </div>

      <div id="verified-panel" style="display:none;margin-top:14px;color:var(--good);font-weight:700;"></div>
    </div>

    <script>
    (function () {
      function show(e) { e.style.display = ""; }
      function hide(e) { e.style.display = "none"; }

      var needAuth = document.getElementById("need-auth-card");
      var card = document.getElementById("connect-card");
      var startForm = document.getElementById("start-form");
      var challengePanel = document.getElementById("challenge-panel");
      var verifiedPanel = document.getElementById("verified-panel");
      var alreadyLinked = document.getElementById("already-linked");
      var countdownEl = document.getElementById("countdown");
      var checkBtn = document.getElementById("check-btn");
      var checkMessage = document.getElementById("check-message");
      var timer = null;
      var expiresAt = null;

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

      TypeTrack.getSession(function (session) {
        if (!session) {
          show(needAuth);
          return;
        }
        show(card);
        TypeTrack.getMyLink(session.user.id, function (err, link) {
          if (link) {
            TypeTrack.getRacerById(link.nt_user_id, function (err2, racer) {
              alreadyLinked.innerHTML =
                "Already linked to <b>" +
                TypeTrack.escapeHtml((racer && (racer.display_name || racer.username)) || link.nt_user_id) +
                "</b>. Starting a new verification keeps this same link — you can only ever link one Nitro Type account.";
              show(alreadyLinked);
            });
          }
        });
      });

      startForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var username = startForm.username.value.trim();
        var errorEl = startForm.querySelector(".form-error");
        hide(errorEl);
        if (!username) return;
        TypeTrack.startVerification(username, function (err, data) {
          if (err) {
            errorEl.textContent = err;
            show(errorEl);
            return;
          }
          hide(startForm);
          show(challengePanel);
          document.getElementById("challenge-minutes").textContent = data.minutes;
          startCountdown(data.expires_at);
        });
      });

      checkBtn.addEventListener("click", function () {
        checkMessage.textContent = "Checking…";
        TypeTrack.checkVerification(function (err, data) {
          if (err) {
            checkMessage.textContent = err;
            return;
          }
          if (data.verified) {
            hide(challengePanel);
            verifiedPanel.textContent = "Verified! You're linked as " + data.nt_username + ".";
            show(verifiedPanel);
            if (timer) clearInterval(timer);
          } else {
            checkMessage.textContent = data.message || "Not verified yet.";
          }
        });
      });
    })();
    </script>`;
}

module.exports = { accountIndexBody, accountConnectBody };
