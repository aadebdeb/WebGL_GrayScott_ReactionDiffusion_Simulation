(function() {

  function createShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) + source);
    }
    return shader;
  }
  
  function createProgramFromSource(gl, vertexShaderSource, fragmentShaderSource) {
    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl, vertexShaderSource, gl.VERTEX_SHADER));
    gl.attachShader(program, createShader(gl, fragmentShaderSource, gl.FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  }

  function createVbo(gl, array, usage) {
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, array, usage !== undefined ? usage : gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return vbo;
  }

  function createIbo(gl, array) {
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, array, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    return ibo;
  }

  function getUniformLocations(gl, program, keys) {
    const locations = {};
    keys.forEach(key => {
        locations[key] = gl.getUniformLocation(program, key);
    });
    return locations;
  }

  function createFramebuffer(gl, sizeX, sizeY) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sizeX, sizeY, 0, gl.RG, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return {
      framebuffer: framebuffer,
      texture: texture
    };
  }

  const VERTICES_POSITION = new Float32Array([
    -1.0, -1.0,
    1.0, -1.0,
    -1.0,  1.0,
    1.0,  1.0
  ]);

  const VERTICES_INDEX = new Int16Array([
    0, 1, 2,
    3, 2, 1
  ]);


  const FILL_SCREEN_VERTEX_SHADER_SOURCE =
`#version 300 es

layout (location = 0) in vec2 position;

void main(void) {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

  const INITIALIZE_FRAGMENT_SHADER_SOURCE =
`#version 300 es

precision highp float;

out vec2 o_state;

uniform vec2 u_resolution;
uniform vec2 u_randomSeed;

float random(vec2 x){
  return fract(sin(dot(x,vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
  vec2 st = (2.0 * gl_FragCoord.xy - u_resolution) / min(u_resolution.x, u_resolution.y);
  if (length(st) < 0.3) {
    o_state = vec2(
      random(gl_FragCoord.xy * 0.15 + u_randomSeed + vec2(231.32, 171.92)),
      random(gl_FragCoord.xy * 0.21 + u_randomSeed + vec2(131.17, 319.23))
    );
  } else {
    o_state = vec2(0.0);
  }
}
`;

  const UPDATE_FRAGMENT_SHADER_SOURCE =
`#version 300 es

precision highp float;

out vec2 o_state;

uniform sampler2D u_stateTexture;
uniform float u_timeStep;
uniform float u_spaceStep;
uniform vec2 u_diffusion;
uniform float u_feed;
uniform float u_kill;

void main(void) {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  ivec2 stateTextureSize = textureSize(u_stateTexture, 0);

  vec2 state = texelFetch(u_stateTexture, coord, 0).xy;

  vec2 left = texelFetch(u_stateTexture, ivec2(coord.x != 0 ? coord.x - 1 : stateTextureSize.x - 1, coord.y), 0).xy;
  vec2 right = texelFetch(u_stateTexture, ivec2(coord.x != stateTextureSize.x - 1 ? coord.x + 1 : 0, coord.y), 0).xy;
  vec2 up = texelFetch(u_stateTexture, ivec2(coord.x, coord.y != 0 ? coord.y - 1 : stateTextureSize.y - 1), 0).xy;
  vec2 down = texelFetch(u_stateTexture, ivec2(coord.x, coord.y != stateTextureSize.y - 1 ? coord.y + 1 : 0), 0).xy;

  vec2 laplacian = (left + right + up + down - 4.0 * state) / (u_spaceStep * u_spaceStep);

  o_state = state + u_timeStep * (u_diffusion * laplacian + vec2(
    state.x * state.x * state.y - (u_feed + u_kill) * state.x,
    -state.x * state.x * state.y + u_feed * (1.0 - state.y)
  ));
}
`

  const RENDER_FRAGMNET_SHADER_SOURCE =
`#version 300 es

precision highp float;

out vec4 o_color;

uniform sampler2D u_stateTexture;
uniform int u_draw;

void main(void) {
  vec2 state = texelFetch(u_stateTexture, ivec2(gl_FragCoord.xy), 0).xy;

  if (u_draw == 0) {
    o_color = vec4(vec3(state.x), 1.0);
  } else if (u_draw == 1) {
    o_color = vec4(vec3(state.y), 1.0);
  } else {
    o_color = vec4(vec3(abs(state.x - state.y)), 1.0);
  }
}
`;

  const parameters = {
    'diffusion U': 0.0009,
    'diffusion V': 0.004,
    'feed': 0.09,
    'kill': 0.06,
    'space step': 0.05,
    'time step': 0.1,
    'time scale': 20.0,
    'draw': 2,
    reset: _ => reset()
  };

  const stats = new Stats();
  document.body.appendChild(stats.dom);
  const gui = new dat.GUI();
  gui.add(parameters, 'diffusion U', 0.00001, 0.01).step(0.00001);
  gui.add(parameters, 'diffusion V', 0.00001, 0.01).step(0.00001);
  gui.add(parameters, 'feed', 0.0, 0.1).step(0.0001);
  gui.add(parameters, 'kill', 0.0, 0.1).step(0.0001);
  gui.add(parameters, 'space step', 0.01, 0.1).step(0.001);
  gui.add(parameters, 'time step', 0.001, 0.1).step(0.001);
  gui.add(parameters, 'time scale', 0.0, 300.0);
  gui.add(parameters, 'draw', {'u': 0, 'v': 1, 'abs(u-v)': 2});
  gui.add(parameters, 'reset');

  const canvas = document.getElementById('canvas');
  const gl = canvas.getContext('webgl2');
  gl.getExtension('EXT_color_buffer_float');

  const initializeProgram = createProgramFromSource(gl, FILL_SCREEN_VERTEX_SHADER_SOURCE, INITIALIZE_FRAGMENT_SHADER_SOURCE);
  const updateProgram = createProgramFromSource(gl, FILL_SCREEN_VERTEX_SHADER_SOURCE, UPDATE_FRAGMENT_SHADER_SOURCE);
  const renderProgram = createProgramFromSource(gl, FILL_SCREEN_VERTEX_SHADER_SOURCE, RENDER_FRAGMNET_SHADER_SOURCE);
  const initializeUniforms = getUniformLocations(gl, initializeProgram, ['u_resolution','u_randomSeed']);
  const updateUniforms = getUniformLocations(gl, updateProgram, ['u_stateTexture', 'u_diffusion', 'u_feed', 'u_kill', 'u_timeStep', 'u_spaceStep']);
  const renderUniforms = getUniformLocations(gl, renderProgram, ['u_stateTexture', 'u_draw']);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, createIbo(gl, VERTICES_INDEX));
  gl.bindBuffer(gl.ARRAY_BUFFER, createVbo(gl, VERTICES_POSITION));
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const renderToFillScreen = function() {
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  };

  let animationId = null;
  const reset = function() {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0.0, 0.0, canvas.width, canvas.height);

    let stateFbObjR = createFramebuffer(gl, canvas.width, canvas.height);
    let stateFbObjW = createFramebuffer(gl, canvas.width, canvas.height);
    const swapFramebuffer = function() {
      const tmp = stateFbObjR;
      stateFbObjR = stateFbObjW;
      stateFbObjW = tmp;
    };

    const initialize = function() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbObjW.framebuffer);
      gl.useProgram(initializeProgram);
      gl.uniform2f(initializeUniforms['u_resolution'], canvas.width, canvas.height);
      gl.uniform2f(initializeUniforms['u_randomSeed'], Math.random() * 1000.0, Math.random() * 1000.0);
      renderToFillScreen();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      swapFramebuffer();
    };

    const update = function(deltaTime) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbObjW.framebuffer)
      gl.useProgram(updateProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stateFbObjR.texture);
      gl.uniform1i(updateUniforms['u_stateTexture'], 0);
      gl.uniform2f(updateUniforms['u_diffusion'], parameters['diffusion U'], parameters['diffusion V']);
      gl.uniform1f(updateUniforms['u_feed'], parameters['feed']);
      gl.uniform1f(updateUniforms['u_kill'], parameters['kill']);
      gl.uniform1f(updateUniforms['u_timeStep'], deltaTime);
      gl.uniform1f(updateUniforms['u_spaceStep'], parameters['space step']);
      renderToFillScreen();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      swapFramebuffer();
    };

    const render = function() {
      gl.useProgram(renderProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stateFbObjR.texture);
      gl.uniform1i(renderUniforms['u_stateTexture'], 0);
      gl.uniform1i(renderUniforms['u_draw'], parameters['draw']);
      renderToFillScreen();
    }

    initialize();
    let simulationSeconds = 0.0;
    let previousRealSeconds = performance.now() * 0.001;
    const loop = function() {
      stats.update();

      const currentRealSeconds = performance.now() * 0.001;
      const nextSimulationSeconds = simulationSeconds + parameters['time scale'] * Math.min(0.2, currentRealSeconds - previousRealSeconds);
      previousRealSeconds = currentRealSeconds;

      const timeStep = parameters['time step'];
      while(nextSimulationSeconds - simulationSeconds > timeStep) {
        update(timeStep);
        simulationSeconds += timeStep;
      }
      render();

      animationId = requestAnimationFrame(loop);
    }
    loop();
  };
  reset();

}());