'use client';
import { useState } from 'react';
import {
  useLenderProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
} from '@/hooks/lender/useLenderData';

type LoanProduct = {
  id: string;
  name: string;
  description: string;
  min_amount_ghs: number;
  max_amount_ghs: number;
  interest_rate_annual: number;
  min_term_days: number;
  max_term_days: number;
  min_credit_band: string;
  is_active: boolean;
};

type FormState = {
  name: string;
  description: string;
  min_amount_ghs: string;
  max_amount_ghs: string;
  interest_rate_annual: string;
  min_term_days: string;
  max_term_days: string;
  min_credit_band: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  min_amount_ghs: '',
  max_amount_ghs: '',
  interest_rate_annual: '',
  min_term_days: '30',
  max_term_days: '365',
  min_credit_band: 'C',
};

const BANDS = ['A', 'B', 'C', 'D', 'E'];

function formFromProduct(p: LoanProduct): FormState {
  return {
    name: p.name,
    description: p.description,
    min_amount_ghs: String(p.min_amount_ghs),
    max_amount_ghs: String(p.max_amount_ghs),
    interest_rate_annual: String(p.interest_rate_annual),
    min_term_days: String(p.min_term_days),
    max_term_days: String(p.max_term_days),
    min_credit_band: p.min_credit_band,
  };
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
      background: active ? 'rgba(46,181,133,0.12)' : 'var(--sf-sunken)',
      color: active ? 'var(--brand)' : 'var(--ink-3)',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function ProductsPage() {
  const { data: products = [], isLoading } = useLenderProducts();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const [editing, setEditing] = useState<LoanProduct | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  }

  function openEdit(p: LoanProduct) {
    setEditing(p);
    setForm(formFromProduct(p));
    setError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  function setField(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit() {
    setError(null);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      min_amount_ghs: Number(form.min_amount_ghs),
      max_amount_ghs: Number(form.max_amount_ghs),
      interest_rate_annual: Number(form.interest_rate_annual),
      min_term_days: Number(form.min_term_days),
      max_term_days: Number(form.max_term_days),
      min_credit_band: form.min_credit_band,
    };
    if (!body.name) return setError('Product name is required.');
    if (body.min_amount_ghs <= 0 || body.max_amount_ghs <= 0) return setError('Amount fields must be positive.');
    if (body.min_amount_ghs > body.max_amount_ghs) return setError('Min amount must be ≤ max amount.');
    if (body.interest_rate_annual <= 0) return setError('Interest rate must be positive.');
    if (body.min_term_days <= 0 || body.max_term_days <= 0) return setError('Term fields must be positive.');
    if (body.min_term_days > body.max_term_days) return setError('Min term must be ≤ max term.');

    if (editing) {
      updateProduct.mutate(
        { id: editing.id, body },
        { onSuccess: closeForm, onError: (e) => setError((e as Error).message) },
      );
    } else {
      createProduct.mutate(body, {
        onSuccess: closeForm,
        onError: (e) => setError((e as Error).message),
      });
    }
  }

  function toggleActive(p: LoanProduct) {
    updateProduct.mutate({ id: p.id, body: { is_active: !p.is_active } });
  }

  const isPending = createProduct.isPending || updateProduct.isPending;

  const inputStyle = {
    width: '100%', boxSizing: 'border-box' as const,
    border: '1px solid var(--sf-line)', borderRadius: 8,
    padding: '8px 10px', fontSize: 13, color: 'var(--ink)',
    background: 'var(--sf-bg)', outline: 'none',
  };

  const labelStyle = {
    display: 'block', fontSize: 10.5, fontWeight: 600,
    color: 'var(--ink-3)', letterSpacing: '0.05em',
    textTransform: 'uppercase' as const, marginBottom: 4,
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--sf-bg)' }}>
      {/* Topbar */}
      <div style={{
        padding: '16px 24px', borderBottom: '1px solid var(--sf-line)',
        background: 'var(--sf-surface)', display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
            Loan Products
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
            Products visible to merchants in SMEFlow
          </p>
        </div>
        <button
          onClick={openNew}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600,
          }}
        >
          + New Product
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Product list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {isLoading ? (
            // Skeleton
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{
                  height: 64, borderRadius: 10,
                  background: 'var(--sf-surface)', border: '1px solid var(--sf-line)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '60px 24px',
              background: 'var(--sf-surface)', borderRadius: 12, border: '1px solid var(--sf-line)',
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px' }}>No products yet</p>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 16px' }}>
                Create your first product to appear in the merchant app.
              </p>
              <button
                onClick={openNew}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600,
                }}
              >
                Create product
              </button>
            </div>
          ) : (
            <div style={{ background: 'var(--sf-surface)', borderRadius: 12, border: '1px solid var(--sf-line)', overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 160px 90px 130px 70px 110px',
                padding: '8px 16px', borderBottom: '1px solid var(--sf-line)',
                fontSize: 10.5, fontWeight: 700, color: 'var(--ink-3)',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                <span>Name</span>
                <span>Amount (GH₵)</span>
                <span>Rate</span>
                <span>Term (days)</span>
                <span>Band</span>
                <span style={{ textAlign: 'right' }}>Status</span>
              </div>

              {products.map((p, i) => (
                <div
                  key={p.id}
                  onClick={() => openEdit(p)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 160px 90px 130px 70px 110px',
                    padding: '12px 16px', alignItems: 'center', cursor: 'pointer',
                    borderBottom: i < products.length - 1 ? '1px solid var(--sf-line)' : 'none',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sf-sunken)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{p.name}</div>
                    {p.description && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
                        {p.description}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                    {Number(p.min_amount_ghs).toLocaleString()}–{Number(p.max_amount_ghs).toLocaleString()}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{p.interest_rate_annual}% p.a.</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{p.min_term_days}–{p.max_term_days}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{p.min_credit_band}+</span>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                    <ActiveBadge active={p.is_active} />
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleActive(p); }}
                      disabled={updateProduct.isPending}
                      title={p.is_active ? 'Deactivate' : 'Activate'}
                      style={{
                        all: 'unset', cursor: 'pointer', padding: '3px 6px', borderRadius: 6,
                        fontSize: 11, fontWeight: 600, color: 'var(--ink-3)',
                        border: '1px solid var(--sf-line)', transition: 'color 0.1s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-3)')}
                    >
                      {p.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Form panel */}
        {showForm && (
          <div style={{
            width: 340, borderLeft: '1px solid var(--sf-line)', background: 'var(--sf-surface)',
            overflowY: 'auto', padding: 24, flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--ink)', flex: 1 }}>
                {editing ? 'Edit Product' : 'New Product'}
              </h2>
              <button
                onClick={closeForm}
                style={{ all: 'unset', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 20, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Product Name</label>
                <input
                  style={inputStyle}
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="e.g. SME Micro Loan"
                />
              </div>

              <div>
                <label style={labelStyle}>Description (optional)</label>
                <textarea
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Brief description for merchants"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Min Amount (GH₵)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={form.min_amount_ghs}
                    onChange={(e) => setField('min_amount_ghs', e.target.value)}
                    placeholder="500"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Max Amount (GH₵)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={form.max_amount_ghs}
                    onChange={(e) => setField('max_amount_ghs', e.target.value)}
                    placeholder="10000"
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Interest Rate (% p.a.)</label>
                <input
                  style={inputStyle}
                  type="number"
                  step="0.1"
                  value={form.interest_rate_annual}
                  onChange={(e) => setField('interest_rate_annual', e.target.value)}
                  placeholder="24"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Min Term (days)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={form.min_term_days}
                    onChange={(e) => setField('min_term_days', e.target.value)}
                    placeholder="30"
                  />
                </div>
                <div>
                  <label style={labelStyle}>Max Term (days)</label>
                  <input
                    style={inputStyle}
                    type="number"
                    value={form.max_term_days}
                    onChange={(e) => setField('max_term_days', e.target.value)}
                    placeholder="365"
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Minimum Credit Band</label>
                <select
                  style={{ ...inputStyle }}
                  value={form.min_credit_band}
                  onChange={(e) => setField('min_credit_band', e.target.value)}
                >
                  {BANDS.map((b) => (
                    <option key={b} value={b}>Band {b}{b === 'A' ? ' (Best)' : b === 'E' ? ' (Any)' : ''}</option>
                  ))}
                </select>
              </div>

              {error && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(184,53,28,0.08)', color: 'var(--danger)', fontSize: 12 }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={isPending}
                style={{
                  padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 600,
                  opacity: isPending ? 0.6 : 1,
                }}
              >
                {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Product'}
              </button>

              {editing && (
                <button
                  onClick={() => {
                    if (confirm('Delete this product? This will deactivate it.')) {
                      deleteProduct.mutate(editing.id, { onSuccess: closeForm });
                    }
                  }}
                  disabled={deleteProduct.isPending}
                  style={{
                    padding: '8px', borderRadius: 8, border: '1px solid var(--sf-line)',
                    cursor: 'pointer', background: 'transparent',
                    color: 'var(--danger)', fontSize: 12, fontWeight: 600,
                    opacity: deleteProduct.isPending ? 0.6 : 1,
                  }}
                >
                  Delete product
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
