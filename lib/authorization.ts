import "server-only";

import { notFound, redirect } from "next/navigation";
import { Types } from "mongoose";

import { ApiError } from "@/lib/errors";
import { connectToDatabase } from "@/lib/mongodb";
import { getSessionUser, type DashboardSessionUser } from "@/lib/session";
import { getAdminIdentity, type AdminIdentity } from "@/lib/admin-session";
import { AppUserModel } from "@/models/AppUser";
import { ApplicationModel, type ApplicationStatus } from "@/models/Application";

/**
 * Authorisation layer.
 *
 * The invariant enforced everywhere in this file:
 *
 *   authenticated dashboard user
 *     -> application.ownerId === sessionUser.id
 *       -> resource.applicationId === application._id
 *
 * The `applicationId` / `userId` that arrive in a URL or body are used ONLY
 * to look up the resource. The ownership decision is always made against the
 * server-side session identity, never against a client-supplied owner field.
 * This is what makes IDOR (cross-tenant access) impossible.
 *
 * All functions throw `ApiError` so route handlers stay thin.
 */

/** Validate a string as an ObjectId without ever passing junk to Mongo. */
export function toObjectId(value: string, label = "identifier"): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw ApiError.validation(`Invalid ${label}.`);
  }
  return new Types.ObjectId(value);
}

/**
 * An application the caller has already proved they own.
 * Declared explicitly so handlers get full document access (timestamps,
 * description) without re-querying.
 */
export type OwnedApplication = {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  description: string;
  appId: string;
  appSecretFingerprint: string;
  appSecretRotatedAt: Date;
  /**
   * Optional because documents written before this field existed have no value.
   * Callers must treat undefined as "active" — see assertApplicationActive.
   */
  status?: ApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Step 1: the caller must be a signed-in dashboard customer.
 * `redirectTo` is used by server components; API routes call it and let the
 * error bubble into the standard envelope.
 */
export async function requireDashboardUser(): Promise<DashboardSessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw ApiError.unauthorized("You must be signed in to view this page.");
  }
  return user;
}

/**
 * Page-level variant.
 *
 * Server components cannot render a JSON error envelope, so an unauthenticated
 * visitor is redirected to the sign-in screen instead of throwing. This is the
 * Data Access Layer entry point recommended by the Next.js auth guide.
 */
export async function requireDashboardUserPage(): Promise<DashboardSessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/**
 * Page-level variant for the platform admin panel.
 *
 * Redirects to the admin sign-in screen rather than throwing, because server
 * components cannot render a JSON error envelope.
 */
export async function requireAdminPage(): Promise<AdminIdentity> {
  const admin = await getAdminIdentity();
  if (!admin) {
    redirect("/admin/login");
  }
  return admin;
}

/**
 * Page-level ownership check. Redirects rather than throwing so nested
 * application pages degrade gracefully.
 */
export async function requireApplicationOwnerPage(
  applicationId: string,
): Promise<OwnedApplication> {
  const user = await requireDashboardUserPage();
  await connectToDatabase();

  const objectId = toObjectId(applicationId, "application id");
  const application = await ApplicationModel.findOne({
    _id: objectId,
    ownerId: new Types.ObjectId(user.id),
  }).lean();

  // notFound() renders the nearest error boundary — correct for a resource
  // that exists but is not yours (we never reveal that it exists).
  if (!application) notFound();

  return application;
}

/**
 * Step 2: the application must exist AND belong to the signed-in customer.
 *
 * Returns the application document so callers never re-query by owner.
 */
export async function requireApplicationOwner(
  applicationId: string,
): Promise<OwnedApplication> {
  const user = await requireDashboardUser();
  await connectToDatabase();

  const objectId = toObjectId(applicationId, "application id");

  // Single query carrying BOTH constraints. A missing row and a
  // not-owned row are indistinguishable to the caller (404), so the API
  // cannot be used to probe which application ids exist.
  const application = await ApplicationModel.findOne({
    _id: objectId,
    ownerId: new Types.ObjectId(user.id),
  }).lean();

  if (!application) {
    throw ApiError.notFound("Application not found.");
  }

  return application;
}

/**
 * Step 3: the application user must belong to the application the customer
 * already proved they own.
 *
 * `applicationId` is passed explicitly (rather than re-derived) so the scope
 * is auditable at every call site.
 */
export async function requireAppUser(
  applicationId: string,
  userId: string,
): Promise<{ _id: Types.ObjectId; applicationId: Types.ObjectId; username: string }> {
  await requireApplicationOwner(applicationId);
  await connectToDatabase();

  const objectId = toObjectId(userId, "user id");
  const appId = toObjectId(applicationId, "application id");

  // Both constraints in one query — no cross-application reach possible.
  const appUser = await AppUserModel.findOne({
    _id: objectId,
    applicationId: appId,
  }).lean();

  if (!appUser) {
    throw ApiError.notFound("User not found.");
  }

  return appUser;
}

/**
 * Convenience wrapper for routes that receive an `appId` from the path.
 * Returns the owner identity together with the application.
 */
export async function requireAppContext(applicationId: string): Promise<{
  user: DashboardSessionUser;
  application: { _id: Types.ObjectId; ownerId: Types.ObjectId; name: string; appId: string };
}> {
  const user = await requireDashboardUser();
  const application = await requireApplicationOwner(applicationId);
  return { user, application };
}
