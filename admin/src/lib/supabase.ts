'use client';

import { createBrowserClient } from '@supabase/ssr';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? '';

/**
 * Client Supabase de l'administration. La session est gardée en cookie ; toutes les données
 * passent par des fonctions SQL qui vérifient le rôle ADMIN côté serveur (RLS et require_admin).
 */
export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_KEY);

export const coverUrl = (path: string | null | undefined) => (path ? `${SUPABASE_URL}/storage/v1/object/public/covers/${path}` : null);
export const promoVideoUrl = (path: string | null | undefined) => (path ? `${SUPABASE_URL}/storage/v1/object/public/promos/${path}` : null);
