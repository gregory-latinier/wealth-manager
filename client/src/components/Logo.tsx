/** The app mark, same drawing as public/favicon.svg. Decorative: the name always sits next to it. */
export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden focusable="false">
      <defs>
        <linearGradient id="wm-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3987e5" />
          <stop offset="1" stopColor="#1a5aa8" />
        </linearGradient>
        <linearGradient id="wm-logo-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#wm-logo-bg)" />
      <path d="M110 348 L196 280 L262 316 L342 214 L402 168 L402 392 L110 392 Z" fill="url(#wm-logo-area)" />
      <path d="M110 348 L196 280 L262 316 L342 214 L402 168" fill="none" stroke="#fff" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="402" cy="168" r="30" fill="#fff" />
      <circle cx="402" cy="168" r="14" fill="#2a78d6" />
    </svg>
  )
}
