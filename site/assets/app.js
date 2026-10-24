// TypeTrack account / captain-events client logic.
//
// Runs only in the browser - never during the static build (build.js just
// copies this file verbatim into site/assets/app.js, and server.js serves
// it straight from this directory for local preview).
//
// Uses Supabase's publishable (anon) key, which is meant to be public and
// is safe to ship in client code: every table this talks to is protected
// by Row Level Security (see schema.sql), and the one operation that must
// never be left to the client - proving someone owns a Nitro Type account -
// is handled entirely server-side by the verify-car-swap Edge Function.
(function () {
  "use strict";

  var SUPABASE_URL = "https://pbnolrgiqpnfmbvgemcy.supabase.co";
  // Legacy (JWT-format) anon key, not the new sb_publishable_... key -
  // the project's gateway was rejecting the new-format key outright for
  // every endpoint (Auth, REST, and Edge Functions alike) at the time this
  // was written, most likely tied to a live Supabase platform incident
  // ("Elevated Mgmt API Error Rates in Multiple Regions"). This legacy key
  // is just as public/browser-safe by Supabase's own design - RLS is what
  // actually protects the data, not which key format asks for it.
  var SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBibm9scmdpcXBuZm1idmdlbWN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MjgwNTYsImV4cCI6MjEwODIwNDA1Nn0.YMUXinEwYRQcYOa2yXGXbcPkdN_ExjNniUeGqSz11Lw";

  var _client = null;
  function withClient(cb) {
    if (_client) return cb(_client);
    if (window.supabase && window.supabase.createClient) {
      _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return cb(_client);
    }
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
    s.onload = function () {
      _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      cb(_client);
    };
    s.onerror = function () {
      console.error("TypeTrack: could not load the Supabase client library.");
    };
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------
  // Small helpers shared by every page that uses this file.
  // ---------------------------------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function eventStatus(ev, now) {
    now = now || new Date();
    var start = new Date(ev.start_stamp);
    var end = new Date(ev.end_stamp);
    if (now < start) return "pending";
    if (now > end) return "ended";
    return "active";
  }

  function statusPill(status) {
    var label = status === "pending" ? "Upcoming" : status === "active" ? "Happening now" : "Ended";
    var cls = status === "pending" ? "ok" : status === "active" ? "good" : "na";
    return '<span class="pill ' + cls + '">' + label + "</span>";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------
  function getSession(cb) {
    withClient(function (sb) {
      sb.auth.getSession().then(function (res) {
        cb(res.data && res.data.session ? res.data.session : null, sb);
      });
    });
  }

  function signUp(email, password, cb) {
    withClient(function (sb) {
      sb.auth.signUp({ email: email, password: password }).then(function (res) {
        cb(res.error ? res.error.message : null, res.data);
      });
    });
  }

  function signIn(email, password, cb) {
    withClient(function (sb) {
      sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        cb(res.error ? res.error.message : null, res.data);
      });
    });
  }

  function signOut(cb) {
    withClient(function (sb) {
      sb.auth.signOut().then(function () {
        cb && cb();
      });
    });
  }

  // "Connect first" flow: the visitor proves ownership of a Nitro Type
  // account BEFORE they ever pick a TypeTrack email/username/password.
  // That needs *some* signed-in Supabase session to exist already (the
  // verify-car-swap Edge Function and the RLS policies on account_links /
  // verification_challenges are both anchored to auth.uid()) - an
  // anonymous Supabase Auth session is exactly that: a real auth.users row
  // with no email/password yet. Requires "Allow anonymous sign-ins" to be
  // turned on for this project (Supabase dashboard -> Authentication ->
  // Sign In / Providers -> Anonymous Sign-Ins); until that's on,
  // signInAnonymously resolves with an error and getOrCreateSession below
  // surfaces it as a normal error message rather than throwing.
  function getOrCreateSession(cb) {
    withClient(function (sb) {
      sb.auth.getSession().then(function (res) {
        var session = res.data && res.data.session ? res.data.session : null;
        if (session) {
          cb(null, session, sb);
          return;
        }
        sb.auth.signInAnonymously().then(function (res2) {
          if (res2.error) {
            cb(res2.error.message, null, sb);
            return;
          }
          cb(null, res2.data.session, sb);
        });
      });
    });
  }

  // Turns the visitor's current session (anonymous or not) into a real,
  // permanent TypeTrack login by attaching an email + password to it. The
  // auth_user_id never changes, so any account_links / verification_challenges
  // row already tied to this session (from the car-swap check) carries
  // straight over - nothing about the verification needs to be redone.
  //
  // Nitro Type usernames aren't email addresses, and a captain/officer's
  // account doesn't collect one at all per the current design, so both
  // paths synthesize a private, never-shown address under a dedicated
  // subdomain scoped to this project, built only from stable Nitro Type
  // ids - never guessable from someone else's real email, and never used
  // to actually send mail.
  function syntheticEmail(ntUserId) {
    return "nt" + ntUserId + "@racers.typetrack.internal";
  }

  function claimAccount(ntUserId, password, cb) {
    withClient(function (sb) {
      sb.auth.updateUser({ email: syntheticEmail(ntUserId), password: password }).then(function (res) {
        cb(res.error ? res.error.message : null, res.data);
      });
    });
  }

  // Looks up the Nitro Type racer (if any) this signed-in account has
  // verified ownership of. account_links is publicly readable (see
  // schema.sql), so this is a plain select.
  function getMyLink(userId, cb) {
    withClient(function (sb) {
      sb.from("account_links")
        .select("nt_user_id, verified_at")
        .eq("auth_user_id", userId)
        .maybeSingle()
        .then(function (res) {
          cb(res.error ? res.error.message : null, res.data);
        });
    });
  }

  function getRacerById(ntUserId, cb) {
    withClient(function (sb) {
      sb.from("racers")
        .select("nt_user_id, username, display_name, team_tag")
        .eq("nt_user_id", ntUserId)
        .maybeSingle()
        .then(function (res) {
          cb(res.error ? res.error.message : null, res.data);
        });
    });
  }

  function getProfile(authUserId, cb) {
    withClient(function (sb) {
      sb.from("profiles")
        .select("chosen_username")
        .eq("auth_user_id", authUserId)
        .maybeSingle()
        .then(function (res) {
          cb(res.error ? res.error.message : null, res.data);
        });
    });
  }

  function setChosenUsername(authUserId, username, cb) {
    withClient(function (sb) {
      sb.from("profiles")
        .upsert({ auth_user_id: authUserId, chosen_username: username })
        .then(function (res) {
          cb(res.error ? res.error.message : null, res.data);
        });
    });
  }

  function isTeamOfficer(teamTag, ntUserId, cb) {
    withClient(function (sb) {
      sb.from("team_officers")
        .select("nt_user_id")
        .eq("team_tag", teamTag)
        .eq("nt_user_id", ntUserId)
        .maybeSingle()
        .then(function (res) {
          cb(res.error ? res.error.message : null, !!res.data);
        });
    });
  }

  function listTeamOfficers(teamTag, cb) {
    withClient(function (sb) {
      sb.from("team_officers")
        .select("nt_user_id")
        .eq("team_tag", teamTag)
        .then(function (res) {
          cb(res.error ? res.error.message : null, (res.data || []).map(function (r) { return r.nt_user_id; }));
        });
    });
  }

  function addTeamOfficer(teamTag, ntUserId, cb) {
    withClient(function (sb) {
      sb.from("team_officers")
        .insert({ team_tag: teamTag, nt_user_id: ntUserId })
        .then(function (res) {
          cb(res.error ? res.error.message : null);
        });
    });
  }

  function removeTeamOfficer(teamTag, ntUserId, cb) {
    withClient(function (sb) {
      sb.from("team_officers")
        .delete()
        .eq("team_tag", teamTag)
        .eq("nt_user_id", ntUserId)
        .then(function (res) {
          cb(res.error ? res.error.message : null);
        });
    });
  }

  // "captain" | "officer" | "member" - the three tiers the latest design
  // calls out. Captain is decided purely from teams.captain_nt_user_id
  // (the same source of truth events.js's RLS policy itself trusts);
  // officer from team_officers; anything else (including a racer who
  // isn't currently on team_tag's team at all) is "member".
  function resolveTeamRole(teamTag, ntUserId, captainNtUserId, cb) {
    if (captainNtUserId != null && String(ntUserId) === String(captainNtUserId)) {
      cb(null, "captain");
      return;
    }
    if (!teamTag) {
      cb(null, "member");
      return;
    }
    isTeamOfficer(teamTag, ntUserId, function (err, isOfficer) {
      cb(err, isOfficer ? "officer" : "member");
    });
  }

  // ---------------------------------------------------------------------
  // Verification (the Edge Function does the actual work - this just
  // invokes it with the signed-in user's session attached automatically).
  // ---------------------------------------------------------------------
  function startVerification(username, cb) {
    withClient(function (sb) {
      sb.functions.invoke("verify-car-swap", { body: { action: "start", username: username } }).then(function (res) {
        if (res.error) {
          var msg = res.error.message || "Could not start verification.";
          (res.error.context && res.error.context.json ? res.error.context.json() : Promise.resolve(null)).then(function (body) {
            cb((body && body.error) || msg, null);
          }).catch(function () {
            cb(msg, null);
          });
          return;
        }
        cb(null, res.data);
      });
    });
  }

  function checkVerification(cb) {
    withClient(function (sb) {
      sb.functions.invoke("verify-car-swap", { body: { action: "check" } }).then(function (res) {
        if (res.error) {
          var msg = res.error.message || "Could not check verification.";
          (res.error.context && res.error.context.json ? res.error.context.json() : Promise.resolve(null)).then(function (body) {
            cb((body && body.error) || msg, null);
          }).catch(function () {
            cb(msg, null);
          });
          return;
        }
        cb(null, res.data);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Team events - public read is always live (not just at build time);
  // writes only succeed server-side (via RLS) for that team's verified
  // real captain, but the UI only shows the manage panel at all when the
  // signed-in visitor's linked racer matches the team's captain_nt_user_id
  // baked into the page at build time.
  // ---------------------------------------------------------------------
  function loadTeamEvents(teamTag, cb) {
    withClient(function (sb) {
      sb.from("events")
        .select("id, title, description, start_stamp, end_stamp")
        .eq("team_tag", teamTag)
        .order("start_stamp", { ascending: false })
        .then(function (res) {
          cb(res.error ? res.error.message : null, res.data || []);
        });
    });
  }

  function renderEventsTable(events) {
    if (!events.length) {
      return (
        '<div class="empty" style="padding:40px 24px;">No events scheduled for this team yet.</div>'
      );
    }
    var rows = events
      .map(function (ev) {
        var status = eventStatus(ev);
        return (
          "<tr>" +
          "<td><b>" +
          escapeHtml(ev.title) +
          "</b>" +
          (ev.description
            ? '<div style="color:var(--muted);font-size:12.5px;margin-top:3px;max-width:420px;white-space:normal;">' +
              escapeHtml(ev.description) +
              "</div>"
            : "") +
          "</td>" +
          "<td>" +
          statusPill(status) +
          "</td>" +
          "<td>" +
          fmtDate(ev.start_stamp) +
          "</td>" +
          "<td>" +
          fmtDate(ev.end_stamp) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      '<div class="table-wrap"><table><thead><tr><th>Event</th><th>Status</th><th>Starts</th><th>Ends</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>"
    );
  }

  function toLocalInputValue(iso) {
    var d = iso ? new Date(iso) : new Date();
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function renderCaptainManager(container, teamTag, events, refresh) {
    container.innerHTML = "";
    var wrap = el("div", { class: "card", style: "margin-top:18px;max-width:640px;" });
    wrap.appendChild(el("div", { style: "font-weight:700;margin-bottom:10px;", text: "Manage events (captain)" }));

    var list = el("div", { style: "display:flex;flex-direction:column;gap:10px;margin-bottom:16px;" });
    events.forEach(function (ev) {
      var row = el("div", { class: "card", style: "padding:12px;" });
      row.innerHTML =
        "<div style='font-weight:700;'>" +
        escapeHtml(ev.title) +
        "</div><div style='color:var(--muted);font-size:12.5px;margin:2px 0 8px;'>" +
        fmtDate(ev.start_stamp) +
        " → " +
        fmtDate(ev.end_stamp) +
        (ev.description ? "<br>" + escapeHtml(ev.description) : "") +
        "</div>";
      var delBtn = el("button", { type: "button", class: "btn-danger", text: "Delete" });
      delBtn.addEventListener("click", function () {
        if (!confirm('Delete "' + ev.title + '"?')) return;
        withClient(function (sb) {
          sb.from("events")
            .delete()
            .eq("id", ev.id)
            .then(function (res) {
              if (res.error) {
                alert("Could not delete: " + res.error.message);
                return;
              }
              refresh();
            });
        });
      });
      row.appendChild(delBtn);
      list.appendChild(row);
    });
    wrap.appendChild(list);

    var form = el("form", { style: "display:flex;flex-direction:column;gap:8px;" });
    form.innerHTML =
      '<input class="form-input" name="title" placeholder="Event title" required>' +
      '<textarea class="form-input" name="description" placeholder="Description (optional)" rows="2"></textarea>' +
      '<label style="font-size:12px;color:var(--muted);">Starts<input class="form-input" name="start" type="datetime-local" required value="' +
      toLocalInputValue() +
      '"></label>' +
      '<label style="font-size:12px;color:var(--muted);">Ends<input class="form-input" name="end" type="datetime-local" required value="' +
      toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()) +
      '"></label>' +
      '<button type="submit" class="btn-primary">Add event</button>' +
      '<div class="form-error" style="display:none;"></div>';
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var title = (fd.get("title") || "").toString().trim();
      var description = (fd.get("description") || "").toString().trim();
      var start = fd.get("start");
      var end = fd.get("end");
      var errorEl = form.querySelector(".form-error");
      errorEl.style.display = "none";
      if (!title || !start || !end) return;
      withClient(function (sb) {
        sb.from("events")
          .insert({
            team_tag: teamTag,
            title: title,
            description: description || null,
            start_stamp: new Date(start).toISOString(),
            end_stamp: new Date(end).toISOString(),
          })
          .then(function (res) {
            if (res.error) {
              errorEl.textContent = res.error.message;
              errorEl.style.display = "";
              return;
            }
            form.reset();
            refresh();
          });
      });
    });
    wrap.appendChild(form);
    container.appendChild(wrap);
  }

  function initEventsPage() {
    var panel = document.querySelector("[data-events-panel]");
    if (!panel) return;
    var teamTag = panel.getAttribute("data-team-tag");
    var captainNtUserId = panel.getAttribute("data-captain-nt-user-id") || "";
    var listTarget = panel.querySelector("[data-events-list]");
    var manageTarget = panel.querySelector("[data-events-manage]");

    function refresh() {
      loadTeamEvents(teamTag, function (err, events) {
        if (err) return;
        if (listTarget) listTarget.innerHTML = renderEventsTable(events);
        if (manageTarget && manageTarget.getAttribute("data-is-captain") === "1") {
          renderCaptainManager(manageTarget, teamTag, events, refresh);
        }
      });
    }

    refresh();

    if (!captainNtUserId) return;
    getSession(function (session) {
      if (!session) return;
      getMyLink(session.user.id, function (err, link) {
        if (err || !link) return;
        if (String(link.nt_user_id) !== String(captainNtUserId)) return;
        if (manageTarget) manageTarget.setAttribute("data-is-captain", "1");
        refresh();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Team Admin: captain edits officers, officer views read-only, anyone
  // else gets no content at all - see theme.js's teamAdminBody for the
  // static shell this fills in.
  // ---------------------------------------------------------------------
  function renderOfficerRows(tbody, teamTag, officerIds, racersById, isCaptain, refresh) {
    if (!officerIds.length) {
      tbody.innerHTML = '<tr><td colspan="2" style="color:var(--muted);">No officers appointed yet.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    officerIds.forEach(function (ntUserId) {
      var racer = racersById[ntUserId];
      var name = (racer && (racer.display_name || racer.username)) || "racer " + ntUserId;
      var tr = document.createElement("tr");
      var nameTd = document.createElement("td");
      nameTd.textContent = name;
      tr.appendChild(nameTd);
      var actionTd = document.createElement("td");
      if (isCaptain) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-danger";
        btn.textContent = "Remove";
        btn.addEventListener("click", function () {
          removeTeamOfficer(teamTag, ntUserId, function (err) {
            if (!err) refresh();
          });
        });
        actionTd.appendChild(btn);
      }
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });
  }

  function initTeamAdminPage() {
    var panel = document.querySelector("[data-admin-panel]");
    if (!panel) return;
    var teamTag = panel.getAttribute("data-team-tag");
    var captainNtUserId = panel.getAttribute("data-captain-nt-user-id") || null;
    var gate = panel.querySelector("[data-admin-gate]");
    var content = panel.querySelector("[data-admin-content]");
    var roleNote = panel.querySelector("[data-admin-role-note]");
    var rowsEl = panel.querySelector("[data-admin-officer-rows]");
    var appointForm = panel.querySelector("[data-admin-appoint-form]");
    var errorEl = panel.querySelector("[data-admin-error]");

    getSession(function (session) {
      if (!session || !session.user || session.user.is_anonymous) {
        gate.textContent = "Sign in and connect your Nitro Type account to view this page.";
        return;
      }
      getMyLink(session.user.id, function (err, link) {
        if (err || !link) {
          gate.textContent = "Connect your Nitro Type account to view this page.";
          return;
        }
        resolveTeamRole(teamTag, link.nt_user_id, captainNtUserId, function (err2, role) {
          if (role !== "captain" && role !== "officer") {
            gate.textContent = "You don't have access to this team's admin page.";
            return;
          }
          gate.style.display = "none";
          content.style.display = "";
          var isCaptain = role === "captain";
          roleNote.textContent = isCaptain
            ? "You're this team's captain — appoint or remove officers below."
            : "You're an officer on this team — you can view this page, but only the captain can make changes.";

          function refresh() {
            withClient(function (sb) {
              Promise.all([
                sb.from("team_officers").select("nt_user_id").eq("team_tag", teamTag),
                sb.from("racers").select("nt_user_id, username, display_name").eq("team_tag", teamTag),
              ]).then(function (results) {
                var officerIds = (results[0].data || []).map(function (r) { return r.nt_user_id; });
                var racersById = {};
                (results[1].data || []).forEach(function (r) { racersById[r.nt_user_id] = r; });
                renderOfficerRows(rowsEl, teamTag, officerIds, racersById, isCaptain, refresh);
                if (isCaptain) appointForm.style.display = "flex";
              });
            });
          }
          refresh();

          appointForm.addEventListener("submit", function (e) {
            e.preventDefault();
            var ntUserId = appointForm.nt_user_id.value;
            if (!ntUserId) return;
            errorEl.style.display = "none";
            addTeamOfficer(teamTag, Number(ntUserId), function (err3) {
              if (err3) {
                errorEl.textContent = err3;
                errorEl.style.display = "";
                return;
              }
              refresh();
            });
          });
        });
      });
    });
  }

  // ---------------------------------------------------------------------
  // Site-wide header auth status (shown on every page via a small badge
  // next to the Account nav link, when that link is present).
  // ---------------------------------------------------------------------
  function initHeaderStatus() {
    var link = document.querySelector('[data-account-nav]');
    if (!link) return;
    getSession(function (session) {
      // An anonymous session only exists mid-connect-flow (see
      // getOrCreateSession) - it isn't a real "signed in" state yet, so
      // the header shouldn't claim one.
      if (session && session.user && !session.user.is_anonymous) {
        link.textContent = "Account ●";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initHeaderStatus();
    initEventsPage();
    initTeamAdminPage();
  });

  window.TypeTrack = {
    withClient: withClient,
    getSession: getSession,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    getOrCreateSession: getOrCreateSession,
    claimAccount: claimAccount,
    getMyLink: getMyLink,
    getRacerById: getRacerById,
    getProfile: getProfile,
    setChosenUsername: setChosenUsername,
    isTeamOfficer: isTeamOfficer,
    listTeamOfficers: listTeamOfficers,
    addTeamOfficer: addTeamOfficer,
    removeTeamOfficer: removeTeamOfficer,
    resolveTeamRole: resolveTeamRole,
    startVerification: startVerification,
    checkVerification: checkVerification,
    el: el,
    escapeHtml: escapeHtml,
    fmtDate: fmtDate,
  };
})();
