/// <reference path="../pb_data/types.d.ts" />

// Defense-in-depth role enforcement on the `users` collection.
//
// The PocketBase Create / Update rules in the admin UI are the primary gate;
// these hooks exist to guarantee the role field can't be self-elevated even
// if those rules are misconfigured.
//
// Required PB collection rules (set in admin UI):
//   users.Create rule:  @request.body.role:isset = false || @request.body.role = "learner"
//   users.Update rule:  id = @request.auth.id  (a user can only edit themselves;
//                                                admin/lg edits go through admin tooling)

const ALLOWED_ROLES = ["learner", "lg", "admin"];

function callerRole(e) {
  return e.auth ? e.auth.get("role") : null;
}

onRecordCreateRequest((e) => {
  const requestedRole = e.record.get("role");

  if (requestedRole && !ALLOWED_ROLES.includes(requestedRole)) {
    throw new BadRequestError("invalid role");
  }

  // Anonymous self-signup may only create learner accounts. Promotion to
  // lg/admin must be performed by an authenticated admin.
  if (!e.auth) {
    if (requestedRole && requestedRole !== "learner") {
      throw new BadRequestError("only learner role can be self-assigned");
    }
    e.record.set("role", "learner");
  } else if (requestedRole && requestedRole !== "learner" && callerRole(e) !== "admin") {
    throw new BadRequestError("only admins can create elevated accounts");
  }

  e.next();
}, "users");

onRecordUpdateRequest((e) => {
  const newRole = e.record.get("role");
  const original = $app.findRecordById("users", e.record.id);
  const originalRole = original.get("role");

  if (newRole && !ALLOWED_ROLES.includes(newRole)) {
    throw new BadRequestError("invalid role");
  }

  // Role changes require admin auth.
  if (newRole && newRole !== originalRole && callerRole(e) !== "admin") {
    throw new BadRequestError("only admins can change a user's role");
  }

  e.next();
}, "users");
