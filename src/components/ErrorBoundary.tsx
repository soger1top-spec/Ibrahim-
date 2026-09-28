import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home, Sparkles } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  onGoHome?: () => void;
  onEnableLowQuality?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleEnableLowQuality = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onEnableLowQuality) {
      this.props.onEnableLowQuality();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="fixed inset-0 w-full h-full bg-slate-950 text-white flex items-center justify-center p-6 text-center select-none z-[9999]"
          dir="rtl"
        >
          <div className="max-w-md w-full bg-slate-900 border-2 border-rose-500/50 rounded-3xl p-8 shadow-2xl space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 mx-auto shadow-lg shadow-rose-950/40">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white">
                {this.props.fallbackTitle || 'حدث خطأ في عرض الشاشة'}
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                قد يكون معالج الرسوميات (WebGL) في هذا الجهاز بحاجة لتفعيل وضع الجودة الخفيفة لمنع الشاشة البيضاء.
              </p>
            </div>

            {/* Error Message Snippet */}
            {this.state.error && (
              <div className="p-3 bg-slate-950 border border-rose-900/60 rounded-xl text-left font-mono text-[11px] text-rose-300 overflow-x-auto max-h-24">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleEnableLowQuality}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold text-sm shadow-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
              >
                <Sparkles className="w-4 h-4" />
                <span>تشغيل بالوضع الخفيف للتلفاز (آمن وبدون تعليق)</span>
              </button>

              <button
                type="button"
                onClick={this.handleReset}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-cyan-400" />
                <span>إعادة المحاولة فوراً</span>
              </button>

              {this.props.onGoHome && (
                <button
                  type="button"
                  onClick={this.props.onGoHome}
                  className="w-full py-2.5 px-4 rounded-xl bg-transparent hover:bg-slate-800/60 border border-slate-700 text-slate-400 text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Home className="w-3.5 h-3.5" />
                  <span>العودة للقائمة الرئيسية</span>
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
