import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  Download, Anchor, CheckCircle, XCircle, Loader, Clock,
  X, RefreshCw, Copy, Check, Film, Play, Video, Clapperboard,
  ChevronLeft, ChevronRight, Sparkles,
} from 'lucide-react';
import api from '../../api/client';
import useTaskStore from '../../stores/useTaskStore';
import VideoMotionModal from './VideoMotionModal';
import DirectorScenesEditor from './DirectorScenesEditor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusIcon({ status, size = 12 }) {
  if (status === 'success') return <CheckCircle size={size} style={{ color: 'var(--success)' }} />;
  if (status === 'failed')  return <XCircle size={size} style={{ color: 'var(--error)' }} />;
  if (status === 'running') return <Loader size={size} className="animate-spin" style={{ color: 'var(--accent)' }} />;
  return <Clock size={size} style={{ color: 'var(--text-tertiary)' }} />;
}

function parseTaskPrompt(rawPrompt) {
  if (!rawPrompt) return { title: '', cleanPrompt: '无提示词记录' };
  const match = rawPrompt.match(/\[TITLE\](.*?)\[\/TITLE\]([\s\S]*)/);
  if (match) return { title: match[1].trim(), cleanPrompt: match[2].trim() };
  return { title: '', cleanPrompt: rawPrompt.trim() };
}

// ---------------------------------------------------------------------------
// Progress Ring (toolbar)
// ---------------------------------------------------------------------------

function ProgressRing({ value, max, color = 'var(--accent)', label, size = 34 }) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const pct = max > 0 ? value / max : 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={3}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <span style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 9, fontWeight: 700, color: label === 'vid' ? '#a78bfa' : 'var(--text-secondary)',
      }}>
        {label === 'vid' ? 'VID' : 'IMG'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SceneCard — unified image + video card per frame
// ---------------------------------------------------------------------------

function SceneCard({
  index, isAnchor,
  imageTask, videoTask,
  showVideoZone,
  onPreviewImage, onPreviewVideo,
  onRetryImage, onRetryVideo,
  onGenerateVideo,
}) {
  const [imgHover, setImgHover] = useState(false);
  const [vidHover, setVidHover] = useState(false);

  const imgSrc     = imageTask?.output_file ? `/${imageTask.output_file}` : null;
  const imgStatus  = imageTask?.status;
  const imgWorking = imgStatus === 'queued' || imgStatus === 'running';

  const vidStatus  = videoTask?.status;
  const vidSrc     = videoTask?.output_file ? `/${videoTask.output_file}` : null;
  const vidThumb   = videoTask?.output_thumbnail ? `/${videoTask.output_thumbnail}` : null;
  const vidWorking = videoTask && (vidStatus === 'queued' || vidStatus === 'running');

  const { title } = parseTaskPrompt(imageTask?.prompt);
  const displayTitle = title || (isAnchor ? '锚点大纲' : `场景 ${index + 1}`);
  const sceneNum = String(index + 1).padStart(2, '0');

  const handleImgDownload = (e) => {
    e.stopPropagation();
    if (!imgSrc) return;
    const a = document.createElement('a');
    a.href = imgSrc;
    a.download = `frame_${index + 1}.jpg`;
    a.click();
  };

  const handleVidDownload = (e) => {
    e.stopPropagation();
    if (!vidSrc) return;
    const a = document.createElement('a');
    a.href = vidSrc;
    a.download = `video_${index + 1}.mp4`;
    a.click();
  };

  return (
    <div
      style={{
        height: '100%',
        width: 'max-content',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--surface-2)',
        border: isAnchor
          ? '1.5px solid var(--accent)'
          : '1px solid var(--border-subtle)',
        boxShadow: isAnchor
          ? '0 0 20px rgba(99,102,241,0.18), 0 4px 24px rgba(0,0,0,0.3)'
          : '0 4px 16px rgba(0,0,0,0.2)',
        transition: 'transform 0.25s ease, box-shadow 0.25s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = isAnchor
          ? '0 0 28px rgba(99,102,241,0.3), 0 8px 32px rgba(0,0,0,0.4)'
          : '0 8px 32px rgba(0,0,0,0.4)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = isAnchor
          ? '0 0 20px rgba(99,102,241,0.18), 0 4px 24px rgba(0,0,0,0.3)'
          : '0 4px 16px rgba(0,0,0,0.2)';
      }}
    >
      {/* ── Image zone ── */}
      <div
        style={{
          height: showVideoZone ? 'calc(50% - 14px)' : '100%',
          aspectRatio: '9 / 16',
          position: 'relative',
          cursor: !imgWorking && imgSrc ? 'pointer' : 'default',
          overflow: 'hidden',
          WebkitMaskImage: '-webkit-radial-gradient(white, black)',
        }}
        onMouseEnter={() => setImgHover(true)}
        onMouseLeave={() => setImgHover(false)}
        onClick={() => !imgWorking && onPreviewImage(imageTask)}
      >
        {/* Background fill */}
        {imgSrc && (
          <img
            src={imgSrc}
            alt={`frame-${index + 1}`}
            style={{
              width: '100%', height: '100%', objectFit: 'cover',
              transform: imgHover ? 'scale(1.06)' : 'scale(1)',
              transition: 'transform 0.5s ease',
              opacity: (imgWorking || imgStatus === 'failed') ? 0.3 : 1,
            }}
          />
        )}
        
        {/* Status Overlay */}
        {(!imgSrc || imgWorking || imgStatus === 'failed') && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8, padding: 12,
            background: imgSrc ? 'rgba(0,0,0,0.4)' : 'transparent',
            zIndex: 10, pointerEvents: 'auto',
          }}>
            <StatusIcon status={imgStatus} size={imgSrc ? 24 : 16} />
            <span style={{ 
              fontSize: 10, 
              color: imgSrc ? '#fff' : 'var(--text-tertiary)', 
              textAlign: 'center', lineHeight: 1.4, 
              fontWeight: imgSrc ? 600 : 400 
            }}>
              {imgStatus === 'queued' && (imgSrc ? '排队重新生成...' : '等待生成')}
              {imgStatus === 'running' && (imgSrc ? '重新生成中...' : '生成中...')}
              {imgStatus === 'failed' && (imageTask?.error_message ? imageTask.error_message : '生成失败')}
            </span>
            {imgStatus === 'failed' && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (isAnchor && onRetryImage) onRetryImage(imageTask.id, true);
                  else if (onRetryImage) onRetryImage(imageTask.id, false);
                }}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: 'none',
                  background: imgSrc ? 'rgba(239,68,68,0.9)' : 'rgba(239,68,68,0.15)', 
                  color: imgSrc ? '#fff' : 'var(--error)',
                  fontSize: 11, cursor: 'pointer', fontWeight: 700, marginTop: 4,
                  display: 'flex', alignItems: 'center', gap: 4,
                  boxShadow: imgSrc ? '0 4px 12px rgba(239,68,68,0.4)' : 'none',
                }}
              >
                <RefreshCw size={12} /> {imgSrc ? '再次重试' : '重试'}
              </button>
            )}
          </div>
        )}

        {/* Large ghost scene number */}
        <span style={{
          position: 'absolute', bottom: 6, right: 6,
          fontSize: 38, fontWeight: 900, lineHeight: 1,
          color: 'rgba(255,255,255,0.07)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: -2,
          pointerEvents: 'none',
          userSelect: 'none',
        }}>
          {sceneNum}
        </span>

        {/* Top badges row */}
        <div style={{
          position: 'absolute', top: 8, left: 8, right: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          pointerEvents: 'none', zIndex: 15,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 7px', borderRadius: 6,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
            fontSize: 10, fontWeight: 700, color: '#fff',
          }}>
            {isAnchor && <Anchor size={9} style={{ color: 'var(--accent)' }} />}
            {isAnchor ? '源' : sceneNum}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center',
            padding: '3px 6px', borderRadius: 6,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
          }}>
            <StatusIcon status={imgStatus} size={10} />
          </div>
        </div>

        {/* Bottom title gradient */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '24px 8px 8px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)',
          pointerEvents: 'none', zIndex: 15,
        }}>
          <span style={{
            display: 'block', fontSize: 10, fontWeight: 700,
            color: '#fff', textAlign: 'center',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayTitle}
          </span>
        </div>

        {/* Hover action overlay */}
        {!imgWorking && imgStatus !== 'failed' && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.38)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            opacity: imgHover ? 1 : 0,
            transition: 'opacity 0.2s ease',
            pointerEvents: 'none', zIndex: 20,
          }}>
            {imgSrc && (
              <div style={{
                padding: '5px 12px', borderRadius: 20,
                background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(6px)',
                color: '#fff', fontSize: 10, fontWeight: 700,
                transform: imgHover ? 'translateY(0)' : 'translateY(-8px)',
                transition: 'transform 0.3s ease',
                pointerEvents: 'none',
              }}>
                点击查看详情
              </div>
            )}

            <div style={{
              position: 'absolute', bottom: 8, right: 8,
              display: 'flex', flexDirection: 'column', gap: 5,
              pointerEvents: 'auto',
            }}>
              {/* 生成此帧视频按钮（仅图片成功且无视频时） */}
              {imgStatus === 'success' && !videoTask && (
                <ActionBtn
                  icon={Film} title="生成此帧视频" color="rgba(16,185,129,0.85)"
                  onClick={e => { e.stopPropagation(); onGenerateVideo(imageTask.id); }}
                  visible={imgHover}
                />
              )}
              {!isAnchor && (
                <ActionBtn
                  icon={RefreshCw} title="重新生成此帧" color="var(--accent)"
                  onClick={e => { e.stopPropagation(); onRetryImage(imageTask.id); }}
                  visible={imgHover} delay="60ms"
                />
              )}
              {imgSrc && (
                <ActionBtn
                  icon={Download} title="下载此帧" color="rgba(0,0,0,0.7)"
                  onClick={handleImgDownload}
                  visible={imgHover} delay="90ms"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Divider band ── */}
      {showVideoZone && (
        <div style={{
          flexShrink: 0,
          height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface-3)',
          gap: 6,
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', marginLeft: 8 }} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 7px', borderRadius: 10,
            background: 'rgba(167,139,250,0.12)',
            border: '1px solid rgba(167,139,250,0.2)',
          }}>
            <Video size={8} style={{ color: '#a78bfa' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', letterSpacing: 1 }}>VID</span>
          </div>
          <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', marginRight: 8 }} />
        </div>
      )}

      {/* ── Video zone ── */}
      {showVideoZone && (
        <div
          style={{
            height: 'calc(50% - 14px)',
            aspectRatio: '9 / 16',
            position: 'relative',
            overflow: 'hidden',
            cursor: vidStatus === 'success' && vidSrc ? 'pointer' : 'default',
            background: videoTask ? 'var(--surface-2)' : 'var(--surface-1)',
            WebkitMaskImage: '-webkit-radial-gradient(white, black)',
          }}
          onMouseEnter={() => setVidHover(true)}
          onMouseLeave={() => setVidHover(false)}
          onClick={() => vidStatus === 'success' && onPreviewVideo(videoTask)}
        >
          {!videoTask ? (
            // Empty slot — image not succeeded yet
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 5, borderTop: '1px dashed var(--border-subtle)',
            }}>
              <Video size={14} style={{ color: 'var(--text-tertiary)', opacity: 0.35 }} />
              <span style={{ fontSize: 9, color: 'var(--text-tertiary)', opacity: 0.45 }}>等待分镜就绪</span>
            </div>
          ) : (
            <>
              {/* Background Thumbnail */}
              {vidThumb && (
                <img
                  src={vidThumb}
                  alt={`video-thumb-${index + 1}`}
                  style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                    transform: vidHover ? 'scale(1.06)' : 'scale(1)',
                    transition: 'transform 0.5s ease',
                    opacity: (vidWorking || vidStatus === 'failed') ? 0.3 : 1,
                  }}
                />
              )}

              {/* Status Overlay */}
              {(!vidThumb || vidWorking || vidStatus === 'failed') && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex',
                  flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: 10,
                  background: vidThumb ? 'rgba(0,0,0,0.4)' : 'transparent',
                  zIndex: 10, pointerEvents: 'auto',
                }}>
                  <StatusIcon status={vidStatus} size={vidThumb ? 20 : 14} />
                  <span style={{ 
                    fontSize: 9, 
                    color: vidThumb ? '#fff' : 'var(--text-tertiary)', 
                    textAlign: 'center', lineHeight: 1.4,
                    fontWeight: vidThumb ? 600 : 400
                  }}>
                    {vidStatus === 'queued' && (vidThumb ? '视频排队重新生成' : '视频排队中')}
                    {vidStatus === 'running' && (vidThumb ? '正在重新生成...' : '生成中...')}
                    {vidStatus === 'failed' && (videoTask?.error_message ? videoTask.error_message : '生成失败')}
                  </span>
                  {vidStatus === 'failed' && (
                    <button
                      onClick={e => { e.stopPropagation(); onRetryVideo(videoTask.id); }}
                      style={{
                        padding: '4px 10px', borderRadius: 6, border: 'none',
                        background: vidThumb ? 'rgba(239,68,68,0.9)' : 'rgba(239,68,68,0.15)', 
                        color: vidThumb ? '#fff' : 'var(--error)',
                        fontSize: 10, cursor: 'pointer', fontWeight: 700, marginTop: 4,
                        display: 'flex', alignItems: 'center', gap: 4,
                        boxShadow: vidThumb ? '0 4px 12px rgba(239,68,68,0.4)' : 'none',
                      }}
                    >
                      <RefreshCw size={10} /> {vidThumb ? '再次重试' : '重试'}
                    </button>
                  )}
                </div>
              )}

              {/* Play overlay */}
              {!vidWorking && vidStatus !== 'failed' && vidThumb && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.3)',
                  opacity: vidHover ? 1 : 0,
                  transition: 'opacity 0.2s ease',
                  zIndex: 20, pointerEvents: 'none',
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transform: vidHover ? 'scale(1)' : 'scale(0.8)',
                    transition: 'transform 0.3s ease',
                  }}>
                    <Play size={16} style={{ color: '#fff', marginLeft: 2 }} />
                  </div>
                  <div style={{
                    position: 'absolute', bottom: 6, right: 6,
                    display: 'flex', flexDirection: 'column', gap: 4,
                    pointerEvents: 'auto',
                  }}>
                    <ActionBtn
                      icon={RefreshCw} title="重新生成视频" color="var(--accent)"
                      onClick={e => { e.stopPropagation(); onRetryVideo(videoTask.id); }}
                      visible={vidHover}
                    />
                    <ActionBtn
                      icon={Download} title="下载视频" color="rgba(0,0,0,0.7)"
                      onClick={handleVidDownload}
                      visible={vidHover} delay="50ms"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Running wave animation */}
          {vidWorking && (
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
              background: 'linear-gradient(90deg, transparent, #a78bfa, transparent)',
              animation: 'shimmer 1.8s ease-in-out infinite',
            }} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionBtn (small round icon button)
// ---------------------------------------------------------------------------

function ActionBtn({ icon: Icon, title, color, onClick, visible, delay = '0ms' }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26, height: 26, borderRadius: '50%', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: color, color: '#fff', cursor: 'pointer',
        backdropFilter: 'blur(4px)',
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.8)',
        opacity: visible ? 1 : 0,
        transition: `transform 0.25s ease ${delay}, opacity 0.2s ease ${delay}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(0) scale(1.12)'}
      onMouseLeave={e => e.currentTarget.style.transform = visible ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.8)'}
    >
      <Icon size={11} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// VideoPreviewModal
// ---------------------------------------------------------------------------

function VideoPreviewModal({ task, onClose }) {
  const videoRef = useRef(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  const videoSrc = task.output_file ? `/${task.output_file}` : null;
  const { title, cleanPrompt } = parseTaskPrompt(task.prompt);

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!videoSrc) return;
    const a = document.createElement('a');
    a.href = videoSrc;
    a.download = `director_video_${task.id.slice(0, 8)}.mp4`;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex p-4 sm:p-8"
      style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <div
        className="w-full h-full max-w-6xl mx-auto flex flex-col md:flex-row gap-4 sm:gap-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-1 flex flex-col relative rounded-2xl overflow-hidden min-h-0" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <button
            onClick={onClose}
            className="absolute top-4 left-4 z-50 text-white flex items-center justify-center w-10 h-10 rounded-full transition-colors"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.5)'}
          >
            <X size={20} />
          </button>
          <div className="flex-1 flex items-center justify-center p-4 min-h-0">
            {videoSrc ? (
              <video
                ref={videoRef}
                src={videoSrc}
                controls autoPlay loop
                className="max-h-full max-w-full rounded-xl shadow-2xl"
                style={{ maxHeight: '80vh' }}
              />
            ) : (
              <div className="flex flex-col items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
                <Video size={40} />
                <span className="text-sm">视频尚未生成</span>
                {task.status === 'failed' && task.error_message && (
                  <span className="text-xs text-[var(--error)] text-center max-w-md px-6">{task.error_message}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div
          className="w-full md:w-72 flex-shrink-0 flex flex-col rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}>
            <h3 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>
              {title || '视频帧'}
            </h3>
            <p className="text-[10px] tracking-wider uppercase mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Director Video Inspector
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>视频提示词</span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold transition-colors"
                  style={{ background: copied ? 'var(--success)' : 'var(--surface-3)', color: copied ? '#fff' : 'var(--text-primary)' }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <div
                className="p-3 rounded-xl text-xs leading-relaxed whitespace-pre-wrap font-mono"
                style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
              >
                {cleanPrompt}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Task ID</span>
                <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{task.id.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>状态</span>
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: task.status === 'failed' ? 'var(--error)' : 'var(--accent)' }}>
                  <StatusIcon status={task.status} /> {task.status}
                </div>
              </div>
              {task.status === 'failed' && task.error_message && (
                <div className="mt-2 pt-2 border-t flex flex-col gap-1" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="text-[10px] uppercase font-bold text-[var(--error)]">错误原因</span>
                  <span className="text-xs text-[var(--error)] break-words leading-relaxed">{task.error_message}</span>
                </div>
              )}
            </div>
            {videoSrc && (
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white transition-all"
                style={{ background: 'var(--accent)', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <Download size={14} /> 下载视频
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskInspectorModal
// ---------------------------------------------------------------------------

function TaskInspectorModal({ task, onClose }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!task) return null;

  const imgSrc = task.output_file ? `/${task.output_file}` : null;
  const { title, cleanPrompt } = parseTaskPrompt(task.prompt);

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex p-4 sm:p-8"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full h-full max-w-7xl mx-auto flex flex-col md:flex-row gap-4 sm:gap-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-1 flex flex-col relative rounded-2xl overflow-hidden min-h-0" style={{ background: 'rgba(0,0,0,0.2)' }}>
          <button
            onClick={onClose}
            className="absolute top-4 left-4 z-50 text-white flex items-center justify-center w-10 h-10 rounded-full transition-colors"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.4)'}
            title="关闭 (Esc)"
          >
            <X size={20} />
          </button>
          <div className="flex-1 flex items-center justify-center p-2 sm:p-6 min-h-0 overflow-hidden">
            {imgSrc ? (
              <img
                src={imgSrc}
                alt={title || 'Preview'}
                className="max-h-full max-w-full object-contain drop-shadow-2xl rounded-lg"
              />
            ) : (
              <div className="flex flex-col items-center text-[var(--text-tertiary)] gap-3">
                <StatusIcon status={task.status} size={24} />
                <span className="text-sm">尚未生成图片或任务失败</span>
                {task.status === 'failed' && task.error_message && (
                  <span className="text-xs text-[var(--error)] text-center max-w-md px-6">{task.error_message}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div
          className="w-full md:w-80 flex-shrink-0 flex flex-col rounded-2xl overflow-hidden"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="px-5 py-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-2)' }}>
            <h3 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>
              {title || '未命名分镜'}
            </h3>
            <p className="text-[10px] tracking-wider uppercase mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Task Frame Inspector
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-5 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>完整的系统提示词</span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold transition-colors"
                  style={{ background: copied ? 'var(--success)' : 'var(--surface-3)', color: copied ? '#fff' : 'var(--text-primary)' }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? '已复制' : '复制参数'}
                </button>
              </div>
              <div
                className="p-3 rounded-xl text-xs leading-relaxed whitespace-pre-wrap font-mono"
                style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
              >
                {cleanPrompt}
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>参考基准图</span>
              {task.input_files && task.input_files.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {task.input_files.map((file, i) => (
                    <img key={i} src={`/${file}`} alt="ref" className="w-16 h-16 object-cover rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }} />
                  ))}
                </div>
              ) : (
                <div className="text-xs text-[var(--text-tertiary)] italic">无参考图</div>
              )}
            </div>
            <div className="space-y-2">
              <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>任务流状态</span>
              <div className="flex flex-col gap-1.5 p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--text-tertiary)]">Task ID</span>
                  <span className="text-xs text-[var(--text-primary)] font-mono">{task.id.split('-')[0]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-[var(--text-tertiary)]">状态</span>
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: task.status === 'failed' ? 'var(--error)' : 'var(--accent)' }}>
                    <StatusIcon status={task.status} /> {task.status}
                  </div>
                </div>
                {task.status === 'failed' && task.error_message && (
                  <div className="mt-2 pt-2 border-t flex flex-col gap-1" style={{ borderColor: 'var(--border-subtle)' }}>
                    <span className="text-[10px] uppercase font-bold text-[var(--error)]">错误原因</span>
                    <span className="text-xs text-[var(--error)] break-words leading-relaxed">{task.error_message}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RetryPromptModal
// ---------------------------------------------------------------------------

function RetryPromptModal({ data, onClose, onSubmit }) {
  const [prompt, setPrompt] = useState(data?.prompt || '');

  useEffect(() => {
    setPrompt(data?.prompt || '');
  }, [data]);

  if (!data) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-3xl bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-2)] flex justify-between items-center">
          <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-wide">
            审核并修改提示词再重试
          </h3>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-white transition-colors">
             <X size={18} />
          </button>
        </div>
        <div className="p-6 pb-4">
           <textarea
             className="w-full h-80 p-4 rounded-xl resize-none text-xs font-mono leading-relaxed custom-scrollbar outline-none focus:ring-1 focus:ring-[var(--accent)]"
             style={{ background: 'var(--surface-0)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
             value={prompt}
             onChange={e => setPrompt(e.target.value)}
           />
           <p className="text-[11px] text-[var(--text-tertiary)] mt-3">
              你可以在这里微调即将用于重新生成的系统提示词。直接原样发往底层 AI 引擎。
           </p>
        </div>
        <div className="p-5 pt-0 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-3)] transition-all"
          >
            取消
          </button>
          <button
             onClick={() => onSubmit(data.taskId, data.type, prompt)}
             className="px-6 py-2.5 rounded-xl text-xs font-bold text-white shadow-lg flex items-center gap-2 transition-transform hover:scale-105"
             style={{ background: 'var(--accent)' }}
          >
            <RefreshCw size={14} /> 确认提交重试
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: 'var(--surface-0)',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
      }}>
        <Clapperboard size={26} style={{ color: 'var(--text-tertiary)' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
          选取左侧剧本记录
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
          或新建一个分镜序列开始创作
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StoryboardResultGrid — main export
// ---------------------------------------------------------------------------

export default function StoryboardResultGrid({ groupId }) {
  const taskGroups    = useTaskStore(s => s.taskGroups);
  const fetchTaskGroups = useTaskStore(s => s.fetchTaskGroups);

  const [selectedImageTask, setSelectedImageTask] = useState(null);
  const [selectedVideoTask, setSelectedVideoTask] = useState(null);
  const [generatingVideo, setGeneratingVideo]     = useState(false);
  const [videoMotionTargetTasks, setVideoMotionTargetTasks] = useState(null);
  const [editingRetryPrompt, setEditingRetryPrompt] = useState(null);

  const scrollRef = useRef(null);

  // Image group
  const group = taskGroups.find(g => g.id === groupId);
  const groupTasks = (group?.tasks || [])
    .slice()
    .sort((a, b) => {
      const idxA = a.config_json?.index || 0;
      const idxB = b.config_json?.index || 0;
      if (idxA !== idxB) return idxA - idxB;
      return new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0);
    });

  // Video group
  const videoGroup = taskGroups.find(
    g => g.source === 'DIRECTOR_VIDEO' && g.fission_parent_id === groupId
  );
  const videoTasks = (videoGroup?.tasks || [])
    .slice()
    .sort((a, b) => {
      const idxA = a.config_json?.index || 0;
      const idxB = b.config_json?.index || 0;
      if (idxA !== idxB) return idxA - idxB;
      return new Date(a.created_at ?? 0) - new Date(b.created_at ?? 0);
    });

  const videoTaskByImageTaskId = {};
  videoTasks.forEach(vt => {
    const srcId = vt.config_json?.source_image_task_id;
    if (srcId) videoTaskByImageTaskId[srcId] = vt;
  });

  const anyRunning =
    groupTasks.some(t => t.status === 'queued' || t.status === 'running') ||
    videoTasks.some(t => t.status === 'queued' || t.status === 'running');

  useEffect(() => {
    if (!groupId) return;
    fetchTaskGroups();
    if (!anyRunning) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchTaskGroups();
    }, 3000);
    return () => clearInterval(timer);
  }, [groupId, anyRunning, fetchTaskGroups]);

  // Scroll helpers
  const scrollBy = (dir) => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir * 500, behavior: 'smooth' });
  };

  // Actions
  const handleRetryImageTask = async (taskId, isGroupRetry = false, overridePrompt = null) => {
    try {
      if (isGroupRetry) {
        if (!window.confirm("确认重试执行该分镜大纲吗？（将跳过剧本打样直接重试成图）")) return;
        await api.post(`/director/${groupId}/retry`);
      } else {
        await api.post(`/tasks/item/${taskId}/retry`, overridePrompt ? { prompt: overridePrompt } : {});
      }
      fetchTaskGroups();
    } catch (e) {
      alert("重试失败: " + (e.response?.data?.detail || e.message));
    }
  };

  const handleRetryVideoTask = async (taskId, overridePrompt = null) => {
    try {
      await api.post(`/tasks/item/${taskId}/retry`, overridePrompt ? { prompt: overridePrompt } : {});
      fetchTaskGroups();
    } catch (e) {
      alert('视频重试失败：' + (e.response?.data?.detail || e.message));
    }
  };

  const requestRetryImage = (taskId, isGroupRetry) => {
    if (isGroupRetry) {
      handleRetryImageTask(taskId, true);
      return;
    }
    const t = groupTasks.find(x => x.id === taskId);
    if (!t) return;
    setEditingRetryPrompt({ taskId, type: 'image', prompt: t.prompt });
  };

  const requestRetryVideo = (taskId) => {
    const t = videoTasks.find(x => x.id === taskId);
    if (!t) return;
    setEditingRetryPrompt({ taskId, type: 'video', prompt: t.prompt });
  };

  const submitRetryPrompt = (taskId, type, finalPrompt) => {
    if (type === 'image') handleRetryImageTask(taskId, false, finalPrompt);
    else handleRetryVideoTask(taskId, finalPrompt);
    setEditingRetryPrompt(null);
  };

  const handleGenerateAllVideos = () => {
    const eligibleTasks = groupTasks.filter(t => t.status === 'success');
    if (eligibleTasks.length === 0) return alert('没有可用的分镜能生成视频');
    setVideoMotionTargetTasks(eligibleTasks);
  };

  const handleGenerateSingleVideo = (imageTaskId) => {
    const task = groupTasks.find(t => t.id === imageTaskId);
    if (!task) return;
    setVideoMotionTargetTasks([task]);
  };

  const executeVideoGeneration = async (prompts, model) => {
    setGeneratingVideo(true);
    try {
      const task_ids = videoMotionTargetTasks.length === groupTasks.filter(t => t.status === 'success').length && videoMotionTargetTasks.length > 1
        ? null
        : videoMotionTargetTasks.map(t => t.id);

      await api.post(`/director/${groupId}/generate-videos`, {
        task_ids: task_ids,
        video_prompts: prompts,
        video_model: model,
      });
      fetchTaskGroups();
      setVideoMotionTargetTasks(null);
    } catch (e) {
      alert('生成视频失败：' + (e.response?.data?.detail || e.message));
    } finally {
      setGeneratingVideo(false);
    }
  };

  const handleDownloadAllImages = useCallback(() => {
    groupTasks.forEach((t, idx) => {
      if (!t.output_file) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/${t.output_file}`;
        a.download = `storyboard_frame_${idx + 1}.jpg`;
        a.click();
      }, idx * 200);
    });
  }, [groupTasks]);

  const handleDownloadAllVideos = useCallback(() => {
    videoTasks.forEach((t, idx) => {
      if (t.status !== 'success' || !t.output_file) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/${t.output_file}`;
        a.download = `storyboard_video_${idx + 1}.mp4`;
        a.click();
      }, idx * 400); // 间隔稍微大一点给浏览器反应时间
    });
  }, [videoTasks]);

  if (!groupId) return <EmptyState />;
  if (group && group.status === 'needs_review') {
    const scenes = group.config_json?.director_scenes || [];
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-0)' }}>
        {/* Inline editor taking the full view */}
        <DirectorScenesEditor 
          scenes={scenes}
          submitting={generatingVideo}
          onConfirm={async (editedScenes) => {
            setGeneratingVideo(true);
            try {
              await api.post(`/director/${groupId}/confirm-scenes`, { director_scenes: editedScenes });
              fetchTaskGroups();
            } catch (e) {
              alert('提交失败: ' + (e.response?.data?.detail || e.message));
            } finally {
              setGeneratingVideo(false);
            }
          }}
        />
      </div>
    );
  }

  const successImageCount = groupTasks.filter(t => t.status === 'success').length;
  const totalImageCount   = groupTasks.length;
  const successVideoCount = videoTasks.filter(t => t.status === 'success').length;
  const hasVideoGroup     = !!videoGroup;
  const showVideoZone     = hasVideoGroup;
  const videoRunning      = videoTasks.some(t => t.status === 'queued' || t.status === 'running');

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface-0)' }}>

      {/* ── Toolbar ── */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', gap: 12,
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--surface-1)',
      }}>
        {/* Left: title + rings */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clapperboard size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 700,
                color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: 200,
              }}>
                {group?.title || '未命名序列'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                {groupId.slice(0, 8)} · 分镜时间轴
              </div>
            </div>
          </div>

          {/* Progress rings */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ProgressRing value={successImageCount} max={totalImageCount} label="img" />
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.3 }}>
              <div>{successImageCount}/{totalImageCount}</div>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>图片</div>
            </div>
            {hasVideoGroup && (
              <>
                <div style={{ width: 1, height: 24, background: 'var(--border-subtle)', margin: '0 2px' }} />
                <ProgressRing value={successVideoCount} max={videoGroup.total_count} color="#a78bfa" label="vid" />
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.3 }}>
                  <div>{successVideoCount}/{videoGroup.total_count}</div>
                  <div style={{ fontSize: 9, color: '#a78bfa' }}>视频</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {group?.status === 'failed' && (
            <button
              onClick={async () => {
                if (!window.confirm("确认重试执行该分镜大纲吗？（将跳过剧本打样直接重试成图）")) return;
                try {
                  await api.post(`/director/${groupId}/retry`);
                  fetchTaskGroups();
                } catch (e) {
                  alert("重试失败: " + (e.response?.data?.detail || e.message));
                }
              }}
              style={{
                height: 30, padding: '0 12px', borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)', 
                border: '1px solid rgba(239, 68, 68, 0.3)',
                fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
              }}
              title="锚点或排队异常时点击重试"
            >
              <RefreshCw size={14} /> 重试断点执行
            </button>
          )}

          {/* Scroll nav */}
          <button
            onClick={() => scrollBy(-1)}
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border-subtle)',
              background: 'var(--surface-2)', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
            title="向左滚动"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => scrollBy(1)}
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border-subtle)',
              background: 'var(--surface-2)', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
            title="向右滚动"
          >
            <ChevronRight size={15} />
          </button>

          {/* Download images */}
          {successImageCount > 0 && (
            <button
              onClick={handleDownloadAllImages}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface-2)', color: 'var(--text-primary)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
              title="批量下载全部分镜图"
            >
              <Download size={13} />
              下载图片
            </button>
          )}

          {/* Download videos */}
          {successVideoCount > 0 && (
            <button
              onClick={handleDownloadAllVideos}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--surface-2)', color: 'var(--text-primary)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
              title="批量下载全部视频"
            >
              <Download size={13} />
              下载视频
            </button>
          )}

          {/* Generate video series */}
          {successImageCount > 0 && !hasVideoGroup && (
            <button
              onClick={handleGenerateAllVideos}
              disabled={generatingVideo}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 16px', borderRadius: 8, border: 'none',
                background: generatingVideo
                  ? 'rgba(124,58,237,0.4)'
                  : 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
                color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: generatingVideo ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 14px rgba(124,58,237,0.35)',
                opacity: generatingVideo ? 0.7 : 1,
              }}
            >
              {generatingVideo
                ? <><Loader size={13} className="animate-spin" />提交中...</>
                : <><Sparkles size={13} />生成视频序列</>
              }
            </button>
          )}

          {/* Video group status */}
          {hasVideoGroup && videoRunning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8,
              background: 'rgba(167,139,250,0.1)',
              border: '1px solid rgba(167,139,250,0.25)',
              color: '#a78bfa', fontSize: 12, fontWeight: 600,
            }}>
              <Loader size={12} className="animate-spin" />
              视频生成中...
            </div>
          )}
        </div>
      </div>

      {/* ── Timeline content ── */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Ambient glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 60% 40% at 50% 100%, rgba(99,102,241,0.06) 0%, transparent 70%)',
        }} />

        {/* Scroll container */}
        <div
          ref={scrollRef}
          className="timeline-scrollbar"
          style={{
            flex: 1, minHeight: 0,
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'stretch',
            gap: 12,
            overflowX: 'auto',
            overflowY: 'hidden',
            padding: '20px 24px',
            boxSizing: 'border-box',
            position: 'relative',
          }}
        >
          {groupTasks.map((task, idx) => (
            <SceneCard
              key={task.id}
              index={idx}
              isAnchor={idx === 0}
              imageTask={task}
              videoTask={videoTaskByImageTaskId[task.id] || null}
              showVideoZone={showVideoZone}
              onPreviewImage={setSelectedImageTask}
              onPreviewVideo={setSelectedVideoTask}
              onRetryImage={requestRetryImage}
              onRetryVideo={requestRetryVideo}
              onGenerateVideo={handleGenerateSingleVideo}
            />
          ))}

          {/* Trailing spacer */}
          <div style={{ flexShrink: 0, width: 8 }} />
        </div>
      </div>

      {/* Modals */}
      <TaskInspectorModal task={selectedImageTask} onClose={() => setSelectedImageTask(null)} />
      <VideoPreviewModal  task={selectedVideoTask}  onClose={() => setSelectedVideoTask(null)} />
      {videoMotionTargetTasks && (
        <VideoMotionModal
           targetTasks={videoMotionTargetTasks}
           onClose={() => setVideoMotionTargetTasks(null)}
           onConfirm={executeVideoGeneration}
           submitting={generatingVideo}
           defaultModel={group?.config_json?.videoModel}
        />
      )}
      <RetryPromptModal 
        data={editingRetryPrompt} 
        onClose={() => setEditingRetryPrompt(null)} 
        onSubmit={submitRetryPrompt} 
      />

      {/* Shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
