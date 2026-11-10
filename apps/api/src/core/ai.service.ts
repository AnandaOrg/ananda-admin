import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

const TONES = {
  friendly: 'warm and friendly, still professional',
  neutral: 'clear, polite and neutral',
  firm: 'firm and direct, still courteous',
} as const;
const LANGUAGES = { en: 'English', bg: 'Bulgarian', he: 'Hebrew' } as const;

/**
 * Optional "Polish with AI" for drafted e-mails (Ask supplier, Nudge, Invite agent).
 * Available only when ANTHROPIC_API_KEY (or another SDK credential) is configured.
 */
@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  private readonly client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  get enabled() {
    return this.client !== null;
  }

  async polish(text: string, tone: keyof typeof TONES, language: keyof typeof LANGUAGES): Promise<string> {
    if (!this.client) throw new ServiceUnavailableException({ message: 'AI polishing is not set up' });
    try {
      const response = await this.client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system:
          'You edit short business e-mails for a drinks distributor. Rewrite the e-mail you are given so it reads well, ' +
          'keeping every fact, figure, date, name, number and link exactly as written. Do not add new facts or promises. ' +
          'Reply with the rewritten e-mail text only, with no preamble.',
        messages: [{ role: 'user', content: `Tone: ${TONES[tone]}. Write it in ${LANGUAGES[language]}.\n\n<email>\n${text}\n</email>` }],
      });
      if (response.stop_reason === 'refusal') throw new ServiceUnavailableException({ message: 'The text could not be polished. Edit it by hand.' });
      const out = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
      return out || text;
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.log.warn(`Polish failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException({ message: 'AI polishing is not available right now. Edit the text by hand.' });
    }
  }
}
