/**
 * Dummy dataset generator: a small day-by-day simulation of a distributor.
 * It buys, receives, sells, ships, invoices and gets paid, and it seeds the exceptions the world must show.
 * Pure: the same options always give the same dataset.
 */
import {
  addDays,
  DOMAIN_SCHEMA_VERSION,
  isWeekend,
  nextWorkday,
  type Customer,
  type Dataset,
  type GoodsReceipt,
  type IsoDate,
  type OpeningStock,
  type Product,
  type ProductCategory,
  type PurchaseInvoice,
  type PurchaseOrder,
  type SalesInvoice,
  type SalesOrder,
  type Supplier,
} from '@ai-erp/domain';
import { CATEGORIES, createNameMaker, productDescription } from './names';
import { createRng, cumulativeWeights } from './rng';

export interface GenerateOptions {
  seed: number;
  /** First day the world can show. */
  startDate: IsoDate;
  /** Days the world can show. */
  days: number;
  /** Days simulated before startDate, so the world is already busy on day one. */
  warmupDays: number;
}

export const DEFAULT_OPTIONS: GenerateOptions = {
  seed: 20261111,
  startDate: '2026-08-03',
  days: 90,
  warmupDays: 45,
};

/** What the generator sets out to produce. The tests hold it to these. */
export const SPEC = {
  suppliers: 25,
  customers: 120,
  products: 600,
  categories: 12,
  /** Suppliers that deliver late most of the time. */
  lateProneSuppliers: 3,
  lateProneRate: 0.6,
  otherLateRate: 0.04,
  customersOnStop: 3,
  customersOverLimit: 4,
  /** Category indexes whose stock is deliberately old: over 180, 365 and 730 days. */
  agedCategories: [8, 9, 11] as const,
  negativeStockRows: 1,
} as const;

const ORDERS_PER_DAY_MIN = 38;
const ORDERS_PER_DAY_MAX = 54;
const LINES_PER_ORDER = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4] as const;
const PO_CHANCE_PER_SUPPLIER_DAY = 0.4;
const UNACKNOWLEDGED_RATE = 0.015;
const PARTIAL_RECEIPT_RATE = 0.08;
const OPENING_CASH = 2_000_000;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const pad = (value: number, width: number): string => String(value).padStart(width, '0');

interface ProductSim {
  product: Product;
  categoryIndex: number;
  slow: boolean;
  /** Share of all order lines that are for this product. */
  share: number;
  maxQty: number;
  /** Expected units sold per calendar day. */
  dailyDemand: number;
  onHand: number;
  reserved: number;
  onOrder: number;
  waiting: number;
}

interface PlannedReceipt {
  order: PurchaseOrder;
  lines: { line: number; qty: number }[];
}

export function generate(options: GenerateOptions = DEFAULT_OPTIONS): Dataset {
  const rng = createRng(options.seed);
  const names = createNameMaker(rng);
  const simStart = addDays(options.startDate, -options.warmupDays);
  const endDate = addDays(options.startDate, options.days - 1);
  const withinRange = (date: IsoDate): IsoDate | null => (date <= endDate ? date : null);

  // ---- Categories and suppliers
  const categories: ProductCategory[] = CATEGORIES.map((category, index) => ({
    id: `CAT${pad(index + 1, 2)}`,
    name: category.name,
  }));

  const supplierCategories: number[][] = [];
  const suppliers: Supplier[] = [];
  for (let i = 0; i < SPEC.suppliers; i++) {
    suppliers.push({ id: `SUP${pad(i + 1, 3)}`, name: names.supplier(), leadTimeDays: rng.int(7, 28) });
    const own = new Set<number>([i % SPEC.categories]);
    const extras = rng.int(0, 2);
    for (let e = 0; e < extras; e++) own.add(rng.int(0, SPEC.categories - 1));
    supplierCategories.push([...own]);
  }
  const lateProne = new Set(rng.shuffle(suppliers.map((_, index) => index)).slice(0, SPEC.lateProneSuppliers));
  const suppliersByCategory = CATEGORIES.map((_, categoryIndex) =>
    supplierCategories.flatMap((own, supplierIndex) => (own.includes(categoryIndex) ? [supplierIndex] : [])),
  );

  // ---- Products
  const categoryCumulative = cumulativeWeights(CATEGORIES.map((category) => category.weight));
  const agedCategories: readonly number[] = SPEC.agedCategories;
  const sims: ProductSim[] = [];
  const popularity = rng.shuffle(Array.from({ length: SPEC.products }, (_, index) => index + 1));
  for (let i = 0; i < SPEC.products; i++) {
    const categoryIndex = rng.pickCumulative(categoryCumulative);
    const category = CATEGORIES[categoryIndex] as (typeof CATEGORIES)[number];
    const supplierIndex = rng.pick(suppliersByCategory[categoryIndex] as number[]);
    const unitCost = round2(category.costLow * (category.costHigh / category.costLow) ** rng.next());
    const slow = rng.chance(agedCategories.includes(categoryIndex) ? 0.7 : 0.08);
    const rank = popularity[i] as number;
    sims.push({
      product: {
        id: `PRD${pad(i + 1, 5)}`,
        description: productDescription(rng, category.noun),
        categoryId: (categories[categoryIndex] as ProductCategory).id,
        supplierId: (suppliers[supplierIndex] as Supplier).id,
        unitCost,
        sellPrice: round2(unitCost * (1.15 + rng.next() * 0.3)),
      },
      categoryIndex,
      slow,
      share: slow ? 0.0004 : 1 / rank ** 0.8,
      maxQty: unitCost < 50 ? 20 : unitCost < 300 ? 8 : unitCost < 1000 ? 4 : 2,
      dailyDemand: 0,
      onHand: 0,
      reserved: 0,
      onOrder: 0,
      waiting: 0,
    });
  }
  const shareTotal = sims.reduce((sum, sim) => sum + sim.share, 0);
  const linesPerOrder = LINES_PER_ORDER.reduce((sum, n) => sum + n, 0) / LINES_PER_ORDER.length;
  const ordersPerCalendarDay = ((ORDERS_PER_DAY_MIN + ORDERS_PER_DAY_MAX) / 2) * (5 / 7);
  let dailySalesValue = 0;
  for (const sim of sims) {
    sim.share /= shareTotal;
    sim.dailyDemand = sim.share * ordersPerCalendarDay * linesPerOrder * ((1 + sim.maxQty) / 2);
    dailySalesValue += sim.dailyDemand * sim.product.sellPrice;
  }
  const productCumulative = cumulativeWeights(sims.map((sim) => sim.share));
  const simByProduct = new Map(sims.map((sim) => [sim.product.id, sim]));
  const simsBySupplier = new Map<string, ProductSim[]>();
  for (const sim of sims) {
    const list = simsBySupplier.get(sim.product.supplierId) ?? [];
    list.push(sim);
    simsBySupplier.set(sim.product.supplierId, list);
  }

  // ---- Opening stock
  const openingStock: OpeningStock[] = [];
  for (const sim of sims) {
    let ageDays: number;
    if (sim.slow) {
      // Aged categories each sit in their own band for the whole period; slow stock elsewhere is a mix.
      // Ages are days before the simulation starts, so each range leaves room for the days simulated.
      const band = agedCategories.indexOf(sim.categoryIndex);
      const ranges = [
        [190, 220],
        [380, 560],
        [740, 1200],
      ] as const;
      const [low, high] = ranges[band >= 0 ? band : rng.int(0, 2)] as readonly [number, number];
      ageDays = rng.int(low, high);
      sim.onHand = rng.int(sim.maxQty * 2, sim.maxQty * 8);
    } else {
      ageDays = rng.int(3, 60);
      sim.onHand = Math.max(sim.maxQty * 2, Math.round(sim.dailyDemand * rng.int(15, 40)));
    }
    openingStock.push({
      productId: sim.product.id,
      qty: sim.onHand,
      lastReceiptDate: addDays(simStart, -ageDays),
    });
  }

  // ---- Customers
  const customerWeights = Array.from({ length: SPEC.customers }, (_, index) => 1 / (index + 1) ** 0.9);
  const customerWeightTotal = customerWeights.reduce((sum, weight) => sum + weight, 0);
  const customerCumulative = cumulativeWeights(customerWeights);
  const overLimit = new Set(rng.shuffle(Array.from({ length: 36 }, (_, index) => index + 4)).slice(0, SPEC.customersOverLimit));
  const stopCandidates = Array.from({ length: 38 }, (_, index) => index + 7).filter((index) => !overLimit.has(index));
  const onStop = new Set(rng.shuffle(stopCandidates).slice(0, SPEC.customersOnStop));
  const customers: Customer[] = customerWeights.map((weight, index) => {
    const termsDays = rng.pick([30, 30, 30, 30, 14, 45, 60] as const);
    const expectedBalance = dailySalesValue * (weight / customerWeightTotal) * termsDays;
    const limit = Math.max(5000, Math.ceil((expectedBalance * 2.2) / 1000) * 1000);
    return {
      id: `CUS${pad(index + 1, 4)}`,
      name: names.customer(),
      creditLimit: overLimit.has(index) ? Math.max(1000, Math.round(limit * 0.2)) : limit,
      termsDays,
      onStopFrom: onStop.has(index) ? addDays(options.startDate, rng.int(35, 60)) : null,
    };
  });

  // ---- Simulation
  const purchaseOrders: PurchaseOrder[] = [];
  const goodsReceipts: GoodsReceipt[] = [];
  const purchaseInvoices: PurchaseInvoice[] = [];
  const salesOrders: SalesOrder[] = [];
  const salesInvoices: SalesInvoice[] = [];
  const receiptsDue = new Map<IsoDate, PlannedReceipt[]>();
  const shipmentsDue = new Map<IsoDate, SalesOrder[]>();
  let backOrders: SalesOrder[] = [];

  const negativeStockDay = addDays(options.startDate, 60);
  const negativeStockSim = sims.find((sim) => sim.slow && sim.categoryIndex === 2);
  if (!negativeStockSim) throw new Error('No slow product available to seed the negative stock row');

  const planReceipt = (date: IsoDate, planned: PlannedReceipt): void => {
    const list = receiptsDue.get(date) ?? [];
    list.push(planned);
    receiptsDue.set(date, list);
  };

  const canAllocate = (order: SalesOrder): boolean =>
    order.lines.every((line) => {
      const sim = simByProduct.get(line.productId) as ProductSim;
      return sim.onHand - sim.reserved >= line.qty;
    });

  const allocate = (order: SalesOrder, day: IsoDate): void => {
    for (const line of order.lines) (simByProduct.get(line.productId) as ProductSim).reserved += line.qty;
    const pickDay = nextWorkday(addDays(day, rng.chance(0.5) ? 0 : 1));
    const shipDay = nextWorkday(addDays(pickDay, rng.chance(0.6) ? 0 : 1));
    const deliveryDay = addDays(shipDay, rng.int(1, 2));
    order.allocatedDate = day;
    order.pickedDate = withinRange(pickDay);
    order.shippedDate = withinRange(shipDay);
    order.deliveredDate = withinRange(deliveryDay);
    const list = shipmentsDue.get(shipDay) ?? [];
    list.push(order);
    shipmentsDue.set(shipDay, list);
  };

  const invoice = (order: SalesOrder, day: IsoDate): void => {
    const customer = customers[Number(order.customerId.slice(3)) - 1] as Customer;
    const dueDate = addDays(day, customer.termsDays);
    let paidDate: IsoDate | null = null;
    const stopped = customer.onStopFrom !== null && dueDate >= addDays(customer.onStopFrom, -5);
    if (!stopped) {
      const slip = rng.chance(0.08) ? rng.int(15, 40) : rng.int(-3, 6);
      paidDate = withinRange(nextWorkday(addDays(dueDate, slip)));
    }
    salesInvoices.push({
      id: `SI${400001 + salesInvoices.length}`,
      salesOrderId: order.id,
      customerId: order.customerId,
      date: day,
      net: round2(order.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0)),
      dueDate,
      paidDate,
    });
  };

  for (let day = simStart; day <= endDate; day = addDays(day, 1)) {
    const workday = !isWeekend(day);

    // 1. Deliveries arrive.
    for (const planned of receiptsDue.get(day) ?? []) {
      const roll = rng.next();
      const putaway = roll < 0.75 ? day : nextWorkday(addDays(day, roll < 0.95 ? 1 : rng.int(3, 6)));
      const receipt: GoodsReceipt = {
        id: `GRN${200001 + goodsReceipts.length}`,
        purchaseOrderId: planned.order.id,
        date: day,
        putawayDate: withinRange(putaway),
        lines: planned.lines,
      };
      goodsReceipts.push(receipt);
      let net = 0;
      for (const received of planned.lines) {
        const line = planned.order.lines.find((candidate) => candidate.line === received.line);
        if (!line) throw new Error(`Receipt for a missing line on ${planned.order.id}`);
        const sim = simByProduct.get(line.productId) as ProductSim;
        sim.onHand += received.qty;
        sim.onOrder -= received.qty;
        net += received.qty * line.unitCost;
      }
      const invoiceDate = nextWorkday(addDays(day, rng.int(2, 6)));
      if (invoiceDate <= endDate) {
        const dueDate = addDays(invoiceDate, 30);
        purchaseInvoices.push({
          id: `PI${500001 + purchaseInvoices.length}`,
          purchaseOrderId: planned.order.id,
          goodsReceiptId: receipt.id,
          supplierId: planned.order.supplierId,
          date: invoiceDate,
          net: round2(net),
          dueDate,
          paidDate: withinRange(nextWorkday(dueDate)),
        });
      }
    }

    // 2. Stock that arrived may free waiting orders, oldest first.
    const stillWaiting: SalesOrder[] = [];
    for (const order of backOrders) {
      if (canAllocate(order)) {
        for (const line of order.lines) (simByProduct.get(line.productId) as ProductSim).waiting -= line.qty;
        allocate(order, day);
      } else {
        stillWaiting.push(order);
      }
    }
    backOrders = stillWaiting;

    // 3. New sales orders.
    if (workday) {
      const count = rng.int(ORDERS_PER_DAY_MIN, ORDERS_PER_DAY_MAX);
      for (let n = 0; n < count; n++) {
        const customer = customers[rng.pickCumulative(customerCumulative)] as Customer;
        if (customer.onStopFrom !== null && day >= customer.onStopFrom) continue;
        const chosen = new Set<ProductSim>();
        const lineCount = rng.pick(LINES_PER_ORDER);
        while (chosen.size < lineCount) {
          const sim = sims[rng.pickCumulative(productCumulative)] as ProductSim;
          if (sim !== negativeStockSim) chosen.add(sim);
        }
        const order: SalesOrder = {
          id: `SO${300001 + salesOrders.length}`,
          customerId: customer.id,
          orderDate: day,
          committedDate: nextWorkday(addDays(day, rng.int(2, 5))),
          allocatedDate: null,
          pickedDate: null,
          shippedDate: null,
          deliveredDate: null,
          lines: [...chosen].map((sim, index) => ({
            line: index + 1,
            productId: sim.product.id,
            qty: rng.int(1, sim.maxQty),
            unitPrice: round2(sim.product.sellPrice * (1 - rng.int(0, 8) / 100)),
          })),
        };
        salesOrders.push(order);
        if (canAllocate(order)) {
          allocate(order, day);
        } else {
          for (const line of order.lines) (simByProduct.get(line.productId) as ProductSim).waiting += line.qty;
          backOrders.push(order);
        }
      }
    }

    // Seeded exception: one order shipped for more than the system holds, leaving negative stock.
    if (day === negativeStockDay) {
      const sim = negativeStockSim;
      const order: SalesOrder = {
        id: `SO${300001 + salesOrders.length}`,
        customerId: (customers[9] as Customer).id,
        orderDate: day,
        committedDate: day,
        allocatedDate: day,
        pickedDate: day,
        shippedDate: day,
        deliveredDate: withinRange(addDays(day, 1)),
        lines: [{ line: 1, productId: sim.product.id, qty: sim.onHand + 6, unitPrice: sim.product.sellPrice }],
      };
      salesOrders.push(order);
      sim.onHand -= sim.onHand + 6;
      invoice(order, day);
    }

    // 4. Shipments leave and are invoiced.
    for (const order of shipmentsDue.get(day) ?? []) {
      for (const line of order.lines) {
        const sim = simByProduct.get(line.productId) as ProductSim;
        sim.onHand -= line.qty;
        sim.reserved -= line.qty;
      }
      invoice(order, day);
    }

    // 5. Purchasing: reorder what is running low.
    if (workday) {
      suppliers.forEach((supplier, supplierIndex) => {
        if (!rng.chance(PO_CHANCE_PER_SUPPLIER_DAY)) return;
        const low = (simsBySupplier.get(supplier.id) ?? [])
          .filter((sim) => !sim.slow && sim !== negativeStockSim)
          .map((sim) => {
            const net = sim.onHand - sim.reserved - sim.waiting + sim.onOrder;
            // Reorder point: demand over the lead time plus a buffer, and never less than one big order line.
            const reorderPoint = Math.max(sim.maxQty * 1.5, sim.dailyDemand * (supplier.leadTimeDays + 14));
            return { sim, cover: net / reorderPoint };
          })
          .filter((entry) => entry.cover < 1)
          .sort((a, b) => a.cover - b.cover || a.sim.product.id.localeCompare(b.sim.product.id))
          .slice(0, rng.int(2, 6));
        if (low.length === 0) return;

        const unacknowledged = rng.chance(UNACKNOWLEDGED_RATE);
        const late = unacknowledged || rng.chance(lateProne.has(supplierIndex) ? SPEC.lateProneRate : SPEC.otherLateRate);
        const dueDate = nextWorkday(addDays(day, supplier.leadTimeDays));
        const slip = unacknowledged ? rng.int(20, 60) : late ? (lateProne.has(supplierIndex) ? rng.int(8, 30) : rng.int(2, 7)) : rng.int(-2, 0);
        const arrival = nextWorkday(addDays(dueDate, slip));
        const order: PurchaseOrder = {
          id: `PO${100001 + purchaseOrders.length}`,
          supplierId: supplier.id,
          orderDate: day,
          acknowledgedDate: unacknowledged ? null : withinRange(nextWorkday(addDays(day, rng.int(1, 2)))),
          lines: low.map((entry, index) => ({
            line: index + 1,
            productId: entry.sim.product.id,
            qty: Math.max(entry.sim.maxQty * 2, Math.ceil(entry.sim.dailyDemand * rng.int(22, 36))),
            unitCost: entry.sim.product.unitCost,
            dueDate,
            originalDueDate: dueDate,
          })),
        };
        purchaseOrders.push(order);
        for (const line of order.lines) (simByProduct.get(line.productId) as ProductSim).onOrder += line.qty;

        const full = order.lines.map((line) => ({ line: line.line, qty: line.qty }));
        const splittable = order.lines.some((line) => line.qty > 1);
        if (splittable && rng.chance(PARTIAL_RECEIPT_RATE)) {
          const first = order.lines.map((line) => ({ line: line.line, qty: Math.max(1, Math.floor(line.qty * 0.6)) }));
          const rest = order.lines
            .map((line, index) => ({ line: line.line, qty: line.qty - (first[index] as { qty: number }).qty }))
            .filter((line) => line.qty > 0);
          planReceipt(arrival, { order, lines: first });
          if (rest.length > 0) planReceipt(nextWorkday(addDays(arrival, rng.int(3, 7))), { order, lines: rest });
        } else {
          planReceipt(arrival, { order, lines: full });
        }
      });
    }
  }

  return {
    meta: {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      source: 'dummy',
      seed: options.seed,
      startDate: options.startDate,
      endDate,
      openingCash: OPENING_CASH,
      simulated: ['creditors', 'cash'],
    },
    suppliers,
    customers,
    categories,
    products: sims.map((sim) => sim.product),
    openingStock,
    purchaseOrders,
    goodsReceipts,
    salesOrders,
    salesInvoices,
    purchaseInvoices,
  };
}
