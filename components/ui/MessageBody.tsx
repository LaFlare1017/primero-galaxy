'use client';

import { Fragment } from 'react';

import { cn } from '@/lib/utils';

/**
 * Structured chat-message body, extracted from the Circle project's agent
 * chat (components/common/agent/agent-chat.tsx) and restyled for the
 * Delegate light/monochrome contract via the token layer (works in both
 * .delegate-light and the dark site chrome).
 *
 * Renders plain LLM/markdown-ish text as readable structure: "- " lines
 * become bullets, "1. " lines become numbered items, blank lines become
 * spacing, `code` and **bold** spans render inline. Replaces the plain
 * whitespace-pre-wrap blob the participant chat used previously.
 */
export function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code
              key={index}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <strong key={index} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

export function MessageBody({
  content,
  streaming,
  className,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
}) {
  const lines = content.split('\n');

  return (
    <div className={cn('text-sm leading-relaxed flex flex-col gap-1', className)}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (trimmed === '') return <span key={index} className="h-1.5" />;
        if (trimmed.startsWith('- ')) {
          return (
            <span key={index} className="flex gap-2">
              <span className="text-muted-foreground mt-[7px] size-1 rounded-full bg-muted-foreground shrink-0" />
              <span>
                <InlineText text={trimmed.slice(2)} />
              </span>
            </span>
          );
        }
        const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numbered) {
          return (
            <span key={index} className="flex gap-2">
              <span className="text-muted-foreground tabular-nums">{numbered[1]}.</span>
              <span>
                <InlineText text={numbered[2]} />
              </span>
            </span>
          );
        }
        return (
          <span key={index}>
            <InlineText text={trimmed} />
          </span>
        );
      })}
      {streaming && <span className="inline-block h-4 w-2 animate-pulse bg-foreground/60" />}
    </div>
  );
}
