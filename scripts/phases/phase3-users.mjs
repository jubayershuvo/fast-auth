import { check, section, call } from "../harness.mjs";

/** Phase 3 — application-user CRUD and cross-tenant isolation. */
export async function phase3Users(ctx) {
  section("Phase 3 — application users, isolation, CRUD");
  const { owner, intruder, app, app2 } = ctx;

  let r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users`, {
    name: "Peter Player", username: "player123", password: "Player123", maxDevices: 2,
  });
  check("create app user returns 201", r.status === 201, JSON.stringify(r.body).slice(0, 200));
  check("the app user's display name is stored", r.body.data?.name === "Peter Player",
    JSON.stringify(r.body.data?.name));
  ctx.player = r.body.data;

  // name is required on app users too.
  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users`, {
    username: "nonameplayer", password: "Player123",
  });
  check("creating an app user without a name is rejected", r.status === 400, `got ${r.status}`);

  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users`, {
    name: "Peter Player", username: "player123", password: "Player123",
  });
  check("duplicate username in the same app is 409", r.status === 409, `got ${r.status}`);

  r = await call(owner, "POST", `/api/dashboard/applications/${app.id}/users`, {
    name: "Paula Player", username: "player2", password: "Player123", maxDevices: 1,
  });
  check("second app user created", r.status === 201, JSON.stringify(r.body).slice(0, 150));

  // Same username in a DIFFERENT application must be allowed.
  r = await call(owner, "POST", `/api/dashboard/applications/${app2.id}/users`, {
    name: "Peter Player", username: "player123", password: "Other123", maxDevices: 1,
  });
  check("same username is allowed in a different app", r.status === 201,
    JSON.stringify(r.body).slice(0, 150));
  ctx.player2 = r.body.data;

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/users`);
  check("list app users works", r.status === 200 && r.body.data.users.length === 2,
    JSON.stringify(r.body).slice(0, 150));
  check("listing users never exposes a password hash",
    !JSON.stringify(r.body).includes("passwordHash"));

  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/users/${ctx.player.id}`);
  check("get single app user works", r.status === 200, `got ${r.status}`);

  // IDOR: the other customer must not reach these users.
  r = await call(intruder, "GET", `/api/dashboard/applications/${app.id}/users`);
  check("IDOR: other customer cannot list app users", r.status === 404, `got ${r.status}`);

  r = await call(intruder, "GET", `/api/dashboard/applications/${app.id}/users/${ctx.player.id}`);
  check("IDOR: other customer cannot read an app user", r.status === 404, `got ${r.status}`);

  r = await call(intruder, "PATCH", `/api/dashboard/applications/${app.id}/users/${ctx.player.id}`, {
    notes: "hacked",
  });
  check("IDOR: other customer cannot edit an app user", r.status === 404, `got ${r.status}`);

  r = await call(intruder, "DELETE", `/api/dashboard/applications/${app.id}/users/${ctx.player.id}`);
  check("IDOR: other customer cannot delete an app user", r.status === 404, `got ${r.status}`);

  // Cross-application user id: valid ObjectId from app2 used under app1.
  r = await call(owner, "GET", `/api/dashboard/applications/${app.id}/users/${ctx.player2.id}`);
  check("a user from another app is not reachable under this app (404)",
    r.status === 404, `got ${r.status}`);

  r = await call(owner, "PATCH", `/api/dashboard/applications/${app.id}/users/${ctx.player.id}`, {
    notes: "VIP customer", maxDevices: 2,
  });
  check("owner can edit their app user",
    r.status === 200 && r.body.data?.user?.notes === "VIP customer",
    JSON.stringify(r.body).slice(0, 150));
}
