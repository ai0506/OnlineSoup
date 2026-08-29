type IconProps = {
  className?: string;
};

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconHome({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function IconBook({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M12 6.5C10.5 5.2 8.6 4.5 6 4.5H4v13h2c2.6 0 4.5.7 6 2" />
      <path d="M12 6.5c1.5-1.3 3.4-2 6-2h2v13h-2c-2.6 0-4.5.7-6 2z" />
    </svg>
  );
}

export function IconPlusSquare({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 9v6M9 12h6" />
    </svg>
  );
}

export function IconDoor({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3 20.5h18" />
      <path d="M6.5 20.5V5A1.5 1.5 0 0 1 8 3.5h8A1.5 1.5 0 0 1 17.5 5v15.5" />
      <path d="M14 11.8v.9" />
    </svg>
  );
}

export function IconMessage({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M20 14a2 2 0 0 1-2 2H9l-4 3.5V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconCoins({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9.5 10a2.5 2.5 0 0 1 2.5-2 2.5 2.5 0 0 1 0 4 2.5 2.5 0 0 0 0 4 2.5 2.5 0 0 0 2.5-2" />
    </svg>
  );
}

export function IconUser({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c.8-3.2 3.5-5 7-5s6.2 1.8 7 5" />
    </svg>
  );
}

export function IconLogOut({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M14 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" />
      <path d="M17 15.5 20.5 12 17 8.5M20.5 12H10" />
    </svg>
  );
}

export function IconLogIn({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M10 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7" />
      <path d="M9.5 8.5 13 12l-3.5 3.5M3 12h10" />
    </svg>
  );
}
