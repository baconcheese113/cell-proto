import { NetComponent, type NetComponentOptions } from "../network/net-entity";
import { RunOnServer } from "../network/decorators";
import type { InstallOrder, ProteinId, CargoItinerary, CargoStage } from "../core/world-refs";
import type { NetBus } from "@/network/net-bus";
import type { HexCoord } from "@/hex/hex-grid";

type InstallOrderResult = {
  success: boolean;
  message: string;
  orderId?: string;
};

type InstallOrderState = {
  orders: Record<string, InstallOrder>;
};

export class InstallOrderSystem extends NetComponent {
  private orderState = this.stateChannel<InstallOrderState>('installOrder.orders', { orders: {} });

  constructor(bus: NetBus, opts?: NetComponentOptions) { 
    super(bus, opts);
  }

  @RunOnServer()
  createInstallOrder(proteinId: ProteinId, destHex: HexCoord): InstallOrderResult {
    // Check for existing install orders targeting this destination
    for (const order of Object.values(this.orderState.orders)) {
      if (order.destHex && order.destHex.q === destHex.q && order.destHex.r === destHex.r) {
        console.log(`🚫 Blocking duplicate request: Install order ${order.id} already targeting (${destHex.q}, ${destHex.r})`);
        return {
          success: false,
          message: `Install order already exists for (${destHex.q}, ${destHex.r})`
        };
      }
    }

    // Generate unique order ID
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create the install order
    const installOrder: InstallOrder = {
      id: orderId,
      proteinId,
      destHex,
      createdAt: Date.now(),
      itinerary: this.createStandardItinerary(destHex)
    };

    // Add to replicated state (only HOST can modify)
    this.orderState.orders[orderId] = installOrder;

    console.log(`✅ Install order ${orderId} created successfully`);
    return {
      success: true,
      message: `Install order created for ${proteinId}`,
      orderId
    };
  }

  @RunOnServer()
  cancelInstallOrder(orderId: string): InstallOrderResult {
    console.log(`🗑️ SERVER: Canceling install order ${orderId}`);
    
    if (!this.orderState.orders[orderId]) {
      return {
        success: false,
        message: "Install order not found"
      };
    }

    delete this.orderState.orders[orderId];
    
    console.log(`✅ Install order ${orderId} canceled successfully`);
    return {
      success: true,
      message: "Install order canceled"
    };
  }

  /**
   * Create standard itinerary for membrane protein production
   */
  private createStandardItinerary(destHex: HexCoord): CargoItinerary {
    const stages: CargoStage[] = [];
    
    // Stage 1: Nucleus processing (transcription)
    stages.push({
      kind: 'nucleus',
      enterMs: 1000,
      processMs: 2000
    });

    // Stage 2: ER processing (translation/folding)
    stages.push({
      kind: 'proto-er',
      enterMs: 1000,
      processMs: 3000
    });

    // Stage 3: Golgi processing (modification/packaging)
    stages.push({
      kind: 'golgi',
      enterMs: 1000,
      processMs: 2500
    });

    // Stage 4: Membrane installation
    stages.push({
      kind: 'transporter',
      targetHex: destHex,
      enterMs: 500,
      processMs: 2000
    });

    return {
      stages,
      stageIndex: 0
    };
  }

  /**
   * Get all pending install orders for consumption
   */
  getAllOrders(): InstallOrder[] {
    return Object.values(this.orderState.orders);
  }

  /**
   * Remove an order from the replicated state
   */
  @RunOnServer()
  removeProcessedOrder(orderId: string): void {
    console.log(`🔄 SERVER: Removing processed install order ${orderId}`);
    delete this.orderState.orders[orderId];
  }

  /**
   * Get order count for UI display
   */
  getOrderCount(): number {
    return Object.keys(this.orderState.orders).length;
  }
}
