import type { Job } from "bullmq";

import { processKnowledgeDocument } from "@/services/knowledge-document.service";
import type { KnowledgeJobData } from "@/types/queue";

/**
 * Knowledge processor — extracts text from an uploaded knowledge
 * document (PDF/DOCX/TXT/Markdown/JSON) and settles its row as READY
 * or FAILED. All logic lives in the service so tests can call it the
 * same way the worker does.
 */
export async function processKnowledgeJob(job: Job<KnowledgeJobData>): Promise<void> {
  await processKnowledgeDocument(job.data.documentId);
}
