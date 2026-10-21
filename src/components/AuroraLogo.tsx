/**
 * The Aurora logo, drawn inline so it follows the app's accent colour.
 *
 * The original /aurora.svg hard-codes the old lime green, and a CSS
 * variable cannot reach inside an <img>. This inline version paints the
 * wave with the accent and derives the softer strokes from it, so the
 * logo keeps its layered look in every accent colour and both themes.
 */
export function AuroraLogo({ size = 108, className }: { size?: number; className?: string }) {
  return <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 108 108"
    role="img"
    aria-label="Aurora Music"
    className={className}
  >
    <path fill="#0b0d0b" d="M54,4 C82,4 104,26 104,54 C104,82 82,104 54,104 C26,104 4,82 4,54 C4,26 26,4 54,4 Z" />
    <path fill="#121712" d="M54,10 C78.3,10 98,29.7 98,54 C98,78.3 78.3,98 54,98 C29.7,98 10,78.3 10,54 C10,29.7 29.7,10 54,10 Z" />
    <path fill="none" d="M29,78 C39,63 48,44 55,25 C62,44 71,63 81,78" stroke="var(--accent, #fa233b)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    <path fill="none" d="M39,62 C47,59 55,58 63,60 C67,61 71,63 75,65" stroke="color-mix(in srgb, var(--accent, #fa233b) 66%, white)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path fill="none" d="M39,76 L48,76 L54,68 L60,83 L67,72 L76,72" stroke="color-mix(in srgb, var(--accent, #fa233b) 38%, white)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    <path fill="var(--accent, #fa233b)" d="M55,24 m-3.2,0 a3.2,3.2 0 1,0 6.4,0 a3.2,3.2 0 1,0 -6.4,0" />
  </svg>;
}
