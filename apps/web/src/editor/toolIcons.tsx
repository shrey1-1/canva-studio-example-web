import {
  BookOpen,
  Braces,
  Cloud,
  LayoutGrid,
  MonitorSmartphone,
  MoveRight,
  Puzzle,
  Smartphone,
  Sparkles,
  Spline,
  SprayCan,
  Sticker,
  StretchHorizontal,
  WavesHorizontal,
  type LucideIcon,
} from 'lucide-react';

/** Explicit map (not a dynamic import of every icon) keeps the bundle small. */
const ICONS: Record<string, LucideIcon> = {
  spline: Spline,
  'layout-grid': LayoutGrid,
  smartphone: Smartphone,
  'move-right': MoveRight,
  'book-open': BookOpen,
  sticker: Sticker,
  braces: Braces,
  'monitor-smartphone': MonitorSmartphone,
  sparkles: Sparkles,
  'stretch-horizontal': StretchHorizontal,
  'waves-horizontal': WavesHorizontal,
  'spray-can': SprayCan,
  cloud: Cloud,
};

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Puzzle;
}
