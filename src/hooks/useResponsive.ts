import { useWindowDimensions } from "react-native";

// Shortest-side breakpoint used by most tablet detection heuristics.
const TABLET_MIN_WIDTH = 600;

export interface Responsive {
  width:            number;
  height:           number;
  isPortrait:       boolean;
  isLandscape:      boolean;
  isTablet:         boolean;
  isPhone:          boolean;
  /** Phone held upright — product grid/cart must stack instead of sitting side by side. */
  isCompact:        boolean;
  gridColumns:      number;
}

export const useResponsive = (): Responsive => {
  const { width, height } = useWindowDimensions();
  const isPortrait  = height >= width;
  const isLandscape = !isPortrait;
  const shortSide   = Math.min(width, height);
  const isTablet    = shortSide >= TABLET_MIN_WIDTH;
  const isPhone     = !isTablet;
  const isCompact   = isPhone && isPortrait;

  const gridColumns = isTablet ? (isLandscape ? 4 : 3) : (isLandscape ? 4 : 2);

  return { width, height, isPortrait, isLandscape, isTablet, isPhone, isCompact, gridColumns };
};
