import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import useAuthStore from '../../stores/useAuthStore';
import useTaskStore from '../../stores/useTaskStore';
import useSettingsStore from '../../stores/useSettingsStore';
import useThemeStore from '../../stores/useThemeStore';
import {
  Dna, PenLine, Image, Film, Clapperboard, FolderOpen,
  Settings, LogOut, Sun, Moon, Blocks, ScrollText, Copy
} from 'lucide-react';

const navItems = [
  { path: '/fission', icon: Dna, label: '裂变' },
  { path: '/director', icon: Clapperboard, label: '导演模式' },
  { path: '/workshop', icon: Blocks, label: '创意工坊' },

  { dividerAfter: true },
  { path: '/t2i', icon: PenLine, label: '文生图' },
  { path: '/i2i', icon: Image, label: '图生图' },
  { path: '/t2v', icon: Film, label: '文生视频' },
  { path: '/i2v', icon: Clapperboard, label: '图生视频' },
  { path: '/replicate', icon: Copy, label: '复刻视频' },
  { dividerAfter: true },
  { path: '/assets', icon: FolderOpen, label: '资产库' },
  { path: '/logs', icon: ScrollText, label: '调用日志' },
];

function NavTooltip({ children, label }) {
  return (
    <div className="relative group">
      {children}
      <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 z-50"
        style={{ background: 'var(--surface-4)', color: 'var(--text-primary)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
        {label}
        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent" style={{ borderRightColor: 'var(--surface-4)' }} />
      </div>
    </div>
  );
}

export default function GlobalNav() {
  const { user, logout } = useAuthStore();
  const setActiveGroup = useTaskStore((s) => s.setActiveGroup);
  const openSettings = useSettingsStore(state => state.openModal);
  const { theme, toggleTheme } = useThemeStore();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const avatarText = user?.display_name ? user.display_name.slice(0, 2) : 'FA';

  return (
    <nav className="flex flex-col items-center py-4 z-30 relative flex-shrink-0"
      style={{
        width: 'var(--nav-width)',
        background: 'var(--surface-1)',
        borderRight: '1px solid var(--border-subtle)',
      }}>

      {/* Logo */}
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-display font-bold text-sm mb-6 cursor-pointer hover:scale-105 transition-transform"
        style={{
          background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
          boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
        }}>
        N
      </div>

      {/* Main nav */}
      <div className="flex flex-col gap-0.5 w-full px-1.5 flex-1">
        {navItems.map((item, idx) => {
          if (item.dividerAfter) {
            return <div key={`div-${idx}`} className="w-6 h-px mx-auto my-2" style={{ background: 'var(--border-default)' }} />;
          }

          const Icon = item.icon;
          return (
            <NavTooltip key={item.path} label={item.label}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `relative flex items-center justify-center w-10 h-10 mx-auto rounded-xl transition-all duration-150 ${
                    isActive
                      ? 'text-white'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-3)]'
                  }`
                }
                style={({ isActive }) => isActive ? {
                  background: 'var(--accent-subtle)',
                  boxShadow: '0 0 12px rgba(99, 102, 241, 0.15)',
                } : undefined}
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <div className="absolute left-0 top-1/4 bottom-1/4 w-[2.5px] rounded-r-full"
                        style={{ background: 'var(--accent)' }} />
                    )}
                    <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                  </>
                )}
              </NavLink>
            </NavTooltip>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-2 mt-auto">
        <NavTooltip label={theme === 'dark' ? '浅色模式' : '深色模式'}>
          <button
            onClick={toggleTheme}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.background = 'var(--surface-3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-tertiary)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {theme === 'dark' ? <Sun size={19} strokeWidth={1.8} /> : <Moon size={19} strokeWidth={1.8} />}
          </button>
        </NavTooltip>

        <NavTooltip label="系统设置">
          <button
            onClick={openSettings}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.background = 'var(--surface-3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-tertiary)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Settings size={19} strokeWidth={1.8} />
          </button>
        </NavTooltip>

        <NavTooltip label="退出登录">
          <div
            onClick={logout}
            className="w-8 h-8 rounded-full cursor-pointer flex items-center justify-center text-[10px] text-white font-semibold transition-all duration-150 hover:ring-2"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
              '--tw-ring-color': 'var(--accent)',
              '--tw-ring-offset-width': '2px',
              '--tw-ring-offset-color': 'var(--surface-1)',
            }}
          >
            {avatarText}
          </div>
        </NavTooltip>
      </div>
    </nav>
  );
}
