import { aiChat } from "@/lib/ai";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePermission } from "@/lib/workspace-auth";
import { storeProductService, type StoreProduct } from "@/services/store.service";

/**
 * Phase 13G — AI reply assistant + workspace knowledge.
 *
 * Ground rules (from the spec):
 * - Suggestions are DRAFTS for the agent. Nothing here sends a
 *   message; the composer inserts text only when the agent clicks.
 * - Without AI_API_KEY the actions throw AiNotConfiguredError — the
 *   UI shows a setup state, never a fake answer.
 * - Knowledge-grounded suggestions use only this workspace's own
 *   KnowledgeEntry rows and READY KnowledgeDocument files (Full
 *   Document mode), selected by simple keyword overlap.
 */

export interface KnowledgeEntryView {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export const knowledgeService = {
  async list(actorUserId: string, workspaceId: string): Promise<KnowledgeEntryView[]> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.view");
    const rows = await prisma.knowledgeEntry.findMany({
      where: { workspaceId },
      orderBy: { title: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  },

  async create(
    actorUserId: string,
    workspaceId: string,
    input: { title: string; content: string },
  ): Promise<KnowledgeEntryView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const row = await prisma.knowledgeEntry.create({
      data: {
        workspaceId,
        title: input.title.trim(),
        content: input.content,
        createdById: actorUserId,
      },
    });
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  async update(
    actorUserId: string,
    workspaceId: string,
    entryId: string,
    input: { title?: string; content?: string },
  ): Promise<KnowledgeEntryView> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const existing = await prisma.knowledgeEntry.findFirst({
      where: { id: entryId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound("Knowledge entry not found");
    const row = await prisma.knowledgeEntry.update({
      where: { id: entryId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
      },
    });
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  async remove(actorUserId: string, workspaceId: string, entryId: string): Promise<void> {
    await requireWorkspacePermission(actorUserId, workspaceId, "workspace.update");
    const existing = await prisma.knowledgeEntry.findFirst({
      where: { id: entryId, workspaceId },
      select: { id: true },
    });
    if (!existing) throw AppError.notFound("Knowledge entry not found");
    await prisma.knowledgeEntry.delete({ where: { id: entryId } });
  },
};

async function logUsage(workspaceId: string, userId: string, action: string): Promise<void> {
  try {
    await prisma.aiUsageLog.create({ data: { workspaceId, userId, action } });
  } catch (error) {
    console.error("[ai] usage log failed", error);
  }
}

export async function countAiUsageThisMonth(workspaceId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return prisma.aiUsageLog.count({
    where: { workspaceId, createdAt: { gte: monthStart } },
  });
}

interface ThreadContext {
  contactName: string;
  provider: string;
  transcript: string;
  lastCustomerMessage: string | null;
}

async function loadThread(
  workspaceId: string,
  conversationId: string,
): Promise<ThreadContext> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId },
    include: {
      contact: { select: { displayName: true } },
      channel: { select: { provider: true } },
      messages: {
        where: { type: { notIn: ["SYSTEM", "PRIVATE_NOTE"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { direction: true, body: true, type: true },
      },
    },
  });
  if (!conversation) throw AppError.notFound("Conversation not found");
  const chronological = [...conversation.messages].reverse();
  const lines = chronological
    .map((message) => {
      const who = message.direction === "INBOUND" ? "Customer" : "Agent";
      const text = message.body ?? `[${message.type.toLowerCase()}]`;
      return `${who}: ${text}`;
    })
    .join("\n");
  const lastCustomer = [...chronological]
    .reverse()
    .find((message) => message.direction === "INBOUND" && message.body);
  return {
    contactName: conversation.contact.displayName,
    provider: conversation.channel.provider.toLowerCase(),
    transcript: lines,
    lastCustomerMessage: lastCustomer?.body ?? null,
  };
}

/** Pick the knowledge entries most relevant to the customer's words. */
async function relevantKnowledge(
  workspaceId: string,
  queryText: string | null,
): Promise<Array<{ title: string; content: string }>> {
  const entries = await prisma.knowledgeEntry.findMany({
    where: { workspaceId },
    select: { title: true, content: true },
    take: 50,
  });
  if (entries.length === 0) return [];
  const words = new Set(
    (queryText ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4),
  );
  const scored = entries
    .map((entry) => {
      const haystack = `${entry.title} ${entry.content}`.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (haystack.includes(word)) score += 1;
      }
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored.map((item) => item.entry);
}

/** Total characters of document text one suggestion may carry. */
const MAX_DOCUMENT_CHARS = 12_000;

/**
 * Full Document mode (Dograh-style knowledge base): the whole text of
 * each READY uploaded document that matches the customer's words,
 * filled into a fixed character budget in relevance order. Documents
 * that don't match are left out — the audit line names what was used.
 */
async function relevantKnowledgeDocuments(
  workspaceId: string,
  queryText: string | null,
): Promise<Array<{ title: string; content: string }>> {
  const rows = await prisma.knowledgeDocument.findMany({
    where: { workspaceId, status: "READY", mode: "FULL_DOCUMENT" },
    select: { fileName: true, extractedText: true },
    take: 50,
  });
  const docs = rows.filter(
    (row): row is { fileName: string; extractedText: string } => !!row.extractedText,
  );
  if (docs.length === 0) return [];
  const words = new Set(
    (queryText ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4),
  );
  const scored = docs
    .map((doc) => {
      const haystack = `${doc.fileName} ${doc.extractedText}`.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (haystack.includes(word)) score += 1;
      }
      return { doc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked: Array<{ title: string; content: string }> = [];
  let used = 0;
  for (const item of scored) {
    const remaining = MAX_DOCUMENT_CHARS - used;
    if (remaining <= 0) break;
    const text = item.doc.extractedText;
    const content =
      text.length > remaining
        ? `${text.slice(0, remaining)}\n[…document truncated to fit]`
        : text;
    picked.push({ title: item.doc.fileName, content });
    used += content.length;
  }
  return picked;
}

const SUPPORT_SYSTEM_PROMPT =
  "You are an AI assistant helping a human support agent in a customer-service inbox. " +
  "You draft text for the agent to review — you never speak to the customer directly. " +
  "Be accurate, concise and polite. If the workspace knowledge does not cover something, " +
  "do not invent policies, prices or promises.";

export const aiAssistantService = {
  async suggestReply(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<{ text: string; knowledgeUsed: string[]; products: StoreProduct[] }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const thread = await loadThread(workspaceId, conversationId);
    const knowledge = await relevantKnowledge(
      workspaceId,
      `${thread.lastCustomerMessage ?? ""}\n${thread.transcript}`,
    );
    const documents = await relevantKnowledgeDocuments(
      workspaceId,
      `${thread.lastCustomerMessage ?? ""}\n${thread.transcript}`,
    );
    // Live store products for the customer's latest message, when a
    // store is connected. Self-catching — a store outage never breaks
    // the suggestion; the AI just answers without product facts.
    const products = await storeProductService.searchForMessage(
      workspaceId,
      thread.lastCustomerMessage ?? "",
    );
    const formatPrice = (product: StoreProduct): string => {
      if (product.priceMin === null) return "price not listed";
      if (product.priceMax === null || product.priceMax === product.priceMin) {
        return `Rs ${product.priceMin.toLocaleString("en-US")}`;
      }
      return `Rs ${product.priceMin.toLocaleString("en-US")}–${product.priceMax.toLocaleString("en-US")}`;
    };
    const productBlock = products.length
      ? `\n\nLIVE PRODUCTS from the connected store (fetched just now — these names, prices and stock levels are FACTS; if what the customer wants is not listed here, say you will check instead of inventing details):\n${products
          .map(
            (product) =>
              `- ${product.name} — ${formatPrice(product)} — ${
                !product.stockKnown
                  ? "Stock level not reported by the store (do not claim it is in or out of stock)"
                  : product.inStock
                    ? product.totalStock > 0
                      ? `In stock (${product.totalStock} available)`
                      : "In stock"
                    : "Out of stock"
              }${product.variantLabels.length ? ` — options: ${product.variantLabels.join(", ")}` : ""}`,
          )
          .join("\n")}`
      : "";
    const knowledgeBlock = knowledge.length
      ? `\n\nWorkspace knowledge you may rely on:\n${knowledge
          .map((entry) => `## ${entry.title}\n${entry.content}`)
          .join("\n\n")}`
      : "";
    const documentBlock = documents.length
      ? `\n\nUploaded knowledge documents (Full Document mode — the full text of each matching document follows; treat it as facts from the business's own files):\n${documents
          .map((doc) => `## ${doc.title}\n${doc.content}`)
          .join("\n\n")}`
      : "";
    const text = await aiChat([
      { role: "system", content: SUPPORT_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Conversation with ${thread.contactName} (channel: ${thread.provider}):\n\n${thread.transcript}` +
          `${knowledgeBlock}${documentBlock}${productBlock}\n\nWrite the agent's next reply to the customer. ` +
          `Reply in the language the customer is using. Output ONLY the reply text.`,
      },
    ], workspaceId);
    await logUsage(workspaceId, actorUserId, "suggest");
    return {
      text,
      knowledgeUsed: [
        ...knowledge.map((entry) => entry.title),
        ...documents.map((doc) => doc.title),
      ],
      products,
    };
  },

  async rewrite(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    input: { text: string; tone: "professional" | "friendly" | "shorter" | "empathetic" },
  ): Promise<{ text: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    await loadThread(workspaceId, conversationId); // workspace/conversation check
    const toneInstruction = {
      professional: "more professional and polished",
      friendly: "warmer and friendlier",
      shorter: "shorter and more direct, keeping the meaning",
      empathetic: "more empathetic and understanding",
    }[input.tone];
    const text = await aiChat([
      { role: "system", content: SUPPORT_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Rewrite the agent's draft to be ${toneInstruction}. Keep every fact unchanged. ` +
          `Output ONLY the rewritten text.\n\nDraft:\n${input.text}`,
      },
    ], workspaceId);
    await logUsage(workspaceId, actorUserId, "rewrite");
    return { text };
  },

  async summarize(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<{ text: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const thread = await loadThread(workspaceId, conversationId);
    const text = await aiChat([
      { role: "system", content: SUPPORT_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Summarize this support conversation for a teammate taking over. Cover: what the ` +
          `customer wants, what has already been said or done, and what is still pending. ` +
          `Use short bullet points.\n\nConversation with ${thread.contactName}:\n\n${thread.transcript}`,
      },
    ], workspaceId);
    await logUsage(workspaceId, actorUserId, "summarize");
    return { text };
  },

  async sentiment(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<{ sentiment: "positive" | "neutral" | "negative"; reason: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    const thread = await loadThread(workspaceId, conversationId);
    const raw = await aiChat(
      [
        { role: "system", content: SUPPORT_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Judge the CUSTOMER's overall sentiment in this conversation. Respond with ONLY a ` +
            `JSON object like {"sentiment":"positive|neutral|negative","reason":"one short sentence"}.\n\n${thread.transcript}`,
        },
      ],
      workspaceId,
      { maxTokens: 200, temperature: 0 },
    );
    await logUsage(workspaceId, actorUserId, "sentiment");
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match?.[0] ?? "") as { sentiment?: string; reason?: string };
      const sentiment =
        parsed.sentiment === "positive" || parsed.sentiment === "negative"
          ? parsed.sentiment
          : "neutral";
      return { sentiment, reason: parsed.reason?.trim() || "No reason given" };
    } catch {
      throw new Error("The AI returned an unreadable sentiment result — try again");
    }
  },

  async translate(
    actorUserId: string,
    workspaceId: string,
    conversationId: string,
    input: { text: string; target: string },
  ): Promise<{ text: string }> {
    await requireWorkspacePermission(actorUserId, workspaceId, "conversations.reply");
    await loadThread(workspaceId, conversationId); // workspace/conversation check
    const text = await aiChat([
      { role: "system", content: SUPPORT_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Translate the following text into ${input.target}. Keep the tone and meaning. ` +
          `Output ONLY the translation.\n\n${input.text}`,
      },
    ], workspaceId);
    await logUsage(workspaceId, actorUserId, "translate");
    return { text };
  },
};
