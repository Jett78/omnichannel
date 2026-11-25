import { z } from "zod";

import { OUTGOING_WEBHOOK_EVENTS } from "@/lib/webhook-events";

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

export const websiteChannelCreateSchema = z.object({
  name: z.string().trim().min(2, "Give the website a name").max(80),
  websiteUrl: z.string().trim().max(200).optional(),
  widgetColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #4f46e5")
    .optional(),
  welcomeTitle: z.string().trim().max(80).optional(),
  welcomeTagline: z.string().trim().max(140).optional(),
  preChatForm: z.boolean().optional(),
});
export type WebsiteChannelCreateInput = z.infer<typeof websiteChannelCreateSchema>;

export const websiteChannelUpdateSchema = websiteChannelCreateSchema.partial();
export type WebsiteChannelUpdateInput = z.infer<typeof websiteChannelUpdateSchema>;

export const widgetStartSchema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().max(120).optional(),
});

export const widgetMessageSchema = z.object({
  content: z.string().trim().min(1, "Message cannot be empty").max(4000),
});

export const telegramConnectSchema = z.object({
  botToken: z
    .string()
    .trim()
    .regex(
      /^\d{5,}:[A-Za-z0-9_-]{20,}$/,
      "That does not look like a BotFather token (it should look like 123456789:AA…).",
    ),
});
export type TelegramConnectInput = z.infer<typeof telegramConnectSchema>;

export const whatsappCredentialsUpdateSchema = z.object({
  accessToken: z.string().min(1, "A system-user access token is required"),
});
export type WhatsAppCredentialsUpdateInput = z.infer<typeof whatsappCredentialsUpdateSchema>;

export const whatsappRegisterSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, "The registration PIN must be exactly 6 digits"),
});
export type WhatsAppRegisterInput = z.infer<typeof whatsappRegisterSchema>;

// ─── Phase 14: WhatsApp template management ───────────────────────────────────
// Meta's rules: names are lowercase letters, numbers and underscores;
// AUTHENTICATION templates follow stricter component rules and are not
// creatable from this form (they still list and send normally).

export const createWhatsAppTemplateSchema = z.object({
  name: z
    .string()
    .min(1, "A template name is required")
    .max(512)
    .regex(
      /^[a-z0-9_]+$/,
      "Template names can only use lowercase letters, numbers and underscores",
    ),
  language: z.string().min(2, "A language code is required").max(32),
  category: z.enum(["UTILITY", "MARKETING"]),
  headerText: z.string().max(60).optional(),
  headerExample: z.string().max(1000).optional(),
  bodyText: z.string().min(1, "The template body is required").max(1024),
  bodyExamples: z.array(z.string().min(1).max(1000)).max(25).default([]),
  footerText: z.string().max(60).optional(),
});
export type CreateWhatsAppTemplateInput = z.infer<typeof createWhatsAppTemplateSchema>;

export const assignConversationSchema = z.object({
  assigneeId: z.string().min(1).nullable(),
});
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;

export const internalNoteSchema = z.object({
  content: z.string().min(1, "Note cannot be empty").max(10000),
});
export type InternalNoteInput = z.infer<typeof internalNoteSchema>;

export const updateContactDetailsSchema = z.object({
  phone: z.string().trim().max(32, "Phone number is too long").optional(),
  email: z
    .union([z.literal(""), z.string().trim().email("Enter a valid email address")])
    .optional(),
});
export type UpdateContactDetailsInput = z.infer<typeof updateContactDetailsSchema>;

export const conversationTagSchema = z.object({
  name: z.string().min(1, "Tag name is required").max(50),
});
export type ConversationTagInput = z.infer<typeof conversationTagSchema>;

export const setPrioritySchema = z.object({
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).nullable(),
});
export type SetPriorityInput = z.infer<typeof setPrioritySchema>;

export const snoozeConversationSchema = z.object({
  /** ISO timestamp to reopen at, or null = until the next reply. */
  until: z.string().datetime().nullable(),
});
export type SnoozeConversationInput = z.infer<typeof snoozeConversationSchema>;

export const cannedResponseCreateSchema = z.object({
  title: z.string().min(1, "Title is required").max(120),
  body: z.string().min(1, "Body is required").max(4000),
  shortcut: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
});
export type CannedResponseCreateInput = z.infer<typeof cannedResponseCreateSchema>;

export const cannedResponseUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").max(120).optional(),
  body: z.string().min(1, "Body is required").max(4000).optional(),
  shortcut: z.string().max(40).nullable().optional(),
  category: z.string().max(40).nullable().optional(),
});
export type CannedResponseUpdateInput = z.infer<typeof cannedResponseUpdateSchema>;

export const selectConnectionAccountSchema = z.object({
  externalAccountId: z.string().min(1, "An account must be selected"),
});
export type SelectConnectionAccountInput = z.infer<typeof selectConnectionAccountSchema>;

export const outgoingWebhookCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  url: z.string().trim().min(1, "URL is required").max(2000),
  events: z.array(z.enum(OUTGOING_WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
});
export type OutgoingWebhookCreateInput = z.infer<typeof outgoingWebhookCreateSchema>;

export const outgoingWebhookUpdateSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80).optional(),
  url: z.string().trim().min(1, "URL is required").max(2000).optional(),
  events: z.array(z.enum(OUTGOING_WEBHOOK_EVENTS)).min(1, "Pick at least one event").optional(),
  enabled: z.boolean().optional(),
});
export type OutgoingWebhookUpdateInput = z.infer<typeof outgoingWebhookUpdateSchema>;

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

export const automationConditionsSchema = z.object({
  providers: z.array(z.string().max(24)).max(12).optional(),
  channelIds: z.array(z.string()).max(50).optional(),
  tagIds: z.array(z.string()).max(20).optional(),
  unassignedOnly: z.boolean().optional(),
  firstMessageOnly: z.boolean().optional(),
  keywords: z.array(z.string().min(1).max(80)).max(20).optional(),
});

export const automationActionSchema = z.object({
  type: z.enum([
    "assign",
    "add_tag",
    "send_canned",
    "ai_reply",
    "notify",
    "set_status",
    "set_priority",
  ]),
  strategy: z.enum(["specific", "round_robin", "least_busy"]).optional(),
  userId: z.string().optional(),
  teamId: z.string().optional(),
  name: z.string().min(1).max(60).optional(),
  cannedResponseId: z.string().optional(),
  userIds: z.array(z.string()).max(50).optional(),
  message: z.string().max(500).optional(),
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

export const automationRuleCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  trigger: z.enum([
    "conversation.created",
    "message.created",
    "conversation.assigned",
    "conversation.resolved",
    "tag.added",
  ]),
  conditions: automationConditionsSchema.optional(),
  actions: z.array(automationActionSchema).min(1, "At least one action is required").max(10),
  enabled: z.boolean().optional(),
});
export type AutomationRuleCreateInput = z.infer<typeof automationRuleCreateSchema>;

export const automationRuleUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  trigger: automationRuleCreateSchema.shape.trigger.optional(),
  conditions: automationConditionsSchema.nullable().optional(),
  actions: z.array(automationActionSchema).min(1).max(10).optional(),
  enabled: z.boolean().optional(),
});
export type AutomationRuleUpdateInput = z.infer<typeof automationRuleUpdateSchema>;

export const availabilityUpdateSchema = z.object({
  isAvailable: z.boolean(),
});

export const contactProfileUpdateSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  customAttrs: z.record(z.string().max(60), z.string().max(500)).optional(),
});
export type ContactProfileUpdateInput = z.infer<typeof contactProfileUpdateSchema>;

export const aiConfigUpsertSchema = z.object({
  provider: z.enum(["groq", "gemini", "openai", "openrouter", "custom"]),
  model: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(500).optional(),
});

// Store API-shape knobs: length caps here; the semantics (patterns,
// defaults, "" clears a nullable knob) live in resolveStoreApiShape.
const storeApiShapeFields = {
  productsPath: z.string().trim().max(200).optional(),
  searchParam: z.string().trim().max(60).nullable().optional(),
  limitParam: z.string().trim().max(60).nullable().optional(),
  responsePath: z.string().trim().max(120).nullable().optional(),
  nameField: z.string().trim().max(60).optional(),
  priceField: z.string().trim().max(60).optional(),
  stockField: z.string().trim().max(60).optional(),
  imageField: z.string().trim().max(60).optional(),
};

export const storeConnectionUpsertSchema = z.object({
  baseUrl: z.string().trim().min(1).max(500),
  name: z.string().trim().max(120).optional(),
  ...storeApiShapeFields,
});

export const storeConnectionTestSchema = z.object({
  baseUrl: z.string().trim().min(1).max(500),
  ...storeApiShapeFields,
});

export const knowledgeEntryCreateSchema = z.object({
  title: z.string().min(1, "Title is required").max(120),
  content: z.string().min(1, "Content is required").max(8000),
});
export type KnowledgeEntryCreateInput = z.infer<typeof knowledgeEntryCreateSchema>;

export const knowledgeEntryUpdateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  content: z.string().min(1).max(8000).optional(),
});
export type KnowledgeEntryUpdateInput = z.infer<typeof knowledgeEntryUpdateSchema>;

export const aiActionSchema = z.object({
  action: z.enum(["suggest", "rewrite", "summarize", "sentiment", "translate"]),
  text: z.string().max(4000).optional(),
  tone: z.enum(["professional", "friendly", "shorter", "empathetic"]).optional(),
  target: z.string().max(40).optional(),
});
export type AiActionInput = z.infer<typeof aiActionSchema>;
