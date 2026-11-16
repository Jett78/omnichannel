import { z } from "zod";

/** Shared Zod schemas — used by server actions, route handlers and services. */

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    email: z.email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().min(2, "Workspace name must be at least 2 characters").max(80),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers and hyphens")
    .optional(),
  timezone: z.string().min(1).default("Asia/Kathmandu"),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
/** Call-site input: fields with defaults (timezone, slug) are optional. */
export type CreateWorkspaceData = z.input<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  timezone: z.string().min(1).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

export const inviteMemberSchema = z.object({
  email: z.email("Enter a valid email address"),
  role: z.enum(["OWNER", "ADMIN", "AGENT", "VIEWER"]).default("AGENT"),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "AGENT", "VIEWER"]),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const createTeamSchema = z.object({
  name: z.string().min(2, "Team name must be at least 2 characters").max(60),
  description: z.string().max(500).optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address"),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
