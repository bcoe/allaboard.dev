export default function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-xl px-5 py-4">
      <div className={`text-3xl font-bold ${accent ?? "text-white"}`}>{value}</div>
      <div className="text-stone-300 text-sm font-medium mt-0.5">{label}</div>
      {sub && <div className="text-stone-500 text-xs mt-1">{sub}</div>}
    </div>
  );
}
