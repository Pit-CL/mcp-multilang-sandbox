/**
 * Default configuration
 */

import type { PoolConfig, SecurityConfig } from '../types/index.js';

export const DEFAULT_POOL_CONFIG: PoolConfig = {
  minIdle: parseInt(process.env.POOL_MIN_IDLE || '2'),
  maxActive: parseInt(process.env.POOL_MAX_ACTIVE || '20'),
  warmupLanguages: ['python', 'typescript', 'javascript'],
  evictionPolicy: 'LRU',
  healthCheckInterval: 30000, // 30 seconds
};

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  network: {
    mode: 'none',
    allowList: [],
    maxConnections: 10,
  },
  resources: {
    memory: '512m',
    memorySwap: '512m',
    cpus: '1.0',
    pidsLimit: 100,
    diskQuota: '1g',
  },
  security: {
    readonlyRootfs: false,
    noNewPrivileges: true,
    seccompProfile: 'default',
    capDrop: ['ALL'],
    capAdd: [],
  },
  user: {
    uid: 1000,
    gid: 1000,
    name: 'sandbox',
  },
};

export const DEFAULT_TIMEOUT = 30000; // 30 seconds
export const DEFAULT_CACHE_SIZE_GB = parseInt(process.env.CACHE_MAX_SIZE_GB || '20');
