/** Iconos de trazo, geometricos y sin esquinas redondeadas. */
type Props = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
});

export const IconOverview = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M3 20h18M4 20V9l5-4 5 4v11M14 20V12h6v8" />
  </svg>
);

export const IconHoldings = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M3 20V4M3 20h18M7 16V9M12 16V6M17 16v-4" />
  </svg>
);

export const IconActivity = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M3 6h14M3 12h18M3 18h10M17 3l4 3-4 3M7 15l-4 3 4 3" />
  </svg>
);

export const IconInsights = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M3 17l6-7 4 4 8-9M15 5h6v6" />
  </svg>
);

export const IconPlus = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconSettings = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16M9 4v6M16 9v6M7 14v6" />
  </svg>
);

export const IconClose = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M5 5l14 14M19 5L5 19" />
  </svg>
);

export const IconRefresh = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
  </svg>
);

export const IconChevron = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const IconWarning = ({ size = 16, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3L1 21h22L12 3zM12 10v5M12 18h.01" />
  </svg>
);

export const IconTrash = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v7M14 11v7" />
  </svg>
);

export const IconEdit = ({ size = 18, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h4L20 8l-4-4L4 16v4zM14 6l4 4" />
  </svg>
);
