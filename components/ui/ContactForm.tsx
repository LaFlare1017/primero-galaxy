'use client';
import { useState } from 'react';

/**
 * Gated contact form. The Primero address is deliberately never rendered
 * on the page: it is reassembled from parts only when someone actually
 * submits a request, which opens the visitor's mail client pre-filled.
 * This keeps the address off the page for crawlers and casual visitors.
 */
export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const inputClass =
    'w-full rounded-md border border-border-subtle bg-void/80 px-3 py-2.5 text-sm text-star-bright outline-none transition-colors placeholder:text-ui-muted/60 focus:border-star-dim';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    // Reassembled only at submit time so the address never appears verbatim
    // in the markup or the JS bundle (base64 keeps it out of plaintext).
    const recipient = atob('SG9kbGVyb25AZ21haWwuY29t');
    const subject = encodeURIComponent(
      `Primero Galaxy — contact from ${name.trim() || 'a visitor'}`
    );
    const body = encodeURIComponent(
      [
        message.trim(),
        '',
        `— ${name.trim() || 'Anonymous'}${email.trim() ? ` (${email.trim()})` : ''}`,
      ].join('\n')
    );
    window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border-subtle bg-void/60 p-6 text-left"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-label text-ui-muted">
            Your name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className={`${inputClass} mt-1.5`}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-label text-ui-muted">
            Your email
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className={`${inputClass} mt-1.5`}
          />
        </label>
      </div>
      <label className="mt-4 block">
        <span className="text-[11px] font-medium uppercase tracking-label text-ui-muted">
          Message
        </span>
        <textarea
          required
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us about your company and what you'd like to assess."
          className={`${inputClass} mt-1.5 resize-none`}
        />
      </label>
      <button
        type="submit"
        disabled={!message.trim()}
        className="mt-4 w-full rounded-md bg-maturity-high px-4 py-2.5 text-sm font-semibold text-void transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Send message
      </button>
      {sent && (
        <p className="mt-3 text-center text-[12px] text-maturity-high">
          Opening your email app — your message is ready to send.
        </p>
      )}
    </form>
  );
}
