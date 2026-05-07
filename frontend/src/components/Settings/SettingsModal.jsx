import React, { useEffect, useState } from 'react';
import { X, Save, ScrollText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useSettingsStore from '../../stores/useSettingsStore';

export default function SettingsModal() {
  const { isOpen, closeModal, settings, loading, fetchSettings, updateSettings } = useSettingsStore();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && !settings) {
      fetchSettings();
    }
  }, [isOpen, settings, fetchSettings]);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (type === 'number' ? Number(value) : value)
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await updateSettings(formData);
    setSaving(false);
    closeModal();
  };

  const inputStyle = {
    background: 'var(--surface-0)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center transition-opacity"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh] slide-up"
        style={{
          background: 'var(--surface-2)',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--border-subtle)',
        }}>
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 className="text-lg font-display font-bold flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}>
            系统全局设置
          </h2>
          <button
            onClick={closeModal}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--surface-4)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-tertiary)';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar"
          style={{ background: 'var(--surface-1)' }}>
          {loading ? (
            <div className="text-center py-10 flex flex-col items-center"
              style={{ color: 'var(--text-tertiary)' }}>
              <span className="animate-spin text-3xl mb-3">⟳</span>
              <p>加载配置中...</p>
            </div>
          ) : (
            <form id="settings-form" onSubmit={handleSubmit} className="space-y-6">

              {/* Section: Task scheduling */}
              <section className="rounded-xl p-5"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold mb-4 pl-2"
                  style={{ color: 'var(--text-primary)', borderLeft: '3px solid var(--accent)' }}>
                  调度与并发策略
                </h3>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold mb-1"
                      style={{ color: 'var(--text-secondary)' }}>延迟时间 (毫秒)</label>
                    <input type="number" name="submission_delay_ms" value={formData.submission_delay_ms || 2000}
                      onChange={handleChange} min={0} step={500}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-all"
                      style={inputStyle}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      每个并发请求之间的强制等待时间（削峰）。
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1"
                      style={{ color: 'var(--text-secondary)' }}>失败重试次数</label>
                    <input type="number" name="max_retries" value={formData.max_retries || 3}
                      onChange={handleChange} min={0} max={10}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-all"
                      style={inputStyle}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      API 报错时自动重新入队的次数。
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1"
                      style={{ color: 'var(--text-secondary)' }}>去尾冗余帧数</label>
                    <input type="number" name="trim_tail_frames" value={formData.trim_tail_frames || 9}
                      onChange={handleChange} min={0} max={60}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-all"
                      style={inputStyle}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      针对延长等功能首尾衔接，自动丢弃尾部退化帧。
                    </p>
                  </div>
                </div>
              </section>

              {/* Section: Monitoring */}
              <section className="rounded-xl p-5"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold mb-4 pl-2"
                  style={{ color: 'var(--text-primary)', borderLeft: '3px solid #f59e0b' }}>
                  系统监控
                </h3>
                <button
                  type="button"
                  onClick={() => { closeModal(); navigate('/logs'); }}
                  className="w-full flex items-center justify-between rounded-lg px-4 py-3 transition-all text-sm font-semibold"
                  style={{
                    background: 'var(--surface-0)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                >
                  <span className="flex items-center gap-2">
                    <ScrollText size={16} style={{ color: 'var(--accent)' }} />
                    调用日志与账单
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                </button>
                <p className="text-[10px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
                  查看本地调用审计、HOLO 余额与官方账单流水。
                </p>
              </section>

              {/* Section: Storage */}
              <section className="rounded-xl p-5"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold mb-4 pl-2"
                  style={{ color: 'var(--text-primary)', borderLeft: '3px solid var(--success)' }}>
                  存储清理策略
                </h3>
                <div className="grid grid-cols-2 gap-5">
                  <div className="flex flex-col justify-center gap-1">
                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer"
                      style={{ color: 'var(--text-primary)' }}>
                      <input type="checkbox" name="auto_cleanup_failed_tasks"
                        checked={formData.auto_cleanup_failed_tasks ?? false}
                        onChange={handleChange}
                        className="w-4 h-4 rounded cursor-pointer"
                        style={{ accentColor: 'var(--success)' }}
                      />
                      自动清理失败任务源文件
                    </label>
                    <p className="text-[10px] ml-6" style={{ color: 'var(--text-tertiary)' }}>
                      如果任务执行失败，直接抹除残缺缓存节约磁盘。
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1"
                      style={{ color: 'var(--text-secondary)' }}>原文件保留天数</label>
                    <input type="number" name="source_file_retention_days"
                      value={formData.source_file_retention_days || 30}
                      onChange={handleChange} min={1}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none transition-all"
                      style={inputStyle}
                      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
                    />
                  </div>
                </div>
              </section>

            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex justify-end gap-3"
          style={{
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--surface-2)',
          }}>
          <button
            type="button"
            onClick={closeModal}
            className="px-5 py-2 text-sm font-semibold rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-4)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            取消
          </button>
          <button
            type="submit"
            form="settings-form"
            disabled={saving || loading}
            className="px-6 py-2 text-sm font-semibold text-white rounded-lg transition-all flex items-center gap-2 disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
              boxShadow: '0 4px 16px rgba(99, 102, 241, 0.25)',
            }}
          >
            <Save size={14} /> {saving ? '保存中...' : '保存全局配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
