import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchLogs, fetchLogDetail, fetchHoloTransactions, fetchProvidersSummary } from '../api/logs';
import useAuthStore from '../stores/useAuthStore';

const PROVIDER_LABEL = { holo: 'HOLO', flow2api: 'Flow2API', grok: 'Grok', dreamina: '即梦', 'packyapi-gemini': 'PackyAPI' };
const PROVIDER_ACCENT = {
  holo: '#6366f1',
  'packyapi-gemini': '#10b981',
  dreamina: '#f43f5e',
  flow2api: '#0ea5e9',
  grok: '#a855f7',
};
const STATUS_COLOR = {
  completed: '#10b981',
  failed: '#ef4444',
  submitted: '#f59e0b',
  cancelled: '#6b7280',
};

function StatusPill({ status, refunded }) {
  const color = STATUS_COLOR[status] || 'var(--text-tertiary)';
  return (
    <span style={{
      color, fontWeight: 600, fontSize: 11,
      padding: '2px 8px', borderRadius: 6,
      background: `${color}1a`, border: `1px solid ${color}33`,
    }}>
      {status}{refunded ? ' · refunded' : ''}
    </span>
  );
}

function ProviderTag({ p }) {
  const colors = { holo: '#6366f1', flow2api: '#0ea5e9', grok: '#a855f7' };
  const c = colors[p] || '#888';
  return (
    <span style={{
      color: c, fontWeight: 600, fontSize: 11,
      padding: '2px 8px', borderRadius: 6,
      background: `${c}1a`, border: `1px solid ${c}55`,
    }}>{PROVIDER_LABEL[p] || p}</span>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div style={{
      flex: 1,
      padding: '12px 16px',
      background: 'var(--surface-2)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function fmtNum(v) {
  if (v == null) return '—';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }
  return String(v);
}

function ProviderCard({ p }) {
  const accent = PROVIDER_ACCENT[p.provider] || '#888';
  const icon = p.online
    ? <CheckCircle2 size={14} style={{ color: '#10b981' }} />
    : <AlertCircle size={14} style={{ color: '#ef4444' }} />;

  return (
    <div style={{
      flex: 1,
      minWidth: 240,
      padding: 14,
      background: 'var(--surface-2)',
      border: `1px solid var(--border-subtle)`,
      borderTop: `3px solid ${accent}`,
      borderRadius: 12,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
        {icon}
        {p.label}
      </div>

      {!p.online && (
        <div style={{ fontSize: 11, color: '#ef4444', wordBreak: 'break-word' }}>
          {p.error || '不可用'}
        </div>
      )}

      {p.online && p.primary && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{p.primary.label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
            {fmtNum(p.primary.value)}
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 6, fontWeight: 500 }}>
              {p.primary.unit}
            </span>
          </div>
        </div>
      )}

      {p.online && p.metrics && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px 12px',
          paddingTop: 8,
          borderTop: '1px dashed var(--border-subtle)',
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}>
          {Object.entries(p.metrics)
            .filter(([k, v]) => v != null && v !== '' && k !== 'note')
            .slice(0, 8)
            .map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110, textAlign: 'right' }} title={String(v)}>
                  {Array.isArray(v) ? v.join('/') : fmtNum(v)}
                </span>
              </div>
            ))}
          {p.metrics.note && (
            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 4 }}>
              ⓘ {p.metrics.note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export default function Logs() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const isAdmin = !!user?.is_admin;

  const [tab, setTab] = useState('local');  // 'local' | 'holo'
  const [providers, setProviders] = useState([]);
  const [providersErr, setProvidersErr] = useState(null);
  const [providersFetchedAt, setProvidersFetchedAt] = useState(null);

  // ── 多 provider 余额聚合（仅 admin，30s 轮询）——
  const loadProviders = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await fetchProvidersSummary();
      setProviders(data?.providers || []);
      setProvidersFetchedAt(data?.fetched_at);
      setProvidersErr(null);
    } catch (e) {
      setProvidersErr(e?.response?.data?.detail || e.message || '加载失败');
    }
  }, [isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    loadProviders();
    const t = setInterval(loadProviders, 30000);
    return () => clearInterval(t);
  }, [loadProviders, isAdmin]);

  return (
    <div style={{ padding: 24, minHeight: '100vh', background: 'var(--surface-1)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => navigate(-1)} style={{
          padding: 8, borderRadius: 8, background: 'var(--surface-2)',
          border: '1px solid var(--border-subtle)', cursor: 'pointer',
          color: 'var(--text-primary)',
        }}>
          <ArrowLeft size={16} />
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          调用日志与账单
        </h1>
        <button onClick={loadProviders} title="刷新" style={{
          marginLeft: 'auto', padding: 8, borderRadius: 8,
          background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
          cursor: 'pointer', color: 'var(--text-secondary)',
        }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Provider 信息卡片网格（仅管理员可见，账户级共享数据）*/}
      {isAdmin && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            {providers.length === 0 && (
              <div style={{ flex: 1, padding: 14, color: 'var(--text-tertiary)', fontSize: 12 }}>
                {providersErr ? `⚠ ${providersErr}` : '加载中…'}
              </div>
            )}
            {providers.map(p => <ProviderCard key={p.provider} p={p} />)}
          </div>
          {providersFetchedAt && (
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 16 }}>
              更新于 {providersFetchedAt.slice(11, 19)} UTC · 30s 自动刷新
            </div>
          )}
        </>
      )}

      {/* Tabs：HOLO 官方账单仅管理员可见 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
        {[
          { k: 'local', label: '本地调用日志' },
          ...(isAdmin ? [{ k: 'holo', label: 'HOLO 官方账单' }] : []),
        ].map(t => (
          <button key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              padding: '8px 16px', cursor: 'pointer',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.k ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.k ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: 600, fontSize: 13,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'holo' && isAdmin
        ? <HoloTransactions />
        : <LocalLogs isAdmin={isAdmin} />}
    </div>
  );
}


// ─────────────────────────────── Local logs ───────────────────────────────

function LocalLogs({ isAdmin }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);

  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize };
      if (provider) params.provider = provider;
      if (status) params.status = status;
      if (userId) params.user_id = userId;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const data = await fetchLogs(params);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, provider, status, userId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const inputStyle = {
    background: 'var(--surface-0)', border: '1px solid var(--border-default)',
    color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 6, fontSize: 12,
  };

  return (
    <>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={provider} onChange={e => { setPage(1); setProvider(e.target.value); }} style={inputStyle}>
          <option value="">全部 Provider</option>
          <option value="holo">HOLO</option>
          <option value="flow2api">Flow2API</option>
          <option value="grok">Grok</option>
        </select>
        <select value={status} onChange={e => { setPage(1); setStatus(e.target.value); }} style={inputStyle}>
          <option value="">全部状态</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="submitted">submitted</option>
        </select>
        {isAdmin && (
          <input type="number" placeholder="用户 ID 过滤" value={userId}
            onChange={e => { setPage(1); setUserId(e.target.value); }} style={{ ...inputStyle, width: 120 }} />
        )}
        <input type="date" value={dateFrom} onChange={e => { setPage(1); setDateFrom(e.target.value); }} style={inputStyle} />
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>
        <input type="date" value={dateTo} onChange={e => { setPage(1); setDateTo(e.target.value); }} style={inputStyle} />
        <button onClick={load} disabled={loading} style={{
          ...inputStyle, cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', border: 'none',
        }}>{loading ? '加载中…' : '刷新'}</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)' }}>
          共 {total} 条
        </span>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--surface-3)' }}>
            <tr style={{ color: 'var(--text-secondary)' }}>
              {['时间','用户','Provider','模型','类型','状态','扣费','耗时','HOLO_id'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                {loading ? '加载中…' : '暂无记录'}
              </td></tr>
            )}
            {items.map(r => (
              <tr key={r.id}
                  onClick={() => fetchLogDetail(r.id).then(setDetail)}
                  style={{ borderTop: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-primary)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.created_at?.slice(5, 19).replace('T', ' ')}</td>
                <td style={{ padding: '8px 12px' }}>{r.username || r.user_id || '—'}</td>
                <td style={{ padding: '8px 12px' }}><ProviderTag p={r.provider} /></td>
                <td style={{ padding: '8px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.model}>{r.model}</td>
                <td style={{ padding: '8px 12px' }}>{r.task_type || '—'}</td>
                <td style={{ padding: '8px 12px' }}><StatusPill status={r.status} refunded={r.refunded} /></td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.cost ?? '—'}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.latency_ms ? `${r.latency_ms} ms` : '—'}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-tertiary)' }}>{r.holo_task_id ? r.holo_task_id.slice(0, 12) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}
          style={{ ...inputStyle, cursor: page > 1 ? 'pointer' : 'not-allowed', opacity: page > 1 ? 1 : 0.5 }}>‹</button>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
          style={{ ...inputStyle, cursor: page < totalPages ? 'pointer' : 'not-allowed', opacity: page < totalPages ? 1 : 0.5 }}>›</button>
      </div>

      {/* Detail drawer */}
      {detail && <DetailDrawer detail={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function DetailDrawer({ detail, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 480,
        background: 'var(--surface-2)', borderLeft: '1px solid var(--border-subtle)',
        padding: 24, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>调用详情 #{detail.id}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: 8, fontSize: 12, color: 'var(--text-primary)' }}>
          <Row k="Provider"><ProviderTag p={detail.provider} /></Row>
          <Row k="模型">{detail.model}</Row>
          <Row k="任务类型">{detail.task_type || '—'}</Row>
          <Row k="状态"><StatusPill status={detail.status} refunded={detail.refunded} /></Row>
          <Row k="扣费">{detail.cost ?? '—'}</Row>
          <Row k="耗时">{detail.latency_ms ? `${detail.latency_ms} ms` : '—'}</Row>
          <Row k="HOLO task_id"><code style={{ fontSize: 11 }}>{detail.holo_task_id || '—'}</code></Row>
          <Row k="本地 task_id"><code style={{ fontSize: 11 }}>{detail.task_id || '—'}</code></Row>
          <Row k="group_id"><code style={{ fontSize: 11 }}>{detail.group_id || '—'}</code></Row>
          <Row k="提交时间">{detail.created_at}</Row>
          <Row k="完成时间">{detail.completed_at || '—'}</Row>
          {detail.error_msg && <Row k="错误"><span style={{ color: '#ef4444' }}>{detail.error_msg}</span></Row>}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>请求摘要</div>
            <pre style={{
              background: 'var(--surface-0)', padding: 12, borderRadius: 8,
              fontSize: 11, overflow: 'auto', maxHeight: 240, color: 'var(--text-primary)',
            }}>{JSON.stringify(detail.request_summary, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ width: 110, color: 'var(--text-tertiary)', fontSize: 11 }}>{k}</div>
      <div style={{ flex: 1, wordBreak: 'break-all' }}>{children}</div>
    </div>
  );
}


// ─────────────────────────────── HOLO transactions ───────────────────────────────

function HoloTransactions() {
  const [items, setItems] = useState([]);
  const [type, setType] = useState('');
  const [taskType, setTaskType] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const params = { limit: 100 };
      if (type) params.type = type;
      if (taskType) params.task_type = taskType;
      if (date) params.date = date;
      const data = await fetchHoloTransactions(params);
      // 兼容多种响应形态
      setItems(data?.transactions || data?.items || data?.data || (Array.isArray(data) ? data : []));
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [type, taskType, date]);

  useEffect(() => { load(); }, [load]);

  const inputStyle = {
    background: 'var(--surface-0)', border: '1px solid var(--border-default)',
    color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 6, fontSize: 12,
  };

  return (
    <>
      <div style={{ marginBottom: 12, padding: 12, fontSize: 12, color: 'var(--text-secondary)',
        background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
        本表来自 HOLO 官方接口 <code>/me/transactions</code>，与本地日志可对账。
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
          <option value="">全部类型</option>
          <option value="charge">消费</option>
          <option value="refund">退款</option>
          <option value="topup">充值</option>
          <option value="adjust">调整</option>
        </select>
        <select value={taskType} onChange={e => setTaskType(e.target.value)} style={inputStyle}>
          <option value="">全部任务类型</option>
          <option value="t2i">t2i</option>
          <option value="r2i">r2i</option>
          <option value="t2v">t2v</option>
          <option value="i2v">i2v</option>
          <option value="r2v">r2v</option>
        </select>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
        <button onClick={load} disabled={loading} style={{
          ...inputStyle, cursor: 'pointer',
          background: 'var(--accent)', color: '#fff', border: 'none',
        }}>{loading ? '加载中…' : '刷新'}</button>
      </div>

      {err && <div style={{ padding: 12, color: '#ef4444', fontSize: 12 }}>⚠ {err}</div>}

      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--surface-3)' }}>
            <tr style={{ color: 'var(--text-secondary)' }}>
              {['时间','类型','任务类型','模型','金额','HOLO task_id'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                {loading ? '加载中…' : '暂无记录'}
              </td></tr>
            )}
            {items.map((r, i) => (
              <tr key={r.id ?? i} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.created_at || r.timestamp || r.date || '—'}</td>
                <td style={{ padding: '8px 12px' }}>{r.type || '—'}</td>
                <td style={{ padding: '8px 12px' }}>{r.task_type || '—'}</td>
                <td style={{ padding: '8px 12px' }}>{r.model || '—'}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right',
                  color: r.amount < 0 || r.type === 'charge' ? '#ef4444' : '#10b981' }}>
                  {r.amount ?? r.cost ?? r.credits ?? '—'}
                </td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {r.task_id ? String(r.task_id).slice(0, 12) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
