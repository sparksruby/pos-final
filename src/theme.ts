// ─── Theme ────────────────────────────────────────────────────────────────────
// Dark + Light color palettes. Use `useTheme()` (src/context/ThemeContext) to
// get the active palette instead of importing a fixed palette directly.

export type ThemeColors = {
  bg:       string;
  surface:  string;
  card:     string;
  border:   string;

  accent:     string;
  accentFg:   string;
  accentSoft: string;   // tinted background for icon badges / soft highlights

  success:  string;
  danger:   string;
  dangerSoft: string;  // tinted background for error boxes / destructive badges
  info:     string;
  warning:  string;

  text:     string;
  textSub:  string;
  muted:    string;

  overlay:  string;
};

// Dark half of the green theme — the same family as lightColors below,
// not an inversion of it. bg/surface/card/border each step up in lightness
// so a card reads as sitting *on* the page and an input as sitting *in*
// the card, which is the whole job these four fields do.
//
// The ground is close to black rather than the washed charcoal it once
// was: with only a few percent between the page and the cards the layering
// barely showed. Dropping the page and lifting the card widens that gap
// without making either one louder.
//
// The neutrals carry a trace of green rather than being flat grey, so the
// page and the accent read as one palette instead of a green button
// dropped onto something else.
//
// accentFg stays dark-on-bright here. The accent has to be light enough to
// read as text against a near-black page (it is used for prices and links,
// not only for buttons), and at that lightness white lettering on top of
// it falls below a comfortable contrast while near-black is well clear.
export const darkColors: ThemeColors = {
  bg:       "#0B0F0D",
  surface:  "#141A17",
  card:     "#1C2420",
  border:   "#293430",

  accent:     "#22C55E",   // green
  accentFg:   "#08120C",
  accentSoft: "rgba(34,197,94,0.18)",

  success:  "#34D399",     // mint, a step off the accent's pure green so a "synced" tick is not mistaken for a button
  danger:   "#EF4444",
  dangerSoft: "rgba(239,68,68,0.16)",
  info:     "#60A5FA",     // blue — a status colour has to be told apart from the accent at a glance
  warning:  "#F5A524",

  text:     "#ECF3EE",
  textSub:  "#9FB0A6",
  muted:    "#6F8177",

  overlay:  "rgba(3,8,5,0.7)",
};

// Every screen reads colours exclusively through useTheme() (C.bg, C.card,
// ...), never a hardcoded palette import, so remapping this one object is
// what reskins the entire app in one place rather than needing a
// per-screen pass.
//
// The page is a quiet near-white with only a trace of green in it, and
// cards are pure white. It used to be the other way round — a saturated
// page under off-white cards — which left barely any separation between a
// card and the page behind it, so lists and forms read as one flat sheet
// of colour. The colour now lives in the accent, where it means something,
// instead of being spread across every pixel.
//
// `surface` is the raised card surface most content sits on; `card` fills
// the controls — inputs, chips, icon buttons — whether they sit inside a
// card or straight on the page, so it is a step darker than surface, not
// lighter. It has to stay clearly darker than `bg` as well: every screen's
// back button, the POS search box and the inventory filters are all drawn
// in it directly on the page, and at four percent apart from the page
// those all but vanished on a phone in daylight.
export const lightColors: ThemeColors = {
  bg:       "#F3F6F4",   // quiet near-white page
  surface:  "#FFFFFF",   // card surface
  card:     "#E3EAE6",   // inputs/chips — on the page or nested in a card
  border:   "#D2DCD7",

  // A deeper green than the dark theme's, because this one has to do two
  // jobs on a near-white page: carry white lettering on a filled button
  // AND be legible as text, which is what prices and links use it for.
  // The brighter #22C55E manages the first and fails the second.
  accent:     "#15803D",
  accentFg:   "#FFFFFF",
  accentSoft: "rgba(21,128,61,0.12)",

  success:  "#0E9F6E",     // emerald, a step off the accent's forest green
  danger:   "#DC2626",
  dangerSoft: "rgba(220,38,38,0.10)",
  info:     "#2563EB",
  warning:  "#D97706",

  text:     "#14201A",
  textSub:  "#4C5A52",
  muted:    "#81908A",

  overlay:  "rgba(10,20,15,0.45)",
};

// Tints a palette colour for use as a background behind itself — an icon
// tile behind its own icon, a badge behind its own label. Deriving the
// tint from the colour keeps the pair in step when the palette changes,
// instead of hand-mixing a second constant per colour per theme.
//
// Alpha rather than a blend, so the tint sits correctly on whichever
// surface it lands on. Anything that isn't a #RRGGBB literal (an rgba()
// token, say) is handed back untouched.
export const withAlpha = (color: string, alpha: number): string => {
  const hex = color.replace("#", "");
  if (hex.length !== 6 || /[^0-9A-Fa-f]/.test(hex)) return color;
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

export const F = {
  xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24,
} as const;

// Corner radii, a step softer than they were (6/10/14/20). Cards, buttons
// and inputs all round off from here, so this single bump is most of what
// separates the new look from the old one on screens whose colours barely
// changed.
export const R = {
  sm: 8, md: 12, lg: 16, xl: 22, full: 999,
} as const;

// Elevation presets — same values drive both iOS shadow props and Android
// `elevation`. Spread directly onto a style object: `[s.card, Shadow.sm]`.
//
// Cast in a deep green-black rather than pure black: a neutral shadow on
// the light theme's faintly green page grades through grey and reads as
// dirt around the card, while a shadow carrying the page's own hue reads
// as depth. The opacities are low to match — the light theme separates its
// cards by lightness against the page, so the shadow only has to hint at
// the lift instead of doing all the work.
const SHADOW_COLOR = "#0C1A12";

export const Shadow = {
  sm: {
    shadowColor: SHADOW_COLOR, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
  },
  md: {
    shadowColor: SHADOW_COLOR, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10, shadowRadius: 16, elevation: 5,
  },
  lg: {
    shadowColor: SHADOW_COLOR, shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14, shadowRadius: 28, elevation: 10,
  },
} as const;
