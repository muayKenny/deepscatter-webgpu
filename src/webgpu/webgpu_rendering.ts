class Vec2 {
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

interface Point {
  position: Vec2;
}

export class WebGPUPointRenderer {
  private canvas: HTMLCanvasElement;
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private vertexBuffer: GPUBuffer;
  private pointData: Point[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async initialize() {
    // Get WebGPU adapter and device
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

    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: canvasFormat,
      alphaMode: 'premultiplied',
    });

    // Create shader
    const shaderModule = this.device.createShaderModule({
      label: 'Point shader',
      code: `
        struct VertexInput {
          @location(0) position: vec2f,
        };

        struct VertexOutput {
          @builtin(position) position: vec4f,
        };

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          var output: VertexOutput;
          output.position = vec4f(input.position, 0.0, 1.0);
          return output;
        }

        @fragment
        fn fragmentMain() -> @location(0) vec4f {
          return vec4f(1.0, 0.0, 0.0, 1.0); // Red points
        }
      `,
    });

    // Create render pipeline
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
            format: canvasFormat,
          },
        ],
      },
      primitive: {
        topology: 'point-list',
      },
    });
  }

  setData(points: Point[]) {
    this.pointData = points;

    // Create and fill vertex buffer
    const vertexData = new Float32Array(points.length * 2);
    points.forEach((point, i) => {
      vertexData[i * 2] = point.position[0];
      vertexData[i * 2 + 1] = point.position[1];
    });

    this.vertexBuffer = this.device.createBuffer({
      label: 'Point vertices',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData);
  }

  render() {
    // Get the current texture from the canvas context
    const colorTexture = this.context.getCurrentTexture();
    const colorView = colorTexture.createView();

    // Create command encoder
    const commandEncoder = this.device.createCommandEncoder();

    // Begin render pass
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: colorView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    // Set pipeline and vertex buffer
    renderPass.setPipeline(this.pipeline);
    renderPass.setVertexBuffer(0, this.vertexBuffer);

    // Draw points
    renderPass.draw(this.pointData.length, 1, 0, 0);

    // End render pass and submit commands
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}
