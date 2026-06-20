/**
 * Persistence for support tickets.
 *
 * Backends (selected by TICKET_STORE_BACKEND):
 *   - "file"   (default): append-only JSONL on disk + in-memory index. Durable
 *              across restarts, zero external dependencies — ideal for dev and
 *              small/single-instance deployments.
 *   - "cosmos": Azure Cosmos DB container (re-uses the COSMOS_DB_* connection).
 *   - "memory": in-process only (lost on restart) — for tests.
 *
 * The in-memory index is always populated so reads are fast regardless of
 * backend; the chosen backend governs durability.
 */

import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../logger';
import type { SupportTicket } from '../shared/ticketTypes';

type CosmosContainer = {
  items: {
    create: (doc: unknown) => Promise<unknown>;
    upsert: (doc: unknown) => Promise<unknown>;
    readAll: () => { fetchAll: () => Promise<{ resources: unknown[] }> };
  };
};

class TicketStore {
  private byId = new Map<string, SupportTicket>();
  private order: string[] = []; // newest-last insertion order
  private filePath: string;
  private backend = config.support.store.backend;
  private cosmos: CosmosContainer | null = null;
  private initialised = false;

  constructor() {
    this.filePath =
      config.support.store.filePath ||
      path.resolve(__dirname, '../../data/tickets.jsonl');
  }

  /** Load any persisted tickets into the in-memory index. Idempotent. */
  async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;

    if (this.backend === 'cosmos') {
      await this.initCosmos();
    } else if (this.backend === 'file') {
      this.loadFromFile();
    }
    logger.info(
      `Ticket store ready (backend=${this.backend}, ${this.order.length} existing tickets)`
    );
  }

  private loadFromFile(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ticket = JSON.parse(trimmed) as SupportTicket;
          this.index(ticket);
        } catch {
          logger.warn('Ticket store: skipping malformed JSONL line');
        }
      }
    } catch (err) {
      logger.error(`Ticket store: failed to load file ${this.filePath}: ${String(err)}`);
    }
  }

  private async initCosmos(): Promise<void> {
    try {
      // Lazy import so the (heavy) Cosmos SDK isn't pulled in for file/memory.
      const { CosmosClient } = await import('@azure/cosmos');
      const client = new CosmosClient({
        endpoint: config.cosmos.endpoint,
        key: config.cosmos.key,
      });
      const { database } = await client.databases.createIfNotExists({
        id: config.cosmos.database,
      });
      const { container } = await database.containers.createIfNotExists({
        id: config.support.store.cosmosContainer,
        partitionKey: { paths: ['/id'] },
      });
      this.cosmos = container as unknown as CosmosContainer;

      const { resources } = await this.cosmos.items.readAll().fetchAll();
      for (const doc of resources) this.index(doc as SupportTicket);
    } catch (err) {
      logger.error(`Ticket store: Cosmos init failed, falling back to memory: ${String(err)}`);
      this.backend = 'memory';
    }
  }

  private index(ticket: SupportTicket): void {
    if (!this.byId.has(ticket.id)) this.order.push(ticket.id);
    this.byId.set(ticket.id, ticket);
  }

  /** Persist a new ticket and add it to the index. */
  async save(ticket: SupportTicket): Promise<void> {
    this.index(ticket);

    if (this.backend === 'cosmos' && this.cosmos) {
      await this.cosmos.items.create(ticket);
      return;
    }
    if (this.backend === 'file') {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.promises.appendFile(this.filePath, JSON.stringify(ticket) + '\n', 'utf8');
    }
    // "memory" backend: nothing else to do.
  }

  /**
   * Persist an updated copy of an existing ticket (e.g. after notification
   * outcomes are known). The JSONL backend is append-only and last-write-wins
   * per id on reload, so a follow-up line simply supersedes the first.
   */
  async update(ticket: SupportTicket): Promise<void> {
    this.index(ticket);

    if (this.backend === 'cosmos' && this.cosmos) {
      await this.cosmos.items.upsert(ticket);
      return;
    }
    if (this.backend === 'file') {
      await fs.promises.appendFile(this.filePath, JSON.stringify(ticket) + '\n', 'utf8');
    }
  }

  get(id: string): SupportTicket | undefined {
    return this.byId.get(id);
  }

  /** Most-recent-first list, optionally capped. */
  list(limit = 100): SupportTicket[] {
    const ids = this.order.slice(-limit).reverse();
    return ids.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  count(): number {
    return this.order.length;
  }
}

export const ticketStore = new TicketStore();
