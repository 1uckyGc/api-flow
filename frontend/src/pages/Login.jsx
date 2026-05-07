import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import useAuthStore from '../stores/useAuthStore';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        const res = await api.post('/auth/login', formData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        login(res.data.access_token, res.data.user);
        navigate('/');
      } else {
        await api.post('/auth/register', { username, password });
        setIsLogin(true);
        setError('注册成功，请登录');
      }
    } catch (err) {
      setError(err.response?.data?.detail || '发生错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center"
      style={{ background: 'var(--surface-0)' }}>

      {/* Login card */}
      <div className="w-full max-w-[380px] p-8 fade-in"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
        }}>

        {/* Brand */}
        <div className="mb-8">
          <div className="w-10 h-10 flex items-center justify-center text-white font-semibold text-base mb-5"
            style={{
              background: 'var(--accent)',
              borderRadius: 'var(--radius-md)',
            }}>
            F
          </div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isLogin ? '登录 FollowmeeeAIGC' : '注册新账号'}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
            AI 视频生产平台
          </p>
        </div>

        {/* Error / Success message */}
        {error && (
          <div className="px-3 py-2 mb-5 text-sm"
            style={{
              background: error.includes('成功') ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              color: error.includes('成功') ? 'var(--success)' : 'var(--error)',
              borderRadius: 'var(--radius-sm)',
            }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-secondary)' }}>
              用户名
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-sm focus:outline-none transition-colors"
              style={{
                background: 'var(--surface-0)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
              placeholder="输入你的账号"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--text-secondary)' }}>
              密码
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm focus:outline-none transition-colors"
              style={{
                background: 'var(--surface-0)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
              placeholder="输入你的密码"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-medium py-2 text-sm transition-colors disabled:opacity-50"
            style={{
              background: 'var(--accent)',
              borderRadius: 'var(--radius-md)',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--accent-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; }}
          >
            {loading ? '处理中...' : (isLogin ? '登录' : '注册')}
          </button>
        </form>

        {/* Toggle */}
        <div className="mt-5 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {isLogin ? '还没有账号？' : '已拥有账号？'}
          <button
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            className="ml-1 transition-colors"
            style={{ color: 'var(--accent)' }}
          >
            {isLogin ? '立即注册' : '返回登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
