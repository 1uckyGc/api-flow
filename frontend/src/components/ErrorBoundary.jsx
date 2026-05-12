import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }
  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex items-center justify-center min-h-full h-full p-8" style={{ background: 'var(--surface-0)' }}>
        <div className="max-w-2xl w-full rounded-lg p-6" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle size={20} className="text-red-400" />
            <h2 className="text-lg font-bold text-red-400">页面渲染出错</h2>
          </div>
          <p className="text-sm mb-3 font-mono break-words" style={{ color: 'var(--text-secondary)' }}>
            {this.state.error?.message || '未知错误'}
          </p>
          {this.state.errorInfo?.componentStack && (
            <details className="mb-3">
              <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>展开堆栈</summary>
              <pre className="text-[10px] mt-2 overflow-auto max-h-60 p-2 rounded" style={{ background: 'rgba(0,0,0,0.3)', color: 'var(--text-secondary)' }}>{this.state.errorInfo.componentStack}</pre>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="px-4 py-2 rounded text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)' }}
            >
              <RefreshCw size={14} className="inline mr-1" /> 重试当前页
            </button>
            <button
              onClick={() => location.reload()}
              className="px-4 py-2 rounded text-sm"
              style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
            >
              刷新整页
            </button>
          </div>
        </div>
      </div>
    );
  }
}
