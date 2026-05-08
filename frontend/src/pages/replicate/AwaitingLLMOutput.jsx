import React, { useState } from 'react';
import { Copy, CheckCheck, Send } from 'lucide-react';
import { submitLLMOutput } from '../../api/replicate';
import { copyToClipboard } from '../../utils/clipboard';

export default function AwaitingLLMOutput({ job, onSubmitted }) {
  const [llmOutput, setLLMOutput] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const copyPrompt = async () => {
    const ok = await copyToClipboard(job.master_prompt || '');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      alert('复制失败，请手动选中复制');
    }
  };

  const submit = async () => {
    if (!llmOutput.trim()) {
      alert('请粘贴 LLM 完整输出');
      return;
    }
    setSubmitting(true);
    try {
      await submitLLMOutput(job.id, llmOutput);
      onSubmitted?.();
    } catch (e) {
      alert(`提交失败：${e.response?.data?.detail || e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶部说明 */}
      <div className="px-8 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <h2 className="text-lg font-semibold mb-1">{job.title}</h2>
        <ol className="text-xs space-y-1" style={{ color: 'var(--text-tertiary)' }}>
          <li>1. 复制下方主提示词 → 打开 ChatGPT / Gemini / Claude 网页</li>
          <li>2. 上传同一个样片视频 + 商品参考图（要跟你刚提交的一致）</li>
          <li>3. 把主提示词整段粘贴 → LLM 会按 6 阶段输出（中途如果停了发"继续，完整输出剩余 GU，不得省略"）</li>
          <li>4. LLM 输出完整后，整段复制粘贴到右下方文本框 → 点提交</li>
        </ol>
      </div>

      <div className="flex-1 grid grid-cols-2 overflow-hidden">
        {/* 左：master prompt */}
        <div className="flex flex-col overflow-hidden border-r" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-sm font-medium">主提示词（master_prompt_rendered.md）</span>
            <button
              onClick={copyPrompt}
              className="px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition"
              style={{ background: copied ? 'var(--accent-subtle)' : 'var(--surface-2)', color: copied ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
              {copied ? '已复制' : '复制全文'}
            </button>
          </div>
          <pre className="flex-1 overflow-auto px-5 py-3 text-xs whitespace-pre-wrap font-mono leading-relaxed"
            style={{ background: 'var(--surface-1)', color: 'var(--text-secondary)' }}
          >
            {job.master_prompt}
          </pre>
        </div>

        {/* 右：粘贴 LLM 输出 */}
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-sm font-medium">粘贴 LLM 完整输出</span>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition"
              style={{
                background: submitting ? 'var(--surface-3)' : 'var(--accent)',
                color: '#fff',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              <Send size={14} />
              {submitting ? '提交中…' : '提交并自动拆 GU'}
            </button>
          </div>
          <textarea
            value={llmOutput}
            onChange={e => setLLMOutput(e.target.value)}
            placeholder={'整段粘贴 LLM 的输出，须包含 ═══【GU01/...】 这种分隔标记。\n\n建议先在 LLM 网页里发一句"按完整格式输出，不得省略，不得用同上/类推/模板"。'}
            className="flex-1 px-5 py-3 text-xs outline-none resize-none font-mono leading-relaxed"
            style={{ background: 'var(--surface-0)', color: 'var(--text-primary)' }}
          />
        </div>
      </div>
    </div>
  );
}
