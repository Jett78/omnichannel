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

// ─── Phase 4: conversations & messaging ───────────────────────────────────────

export const sendMessageSchema = z.union([
  // WhatsApp template send (Phase 6): the rendered preview is stored
  // as the message body; optInConfirmed is enforced by the service so
  // its error message can explain the opt-in requirement.
  z.object({
    templateName: z.string().min(1, "A template name is required").max(512),
    templateLanguage: z.string().min(2).max(32).optional(),
    templateParams: z.array(z.string().max(1000)).max(25).default([]),
    previewText: z.string().min(1, "A rendered template preview is required").max(10000),
    optInConfirmed: z.boolean().optional(),
    type: z.literal("TEMPLATE").optional(),
  }),
  z.object({
    content: z.string().min(1, "Message cannot be empty").max(10000),
    type: z
      .enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE", "LOCATION", "STICKER"])
      .default("TEXT"),
  }),
]);
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// ─── Phase 6: WhatsApp connection ─────────────────────────────────────────────

export const whatsappEmbeddedSignupSchema = z.object({
  code: z.string().min(1, "The Embedded Signup code is required"),
  wabaId: z.string().min(1, "The WhatsApp Business Account id is required"),
  phoneNumberId: z.string().min(1).optional(),
});
export type WhatsAppEmbeddedSignupInput = z.infer<typeof whatsappEmbeddedSignupSchema>;

export const whatsappManualConnectSchema = z.object({
  wabaId: z.string().min(1, "The WhatsApp Business Account id is required"),
  phoneNumberId: z.string().min(1, "The phone number id is required"),
  accessToken: z.string().min(1, "A system-user access token is required"),
});
export type WhatsAppManualConnectInput = z.infer<typeof whatsappManualConnectSchema>;

export const whatsappRegisterSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, "The registration PIN must be exactly 6 digits"),
});
export type WhatsAppRegisterInput = z.infer<typeof whatsappRegisterSchema>;

export const assignConversationSchema = z.object({
  assigneeId: z.string().min(1).nullable(),
});
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;

export const internalNoteSchema = z.object({
  content: z.string().min(1, "Note cannot be empty").max(10000),
});
export type InternalNoteInput = z.infer<typeof internalNoteSchema>;

export const conversationTagSchema = z.object({
  name: z.string().min(1, "Tag name is required").max(50),
});
export type ConversationTagInput = z.infer<typeof conversationTagSchema>;

export const selectConnectionAccountSchema = z.object({
  externalAccountId: z.string().min(1, "An account must be selected"),
});
export type SelectConnectionAccountInput = z.infer<typeof selectConnectionAccountSchema>;

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
