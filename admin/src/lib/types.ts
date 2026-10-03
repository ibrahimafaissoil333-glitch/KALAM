import type { CoverData } from '@/components/ui';

export interface Ebook {
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  category: { name: string; slug: string } | null;
  priceCents: number | null;
  currency: string;
  format: string | null;
  pages: number | null;
  downloadAllowed: boolean;
  publishedAt: string | null;
  cover: CoverData & { tint: string };
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  featured: boolean;
  updatedAt: string;
  sales: number;
}

export interface EbookDetail extends Ebook {
  previewBlocks: number;
  createdAt: string;
  files: { id: string; kind: 'COVER' | 'MAIN' | 'CONTENT'; mimeType: string; sizeBytes: number; originalName: string; createdAt: string }[];
  publishable: string[];
}

export interface OrderItem {
  ebookId: string;
  title: string;
  priceCents: number;
}

export interface Order {
  id: string;
  reference: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED';
  totalCents: number;
  currency: string;
  taxCents: number | null;
  createdAt: string;
  paidAt: string | null;
  items: OrderItem[];
  user: { id?: string; name: string; email: string | null };
}

export interface Stats {
  period: string;
  currency: string;
  revenueCents: number;
  paidOrders: number;
  averageOrderCents: number;
  failureRate: number;
  ordersByStatus: Record<string, number>;
  views: number;
  activeCustomers: number;
  weekly: { week: string; revenueCents: number; orders: number }[];
  topEbooks: { id: string; title: string; sales: number; revenueCents: number; views: number }[];
  recentOrders: Order[];
}
