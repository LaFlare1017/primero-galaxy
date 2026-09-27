/**
 * One key inside a keyboard chip, in the Delegate console's monochrome
 * register: a hairline border, not a filled pill, because the chip that
 * holds it is already the emphasis. `<kbd>` rather than a span, so the key
 * is still a key for anything that reads the markup.
 *
 * Shared by the console's two keyboard surfaces — the armed-chord chip and
 * the shortcut sheet — because a legend that draws its own keys is a
 * legend that drifts from the one the facilitator just pressed.
 *
 * The spacing between caps is the caller's job, and it must be REAL
 * whitespace rather than flex `gap` alone: a gap is invisible to the text
 * content, so a chip assembled out of gaps alone reads as "gi" to a screen
 * reader and in the accessibility tree, while the same chip looks correct
 * to the eye.
 */
export function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-gray-400 bg-white px-1 align-middle font-sans text-[10px] leading-none text-black">
      {children}
    </kbd>
  );
}
