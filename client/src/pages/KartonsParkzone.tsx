/**
 * Kartons & Parkzone — calendar overview.
 *
 * Shows, per day, which customers need moving boxes ("Kartons") delivered
 * and/or a parking zone ("Parkzone") set up on that date. Each entry has a
 * red pulsing dot while it's not yet done ("Karton geliefert?" / "Parkzone
 * geliefert?" is empty or "Nein"), and turns green once marked "Ja".
 *
 * This data already exists per order inside `servicesJson`
 * (kartonDelivery, kartonGeliefert, parkzoneDatum, parkzoneGeliefert) — this
 * page just aggregates it across all orders into a monthly calendar.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { ChevronLeft, ChevronRight, Package, ParkingSquare, MapPin } from "lucide-react";

type DayEvent = {
  moveId: number;
  customerName: string;
  kundenummer: string;
  address: string;
  kind: "karton" | "parkzone";
  done: boolean;
  umzugskartons?: string;
  kleiderkartons?: string;
};

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// kartonDelivery is a datetime-local string ("2026-07-29T10:00"),
// parkzoneDatum is a plain date string ("2026-07-29") — normalize both to
// just the date part so they can be grouped by day.
function extractDateKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const datePart = raw.split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return datePart;
}

export default function KartonsParkzone() {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string>(toDateKey(today));

  const movesQuery = trpc.moves.list.useQuery();
  const moves = (movesQuery.data ?? []) as any[];

  // Build a map of dateKey -> events, parsed once per fetch.
  const eventsByDay = useMemo(() => {
    const map: Record<string, DayEvent[]> = {};
    for (const m of moves) {
      if (!m.servicesJson) continue;
      let sj: any;
      try {
        sj = JSON.parse(m.servicesJson);
      } catch {
        continue;
      }
      const customerName = m.customerName || "—";
      const kundenummer = m.kundenummer || "";
      const address = m.pickupAddress || m.deliveryAddress || "—";

      const kartonKey = extractDateKey(sj.kartonDelivery || sj.deliveryDate);
      if (kartonKey) {
        (map[kartonKey] ??= []).push({
          moveId: m.id,
          customerName,
          kundenummer,
          address,
          kind: "karton",
          done: sj.kartonGeliefert === "Ja",
          umzugskartons: sj.umzugskartons,
          kleiderkartons: sj.kleiderkartons,
        });
      }

      const parkzoneKey = extractDateKey(sj.parkzoneDatum || sj.datumParkzone);
      if (parkzoneKey) {
        (map[parkzoneKey] ??= []).push({
          moveId: m.id,
          customerName,
          kundenummer,
          address,
          kind: "parkzone",
          done: sj.parkzoneGeliefert === "Ja",
        });
      }
    }
    return map;
  }, [moves]);

  // Build the grid for the visible month (Mon-start weeks).
  const grid = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // 0 = Monday
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewDate]);

  const selectedEvents = eventsByDay[selectedDay] || [];
  const selectedKartons = selectedEvents.filter((e) => e.kind === "karton");
  const selectedParkzones = selectedEvents.filter((e) => e.kind === "parkzone");

  const goToMonth = (delta: number) => {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const Dot = ({ done }: { done: boolean }) => (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        done ? "bg-green-500" : "bg-red-500 animate-pulse"
      }`}
    />
  );

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a4d6d]">Kartons & Parkzone</h1>
          <p className="text-sm text-gray-500">
            Übersicht: wer heute Kartons oder eine Parkzone braucht — rot pulsierend = noch nicht erledigt, grün = erledigt.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6">
          {/* Calendar */}
          <div className="bg-white rounded-2xl border border-[#1a4d6d]/10 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => goToMonth(-1)}
                className="p-2 rounded-lg hover:bg-gray-100 text-[#1a4d6d]"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="font-semibold text-[#1a4d6d]">
                {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
              </span>
              <button
                onClick={() => goToMonth(1)}
                className="p-2 rounded-lg hover:bg-gray-100 text-[#1a4d6d]"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500 mb-2">
              {WEEKDAYS.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {grid.map((date, i) => {
                if (!date) return <div key={i} className="h-16" />;
                const key = toDateKey(date);
                const events = eventsByDay[key] || [];
                const hasKarton = events.some((e) => e.kind === "karton");
                const hasParkzone = events.some((e) => e.kind === "parkzone");
                const allDone = events.length > 0 && events.every((e) => e.done);
                const isSelected = key === selectedDay;
                const isToday = key === toDateKey(today);

                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDay(key)}
                    className={`h-16 rounded-lg border flex flex-col items-center justify-start pt-1 text-sm transition-colors ${
                      isSelected
                        ? "border-[#d97e3a] bg-[#fff2e8]"
                        : isToday
                        ? "border-[#1a4d6d]/40 bg-[#eaf2f7]"
                        : "border-gray-100 hover:bg-gray-50"
                    }`}
                  >
                    <span className={isToday ? "font-bold text-[#1a4d6d]" : "text-gray-700"}>
                      {date.getDate()}
                    </span>
                    {(hasKarton || hasParkzone) && (
                      <div className="flex items-center gap-1 mt-1">
                        {hasKarton && (
                          <span className="flex items-center gap-0.5">
                            <Package size={11} className="text-gray-400" />
                            <Dot done={events.filter((e) => e.kind === "karton").every((e) => e.done)} />
                          </span>
                        )}
                        {hasParkzone && (
                          <span className="flex items-center gap-0.5">
                            <ParkingSquare size={11} className="text-gray-400" />
                            <Dot done={events.filter((e) => e.kind === "parkzone").every((e) => e.done)} />
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Dot done={false} /> noch nicht erledigt</span>
              <span className="flex items-center gap-1"><Dot done={true} /> erledigt</span>
            </div>
          </div>

          {/* Selected day list */}
          <div className="bg-white rounded-2xl border border-[#1a4d6d]/10 shadow-sm p-5">
            <h2 className="font-semibold text-[#1a4d6d] mb-1">
              {new Date(selectedDay).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              {selectedEvents.length === 0 ? "Keine Kartons oder Parkzonen an diesem Tag." : `${selectedEvents.length} Eintrag/Einträge`}
            </p>

            {selectedKartons.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                  <Package size={13} /> Kartons
                </p>
                <div className="space-y-2">
                  {selectedKartons.map((e, idx) => (
                    <a
                      key={idx}
                      href={`/orders?open=${e.moveId}`}
                      className="block rounded-lg border border-gray-100 p-3 hover:bg-gray-50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm text-[#1a4d6d]">{e.customerName}</span>
                        <Dot done={e.done} />
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <MapPin size={11} /> {e.address}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Umzugskartons: {e.umzugskartons || "0"} · Kleiderkartons: {e.kleiderkartons || "0"} · {e.kundenummer}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {selectedParkzones.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                  <ParkingSquare size={13} /> Parkzone
                </p>
                <div className="space-y-2">
                  {selectedParkzones.map((e, idx) => (
                    <a
                      key={idx}
                      href={`/orders?open=${e.moveId}`}
                      className="block rounded-lg border border-gray-100 p-3 hover:bg-gray-50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm text-[#1a4d6d]">{e.customerName}</span>
                        <Dot done={e.done} />
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <MapPin size={11} /> {e.address}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{e.kundenummer}</div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
