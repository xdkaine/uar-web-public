import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Prisma Client Configuration
 * 
 * Connection Pool Settings (Security Issue #10):
 * - connection_limit: Maximum number of database connections
 * - pool_timeout: Timeout for acquiring a connection from the pool
 * 
 * These limits prevent connection exhaustion under extreme load.
 * 
 * Default Prisma connection pool settings:
 * - connection_limit: num_physical_cpus * 2 + 1
 * - pool_timeout: 10 seconds
 * 
 * For production, set explicit limits in DATABASE_URL:
 * postgres://user:pass@host:5432/db?connection_limit=10&pool_timeout=20
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

// Initialize PostgreSQL connection pool
const pool = globalForPrisma.pool ?? new Pool({ 
  connectionString: process.env.DATABASE_URL 
})

// Initialize Prisma adapter
const adapter = new PrismaPg(pool)

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
  transactionOptions: {
    maxWait: 10000,
    timeout: 30000,
  },
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.pool = pool
}

/**
 * Recommended Production Settings:
 * 
 * For a typical web application on a 4-core server:
 * - connection_limit: 10-20 (adjust based on concurrent users)
 * - pool_timeout: 10-20 seconds
 * 
 * For high-traffic applications:
 * - connection_limit: 50-100 (with adequate database resources)
 * - Consider using PgBouncer for connection pooling
 * 
 * Monitor these metrics in production:
 * - Active connections
 * - Connection pool exhaustion events
 * - Query execution times
 * - Pool timeout errors
 */
