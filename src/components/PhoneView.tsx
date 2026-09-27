import { useState, useEffect } from 'react';
import {
  Cast,
  Gamepad2,
  Tv,
  Radio,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Layers,
  PowerOff,
  Maximize2
} from 'lucide-react';
import {
  externalDisplayService,
  isNativeAndroid,
  type DisplayInfo
} from '../services/externalDisplay';
import { ControllerPad } from './ControllerPad';
import { TvPresentationView } from './TvPresentationView';

interface LogEntry {
  timestamp: string;
  event: string;
  details: string;
}

export function PhoneView() {
  const [activeTab, setActiveTab] = useState<'connection' | 'control'>('connection');
  const [connectedDisplay, setConnectedDisplay] = useState<DisplayInfo | null>(null);
  const [isOpeningSelection, setIsOpeningSelection] = useState(false);
  const [systemActionReported, setSystemActionReported] = useState<string | null>(null);
  const [eventLogs, setEventLogs] = useState<LogEntry[]>([]);
  const [showTvPreviewInDev, setShowTvPreviewInDev] = useState(false);
  const [isFullscreenController, setIsFullscreenController] = useState(false);

  const addLog = (event: string, details: string) => {
    const timeStr = new Date().toLocaleTimeString('ar-SA', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    setEventLogs(prev => [{ timestamp: timeStr, event, details }, ...prev.slice(0, 19)]);
  };

  useEffect(() => {
    // Initial check on load
    externalDisplayService.getConnectedDisplay().then(result => {
      if (result.isConnected && result.display) {
        setConnectedDisplay(result.display);
        addLog('الفحص الأولي', `تم العثور على شاشة عرض متصلة بالمعرّف ${result.display.displayId}`);
      } else {
        addLog('الفحص الأولي', 'لا توجد شاشة عرض ثانوية متصلة حالياً');
      }
    });

    // Real DisplayManager Event Listeners
    let handles: any[] = [];

    const setupListeners = async () => {
      const h1 = await externalDisplayService.addListener('externalDisplayConnected', (display: DisplayInfo) => {
        setConnectedDisplay(display);
        addLog(
          'اتصال شاشة أندرويد',
          `تم توصيل الشاشة "${display.name}" (معرّف ${display.displayId}) بدقة ${display.width}×${display.height}`
        );
      });

      const h2 = await externalDisplayService.addListener('externalDisplayDisconnected', (data: { displayId: number }) => {
        setConnectedDisplay(null);
        addLog('فصل شاشة أندرويد', `تم فصل الشاشة رقم ${data.displayId}`);
      });

      const h3 = await externalDisplayService.addListener('externalDisplayChanged', (display: DisplayInfo) => {
        setConnectedDisplay(display);
        addLog('تحديث الشاشة', `تم تحديث بيانات الشاشة رقم ${display.displayId}`);
      });

      const h4 = await externalDisplayService.addListener('displayAdded', (display: DisplayInfo) => {
        addLog('إضافة شاشة', `اكتشف النظام شاشة جديدة معرّف ${display.displayId} (${display.name})`);
      });

      const h5 = await externalDisplayService.addListener('displayRemoved', (data: { displayId: number }) => {
        addLog('إزالة شاشة', `أزال النظام الشاشة رقم ${data.displayId}`);
      });

      handles = [h1, h2, h3, h4, h5];
    };

    setupListeners();

    return () => {
      handles.forEach(h => h.remove?.());
    };
  }, []);

  const handleOpenDisplaySelection = async () => {
    setIsOpeningSelection(true);
    setSystemActionReported(null);
    try {
      const result = await externalDisplayService.openDisplaySelection();
      setSystemActionReported(result.action);
      addLog('فتح قائمة النظام', result.action);
    } catch (err: any) {
      addLog('خطأ في الاتصال', err?.message || 'تعذر فتح قائمة اختيار الشاشة');
    } finally {
      setIsOpeningSelection(false);
    }
  };

  const handleDismissPresentation = async () => {
    try {
      await externalDisplayService.dismissPresentation();
      setConnectedDisplay(null);
      addLog('إغلاق العرض', 'تم إنهاء واجهة العرض على الشاشة بطلب المستخدم');
    } catch (err: any) {
      addLog('خطأ في الإغلاق', err?.message || 'تعذر إنهاء العرض');
    }
  };

  const toggleFullscreenController = () => {
    const nextState = !isFullscreenController;
    setIsFullscreenController(nextState);

    // Try requesting device fullscreen if available
    if (typeof document !== 'undefined') {
      if (nextState) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    }
  };

  const isConnectedToTv = !!connectedDisplay;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans max-w-md mx-auto border-x border-slate-900 shadow-2xl" dir="rtl">
      {/* Top Application Header */}
      <header className="px-5 py-4 border-b border-slate-900 bg-slate-950/90 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-orange-500 border border-amber-400/40 flex items-center justify-center text-white shadow-lg shadow-orange-600/30">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                طريق الغروب السريع
              </h1>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>يد تحكم الهاتف</span>
                <span aria-hidden="true">·</span>
                <span className={isConnectedToTv ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                  {isConnectedToTv ? 'التلفاز متصل' : 'التلفاز غير متصل'}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Status Light */}
          <div
            className={`w-3.5 h-3.5 rounded-full ${
              isConnectedToTv
                ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)] animate-pulse'
                : 'bg-slate-700'
            }`}
            title={isConnectedToTv ? 'متصل بشاشة العرض التقديمي للتلفاز' : 'في انتظار الاتصال'}
          />
        </div>

        {/* Function Navigation Tabs */}
        <div className="mt-4 grid grid-cols-2 p-1 bg-slate-900/90 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('connection')}
            className={`flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'connection'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cast className="w-3.5 h-3.5" />
            <span>الاتصال</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('control')}
            className={`flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'control'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>يد التحكم</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 overflow-y-auto space-y-4">
        {/* TAB 1: CONNECTION AREA (REAL TV CONNECTION) */}
        {activeTab === 'connection' && (
          <div className="space-y-4">
            {/* REAL TV CONNECTION CARD (ORIGINAL, UNTOUCHED LOGIC) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-xs uppercase tracking-wider text-slate-400">
                    حالة الشاشة الخارجية
                  </span>
                  <h2 className="text-lg font-bold text-white mt-1">
                    {isConnectedToTv ? 'العرض المباشر نشط' : 'في وضع الاستعداد / غير متصل'}
                  </h2>
                </div>
                <div
                  className={`p-2.5 rounded-xl border ${
                    isConnectedToTv
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-slate-800/80 border-slate-700 text-slate-400'
                  }`}
                >
                  <Tv className="w-5 h-5" />
                </div>
              </div>

              {/* Real Display Information Reported by Android */}
              {isConnectedToTv && connectedDisplay ? (
                <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>تم التحقق عبر نظام أندرويد (DisplayManager)</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-900">
                    <div>
                      <span className="text-slate-500 block">اسم الشاشة</span>
                      <span className="text-white font-semibold truncate block">
                        {connectedDisplay.name || `شاشة #${connectedDisplay.displayId}`}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">معرّف الشاشة</span>
                      <span className="text-slate-200 font-mono">#{connectedDisplay.displayId}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">الدقة</span>
                      <span className="text-slate-200 font-mono">
                        {connectedDisplay.width} × {connectedDisplay.height}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">معدل التحديث</span>
                      <span className="text-slate-200 font-mono">
                        {Math.round(connectedDisplay.refreshRate || 60)} هرتز
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleDismissPresentation}
                    className="mt-3 w-full py-2 px-3 rounded-lg border border-rose-900/50 bg-rose-950/20 hover:bg-rose-950/40 text-rose-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span>إنهاء العرض على التلفاز</span>
                  </button>
                </div>
              ) : (
                <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 text-xs text-slate-400 space-y-2">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Radio className="w-4 h-4 text-amber-400 animate-pulse" />
                    <span className="font-medium">مستشعر شاشات أندرويد نشط</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    اضغط على الزر أدناه لفتح شاشة اختيار الشاشة الأصلية في نظام أندرويد / سامسونج (بث الشاشة / Smart View).
                    عند اتصال شاشة خارجية لاسلكية أو سلكية، سيعرض التطبيق لعبة طريق الغروب السريع عليها تلقائياً.
                  </p>
                </div>
              )}

              {/* The Real Native Connection Button */}
              <button
                type="button"
                onClick={handleOpenDisplaySelection}
                disabled={isOpeningSelection}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 active:scale-95 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-orange-600/25 transition-all disabled:opacity-50"
              >
                <Cast className="w-4 h-4" />
                <span>
                  {isOpeningSelection
                    ? 'جارٍ فتح قائمة النظام...'
                    : 'اتصال بشاشة خارجية / بث الشاشة'}
                </span>
              </button>

              {systemActionReported && (
                <div className="rounded-lg bg-indigo-950/30 border border-indigo-900/50 p-2.5 text-xs text-indigo-300 font-mono flex items-start gap-2">
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    <span className="block text-[11px] text-slate-400">الإجراء المنفذ في النظام:</span>
                    <span className="break-all">{systemActionReported}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Architecture Explanatory Notice */}
            <div className="rounded-2xl border border-slate-900 bg-slate-900/30 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span>طريقة العرض المباشر</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                عند الاتصال بالتلفاز عبر بث الشاشة أو الكيبل، تظهر كابينة القيادة ثلاثية الأبعاد على التلفاز بدقة كاملة، ويبقى هاتفك يد تحكم سريعة الاستجابة.
              </p>
            </div>

            {/* Real-time DisplayManager Lifecycle Event Log */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-semibold">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  سجل أحداث النظام
                </span>
                <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  {isNativeAndroid() ? 'تطبيق أندرويد الأصلي' : 'معاينة ويب'}
                </span>
              </div>

              <div className="bg-slate-950 rounded-xl border border-slate-900 p-3 max-h-40 overflow-y-auto space-y-1.5 text-xs">
                {eventLogs.length > 0 ? (
                  eventLogs.map((log, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <span className="text-slate-500 font-mono shrink-0">{log.timestamp}</span>
                      <span className="text-amber-400 shrink-0 font-medium">[{log.event}]</span>
                      <span className="text-slate-300 break-all">{log.details}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-slate-600">لم يتم تسجيل أية أحداث بعد.</span>
                )}
              </div>
            </div>

            {/* Web Preview TV Interface Inspection (For UI Verification in browser) */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-slate-200">معاينة واجهة العرض على التلفاز</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    معاينة واجهة التلفاز المستقلة المعروضة على الشاشة الثانوية.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTvPreviewInDev(!showTvPreviewInDev)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  {showTvPreviewInDev ? 'إخفاء إطار التلفاز' : 'إظهار إطار التلفاز'}
                </button>
              </div>

              {showTvPreviewInDev && (
                <div className="pt-2 border-t border-slate-800">
                  <div className="rounded-xl border border-amber-500/40 overflow-hidden shadow-2xl bg-slate-950">
                    <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[10px] font-mono text-amber-300 flex items-center justify-between">
                      <span>محاكاة الشاشة الثانوية (طريق الغروب السريع)</span>
                      <span>mode=tv</span>
                    </div>
                    <div className="scale-75 origin-top-left w-[133.33%] -mb-[25%] pointer-events-auto">
                      <TvPresentationView initialDisplay={connectedDisplay} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: GAMEPAD CONTROLLER */}
        {activeTab === 'control' && (
          <div className="space-y-4">
            {/* Controller Status Header */}
            <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-amber-400 font-semibold uppercase tracking-wider block">
                  وضع يد التحكم
                </span>
                <span className="text-xs text-slate-300">
                  {isConnectedToTv
                    ? `جارٍ الإرسال إلى: ${connectedDisplay?.name || 'شاشة التلفاز'}`
                    : 'جارٍ إرسال الأوامر (في وضع الاستعداد)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowTvPreviewInDev(!showTvPreviewInDev)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-300 border border-slate-700 transition-colors"
                >
                  {showTvPreviewInDev ? 'إخفاء الشاشة' : 'عرض الشاشة'}
                </button>
                <div
                  className={`px-2 py-1 rounded text-[10px] font-medium ${
                    isConnectedToTv
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isConnectedToTv ? 'متصل بالتلفاز' : 'غير مقترن'}
                </div>
              </div>
            </div>

            {/* Live TV Screen Mini-Monitor above controller */}
            {showTvPreviewInDev && (
              <div className="rounded-2xl border-2 border-amber-500/40 overflow-hidden shadow-2xl bg-slate-950">
                <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] font-mono text-amber-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Tv className="w-3.5 h-3.5 text-amber-400" />
                    <span>شاشة العرض المباشر (TV Live Screen)</span>
                  </span>
                  <span className="text-emerald-400">طريق الغروب السريع</span>
                </div>
                <div className="w-full aspect-video relative overflow-hidden bg-slate-950">
                  <div className="w-full h-full scale-100">
                    <TvPresentationView initialDisplay={connectedDisplay} />
                  </div>
                </div>
              </div>
            )}

            {/* Prominent Fullscreen Toggle Banner */}
            <div className="p-3 rounded-2xl bg-gradient-to-r from-amber-950/40 to-slate-900 border border-amber-500/30 flex items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <Maximize2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white">ملء الشاشة ليد التحكم</h3>
                  <p className="text-[11px] text-slate-400">
                    تمدد الكنترولر ليملأ الشاشة لتجربة قيادة مريحة باليدين.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleFullscreenController}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 text-white font-semibold text-xs shrink-0 shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>ملء الشاشة</span>
              </button>
            </div>

            {/* Virtual Gamepad Controller Embedded */}
            <div className="bg-slate-900/30 rounded-2xl border border-slate-800/80 p-2">
              <ControllerPad
                isFullscreen={false}
                onToggleFullscreen={toggleFullscreenController}
                connectedDisplayName={connectedDisplay?.name}
                playerTitle="يد تحكم طريق الغروب"
              />
            </div>
          </div>
        )}
      </main>

      {/* Fullscreen Overlay Component if activated */}
      {isFullscreenController && (
        <ControllerPad
          isFullscreen={true}
          onToggleFullscreen={toggleFullscreenController}
          connectedDisplayName={connectedDisplay?.name}
          playerTitle="يد تحكم طريق الغروب"
        />
      )}

      {/* Footer System Indicator */}
      <footer className="px-5 py-3 border-t border-slate-900 bg-slate-950 text-center text-xs text-slate-500">
        طريق الغروب السريع · نظام أندرويد DisplayManager
      </footer>
    </div>
  );
}
