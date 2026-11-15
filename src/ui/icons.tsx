/**
 * Icons, drawn from Lucide (one stroke, one weight). Only the icons listed
 * here end up in the bundle.
 */
import {
  Accessibility,
  ArrowUpDown,
  BedDouble,
  Bike,
  Bookmark,
  BusFront,
  CableCar,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  CornerUpRight,
  ExternalLink,
  Footprints,
  HardDriveDownload,
  History,
  type IconNode,
  Info,
  Landmark,
  Layers,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Martini,
  Mountain,
  Phone,
  Pill,
  Plane,
  Radio,
  RefreshCw,
  Scooter,
  Search,
  Settings,
  Share2,
  Ship,
  ShoppingCart,
  TrainFront,
  TrainFrontTunnel,
  TramFront,
  Trash2,
  TriangleAlert,
  Utensils,
  WifiOff,
  X,
} from "lucide";
import type { Vehicle } from "../providers/types";

const ICONS = {
  restaurant: Utensils,
  cafe: Coffee,
  bar: Martini,
  grocery: ShoppingCart,
  pharmacy: Pill,
  hotel: BedDouble,
  museum: Landmark,
  search: Search,
  close: X,
  back: ChevronLeft,
  next: ChevronRight,
  down: ChevronDown,
  locate: LocateFixed,
  layers: Layers,
  directions: CornerUpRight,
  swap: ArrowUpDown,
  save: Bookmark,
  share: Share2,
  external: ExternalLink,
  settings: Settings,
  clock: Clock,
  recent: History,
  pin: MapPin,
  info: Info,
  alert: TriangleAlert,
  live: Radio,
  refresh: RefreshCw,
  check: Check,
  spinner: LoaderCircle,
  offline: WifiOff,
  keep: HardDriveDownload,
  trash: Trash2,
  phone: Phone,
  climb: Mountain,
  stepfree: Accessibility,
  foot: Footprints,
  bike: Bike,
  scooter: Scooter,
  car: Car,
  bus: BusFront,
  tram: TramFront,
  subway: TrainFrontTunnel,
  rail: TrainFront,
  ferry: Ship,
  cable: CableCar,
  plane: Plane,
  other: BusFront,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/** The icon of a vehicle: every `Vehicle` has one of the same name. */
export function vehicleIcon(v: Vehicle): IconName {
  return v;
}

export function Icon({
  name,
  size = 20,
  class: cls,
}: {
  name: IconName;
  size?: number;
  class?: string;
}) {
  return (
    <svg
      class={cls ? `icon ${cls}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {ICONS[name].map(([tag, attrs], i) => {
        const Tag = tag as "path";
        return <Tag key={i} {...(attrs as Record<string, string>)} />;
      })}
    </svg>
  );
}
