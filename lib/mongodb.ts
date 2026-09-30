import "server-only";

// Mongoose 9 re-exports the driver as `mongo` (not `mongodb`).
import mongoose, { type mongo } from "mongoose";

/**
 * MongoDB connection management.
 *
 * Next.js dev-server hot reload re-evaluates modules constantly, which would
 * otherwise open a new connection pool on every edit until Mongo refuses them.
 * We cache the connection promise on `globalThis` so it survives hot reloads.
 */

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalWithMongoose = globalThis as typeof globalThis & {
  __mongooseCache?: MongooseCache;
};

const cache: MongooseCache = globalWithMongoose.__mongooseCache ?? {
  conn: null,
  promise: null,
};
globalWithMongoose.__mongooseCache = cache;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    mongoose.set("strictQuery", true);

    // NOTE: `sanitizeFilter` is intentionally NOT enabled.
    // In Mongoose 9 it rewrites `{ field: { $lte: someDate } }` into
    // `{ field: { $eq: { $lte: someDate } } }`, which then fails to cast the
    // operator object as a Date. That breaks every range query we rely on
    // (expiry windows, session TTLs, 7-day log stats).
    // We are protected against query injection a different, stronger way: no
    // service ever spreads a client-supplied object into a query. Filters are
    // always built field-by-field from values that have already passed Zod
    // validation, and `applicationId` is always a server-derived ObjectId.

    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI is not set. Copy .env.example to .env.local.");
    }

    cache.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
      })
      .then((m) => m)
      .catch((error: unknown) => {
        // Clear the rejected promise so the next request can retry.
        cache.promise = null;
        throw error;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (cache.promise) {
    await cache.promise;
  }
  await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * True when the deployment can run multi-document transactions.
 *
 * MongoDB only supports them on a replica set or a sharded cluster. A single
 * `mongod` started for local development does not, and neither does some
 * self-hosted production setups. Cached after the first probe.
 */
let transactionsSupported: boolean | null = null;

async function supportsTransactions(): Promise<boolean> {
  if (transactionsSupported !== null) return transactionsSupported;
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const info = (await admin.command({ hello: 1 })) as {
      setName?: string;
      msg?: string;
    };
    transactionsSupported = Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    transactionsSupported = false;
  }
  return transactionsSupported;
}

/**
 * Run `work` inside a transaction when the deployment supports one, otherwise
 * run it directly.
 *
 * Why the fallback: a cascade delete must still work on a standalone mongod.
 * Callers MUST order their operations children-first and the parent last, so
 * that a mid-way failure leaves the parent row intact and the operation is
 * safely retryable — never a half-deleted tenant with orphaned children.
 */
export async function withOptionalTransaction<T>(
  work: (session: mongo.ClientSession | null) => Promise<T>,
): Promise<T> {
  if (!(await supportsTransactions())) {
    return work(null);
  }

  const dbSession = await mongoose.startSession();
  try {
    let result: T;
    await dbSession.withTransaction(async () => {
      result = await work(dbSession);
    });
    // `result` is assigned inside the callback; TS cannot see that, so assert.
    return result!;
  } catch (error) {
    // A replica set can be configured but still refuse transactions; degrade
    // gracefully rather than failing the user's request.
    const code = (error as { codeName?: string }).codeName;
    if (code === "IllegalOperation" || code === "InvalidOptions") {
      transactionsSupported = false;
      console.warn(
        "[mongodb] Transactions unavailable; falling back to sequential writes.",
      );
      return work(null);
    }
    throw error;
  } finally {
    await dbSession.endSession();
  }
}
