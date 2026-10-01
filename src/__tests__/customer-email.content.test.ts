import { describe, it, expect } from 'vitest';
import {
  buildCustomerReplyEmailMessage,
  buildCustomerStatusChangedEmailMessage,
  buildCustomerTicketsUrl,
  escapeHtml,
  excerptBody,
  sanitizeSubjectComponent,
} from '@/lib/customer-notifications/email-content';

/**
 * Customer email rendering (Phase 9 Task 3).
 *
 * Two properties matter more than the wording:
 *
 *  - a raw ticket id never appears in an email, because emails outlive the
 *    session and get forwarded;
 *  - customer-controlled text cannot inject a header, because a `\r\n` in a
 *    subject is a header injection and a 10k-character title is a bounce.
 *
 * The second is only interesting with hostile input, which is why the inputs
 * below are hostile rather than realistic.
 */

const BASE_INPUT = {
  to: 'buyer@example.com',
  workspaceName: 'Acme Support',
  workspaceSlug: 'acme-support',
  baseUrl: 'http://localhost:3000',
  ticketId: 'clx1234567890abcdef',
  ticketTitle: 'Cannot log in',
};

describe('sanitizeSubjectComponent', () => {
  it('leaves ordinary text alone', () => {
    expect(sanitizeSubjectComponent('Acme Support')).toBe('Acme Support');
  });

  it('removes CRLF so a title cannot append a header', () => {
    const injected = sanitizeSubjectComponent('Hi\r\nBcc: attacker@evil.test\r\nSubject: pwned');

    expect(injected).not.toContain('\r');
    expect(injected).not.toContain('\n');
    expect(injected).toBe('Hi Bcc: attacker@evil.test Subject: pwned');
  });

  it('removes other control characters', () => {
    expect(sanitizeSubjectComponent('a\u0000b\u0007c\u007Fd')).toBe('a b c d');
  });

  it('collapses whitespace runs', () => {
    expect(sanitizeSubjectComponent('  too    many\t\tspaces  ')).toBe('too many spaces');
  });

  it('truncates rather than failing the send', () => {
    const long = sanitizeSubjectComponent('x'.repeat(500));

    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeSubjectComponent('')).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes every character that can break out of markup', () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });

  it('escapes ampersands before the entities it introduces', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('excerptBody', () => {
  it('keeps a short body intact', () => {
    expect(excerptBody('Short and useful.')).toBe('Short and useful.');
  });

  it('trims and normalizes line endings', () => {
    expect(excerptBody('  line one\r\nline two  ')).toBe('line one\nline two');
  });

  it('clips a long body on a word boundary', () => {
    const excerpt = excerptBody(`${'word '.repeat(200)}end`);

    expect(excerpt.length).toBeLessThanOrEqual(401);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toContain('wo…');
  });

  it('still clips when there is no word boundary to use', () => {
    const excerpt = excerptBody('x'.repeat(1000));

    expect(excerpt.length).toBeLessThanOrEqual(401);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('buildCustomerTicketsUrl', () => {
  it('builds the workspace tickets page', () => {
    expect(buildCustomerTicketsUrl('http://localhost:3000', 'acme-support')).toBe(
      'http://localhost:3000/portal/acme-support/tickets',
    );
  });

  it('does not double up slashes on a base url with a trailing slash', () => {
    expect(buildCustomerTicketsUrl('http://localhost:3000///', 'acme-support')).toBe(
      'http://localhost:3000/portal/acme-support/tickets',
    );
  });

  it('encodes a slug that would otherwise break the path', () => {
    expect(buildCustomerTicketsUrl('http://localhost:3000', 'a b/c')).toBe(
      'http://localhost:3000/portal/a%20b%2Fc/tickets',
    );
  });
});

describe('buildCustomerReplyEmailMessage', () => {
  it('addresses the customer and quotes the agent reply', () => {
    const message = buildCustomerReplyEmailMessage({
      ...BASE_INPUT,
      messageBody: 'We are looking into it.',
    });

    expect(message.to).toBe('buyer@example.com');
    expect(message.subject).toContain('New reply');
    expect(message.text).toContain('We are looking into it.');
    expect(message.text).toContain('http://localhost:3000/portal/acme-support/tickets');
    expect(message.html).toContain('We are looking into it.');
  });

  it('never puts the raw ticket id in the message', () => {
    const message = buildCustomerReplyEmailMessage({
      ...BASE_INPUT,
      messageBody: 'We are looking into it.',
    });

    expect(message.subject).not.toContain(BASE_INPUT.ticketId);
    expect(message.text).not.toContain(BASE_INPUT.ticketId);
    expect(message.html).not.toContain(BASE_INPUT.ticketId);
  });

  it('is not affected by a CRLF-injecting ticket title', () => {
    // The title only ever reaches the body, never a header. Asserting that
    // absence is stronger than asserting sanitization would be.
    const injected = buildCustomerReplyEmailMessage({
      ...BASE_INPUT,
      ticketTitle: 'Broken\r\nBcc: attacker@evil.test',
      messageBody: 'Any update?',
    });
    const ordinary = buildCustomerReplyEmailMessage({
      ...BASE_INPUT,
      ticketTitle: 'Cannot log in',
      messageBody: 'Any update?',
    });

    expect(injected.subject).toBe(ordinary.subject);
    expect(injected.subject).not.toContain('\n');
    expect(injected.subject).not.toContain('Bcc:');

    // The body may quote the title, but flattened to a single line.
    expect(injected.text).toContain('Broken Bcc: attacker@evil.test');
    expect(injected.text.split('\n').filter((line) => line.includes('Bcc:'))).toHaveLength(1);
  });

  it('escapes markup in the quoted reply', () => {
    const message = buildCustomerReplyEmailMessage({
      ...BASE_INPUT,
      messageBody: '<img src=x onerror=alert(1)>',
    });

    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
    // The plain-text part keeps the customer's characters verbatim.
    expect(message.text).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders a multi-line reply as line breaks in HTML', () => {
    const message = buildCustomerReplyEmailMessage({
      ...BASE_INPUT,
      messageBody: 'first line\nsecond line',
    });

    expect(message.html).toContain('first line<br />second line');
  });
});

describe('buildCustomerStatusChangedEmailMessage', () => {
  const base = {
    ...BASE_INPUT,
    fromStatus: 'open' as const,
    toStatus: 'in_progress' as const,
  };

  it('names the new status in customer vocabulary', () => {
    const message = buildCustomerStatusChangedEmailMessage(base);

    expect(message.subject).toContain('In progress');
    expect(message.text).toContain('is now In progress');
    expect(message.text).toContain('http://localhost:3000/portal/acme-support/tickets');
  });

  it('never puts the raw ticket id in the message', () => {
    const message = buildCustomerStatusChangedEmailMessage({ ...base, ticketId: 'clxdeadbeef0000000' });

    expect(message.subject).not.toContain('clxdeadbeef0000000');
    expect(message.text).not.toContain('clxdeadbeef0000000');
    expect(message.html).not.toContain('clxdeadbeef0000000');
  });

  it('is not affected by a CRLF-injecting ticket title', () => {
    const injected = buildCustomerStatusChangedEmailMessage({
      ...base,
      ticketTitle: 'Broken\r\nBcc: attacker@evil.test',
    });
    const ordinary = buildCustomerStatusChangedEmailMessage({ ...base, ticketTitle: 'Cannot log in' });

    expect(injected.subject).toBe(ordinary.subject);
    expect(injected.subject).not.toContain('\n');
    expect(injected.subject).not.toContain('Bcc:');
    expect(injected.text).toContain('Broken Bcc: attacker@evil.test');
  });

  it('escapes markup in the ticket title', () => {
    const message = buildCustomerStatusChangedEmailMessage({ ...base, ticketTitle: '<b>urgent</b>' });

    expect(message.html).toContain('&lt;b&gt;urgent&lt;/b&gt;');
    expect(message.html).not.toContain('<b>urgent</b>');
  });
});
