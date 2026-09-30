import { check, section, call } from "../harness.mjs";

/**
 * Phase 9 — database integrity.
 *
 * Verifies the indexes Mongoose actually built in MongoDB, not the ones the
 * schema files declare. This catches the silent failure mode where declaring
 * an index twice (`index: true` AND `schema.index()`) makes Mongoose discard
 * the whole definition — including `expireAfterSeconds` — so TTL cleanup
 * quietly stops working.
 */
export async function phase9Indexes(ctx) {
  section("Phase 9 — MongoDB indexes");
  const { owner, app } = ctx;

  // Drive a request that loads every model so indexes are created.
  await call(owner, "GET", `/api/dashboard/applications/${app.id}/logs?limit=5`);

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(ctx.uri);
  await client.connect();
  const db = client.db();

  try {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    check("all seven collections exist",
      ["users", "applications", "app_users", "devices", "sessions",
       "auth_logs", "dashboard_sessions"].every((n) => names.includes(n)),
      `got: ${names.join(", ")}`);

    const indexesOf = async (collection) => {
      if (!names.includes(collection)) return [];
      return await db.collection(collection).indexes();
    };

    /**
     * Assert that a UNIQUE index exists covering exactly the given key.
     * We inspect the index documents' `unique` flag rather than their names,
     * because Mongoose names a unique index `field_1`, not `field_1_unique`.
     */
    const hasUnique = (indexes, key) =>
      indexes.some(
        (i) => i.unique === true && JSON.stringify(i.key) === JSON.stringify(key),
      );

    const userIdx = await indexesOf("users");
    check("users has a unique email index",
      hasUnique(userIdx, { email: 1 }), JSON.stringify(userIdx.map((i) => [i.name, i.unique])));
    check("users has a unique username index",
      hasUnique(userIdx, { username: 1 }), JSON.stringify(userIdx.map((i) => [i.name, i.unique])));

    const appIdx = await indexesOf("applications");
    check("applications has a unique appId index",
      hasUnique(appIdx, { appId: 1 }), JSON.stringify(appIdx.map((i) => [i.name, i.unique])));
    check("applications indexes ownerId for tenant scoping",
      appIdx.some((i) => JSON.stringify(i.key) === JSON.stringify({ ownerId: 1 })),
      JSON.stringify(appIdx.map((i) => i.key)));

    const appUserIdx = await indexesOf("app_users");
    check("app_users has a unique (applicationId, username) index",
      hasUnique(appUserIdx, { applicationId: 1, username: 1 }),
      JSON.stringify(appUserIdx.map((i) => [i.name, i.unique])));

    const deviceIdx = await indexesOf("devices");
    check("devices has a unique (applicationId, userId, deviceId) index",
      hasUnique(deviceIdx, { applicationId: 1, userId: 1, deviceId: 1 }),
      JSON.stringify(deviceIdx.map((i) => [i.name, i.unique])));

    const sessionIdx = await indexesOf("sessions");
    check("sessions has a unique tokenHash index",
      hasUnique(sessionIdx, { tokenHash: 1 }),
      JSON.stringify(sessionIdx.map((i) => [i.name, i.unique])));

    // The critical one: the TTL index must actually carry expireAfterSeconds.
    const ttl = sessionIdx.find((i) => i.expireAfterSeconds !== undefined);
    check("sessions has a working TTL index (expireAfterSeconds is set)",
      Boolean(ttl), JSON.stringify(sessionIdx.map((i) => ({ name: i.name, ttl: i.expireAfterSeconds }))));

    const dashIdx = await indexesOf("dashboard_sessions");
    const dashTtl = dashIdx.find((i) => i.expireAfterSeconds !== undefined);
    check("dashboard_sessions has a working TTL index",
      Boolean(dashTtl), JSON.stringify(dashIdx.map((i) => ({ name: i.name, ttl: i.expireAfterSeconds }))));

    // No plaintext secrets anywhere in the raw documents.
    const sessions = await db.collection("sessions").find({}).limit(5).toArray();
    const serialized = JSON.stringify(sessions);
    check("stored sessions contain only a tokenHash",
      !serialized.includes("sessionToken") && serialized.includes("tokenHash"));
    check("no bcrypt password hash leaks into the sessions collection",
      !serialized.includes("$2b$"));

    const appDocs = await db.collection("applications").find({}).limit(5).toArray();
    check("stored applications contain only an appSecretHash",
      JSON.stringify(appDocs).includes("appSecretHash") &&
      !JSON.stringify(appDocs).includes("fas_"));
  } finally {
    await client.close();
  }
}
