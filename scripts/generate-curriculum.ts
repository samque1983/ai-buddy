/**
 * One-time content generation: builds the curated curriculum for each pack via
 * Claude, then bulk-inserts into curriculum_expressions (upsert on pack+english).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/generate-curriculum.ts [pack...]
 *
 * Re-runnable and idempotent (upsert). Review the printed table before trusting it.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const itemSchema = z.object({
  rank: z.number(),
  level: z.enum(['beginner', 'elementary', 'intermediate', 'advanced']),
  english: z.string(),
  chinese: z.string(),
  scenario: z.string(),
  formality: z.enum(['casual', 'neutral', 'formal']),
  example_sentence: z.string(),
  common_mistake: z.string(),
});
const listSchema = z.object({ items: z.array(itemSchema) });

const PACKS: Record<string, { count: number; prompt: string }> = {
  'daily-core': {
    count: 100,
    prompt: [
      'Produce the most useful everyday spoken-American-English expressions for Chinese learners.',
      'Rank them by real conversational FREQUENCY: rank 1 = the most common, must-know first.',
      'Cover casual daily life: reactions, opinions, plans, feelings, agreeing/declining, small talk, wrapping up.',
      'Level: beginner/elementary items should dominate the low ranks; harder idioms come later.',
      'Each: english (the expression), chinese (natural meaning), scenario (when to use, short), formality, example_sentence (natural, everyday), common_mistake (the awkward direct-translation a Chinese learner would say instead).',
      'These must be things real people actually say a lot — no rare idioms, no textbook stiffness.',
    ].join('\n'),
  },
  ielts: {
    count: 80,
    prompt: [
      'Produce high-value expressions and collocations for IELTS Speaking and Writing band improvement (target band 6-7.5).',
      'Rank by how much each lifts a typical candidate\'s band (rank 1 = highest payoff).',
      'Cover: opinion/argument framing, linking and cohesion, hedging, comparison, cause-effect, academic collocations, Speaking Part 2/3 fluency phrases.',
      'Level: mostly intermediate/advanced.',
      'Each: english (the phrase), chinese (meaning), scenario (which IELTS task/context), formality, example_sentence (band-7 style), common_mistake (a lower-band or Chinglish version to avoid).',
      'Prioritise phrases that examiners reward and that generalise across topics — not topic-specific vocab.',
    ].join('\n'),
  },
};

async function generatePack(client: Anthropic, pack: string): Promise<z.infer<typeof itemSchema>[]> {
  const { count, prompt } = PACKS[pack];
  const jsonSchema = z.toJSONSchema(listSchema, { target: 'draft-7' });
  const all: z.infer<typeof itemSchema>[] = [];
  // Generate in batches so each response stays complete and high quality.
  const batch = 25;
  for (let start = 1; start <= count; start += batch) {
    const end = Math.min(start + batch - 1, count);
    const res = await client.messages.create({
      model: process.env.LLM_MODEL ?? 'claude-sonnet-5',
      max_tokens: 8000,
      system: `You are an expert curriculum designer for a spoken-English app.\n${prompt}`,
      tools: [
        {
          name: 'curriculum',
          description: 'Return the curriculum items.',
          input_schema: jsonSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'curriculum' },
      messages: [
        {
          role: 'user',
          content: `Give me items ranked ${start} through ${end} for the "${pack}" pack. Continue the same ranked list; do not repeat earlier ranks. Return exactly ${end - start + 1} items with rank values ${start}..${end}.`,
        },
      ],
    });
    const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) throw new Error(`no tool_use for ${pack} ${start}-${end}`);
    const parsed = listSchema.parse(toolUse.input);
    all.push(...parsed.items);
    console.log(`  ${pack}: got ranks ${start}-${end} (${parsed.items.length})`);
  }
  // Dedupe by english, keep first (lowest rank), then renumber ranks 1..N.
  const seen = new Set<string>();
  const deduped = all
    .sort((a, b) => a.rank - b.rank)
    .filter((i) => {
      const k = i.english.toLowerCase().trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((i, idx) => ({ ...i, rank: idx + 1 }));
  return deduped;
}

async function upsert(pack: string, items: z.infer<typeof itemSchema>[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const rows = items.map((i) => ({ pack, ...i }));
  const res = await fetch(`${url}/rest/v1/curriculum_expressions?on_conflict=pack,english`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${pack} failed: ${res.status} ${await res.text()}`);
  console.log(`  ${pack}: upserted ${rows.length} rows`);
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const packs = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PACKS);
  for (const pack of packs) {
    if (!PACKS[pack]) throw new Error(`unknown pack: ${pack}`);
    console.log(`Generating ${pack}...`);
    const items = await generatePack(client, pack);
    console.log(`  ${pack}: ${items.length} unique items`);
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await upsert(pack, items);
    } else {
      console.log(JSON.stringify(items.slice(0, 3), null, 2), '\n(dry run — no DB env)');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
