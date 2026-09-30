import type { InferSchemaType } from "mongoose";

import { AppUserModel } from "@/models/AppUser";
import { ApplicationModel } from "@/models/Application";
import { AuthLogModel } from "@/models/AuthLog";
import { DashboardSessionModel } from "@/models/DashboardSession";
import { DeviceModel } from "@/models/Device";
import { SessionModel } from "@/models/Session";
import { UserModel } from "@/models/User";

/**
 * Single import surface for every model.
 *
 * Importing models through this barrel guarantees the connection helper runs
 * first and avoids scattered deep-import paths. Each model file remains
 * independently hot-reload safe on its own.
 */
export { AppUserModel } from "@/models/AppUser";
export { ApplicationModel } from "@/models/Application";
export { AuthLogModel, AuthAction, type AuthActionValue } from "@/models/AuthLog";
export { DashboardSessionModel } from "@/models/DashboardSession";
export { DeviceModel } from "@/models/Device";
export { SessionModel } from "@/models/Session";
export { UserModel } from "@/models/User";

export { isExpired, toPublicAppUser, type PublicAppUser } from "@/models/AppUser";
export { toPublicApplication, type PublicApplication } from "@/models/Application";
export { toPublicAuthLog, type PublicAuthLog } from "@/models/AuthLog";
export { toPublicDevice, type PublicDevice } from "@/models/Device";
export { toPublicSession, type PublicSession } from "@/models/Session";
export {
  toPublicUser,
  type PublicUser,
  type UserAuthSource,
} from "@/models/User";
export { VerificationCodeModel } from "@/models/VerificationCode";

/** Re-exported document types for service signatures. */
export type { AppUser } from "@/models/AppUser";
export type { Application } from "@/models/Application";
export type { AuthLog } from "@/models/AuthLog";
export type { DashboardSession } from "@/models/DashboardSession";
export type { Device } from "@/models/Device";
export type { Session } from "@/models/Session";
export type { User } from "@/models/User";

export type {
  AppUserModelType,
  ApplicationModelType,
} from "@/lib/model-types";

// Keep the model imports referenced so bundlers never tree-shake the
// registration side effects away.
void [
  AppUserModel,
  ApplicationModel,
  AuthLogModel,
  DashboardSessionModel,
  DeviceModel,
  SessionModel,
  UserModel,
];

export type { InferSchemaType };
