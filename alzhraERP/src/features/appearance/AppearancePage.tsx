import React, { useState, useMemo } from 'react';
import {
  Palette,
  Crown,
  Droplets,
  Type,
  Wand2,
  Save,
  RotateCcw,
  Sparkles,
  Filter,
} from 'lucide-react';
import { useThemeStore } from '../../lib/themeStore';
import { THEME_PRESETS, THEME_CATEGORIES } from './constants';
import ThemePresetCard from './components/ThemePresetCard';
import ModeSelector from './components/ModeSelector';
import type { AppearanceTab, ThemeMode } from './types';
import { useFeedbackStore } from '../feedback/store';
import MicroHeader from '../../ui/base/MicroHeader';
import ColorCustomizer from './components/ColorCustomizer';
import FontSelector from './components/FontSelector';
import EffectsCustomizer from './components/EffectsCustomizer';
import { cn } from '../../core/utils';

type CategoryFilter =
  | 'all'
  | 'premium'
  | 'automotive'
  | 'glass'
  | 'bento'
  | 'royal'
  | 'accounting'
  | 'beige'
  | 'classic'
  | 'nature'
  | 'bold'
  | 'corporate'
  | 'night'
  | 'seasonal'
  | 'artistic'
  | 'industry';

const AppearancePage: React.FC = () => {
  const {
    mode,
    setMode,
    activePresetId,
    setPreset,
    draftSettings,
    accentColor,
    font,
    radius,
    fontSize,
    shadowStrength,
    glassBlur,
    glassOpacity,
    saveAppearanceSettings,
    revertAppearanceSettings,
  } = useThemeStore();

  const [activeTab, setActiveTab] = useState<AppearanceTab>('premium');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const { showToast } = useFeedbackStore();

  const hasUnsavedChanges = useMemo(
    () =>
      draftSettings.accentColor !== accentColor ||
      draftSettings.font !== font ||
      draftSettings.radius !== radius ||
      draftSettings.fontSize !== fontSize ||
      draftSettings.shadowStrength !== shadowStrength ||
      draftSettings.glassBlur !== glassBlur ||
      draftSettings.glassOpacity !== glassOpacity,
    [draftSettings, accentColor, font, radius, fontSize, shadowStrength, glassBlur, glassOpacity]
  );

  const handleSave = () => {
    saveAppearanceSettings();
    showToast('تم حفظ إعدادات المظهر بنجاح!', 'success');
  };

  const handleRevert = () => {
    revertAppearanceSettings();
    showToast('تم التراجع عن التغييرات غير المحفوظة', 'info');
  };

  const handlePresetSelect = (id: string) => {
    setPreset(id);
    showToast('تم تطبيق النمط المختار ✨', 'success');
  };

  const handleModeChange = (newMode: ThemeMode) => {
    setMode(newMode);
    const modeName = newMode === 'light' ? 'النهاري' : newMode === 'dark' ? 'الليلي' : 'التلقائي';
    showToast(`تم التبديل إلى الوضع ${modeName}`, 'info');
  };

  // فلترة الثيمات بناءً على الوضع والتصنيف
  const filteredPresets = useMemo(() => {
    let presets = THEME_PRESETS;

    // Filter by light/dark mode
    if (mode !== 'system') {
      presets = presets.filter(p => {
        // الثيمات الاحترافية التي تدعم الوضعين معاً تظهر دائماً
        if (p.light && p.dark) return true;
        // الثيمات الكلاسيكية تظهر بناءً على وضعها المحدد
        return p.isDark === (mode === 'dark');
      });
    }

    // Filter by category
    if (categoryFilter !== 'all') {
      presets = presets.filter(p => p.category === categoryFilter);
    }

    return presets;
  }, [mode, categoryFilter]);

  // Group presets by category for display
  const groupedPresets = useMemo(() => {
    if (categoryFilter !== 'all') return null; // Don't group when a specific category is selected

    const groups: Array<{ category: string; presets: typeof THEME_PRESETS }> = [];
    const categories = [
      'premium',
      'automotive',
      'glass',
      'bento',
      'royal',
      'accounting',
      'beige',
      'classic',
      'nature',
      'bold',
      'corporate',
      'night',
      'seasonal',
      'artistic',
      'industry',
    ] as const;

    for (const cat of categories) {
      const catPresets = filteredPresets.filter(p => p.category === cat);
      if (catPresets.length > 0) {
        groups.push({ category: cat, presets: catPresets });
      }
    }
    return groups;
  }, [filteredPresets, categoryFilter]);

  const TABS = [
    { id: 'premium', label: 'الأنماط الرسمية', icon: Crown },
    { id: 'colors', label: 'الألوان المخصصة', icon: Droplets },
    { id: 'fonts', label: 'الخطوط', icon: Type },
    { id: 'effects', label: 'التأثيرات', icon: Wand2 },
  ];

  const CATEGORY_FILTERS: Array<{ id: CategoryFilter; label: string; emoji: string }> = [
    { id: 'all', label: 'الكل', emoji: '🎨' },
    { id: 'premium', label: 'باقات برو ✨', emoji: '✨' },
    { id: 'automotive', label: 'قطع غيار 🏎️', emoji: '🏎️' },
    { id: 'glass', label: 'زجاجي ✨', emoji: '🪟' },
    { id: 'bento', label: 'بينتو 🍱', emoji: '🍱' },
    { id: 'royal', label: 'ملكي فاخر', emoji: '👑' },
    { id: 'accounting', label: 'محاسبي', emoji: '📊' },
    { id: 'beige', label: 'بيج ودافئ', emoji: '🏜️' },
    { id: 'classic', label: 'كلاسيكي', emoji: '🏛️' },
    { id: 'nature', label: 'طبيعي', emoji: '🌿' },
    { id: 'bold', label: 'جريء', emoji: '🔥' },
    { id: 'corporate', label: 'شركة', emoji: '🏢' },
    { id: 'night', label: 'ليلي', emoji: '🌙' },
    { id: 'seasonal', label: 'موسمي', emoji: '🌸' },
    { id: 'artistic', label: 'فني', emoji: '🎨' },
    { id: 'industry', label: 'قطاعي', emoji: '🏭' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'premium':
        return (
          <div className="animate-in fade-in space-y-6 duration-500">
            {/* Category Filter Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <Filter size={14} className="text-gray-400" />
              {CATEGORY_FILTERS.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setCategoryFilter(cat.id);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-all duration-300 md:px-4 md:py-2 md:text-xs',
                    categoryFilter === cat.id
                      ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                      : 'border-gray-100 bg-[var(--app-surface)] text-gray-500 hover:border-blue-200 dark:border-slate-800 dark:text-slate-400 dark:hover:border-blue-800'
                  )}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>

            {/* Grouped or Flat Grid */}
            {categoryFilter === 'all' && groupedPresets ? (
              // Grouped by category
              groupedPresets.map(group => {
                const catInfo = THEME_CATEGORIES[group.category as keyof typeof THEME_CATEGORIES];
                return (
                  <div key={group.category} className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-base md:text-lg">{catInfo.emoji}</span>
                      <div>
                        <h3 className="text-[11px] font-bold text-gray-700 dark:text-slate-200 md:text-sm">
                          {catInfo.label}
                        </h3>
                        <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 md:text-[10px]">
                          {catInfo.description}
                        </p>
                      </div>
                      <div className="mr-2 flex-1 border-t border-gray-100 dark:border-slate-800" />
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-3">
                      {group.presets.map(preset => (
                        <ThemePresetCard
                          key={preset.id}
                          preset={preset}
                          isActive={activePresetId === preset.id}
                          onSelect={handlePresetSelect}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              // Flat grid when filtered
              <>
                <div className="flex items-center gap-2 px-1">
                  <Sparkles size={14} className="text-blue-500" />
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 md:text-sm">
                    {filteredPresets.length} نمط متوفر
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-3">
                  {filteredPresets.map(preset => (
                    <ThemePresetCard
                      key={preset.id}
                      preset={preset}
                      isActive={activePresetId === preset.id}
                      onSelect={handlePresetSelect}
                    />
                  ))}
                </div>
              </>
            )}

            {filteredPresets.length === 0 && (
              <div className="py-12 text-center">
                <span className="text-4xl">🎨</span>
                <p className="mt-3 text-sm font-bold text-gray-400 dark:text-slate-500">
                  لا توجد أنماط لهذا التصنيف في الوضع الحالي
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-900/20 dark:bg-blue-900/10 md:rounded-[2rem] md:p-5">
              <p className="text-center text-[10px] font-bold leading-relaxed text-blue-800 dark:text-blue-300 md:text-xs">
                💡 تم تصميم هذه الأنماط خصيصاً لتوفير أفضل تجربة مستخدم لنظام "الجعفري". يمكنك
                التعديل يدوياً على الألوان والخطوط من التبويبات الأخرى.
              </p>
            </div>
          </div>
        );
      case 'colors':
        return <ColorCustomizer />;
      case 'fonts':
        return <FontSelector />;
      case 'effects':
        return <EffectsCustomizer />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-50 dark:bg-slate-950">
      <MicroHeader
        title="تخصيص هوية النظام"
        icon={Palette}
        iconColor="text-blue-500"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={id => {
          setActiveTab(id as AppearanceTab);
        }}
      />

      <div className="custom-scrollbar flex-1 overflow-y-auto p-4 pb-24 md:p-6">
        <div className="mx-auto max-w-none space-y-6 md:space-y-8">
          <div className="rounded-2xl border-2 border-gray-100 bg-[var(--app-surface)] p-4 shadow-sm dark:border-slate-800 md:rounded-[2.5rem] md:p-6">
            <div className="mb-3 flex items-center gap-2 px-1 md:mb-4">
              <span className="h-4 w-1.5 rounded-full bg-blue-600"></span>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 md:text-sm">
                نمط العرض الافتراضي
              </h3>
            </div>
            <ModeSelector activeMode={mode} onChange={handleModeChange} />
          </div>

          {renderContent()}
        </div>
      </div>

      {/* Unsaved Changes Bar */}
      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 z-50 px-4 transition-transform duration-500',
          hasUnsavedChanges ? 'translate-y-[-1.5rem]' : 'translate-y-full'
        )}
      >
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl ring-1 ring-blue-500/20 backdrop-blur-2xl md:rounded-[2.5rem] md:p-4">
            <div className="flex items-center gap-3 pr-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500"></div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white md:text-xs">
                تعديلات غير محفوظة
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRevert}
                className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-tighter text-white transition-all hover:bg-white/10 md:rounded-2xl md:px-5 md:py-2.5"
              >
                <RotateCcw size={14} /> تراجع
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2 text-[10px] font-bold uppercase tracking-tighter text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700 md:rounded-2xl md:px-8 md:py-2.5"
              >
                <Save size={14} /> حفظ الإعدادات
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppearancePage;
