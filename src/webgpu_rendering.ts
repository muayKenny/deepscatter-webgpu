// import { Renderer } from './rendering';

// export class WebGPURenderer extends Renderer {

export class WebGPURenderer {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private intervalId: number | null = null; // Store the interval ID

  private starOpacities: Float32Array | null = null;

  constructor(private canvas: HTMLCanvasElement) {}

  async initialize(): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found');

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');

    if (!this.context) throw new Error('Could not get WebGPU context');

    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied',
    });

    await this.createPipeline(format);
    this.createStarfield();
  }

  private async createPipeline(format: GPUTextureFormat): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');

    const shaderModule = this.device.createShaderModule({
      code: `
              @vertex
              fn vertexMain(@location(0) position: vec2f) -> @builtin(position) vec4f {
                return vec4f(position, 0.0, 1.0);
              }
      
              @fragment
              fn fragmentMain() -> @location(0) vec4f {
                return vec4f(1.0, 1.0, 1.0, 1.0);  // White stars
              }
            `,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 8, // 2 floats * 4 bytes
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: 'float32x2',
              },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: format,
          },
        ],
      },
      primitive: {
        topology: 'point-list',
      },
    });
  }

  private createStarfield(): void {
    if (!this.device) throw new Error('Device not initialized');

    // Create random star positions
    const numStars = 1000;
    const stars = new Float32Array(numStars * 2); // x,y for each star
    this.starOpacities = new Float32Array(numStars); // Opacities for each star

    for (let i = 0; i < numStars * 2; i += 2) {
      stars[i] = Math.random() * 2 - 1; // x: -1 to 1
      stars[i + 1] = Math.random() * 2 - 1; // y: -1 to 1
      this.starOpacities[i / 2] = Math.random(); // Random opacity between 0 and 1
    }

    this.vertexBuffer = this.device.createBuffer({
      size: stars.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });

    new Float32Array(this.vertexBuffer.getMappedRange()).set(stars);
    this.vertexBuffer.unmap();
  }

  render(): void {
    if (!this.device || !this.context || !this.pipeline || !this.vertexBuffer) {
      return;
    }
    if (this.starOpacities) {
      for (let i = 0; i < this.starOpacities.length; i++) {
        this.starOpacities[i] = Math.random(); // Random opacity for twinkling
      }
    }

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.1, a: 1.0 }, // Dark blue background
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.draw(1000); // Number of stars
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  startTwinkling(interval: number): void {
    // Clear any existing interval to avoid multiple intervals running simultaneously
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(() => {
      this.render(); // Call your render method to update the stars
    }, interval);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
}
