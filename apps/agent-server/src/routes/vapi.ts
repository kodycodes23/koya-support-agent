import type { FinalStatus } from "@koya/shared";
import { z } from "zod";

/** Vapi server messages Koya handles. Everything else is acknowledged and ignored. */
export const vapiServerMessageSchema = z.object({
  message: z
    .object({
      type: z.string(),
      status: z.string().optional(),
      endedReason: z.string().optional(),
      summary: z.string().optional(),
      analysis: z.object({ summary: z.string().optional(), successEvaluation: z.unknown().optional() }).loose().optional(),
      artifact: z.object({ transcript: z.string().optional(), recordingUrl: z.string().optional() }).loose().optional(),
      startedAt: z.string().optional(),
      endedAt: z.string().optional(),
      durationSeconds: z.number().optional(),
      cost: z.number().optional(),
      call: z.object({ id: z.string(), customer: z.object({ number: z.string().optional() }).loose().optional() }).loose().optional(),
    })
    .loose(),
});

export type VapiServerMessage = z.infer<typeof vapiServerMessageSchema>["message"];

/** Maps Vapi's endedReason onto our final_status (escalation/ticket outcomes are layered on later). */
export function statusFromEndedReason(reason: string | undefined): FinalStatus {
  if (!reason) return "completed";
  if (/error|failed|fault|timeout-exceeded|pipeline/i.test(reason)) return "error";
  if (/did-not-answer|busy|voicemail|no-answer|did-not-give-microphone/i.test(reason)) return "abandoned";
  return "completed";
}
