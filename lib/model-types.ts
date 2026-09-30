import type { Model } from "mongoose";

import type { AppUser } from "@/models/AppUser";
import type { Application } from "@/models/Application";
import type { AuthLog } from "@/models/AuthLog";
import type { DashboardSession } from "@/models/DashboardSession";
import type { Device } from "@/models/Device";
import type { Session } from "@/models/Session";
import type { User } from "@/models/User";

/**
 * Explicit model types.
 *
 * `models.X` is typed as `Model<any>` by Mongoose's global registry, which
 * would force `any` back into every service signature. These aliases let the
 * data layer stay fully typed without a single `any`.
 */
export type AppUserModelType = Model<AppUser>;
export type ApplicationModelType = Model<Application>;
export type AuthLogModelType = Model<AuthLog>;
export type DashboardSessionModelType = Model<DashboardSession>;
export type DeviceModelType = Model<Device>;
export type SessionModelType = Model<Session>;
export type UserModelType = Model<User>;
