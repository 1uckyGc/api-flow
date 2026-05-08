import React, { useState } from 'react';
import { Upload, Image as ImageIcon, Film, Plus, X } from 'lucide-react';

const initialBrand = {
  brand_name: '',
  product_name: '',
  core_selling_points: '',  // 多行文本，每行一条
  target_users: '',
  pain_points: '',          // 多行文本，每行一条
};

export default function InputForm({ onSubmit, submitting }) {
  const [title, setTitle] = useState('');
  const [video, setVideo] = useState(null);
  const [productImages, setProductImages] = useState([]);
  const [brand, setBrand] = useState(initialBrand);

  const handleVideo = (e) => {
    const f = e.target.files?.[0];
    if (f) setVideo(f);
  };

  const handleImages = (e) => {
    const files = Array.from(e.target.files || []);
    setProductImages(prev => [...prev, ...files]);
  };

  const removeImage = (idx) => {
    setProductImages(prev => prev.filter((_, i) => i !== idx));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!video) {
      alert('请上传样片视频');
      return;
    }
    if (!title.trim()) {
      alert('请填写作业标题');
      return;
    }

    const fd = new FormData();
    fd.append('title', title.trim());
    fd.append('sample_video', video);
    productImages.forEach(img => fd.append('product_images', img));

    const linesToList = (s) => (s || '').split('\n').map(x => x.trim()).filter(Boolean);
    const brandPayload = {
      brand_name: brand.brand_name.trim(),
      product_name: brand.product_name.trim(),
      core_selling_points: linesToList(brand.core_selling_points),
      target_users: brand.target_users.trim(),
      pain_points: linesToList(brand.pain_points),
    };
    fd.append('brand', JSON.stringify(brandPayload));

    await onSubmit(fd);
  };

  return (
    <form onSubmit={submit} className="flex-1 overflow-auto px-8 py-6 max-w-3xl mx-auto w-full">
      <h1 className="text-xl font-semibold mb-1">新建复刻作业</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        上传一段样片视频 + N 张商品参考图。系统会渲染主提示词，请你拿去 ChatGPT/Gemini/Claude 网页跑出 9宫格分镜的双产线提示词。
      </p>

      <Field label="作业标题">
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="例如：5月母亲节冲量样片复刻"
          className="w-full px-3 py-2 rounded-lg outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
          required
        />
      </Field>

      <Field label="样片视频" hint="MP4 / MOV，建议 ≤200MB">
        <label
          className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)' }}
        >
          <Film size={18} />
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {video ? video.name : '点击选择视频文件'}
          </span>
          <input type="file" accept="video/*" className="hidden" onChange={handleVideo} />
        </label>
      </Field>

      <Field label="商品参考图" hint="1-5 张；正面 + 侧面 + 细节会让出图更稳">
        <div className="flex flex-wrap gap-2">
          {productImages.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={URL.createObjectURL(img)}
                alt=""
                className="w-20 h-20 object-cover rounded-lg"
                style={{ border: '1px solid var(--border-default)' }}
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: 'var(--surface-4)', color: '#fff' }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <label
            className="w-20 h-20 rounded-lg flex flex-col items-center justify-center cursor-pointer text-xs gap-1"
            style={{ background: 'var(--surface-2)', border: '1px dashed var(--border-default)', color: 'var(--text-tertiary)' }}
          >
            <Plus size={16} />
            添加
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleImages} />
          </label>
        </div>
      </Field>

      <div className="mt-8 mb-3 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
        品牌产品配置 <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>（可全留空 → 仅做去重改写不做场景化置换）</span>
      </div>

      <Field label="品牌名称">
        <input
          type="text"
          value={brand.brand_name}
          onChange={e => setBrand({ ...brand, brand_name: e.target.value })}
          placeholder="例如：FollowMeeee"
          className="w-full px-3 py-2 rounded-lg outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
        />
      </Field>

      <Field label="产品名称">
        <input
          type="text"
          value={brand.product_name}
          onChange={e => setBrand({ ...brand, product_name: e.target.value })}
          placeholder="例如：智能补水仪 Pro"
          className="w-full px-3 py-2 rounded-lg outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
        />
      </Field>

      <Field label="核心卖点" hint="每行一条">
        <textarea
          value={brand.core_selling_points}
          onChange={e => setBrand({ ...brand, core_selling_points: e.target.value })}
          placeholder={'30 秒补水\n医美级护肤渗透\n通勤可携'}
          className="w-full px-3 py-2 rounded-lg outline-none min-h-[88px]"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
        />
      </Field>

      <Field label="目标用户">
        <input
          type="text"
          value={brand.target_users}
          onChange={e => setBrand({ ...brand, target_users: e.target.value })}
          placeholder="例如：25-35 岁一线城市职场女性"
          className="w-full px-3 py-2 rounded-lg outline-none"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
        />
      </Field>

      <Field label="用户痛点" hint="每行一条">
        <textarea
          value={brand.pain_points}
          onChange={e => setBrand({ ...brand, pain_points: e.target.value })}
          placeholder={'熬夜后皮肤干燥起皮\n空调房水分流失快'}
          className="w-full px-3 py-2 rounded-lg outline-none min-h-[88px]"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border-default)' }}
        />
      </Field>

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg font-medium transition flex items-center gap-2"
          style={{
            background: submitting ? 'var(--surface-3)' : 'var(--accent)',
            color: '#fff',
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          <Upload size={16} />
          {submitting ? '上传中…' : '提交并生成主提示词'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
        {hint && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
