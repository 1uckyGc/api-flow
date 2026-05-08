/**
 * 复制文本到剪贴板，跨 HTTP / HTTPS 两套环境都能跑。
 *
 * - HTTPS / localhost：用现代 navigator.clipboard.writeText
 * - 裸 HTTP（如 http://154.53.75.37:8090）：navigator.clipboard 不可用，
 *   退回 document.execCommand('copy') + 隐藏 textarea（虽然废弃但浏览器仍兼容）
 *
 * 返回 true / false（不抛异常，调 caller 自行决定 UI）
 */
export async function copyToClipboard(text) {
  const value = text == null ? '' : String(text);

  // 1) 现代 API — 仅 secure context 可用
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (e) {
      // 落到 fallback
    }
  }

  // 2) Fallback — 隐藏 textarea + execCommand
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
}
