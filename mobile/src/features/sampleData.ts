export const sampleItems = [
  {
    id: 'sample-tomatoes',
    name: 'Tomatoes crate',
    sku: 'TOM-CRATE',
    category: 'Fresh food',
    sellPrice: 35,
    costPrice: 24,
    stockQty: 8,
    lowStockThreshold: 5,
    synced: true,
  },
  {
    id: 'sample-rice',
    name: 'Rice 5kg',
    sku: 'RICE-5KG',
    category: 'Staples',
    sellPrice: 92,
    costPrice: 74,
    stockQty: 18,
    lowStockThreshold: 6,
    synced: true,
  },
  {
    id: 'sample-oil',
    name: 'Cooking oil 1L',
    sku: 'OIL-1L',
    category: 'Staples',
    sellPrice: 28,
    costPrice: 21,
    stockQty: 4,
    lowStockThreshold: 5,
    synced: false,
  },
];

export const revenueSeries = [
  { label: 'Mon', value: 430 },
  { label: 'Tue', value: 520 },
  { label: 'Wed', value: 390 },
  { label: 'Thu', value: 680 },
  { label: 'Fri', value: 740 },
  { label: 'Sat', value: 860 },
  { label: 'Sun', value: 610 },
];

export const stockTrendSeries = [
  { label: 'D1', value: 12 },
  { label: 'D2', value: 10 },
  { label: 'D3', value: 9 },
  { label: 'D4', value: 11 },
  { label: 'D5', value: 8 },
  { label: 'D6', value: 6 },
  { label: 'D7', value: 4 },
];

export const agentPipeline = [
  { id: 'ag-001', name: 'Akosua Trading', phone: '024 111 3344', stage: 'Ghana Card pending' },
  { id: 'ag-002', name: 'Mensah Provisions', phone: '055 909 8821', stage: 'Photos needed' },
  { id: 'ag-003', name: 'Adom Fresh Foods', phone: '020 441 1209', stage: 'Verified' },
];

export const monthlyRevenue = [
  { label: 'Jan', value: 6200 },
  { label: 'Feb', value: 7100 },
  { label: 'Mar', value: 6800 },
  { label: 'Apr', value: 7900 },
  { label: 'May', value: 8600 },
  { label: 'Jun', value: 9200 },
];
