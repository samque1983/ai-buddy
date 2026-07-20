/**
 * One-time script: generate character voice preview MP3s via OpenAI TTS.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-xxx npx tsx scripts/generate-voice-previews.ts
 *
 * Writes public/audio/previews/<slug>.mp3 and prints the SQL to set
 * preview_audio_url on each character row.
 */
import fs from 'node:fs';
import path from 'node:path';

const CHARACTERS = [
  {
    slug: 'emma',
    voice: 'nova',
    text: "Hi there! I'm Emma. Don't worry about making mistakes with me — that's how we learn. We'll just chat, take it slow, and have a good time. I can't wait to hear about your day!",
  },
  {
    slug: 'jake',
    voice: 'echo',
    text: "Hey, what's up? I'm Jake. Look, English isn't about being perfect — it's about hanging out and saying stuff. We'll joke around, talk about whatever, and you'll pick things up without even noticing. Sound good?",
  },
  {
    slug: 'sophia',
    voice: 'alloy',
    text: "Hello, I'm Sophia. I really enjoy good conversations — work, films, technology, ideas. I'll help you shape your thoughts into clear, natural English, one sentence at a time. So — what have you been thinking about lately?",
  },
  {
    slug: 'leo',
    voice: 'fable',
    text: "Hey hey! Leo here. Ready to level up? I like to keep things moving — quick questions, fun little challenges, full sentences. You bring the energy, I'll bring the games. Let's see what you've got!",
  },
];

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is required');
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), 'public', 'audio', 'previews');
  fs.mkdirSync(outDir, { recursive: true });

  for (const c of CHARACTERS) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.TTS_MODEL ?? 'tts-1',
        voice: c.voice,
        input: c.text,
        response_format: 'mp3',
      }),
    });
    if (!res.ok) {
      throw new Error(`TTS failed for ${c.slug}: ${res.status} ${await res.text()}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const file = path.join(outDir, `${c.slug}.mp3`);
    fs.writeFileSync(file, buffer);
    console.log(`wrote ${file} (${(buffer.length / 1024).toFixed(0)} KB)`);
  }

  console.log('\nRun this SQL to point characters at the generated previews:\n');
  for (const c of CHARACTERS) {
    console.log(
      `update public.characters set preview_audio_url = '/audio/previews/${c.slug}.mp3' where slug = '${c.slug}';`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
