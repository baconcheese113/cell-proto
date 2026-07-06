// cpm-gpu-device.ts — worker-safe WebGPU device acquisition. Returns a soft error object instead
// of throwing, so callers (bench, later the sim worker) can degrade gracefully.

// Minimal ambient decls so we don't pull in @webgpu/types for a prototype.
declare const GPUBufferUsage: {
  STORAGE: number; COPY_DST: number; COPY_SRC: number; UNIFORM: number; MAP_READ: number;
};
declare const GPUMapMode: { READ: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GpuHandle = { device: any; queue: any };

export async function acquireGpu(): Promise<GpuHandle | { error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as unknown as { gpu?: any }).gpu;
  if (!gpu) return { error: "WebGPU not available (navigator.gpu missing)" };
  const adapter = await gpu.requestAdapter();
  if (!adapter) return { error: "no GPU adapter" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const device: any = await adapter.requestDevice();
  return { device, queue: device.queue };
}

// Re-export the ambient flag enums as runtime values for buffer creation elsewhere.
export const BUF = {
  STORAGE: (): number => GPUBufferUsage.STORAGE,
  COPY_DST: (): number => GPUBufferUsage.COPY_DST,
  COPY_SRC: (): number => GPUBufferUsage.COPY_SRC,
  UNIFORM: (): number => GPUBufferUsage.UNIFORM,
  MAP_READ: (): number => GPUBufferUsage.MAP_READ,
};
export const MAP_READ_FLAG = (): number => GPUMapMode.READ;
