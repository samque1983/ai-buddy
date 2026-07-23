import { describe, it, expect } from 'vitest';
import { explanationLanguage, globalRules } from '@/lib/prompts/modules';

describe('globalRules — must not contradict the bilingual explanation setting', () => {
  const g = globalRules();

  it('does not hard-restrict Chinese to "only if the user is clearly lost"', () => {
    // This Core rule ran first and overrode the bilingual instruction, so the
    // model spoke English only. It must defer to the Explanation language section.
    expect(g).not.toContain('clearly lost');
  });

  it('points the model to the Explanation language section for how much Chinese to use', () => {
    expect(g).toContain('Explanation language');
  });
});

describe('explanationLanguage — bilingual (default)', () => {
  const p = explanationLanguage('bilingual');

  it('makes speaking the explanation in Chinese a hard requirement, not optional', () => {
    // The old prompt allowed Chinese only as a single optional clause, so the
    // model kept dropping it and learners heard English only. Bilingual must now
    // require the Chinese explanation.
    expect(p).toMatch(/MUST|必须/);
    expect(p.toLowerCase()).toContain('chinese');
  });

  it('tells the model to actually say the explanation in Chinese', () => {
    expect(p.toLowerCase()).toMatch(/say .*in chinese|explanation in chinese|in chinese as well|also .*chinese/);
  });

  it('does NOT keep the old one-clause-only restriction that caused Chinese to be skipped', () => {
    expect(p).not.toContain('ONLY for the "why"');
    expect(p).not.toContain('never a paragraph');
  });

  it('still keeps the English model sentence + practice in English', () => {
    expect(p.toLowerCase()).toContain('english');
  });

  it('forbids announcing the language switch ("中文意思是"...) — just switch', () => {
    // Live feedback: the model prefixed every Chinese line with "中文意思是",
    // which is pure filler in a voice conversation.
    expect(p).toContain('中文意思是');
    expect(p.toLowerCase()).toMatch(/never announce|do not announce|without announcing/);
  });
});

describe('explanationLanguage — english', () => {
  const p = explanationLanguage('english');

  it('stays English-only and does not force Chinese', () => {
    expect(p).toContain('ENGLISH ONLY');
    expect(p).not.toMatch(/必须.*中文/);
  });
});
