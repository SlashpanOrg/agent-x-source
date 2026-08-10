import type { Pool } from 'pg';

let adoptionPool: Pool | null = null;

export function setAdoptionDbPool(pool: Pool | null): void {
  adoptionPool = pool;
}

export function getAdoptionDbPool(): Pool | null {
  return adoptionPool;
}
