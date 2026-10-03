import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Target, Award, Star } from 'lucide-react';
import { cn } from '../../../core/utils';
import { useThemeStore } from '../../../lib/themeStore';

interface PerformanceGaugeProps {
  value: number;
  target: number;
  title?: string;
  /**
   * مُنسِّق مبالغ اختياري لعرض المحقق/الهدف بالعملة (مثل formatCurrency)
   * بدلاً من أرقام مجردة مضللة في سياق مالي.
   */
  formatValue?: (value: number) => string;
  className?: string;
}

const PerformanceGauge: React.FC<PerformanceGaugeProps> = ({
  value,
  target,
  title = 'أداء المبيعات',
  formatValue,
  className,
}) => {
  const { theme } = useThemeStore();
  const isDark = theme === 'dark';
  const [isMounted, setIsMounted] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const displayValue = formatValue ? formatValue(value) : value.toLocaleString('en-US');
  const displayTarget = formatValue ? formatValue(target) : target.toLocaleString('en-US');
  const displayRemaining = formatValue
    ? formatValue(target - value)
    : (target - value).toLocaleString('en-US');

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // قياس واحد فقط (بلا استطلاع دوري) ثم مراقبة التغيّر — يمنع إعادة التخطيط القسري المتكرر.
    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      setIsMounted(true);
      return;
    }

    if (typeof ResizeObserver === 'undefined') {
      setIsMounted(true);
      return;
    }

    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setIsMounted(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const percentage = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const remaining = 100 - percentage;

  // Determine color based on performance
  const getColor = () => {
    if (percentage >= 80) return '#10b981'; // emerald
    if (percentage >= 60) return '#3b82f6'; // blue
    if (percentage >= 40) return '#f59e0b'; // amber
    return '#ef4444'; // red
  };

  const color = getColor();

  const data = [
    { value: percentage, color },
    { value: remaining, color: '#e2e8f0' },
  ];

  const getStatus = () => {
    if (percentage >= 80) return { label: 'ممتاز', icon: Award, color: 'text-emerald-500' };
    if (percentage >= 60) return { label: 'جيد جداً', icon: Star, color: 'text-blue-500' };
    if (percentage >= 40) return { label: 'جيد', icon: Target, color: 'text-amber-500' };
    return { label: 'يحتاج تحسين', icon: Target, color: 'text-rose-500' };
  };

  const status = getStatus();

  // If no data, show empty state
  if (value === 0 && target === 0) {
    return (
      <div
        className={cn(
          'bg-[var(--app-surface)]/80 flex h-64 items-center justify-center rounded-2xl border border-[var(--app-border)] p-5 backdrop-blur-xl max-md:rounded-xl max-md:p-3',
          className
        )}
      >
        <div className="text-center">
          <Target size={32} className="mx-auto mb-2 text-[var(--app-text-secondary)]" />
          <p className="text-sm font-bold text-[var(--app-text-secondary)]">لا توجد بيانات</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-[var(--app-surface)]/80 group relative overflow-hidden rounded-2xl border border-[var(--app-border)] p-5 backdrop-blur-xl max-md:rounded-xl max-md:p-3',
        className
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between max-md:mb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2">
            <Target size={16} className="text-blue-400" />
          </div>
          <h3 className="text-sm font-bold text-[var(--app-text)]">{title}</h3>
        </div>
        <div className={cn('flex items-center gap-1', status.color)}>
          <status.icon size={14} />
          <span className="text-[10px] font-bold">{status.label}</span>
        </div>
      </div>

      {/* Gauge Chart */}
      <div ref={containerRef} className="group relative h-40 min-h-[160px] overflow-hidden">
        {/* Subtle outer glow */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-4 h-24 bg-[length:100%_100%] bg-no-repeat opacity-20 transition-opacity duration-700 group-hover:opacity-40"
          style={{
            backgroundImage: `radial-gradient(ellipse at bottom, ${color} 0%, transparent 70%)`,
          }}
        />

        {isMounted ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={120}>
            <PieChart>
              <defs>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow
                    dx="0"
                    dy="0"
                    stdDeviation="4"
                    floodColor={color}
                    floodOpacity="0.4"
                  />
                </filter>
                <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={color} stopOpacity={0.7} />
                  <stop offset="100%" stopColor={color} stopOpacity={1} />
                </linearGradient>
              </defs>
              <Pie
                data={data}
                cx="50%"
                cy="75%"
                startAngle={180}
                endAngle={0}
                innerRadius={65}
                outerRadius={85}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
                cornerRadius={8}
              >
                {data.map((_entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={index === 0 ? 'url(#gaugeGradient)' : isDark ? '#334155' : '#e2e8f0'}
                    filter={index === 0 ? 'url(#glow)' : undefined}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full animate-pulse rounded-2xl bg-slate-50/50 dark:bg-slate-800/10 max-md:rounded-xl" />
        )}

        {/* Center Text */}
        <div className="absolute inset-0 flex items-center justify-center pt-10">
          <div className="text-center">
            <p
              className="font-mono text-4xl font-bold tracking-tighter text-[var(--app-text)] max-md:text-2xl"
              style={{ textShadow: `0 2px 10px ${color}30` }}
            >
              {percentage.toFixed(0)}%
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--app-text-secondary)]">
              من الهدف
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 max-md:mt-3">
        <div className="rounded-xl border border-white/5 bg-white/5 p-2 text-center">
          <p className="text-[10px] font-bold uppercase text-[var(--app-text-secondary)]">المحقق</p>
          <p className="font-mono text-sm font-bold text-[var(--app-text)]">{displayValue}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/5 p-2 text-center">
          <p className="text-[10px] font-bold uppercase text-[var(--app-text-secondary)]">الهدف</p>
          <p className="font-mono text-sm font-bold text-[var(--app-text)]">{displayTarget}</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${percentage}%`, backgroundColor: color }}
          />
        </div>
        <p className="mt-1 text-center text-[10px] font-medium text-[var(--app-text-secondary)]">
          متبقي {displayRemaining} للوصول للهدف
        </p>
      </div>
    </div>
  );
};

export default PerformanceGauge;
