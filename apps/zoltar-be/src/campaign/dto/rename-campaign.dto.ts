import { z } from 'zod';

export const RenameCampaignSchema = z.object({
  name: z.string().min(1).max(120),
});

export type RenameCampaignDto = z.infer<typeof RenameCampaignSchema>;
