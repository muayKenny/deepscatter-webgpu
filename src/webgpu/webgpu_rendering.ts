export class Vec2 {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  toArray(): [number, number] {
    return [this.x, this.y];
  }
}

export interface Point {
  position: Vec2;
}

export class WebGPURenderer {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private vertexBuffer: GPUBuffer;
  // private pointData: Point[] = [];
  private vertexCount: number = 0; // Add this to track vertex count

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async initialize() {
    // Previous initialization code remains the same...
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('No appropriate GPUAdapter found');
    }

    this.device = await adapter.requestDevice();

    // Set up canvas context
    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    if (!this.context) {
      throw new Error('Failed to get WebGPU context');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied',
    });

    await this.createPipeline(format);
  }

  private async createPipeline(format: GPUTextureFormat): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');

    // Modified shader with debug colors based on position
    const shaderModule = this.device.createShaderModule({
      label: 'Point shader',
      code: `
        struct VertexInput {
          @location(0) position: vec2f,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) color: vec4f,
        };

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.position = vec4f(input.position, 0.0, 1.0);
          
          // Debug coloring based on position
          output.color = vec4f(
            (input.position.x + 1.0) / 2.0,  // R: x mapped to 0-1
            (input.position.y + 1.0) / 2.0,  // G: y mapped to 0-1
            0.5,                             // B: constant
            1.0                              // A: constant
          );
          
          return output;
        }

        @fragment
        fn fragmentMain(@location(0) color: vec4f) -> @location(0) vec4f {
          return color; // Use interpolated color from vertex shader
        }
      `,
    });

    // Modified pipeline to include color output
    this.pipeline = this.device.createRenderPipeline({
      label: 'Point pipeline',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 8, // 2 * float32
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
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'point-list',
        // Add point size
        stripIndexFormat: undefined,
      },
    });
  }

  setDataArray(points: Float32Array) {
    if (!points || points.length === 0) {
      console.error('Received empty or null points array');
      return;
    }

    // Debug logging
    this.vertexCount = points.length / 2;
    console.log(`Setting up ${this.vertexCount} vertices`);
    console.log(
      'First few points:',
      Array.from(points.slice(0, Math.min(10, points.length)))
        .map((v, i) => (i % 2 === 0 ? `\n(${v},` : `${v})`))
        .join(''),
    );

    const bufferSize = points.byteLength;
    this.vertexBuffer = this.device.createBuffer({
      label: 'Point vertices',
      size: bufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(this.vertexBuffer, 0, points);
  }

  render() {
    if (!this.vertexBuffer || this.vertexCount === 0) {
      console.warn('No vertices to render');
      return;
    }

    const commandEncoder = this.device.createCommandEncoder();
    const colorTexture = this.context.getCurrentTexture();
    const colorView = colorTexture.createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.0, g: 0.0, b: 0.1, a: 1.0 }, // Slightly blue background
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.draw(this.vertexCount, 1, 0, 0);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
}
