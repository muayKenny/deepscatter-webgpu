export class WebGPURenderer {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private opacityBuffer: GPUBuffer | null = null; // New buffer for opacities
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
            struct VertexOutput {
              @builtin(position) position: vec4f,
              @location(0) opacity: f32,
            }
    
            @vertex
            fn vertexMain(
              @location(0) position: vec2f,
              @location(1) opacity: f32
            ) -> VertexOutput {
              var output: VertexOutput;
              output.position = vec4f(position, 0.0, 1.0);
              output.opacity = opacity;
              return output;
            }
    
            @fragment
            fn fragmentMain(@location(0) opacity: f32) -> @location(0) vec4f {
              return vec4f(1.0, 1.0, 1.0, opacity);  // White stars with varying opacity
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
          {
            arrayStride: 4, // 1 float * 4 bytes
            attributes: [
              {
                shaderLocation: 1,
                offset: 0,
                format: 'float32',
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
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
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

    const numStars = 1000;
    const stars = new Float32Array(numStars * 2);
    this.starOpacities = new Float32Array(numStars);

    for (let i = 0; i < numStars * 2; i += 2) {
      stars[i] = Math.random() * 2 - 1;
      stars[i + 1] = Math.random() * 2 - 1;
      this.starOpacities[i / 2] = Math.random();
    }

    // Create and initialize vertex buffer
    this.vertexBuffer = this.device.createBuffer({
      size: stars.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(stars);
    this.vertexBuffer.unmap();

    // Create and initialize opacity buffer
    this.opacityBuffer = this.device.createBuffer({
      size: this.starOpacities.byteLength, // Each opacity value is 4 bytes (float32)
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true, // Changed from true
    });
    new Float32Array(this.opacityBuffer.getMappedRange()).set(
      this.starOpacities,
    );
    this.opacityBuffer.unmap();
  }

  private updateOpacities(): void {
    if (!this.device || !this.opacityBuffer || !this.starOpacities) return;

    // Update opacity values with smooth transitions
    for (let i = 0; i < 1000; i++) {
      const currentOpacity = this.starOpacities[i];
      const targetOpacity = 0.05 + Math.random() * 0.95; // Range from very dim (0.05) to full bright (1.0)
      this.starOpacities[i] =
        currentOpacity + (targetOpacity - currentOpacity) * 0.4;
    }

    // Write updated opacities to GPU buffer
    this.device.queue.writeBuffer(
      this.opacityBuffer,
      0,
      this.starOpacities.buffer,
      this.starOpacities.byteOffset,
      this.starOpacities.byteLength,
    );
  }

  render(): void {
    if (
      !this.device ||
      !this.context ||
      !this.pipeline ||
      !this.vertexBuffer ||
      !this.opacityBuffer ||
      !this.starOpacities
    ) {
      return;
    }

    console.log('render');
    // Update star opacities
    this.updateOpacities();

    // Update opacity buffer
    this.device.queue.writeBuffer(this.opacityBuffer, 0, this.starOpacities);

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.1, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setVertexBuffer(1, this.opacityBuffer);
    renderPass.draw(1000);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
}
