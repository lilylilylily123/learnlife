/// <reference path="../pb_data/types.d.ts" />

// Atomic invite redemption.
//
// Replaces the previous client-side multi-step flow (check invite → create
// user → mark invite used) which had two race windows:
//   1. The same code could be redeemed twice if two clients raced.
//   2. If the client crashed mid-flow, the user account could exist while
//      the invite stayed "unused".
//
// All work now runs inside a single PocketBase transaction. Failure rolls
// back the entire redemption.
//
// Client contract:
//   POST /api/redeem-invite
//   body: { code: string, password: string }
//   returns: standard PB record-auth response { token, record }
//
// PocketBase 0.22+ JS hook API (matches the conventions used by
// users.pb.js and event_rsvps.pb.js).

const CODE_RE = /^[A-Z0-9]{6}$/;
const MIN_PASSWORD_LEN = 8;

routerAdd("POST", "/api/redeem-invite", (e) => {
  const info = e.requestInfo();
  const body = (info && info.body) || {};
  const code = (body.code || "").toString().toUpperCase();
  const password = (body.password || "").toString();

  if (!CODE_RE.test(code)) {
    throw new BadRequestError("Invalid code format");
  }
  if (password.length < MIN_PASSWORD_LEN) {
    throw new BadRequestError(
      "Password must be at least " + MIN_PASSWORD_LEN + " characters",
    );
  }

  let createdUserId = null;

  $app.runInTransaction((txApp) => {
    let invite;
    try {
      invite = txApp.findFirstRecordByFilter(
        "invites",
        "code = {:code} && used = false && expires_at > @now",
        { code: code },
      );
    } catch (_) {
      throw new BadRequestError("Invalid or expired code");
    }

    const learnerId = invite.get("learner");
    const email = invite.get("email");

    let learnerName = email;
    try {
      const learner = txApp.findRecordById("learners", learnerId);
      learnerName = learner.get("name") || email;
    } catch (_) {
      // Missing learner is non-fatal — fall back to email as display name.
    }

    const usersCollection = txApp.findCollectionByNameOrId("users");
    const user = new Record(usersCollection, {
      email: email,
      emailVisibility: false,
      name: learnerName,
      role: "learner",
      learner: learnerId,
      verified: true,
    });
    user.setPassword(password);
    txApp.save(user);
    createdUserId = user.id;

    // Best-effort back-reference on the learner record. Forward FK on users
    // is the source of truth; failure here doesn't roll back the redemption.
    try {
      const learner = txApp.findRecordById("learners", learnerId);
      learner.set("user", user.id);
      txApp.save(learner);
    } catch (_) {
      // ignore
    }

    invite.set("used", true);
    invite.set("used_at", new Date().toISOString());
    txApp.save(invite);
  });

  const user = $app.findRecordById("users", createdUserId);
  return apis.recordAuthResponse(e, user, "");
});
