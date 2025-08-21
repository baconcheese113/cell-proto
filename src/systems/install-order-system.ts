import { NetComponent } from "../network/net-entity";
import { RunOnServer } from "../network/decorators";
import type { InstallOrder, ProteinId } from "../core/world-refs";
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

  constructor(bus: NetBus) { 
    super(bus); 
  }

  @RunOnServer()
  createInstallOrder(proteinId: ProteinId, destHex: HexCoord, playerId?: string): InstallOrderResult {
    const actualPlayerId = playerId || (this._isHost ? 'host' : 'client');
    console.log(`📤 SERVER: Creating install order for ${proteinId} at (${destHex.q}, ${destHex.r}) for player ${actualPlayerId}`);

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
      createdAt: Date.now()
    };

    // Add to replicated state
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
   * Get all pending install orders for consumption by CellProduction
   */
  getAllOrders(): InstallOrder[] {
    return Object.values(this.orderState.orders);
  }

  /**
   * Remove an order from the replicated state (used by CellProduction after processing)
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
