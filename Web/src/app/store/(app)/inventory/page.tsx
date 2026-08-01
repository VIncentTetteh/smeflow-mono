'use client';
import { useState } from 'react';
import {
  useItems,
  useCategories,
  useCreateItem,
  useAdjustStock,
  useDeleteItem,
  useSuppliers,
  useCreateSupplier,
  useDeleteSupplier,
  usePurchaseOrders,
  useReceivePurchaseOrder,
  type Item,
} from '@/hooks/store/useStoreInventory';
import { useCanManage } from '@/hooks/store/useRole';
import { PageShell, Card, Button, Badge, EmptyState, Spinner, Table, ghs, num } from '@/components/store/kit';
import { Modal, Field, TextInput, Select } from '@/components/store/Modal';

type Tab = 'items' | 'suppliers' | 'orders';

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('items');
  const canManage = useCanManage();

  return (
    <PageShell
      title="Inventory"
      subtitle="Track stock, suppliers, and purchase orders"
    >
      <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
        {(
          [
            ['items', 'Items'],
            ['suppliers', 'Suppliers'],
            ['orders', 'Purchase orders'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '7px 14px',
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 600,
              color: tab === key ? 'var(--brand)' : 'var(--ink-3)',
              background: tab === key ? 'var(--brand-soft)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'items' && <ItemsTab canManage={canManage} />}
      {tab === 'suppliers' && <SuppliersTab canManage={canManage} />}
      {tab === 'orders' && <OrdersTab canManage={canManage} />}
    </PageShell>
  );
}

function ItemsTab({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useItems({ search });
  const { data: categories } = useCategories();
  const createItem = useCreateItem();
  const adjust = useAdjustStock();
  const del = useDeleteItem();

  const [showAdd, setShowAdd] = useState(false);
  const [adjustItem, setAdjustItem] = useState<Item | null>(null);

  const items = data?.items ?? [];

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items…"
          style={inputBase}
        />
        {canManage && <Button onClick={() => setShowAdd(true)}>+ Add item</Button>}
      </div>

      {isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="No items yet" hint={canManage ? 'Add your first item to start tracking stock.' : undefined} />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['Item', 'Stock', 'Cost', 'Price', canManage ? '' : '']}
            rows={items.map((it) => [
              <div key="n">
                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{it.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                  {it.sku ? `${it.sku} · ` : ''}per {it.unit}
                </div>
              </div>,
              <span key="s" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {num(it.current_stock)}
                {it.is_low_stock && <Badge tone="danger">low</Badge>}
              </span>,
              ghs(it.cost_price),
              ghs(it.sell_price),
              canManage ? (
                <div key="a" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button variant="ghost" onClick={() => setAdjustItem(it)}>
                    Adjust
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete ${it.name}?`)) del.mutate(it.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                ''
              ),
            ])}
          />
        </Card>
      )}

      {showAdd && (
        <AddItemModal
          categories={categories ?? []}
          saving={createItem.isPending}
          onClose={() => setShowAdd(false)}
          onSave={async (body) => {
            await createItem.mutateAsync(body);
            setShowAdd(false);
          }}
        />
      )}

      {adjustItem && (
        <AdjustModal
          item={adjustItem}
          saving={adjust.isPending}
          onClose={() => setAdjustItem(null)}
          onSave={async (body) => {
            await adjust.mutateAsync({ item_id: adjustItem.id, ...body });
            setAdjustItem(null);
          }}
        />
      )}
    </>
  );
}

function AddItemModal({
  categories,
  saving,
  onClose,
  onSave,
}: {
  categories: { id: string; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (body: {
    name: string;
    unit: string;
    sell_price: number;
    cost_price: number;
    initial_stock: number;
    low_stock_threshold: number;
    category_id?: string | null;
    sku?: string | null;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('piece');
  const [sellPrice, setSellPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [threshold, setThreshold] = useState('5');
  const [categoryId, setCategoryId] = useState('');
  const [sku, setSku] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    if (!name.trim() || !sellPrice) {
      setError('Name and selling price are required.');
      return;
    }
    onSave({
      name: name.trim(),
      unit,
      sell_price: Number(sellPrice),
      cost_price: Number(costPrice || 0),
      initial_stock: Number(stock || 0),
      low_stock_threshold: Number(threshold || 0),
      category_id: categoryId || null,
      sku: sku || null,
    });
  };

  return (
    <Modal title="Add item" onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Add item">
      <Field label="Name">
        <TextInput value={name} onChange={setName} placeholder="e.g. Rice 5kg" autoFocus />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Selling price (GHS)">
          <TextInput value={sellPrice} onChange={setSellPrice} placeholder="0.00" type="number" />
        </Field>
        <Field label="Cost price (GHS)">
          <TextInput value={costPrice} onChange={setCostPrice} placeholder="0.00" type="number" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Unit">
          <TextInput value={unit} onChange={setUnit} placeholder="piece" />
        </Field>
        <Field label="Initial stock">
          <TextInput value={stock} onChange={setStock} type="number" />
        </Field>
        <Field label="Low-stock at">
          <TextInput value={threshold} onChange={setThreshold} type="number" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Category">
          <Select
            value={categoryId}
            onChange={setCategoryId}
            options={[{ value: '', label: 'None' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
        <Field label="SKU (optional)">
          <TextInput value={sku} onChange={setSku} placeholder="SKU-001" />
        </Field>
      </div>
    </Modal>
  );
}

function AdjustModal({
  item,
  saving,
  onClose,
  onSave,
}: {
  item: Item;
  saving: boolean;
  onClose: () => void;
  onSave: (body: { qty_change: number; reason: string; notes?: string }) => void;
}) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('purchase');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const n = Number(qty);
    if (!qty || Number.isNaN(n) || n === 0) {
      setError('Enter a non-zero quantity (negative to remove stock).');
      return;
    }
    onSave({ qty_change: n, reason, notes: notes || undefined });
  };

  return (
    <Modal
      title={`Adjust stock · ${item.name}`}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Save adjustment"
    >
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 4 }}>
        Current stock: <strong>{num(item.current_stock)}</strong> {item.unit}
      </p>
      <Field label="Quantity change (+ add / − remove)">
        <TextInput value={qty} onChange={setQty} placeholder="e.g. 20 or -3" type="number" autoFocus />
      </Field>
      <Field label="Reason">
        <Select
          value={reason}
          onChange={setReason}
          options={[
            { value: 'purchase', label: 'Purchase / restock' },
            { value: 'damage', label: 'Damage' },
            { value: 'adjustment', label: 'Adjustment' },
            { value: 'transfer', label: 'Transfer' },
            { value: 'return', label: 'Return' },
          ]}
        />
      </Field>
      <Field label="Notes (optional)">
        <TextInput value={notes} onChange={setNotes} placeholder="Reference or note" />
      </Field>
    </Modal>
  );
}

function SuppliersTab({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useSuppliers();
  const create = useCreateSupplier();
  const del = useDeleteSupplier();
  const [show, setShow] = useState(false);

  const suppliers = data ?? [];

  return (
    <>
      {canManage && (
        <div style={{ marginBottom: 14 }}>
          <Button onClick={() => setShow(true)}>+ Add supplier</Button>
        </div>
      )}
      {isLoading ? (
        <Spinner />
      ) : suppliers.length === 0 ? (
        <EmptyState title="No suppliers yet" />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['Supplier', 'Phone', 'Email', canManage ? '' : '']}
            rows={suppliers.map((s) => [
              <span key="n" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                {s.name}
              </span>,
              s.phone ?? '—',
              s.email ?? '—',
              canManage ? (
                <div key="a" style={{ textAlign: 'right' }}>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete ${s.name}?`)) del.mutate(s.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                ''
              ),
            ])}
          />
        </Card>
      )}
      {show && (
        <SupplierModal
          saving={create.isPending}
          onClose={() => setShow(false)}
          onSave={async (body) => {
            await create.mutateAsync(body);
            setShow(false);
          }}
        />
      )}
    </>
  );
}

function SupplierModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (body: { name: string; phone?: string; email?: string; address?: string }) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title="Add supplier"
      onClose={onClose}
      onSubmit={() => {
        if (!name.trim()) {
          setError('Supplier name is required.');
          return;
        }
        onSave({ name: name.trim(), phone: phone || undefined, email: email || undefined, address: address || undefined });
      }}
      saving={saving}
      error={error}
      submitLabel="Add supplier"
    >
      <Field label="Name">
        <TextInput value={name} onChange={setName} autoFocus />
      </Field>
      <Field label="Phone">
        <TextInput value={phone} onChange={setPhone} />
      </Field>
      <Field label="Email">
        <TextInput value={email} onChange={setEmail} type="email" />
      </Field>
      <Field label="Address">
        <TextInput value={address} onChange={setAddress} />
      </Field>
    </Modal>
  );
}

function OrdersTab({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = usePurchaseOrders();
  const receive = useReceivePurchaseOrder();
  const orders = data ?? [];

  return isLoading ? (
    <Spinner />
  ) : orders.length === 0 ? (
    <EmptyState title="No purchase orders" hint="Create purchase orders on mobile; receive them here to update stock." />
  ) : (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <Table
        head={['Supplier', 'Status', 'Total', 'Expected', canManage ? '' : '']}
        rows={orders.map((po) => [
          <span key="s" style={{ fontWeight: 600, color: 'var(--ink)' }}>
            {po.supplier_name ?? po.supplier_id.slice(0, 8)}
          </span>,
          <Badge key="st" tone={po.status === 'received' ? 'success' : 'default'}>
            {po.status.replace(/_/g, ' ')}
          </Badge>,
          ghs(po.total_amount ?? 0),
          po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '—',
          canManage && po.status !== 'received' && po.status !== 'cancelled' ? (
            <div key="a" style={{ textAlign: 'right' }}>
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm('Receive this order and add stock?')) receive.mutate(po.id);
                }}
              >
                Receive
              </Button>
            </div>
          ) : (
            ''
          ),
        ])}
      />
    </Card>
  );
}

const inputBase: React.CSSProperties = {
  flex: 1,
  height: 38,
  padding: '0 14px',
  borderRadius: 10,
  border: '1.5px solid var(--sf-line-2)',
  background: 'var(--sf-surface)',
  fontSize: 13,
  color: 'var(--ink)',
  outline: 'none',
};
