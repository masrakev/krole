/** Marque géométrique minimale « k » (monochrome, currentColor). */
export function KMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 4 V20" />
      <path d="M17 9 L10 14 L17 20" />
    </svg>
  );
}

/** Logo krole : mark dans une pastille à filet + wordmark bas-de-casse. */
export function Logo({
  showWordmark = true,
  className = "",
}: {
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-surface-2">
        <KMark className="h-4 w-4 text-fg" />
      </span>
      {showWordmark && (
        <span className="text-[15px] font-medium tracking-tight text-fg">
          krole
        </span>
      )}
    </span>
  );
}
