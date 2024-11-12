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

    const shaderModule = this.device.createShaderModule({
      label: 'Point shader',
      code: `
        struct VertexInput {
          @location(0) position: vec2f,
        };
    
        struct VertexOutput {
          @builtin(position) position: vec4f,
          @location(0) color: vec4f,
          @location(1) uv: vec2f,
        };
    
       @vertex
        fn vertexMain(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
          var output: VertexOutput;
          
          // Make size much smaller
          let size = 0.005;  // reduced from 0.02
          
          // Vertex indices 0-5 for each point
          let vertexInQuad = vertexIndex % 6u;
          
          let corners = array<vec2f, 6>(
            vec2f(-1.0, -1.0),  
            vec2f( 1.0, -1.0),
            vec2f( 1.0,  1.0),
            vec2f(-1.0, -1.0),  
            vec2f( 1.0,  1.0),
            vec2f(-1.0,  1.0)
          );
          
          let corner = corners[vertexInQuad];
          
          let worldPos = input.position;
          let offset = corner * size;
          output.position = vec4f(worldPos + offset, 0.0, 1.0);
          
          output.uv = corner;
          output.color = vec4f(
            (input.position.x + 1.0) / 2.0,
            (input.position.y + 1.0) / 2.0,
            0.5,
            1.0
          );
          
          return output;
        }
    
        @fragment
        fn fragmentMain(
          @location(0) color: vec4f,
          @location(1) uv: vec2f
        ) -> @location(0) vec4f {
          let dist = length(uv);
          
          if (dist > 1.0) {
            discard;
          }
          
          let smoothing = .7;
          let alpha = 1.0 - smoothstep(1.0 - smoothing, 1.0, dist);
          
          return vec4f(color.rgb, color.a * alpha);
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
        topology: 'triangle-list',
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

    const numPoints = points.length / 2;
    this.vertexCount = numPoints * 6; // 6 vertices per point

    const vertexData = new Float32Array(numPoints * 6 * 2);

    console.log('Number of input points:', numPoints);
    console.log('Creating vertex buffer with size:', vertexData.length);

    for (let i = 0; i < numPoints; i++) {
      const x = points[i * 2];
      const y = points[i * 2 + 1];

      if (i % 100 === 0) {
        console.log(`Processing point ${i}: (${x}, ${y})`);
        console.log(`Writing to indices ${i * 12} through ${i * 12 + 11}`);
      }

      for (let j = 0; j < 6; j++) {
        vertexData[i * 12 + j * 2] = x;
        vertexData[i * 12 + j * 2 + 1] = y;
      }
    }

    const bufferSize = vertexData.byteLength;
    this.vertexBuffer = this.device.createBuffer({
      label: 'Point vertices',
      size: bufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData);
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
