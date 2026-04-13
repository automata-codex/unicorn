import { z } from 'zod';

export const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(120),
  visibility: z.enum(['private', 'invite', 'org']).default('private'),
  diceMode: z
    .enum(['soft_accountability', 'commitment'])
    .default('soft_accountability'),
});

export type CreateCampaignDto = z.infer<typeof CreateCampaignSchema>;
