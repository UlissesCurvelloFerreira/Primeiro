"use strict";

// ============================================================
// CONFIGURAÇÃO DO FORMATO WEB
// ============================================================

const CONFIG = Object.freeze({
  initialCircumference: 160,
  filledWidth: 6,
  emptySpace: 7,
  ringCount: 5,
  totalPartitions: 320,
  ringRotations: [0, 7, 15, 24, 34],
  background: "#231F20",
  bit1Color: "#FFFFFF",
  bit0Color: "#8A8A8A",
  magic: new Uint8Array([0x43, 0x51]), // "CQ"
  version: 3,
  headerSize: 12,
  maskSeed: 0x6D2B79F5,
  outputSize: 1400,
  analysisSize: 1024,
  markerSize: 18,
  markerDotRadius: 0.10,
  cameraScanIntervalMs: 420,
  cameraConfirmations: 1,
});

const DICTIONARY = new Map([
  [0x01, "https://"],
  [0x02, "http://"],
  [0x03, "www."],
  [0x04, ".com.br"],
  [0x05, ".com"],
  [0x06, ".org"],
  [0x07, ".net"],
  [0x08, ".gov.br"],
  [0x09, "://"],
  [0x0A, "/"],
]);

const ORDERED_DICTIONARY = [...DICTIONARY.entries()]
  .sort((a, b) => b[1].length - a[1].length);

// Comprimentos canônicos extraídos da mesma tabela Huffman usada no Python.
// Assim, o pacote binário continua compatível com a versão 3 do codec original.
const HUFFMAN_LENGTHS = [
  15,5,5,5,5,5,5,5,5,5,5,15,15,15,15,15,15,15,14,14,15,14,15,15,15,15,15,15,15,15,15,15,
  9,15,14,14,15,6,6,15,14,15,15,14,14,7,6,6,6,7,7,7,6,6,6,7,7,6,7,15,15,7,15,6,
  15,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,14,15,15,15,6,
  15,6,6,6,6,6,6,6,7,6,6,7,6,6,6,6,6,7,7,7,6,6,6,7,6,6,7,15,15,15,15,14,
  8,8,8,8,15,15,15,8,15,15,14,14,15,14,14,14,14,14,14,15,15,15,15,15,15,15,15,14,14,14,15,15,
  15,8,15,8,15,15,15,8,15,8,15,15,15,8,15,14,14,14,14,14,14,14,15,15,14,15,15,15,15,15,15,15,
  15,15,15,8,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,
  15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

// ============================================================
// HUFFMAN CANÔNICO
// ============================================================

function buildCanonicalHuffman(lengths) {
  const ordered = lengths
    .map((length, symbol) => ({ symbol, length }))
    .sort((a, b) => a.length - b.length || a.symbol - b.symbol);

  let currentCode = 0;
  let previousLength = ordered[0].length;
  const codes = new Array(256);
  const root = {};

  for (const item of ordered) {
    currentCode *= 2 ** (item.length - previousLength);
    codes[item.symbol] = { code: currentCode, length: item.length };

    let node = root;
    for (let bitIndex = item.length - 1; bitIndex >= 0; bitIndex -= 1) {
      const bit = Math.floor(currentCode / (2 ** bitIndex)) & 1;
      node[bit] ??= {};
      node = node[bit];
    }
    node.symbol = item.symbol;

    currentCode += 1;
    previousLength = item.length;
  }

  return { codes, root };
}

const HUFFMAN = buildCanonicalHuffman(HUFFMAN_LENGTHS);

function applyDictionary(text) {
  let transformed = text;
  for (const [token, fragment] of ORDERED_DICTIONARY) {
    transformed = transformed.split(fragment).join(String.fromCharCode(token));
  }
  return textEncoder.encode(transformed);
}

function reverseDictionary(bytes) {
  let transformed = textDecoder.decode(bytes);
  for (const [token, fragment] of ORDERED_DICTIONARY) {
    transformed = transformed.split(String.fromCharCode(token)).join(fragment);
  }
  return transformed;
}

function huffmanEncode(bytes) {
  const bits = [];
  for (const byte of bytes) {
    const { code, length } = HUFFMAN.codes[byte];
    for (let index = length - 1; index >= 0; index -= 1) {
      bits.push(Math.floor(code / (2 ** index)) & 1);
    }
  }
  return bits;
}

function huffmanDecode(bits, symbolCount) {
  const result = new Uint8Array(symbolCount);
  let resultIndex = 0;
  let bitIndex = 0;
  let node = HUFFMAN.root;

  while (resultIndex < symbolCount && bitIndex < bits.length) {
    node = node[bits[bitIndex]];
    bitIndex += 1;

    if (!node) {
      throw new Error("Fluxo Huffman inválido.");
    }

    if (Number.isInteger(node.symbol)) {
      result[resultIndex] = node.symbol;
      resultIndex += 1;
      node = HUFFMAN.root;
    }
  }

  if (resultIndex !== symbolCount) {
    throw new Error("O fluxo Huffman terminou antes do esperado.");
  }

  return result;
}

// ============================================================
// BITS, CRC32 E PACOTE
// ============================================================

function bytesToBits(bytes) {
  const bits = [];
  for (const byte of bytes) {
    for (let position = 7; position >= 0; position -= 1) {
      bits.push((byte >> position) & 1);
    }
  }
  return bits;
}

function bitsToBytes(bits) {
  const byteLength = Math.ceil(bits.length / 8);
  const result = new Uint8Array(byteLength);

  for (let index = 0; index < byteLength * 8; index += 1) {
    const bit = index < bits.length ? bits[index] : 0;
    result[Math.floor(index / 8)] = (result[Math.floor(index / 8)] << 1) | bit;
  }

  return result;
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[n] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeUint16BE(target, offset, value) {
  target[offset] = (value >>> 8) & 0xFF;
  target[offset + 1] = value & 0xFF;
}

function writeUint32BE(target, offset, value) {
  target[offset] = (value >>> 24) & 0xFF;
  target[offset + 1] = (value >>> 16) & 0xFF;
  target[offset + 2] = (value >>> 8) & 0xFF;
  target[offset + 3] = value & 0xFF;
}

function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}

function createPacket(content) {
  const original = textEncoder.encode(content);
  const checksum = crc32(original);
  const tokenBytes = applyDictionary(content);
  const huffmanBits = huffmanEncode(tokenBytes);
  const compressed = bitsToBytes(huffmanBits);

  const compressionEnabled = compressed.length < original.length;
  const payload = compressionEnabled ? compressed : original;
  const tokenCount = compressionEnabled ? tokenBytes.length : original.length;

  if (tokenCount > 0xFFFF || payload.length > 0xFFFF) {
    throw new Error("O conteúdo ultrapassa o limite estrutural do pacote.");
  }

  const packet = new Uint8Array(CONFIG.headerSize + payload.length);
  packet.set(CONFIG.magic, 0);
  packet[2] = CONFIG.version;
  packet[3] = compressionEnabled ? 1 : 0;
  writeUint16BE(packet, 4, tokenCount);
  writeUint16BE(packet, 6, payload.length);
  writeUint32BE(packet, 8, checksum);
  packet.set(payload, CONFIG.headerSize);

  return {
    packet,
    payloadLength: payload.length,
    originalLength: original.length,
    tokenCount,
    compressionEnabled,
  };
}

function decodePacket(bytes) {
  if (bytes.length < CONFIG.headerSize) {
    throw new Error("O pacote recuperado está incompleto.");
  }
  if (bytes[0] !== CONFIG.magic[0] || bytes[1] !== CONFIG.magic[1]) {
    throw new Error("A assinatura do código não foi reconhecida.");
  }
  if (bytes[2] !== CONFIG.version) {
    throw new Error(`Versão não suportada: ${bytes[2]}.`);
  }

  const compressionFlag = bytes[3];
  const tokenCount = readUint16BE(bytes, 4);
  const payloadLength = readUint16BE(bytes, 6);
  const expectedChecksum = readUint32BE(bytes, 8);
  const payloadEnd = CONFIG.headerSize + payloadLength;

  if (payloadEnd > bytes.length) {
    throw new Error("O conteúdo recuperado está incompleto.");
  }

  const payload = bytes.slice(CONFIG.headerSize, payloadEnd);
  let content;

  if (compressionFlag === 1) {
    const decodedTokens = huffmanDecode(bytesToBits(payload), tokenCount);
    content = reverseDictionary(decodedTokens);
  } else if (compressionFlag === 0) {
    content = textDecoder.decode(payload);
  } else {
    throw new Error("Indicador de compressão inválido.");
  }

  const actualChecksum = crc32(textEncoder.encode(content));
  if (actualChecksum !== expectedChecksum) {
    throw new Error("A verificação CRC32 falhou. Reposicione a imagem e tente novamente.");
  }

  return content;
}

function generateMask(bitCount, seed = CONFIG.maskSeed) {
  let state = seed >>> 0;
  const mask = new Array(bitCount);

  for (let index = 0; index < bitCount; index += 1) {
    state = (state ^ ((state << 13) >>> 0)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ ((state << 5) >>> 0)) >>> 0;
    mask[index] = state & 1;
  }

  return mask;
}

function applyMask(bits) {
  const mask = generateMask(bits.length);
  return bits.map((bit, index) => bit ^ mask[index]);
}

// ============================================================
// GEOMETRIA E DISTRIBUIÇÃO
// ============================================================

function circumferenceToRadius(circumference) {
  return circumference / (2 * Math.PI);
}

function buildRings() {
  const rings = [];
  let current = CONFIG.initialCircumference;

  for (let index = 0; index < CONFIG.ringCount; index += 1) {
    rings.push([current, current + CONFIG.filledWidth]);
    current += CONFIG.filledWidth + CONFIG.emptySpace;
  }

  return rings;
}

function distributePartitions(rings, totalPartitions = CONFIG.totalPartitions) {
  const means = rings.map(([start, end]) => (start + end) / 2);
  const sum = means.reduce((accumulator, value) => accumulator + value, 0);
  const realValues = means.map((value) => totalPartitions * value / sum);
  const result = realValues.map(Math.floor);
  let remaining = totalPartitions - result.reduce((accumulator, value) => accumulator + value, 0);

  const orderedIndices = realValues
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
    .map((item) => item.index);

  for (let index = 0; index < remaining; index += 1) {
    result[orderedIndices[index]] += 1;
  }

  return result;
}

const RINGS = buildRings();
const PARTITIONS_PER_RING = distributePartitions(RINGS);
const RING_MID_RADII = RINGS.map(([start, end]) => (
  circumferenceToRadius(start) + circumferenceToRadius(end)
) / 2);
const RING_RADIAL_WIDTH = circumferenceToRadius(CONFIG.filledWidth);
const OUTER_RADIUS = circumferenceToRadius(RINGS[RINGS.length - 1][1]);
const MAX_PACKET_BYTES = Math.floor(CONFIG.totalPartitions * 2 / 8);
const MAX_PAYLOAD_BYTES = MAX_PACKET_BYTES - CONFIG.headerSize;

function distributeBits(bits, counts) {
  const result = [];
  let cursor = 0;
  for (const count of counts) {
    result.push(bits.slice(cursor, cursor + count));
    cursor += count;
  }
  if (cursor !== bits.length) {
    throw new Error("A quantidade de bits não corresponde à geometria configurada.");
  }
  return result;
}

function prepareEncodedBits(content) {
  const packetInfo = createPacket(content);
  const packetBits = bytesToBits(packetInfo.packet);
  const capacityBits = CONFIG.totalPartitions * 2;

  if (packetBits.length > capacityBits) {
    throw new Error(
      `Conteúdo grande demais. Após a compactação, o payload usa ${packetInfo.payloadLength} ` +
      `de ${MAX_PAYLOAD_BYTES} bytes disponíveis. Use um link menor ou um encurtador de URL.`
    );
  }

  const logicalBits = packetBits.concat(new Array(capacityBits - packetBits.length).fill(0));
  const visualBits = applyMask(logicalBits);
  const colorBits = visualBits.slice(0, CONFIG.totalPartitions);
  const gapBits = visualBits.slice(CONFIG.totalPartitions);

  return {
    ...packetInfo,
    colorBits,
    gapBits,
    colorByRing: distributeBits(colorBits, PARTITIONS_PER_RING),
    gapByRing: distributeBits(gapBits, PARTITIONS_PER_RING),
  };
}

// ============================================================
// DESENHO DO CÓDIGO
// ============================================================

function drawCentralMarker(context, centerX, centerY, scale) {
  const markerSize = CONFIG.markerSize * scale;
  const half = markerSize / 2;
  const stroke = Math.max(5, 0.95 * scale);

  context.save();
  context.strokeStyle = CONFIG.bit1Color;
  context.fillStyle = CONFIG.bit1Color;
  context.lineWidth = stroke;
  context.lineCap = "round";
  context.lineJoin = "round";

  // Moldura quadrada: fornece centro e escala de referência.
  context.strokeRect(centerX - half, centerY - half, markerSize, markerSize);

  // Cruz central: ajuda o usuário a alinhar o código ao guia da câmera.
  const crossHalf = markerSize * 0.23;
  context.beginPath();
  context.moveTo(centerX - crossHalf, centerY);
  context.lineTo(centerX + crossHalf, centerY);
  context.moveTo(centerX, centerY - crossHalf);
  context.lineTo(centerX, centerY + crossHalf);
  context.stroke();

  // Ponto assimétrico maior: oferece uma estimativa rápida da rotação.
  const dotRadius = markerSize * CONFIG.markerDotRadius;
  context.beginPath();
  context.arc(
    centerX + markerSize * 0.29,
    centerY - markerSize * 0.29,
    dotRadius,
    0,
    Math.PI * 2
  );
  context.fill();
  context.restore();
}

function drawCircularCode(canvas, encoded) {
  canvas.width = CONFIG.outputSize;
  canvas.height = CONFIG.outputSize;

  const context = canvas.getContext("2d", { alpha: false });
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const scale = (canvas.width * 0.42) / OUTER_RADIUS;
  const radialGapUnit = CONFIG.filledWidth / (2 * Math.PI);
  const narrowGapUnits = radialGapUnit * 1.35;
  const wideGapUnits = radialGapUnit * 2.7;

  context.fillStyle = CONFIG.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let ringIndex = 0; ringIndex < RINGS.length; ringIndex += 1) {
    const [innerCircumference, outerCircumference] = RINGS[ringIndex];
    const innerRadius = circumferenceToRadius(innerCircumference);
    const outerRadius = circumferenceToRadius(outerCircumference);
    const middleRadius = (innerRadius + outerRadius) / 2;
    const lineWidth = (outerRadius - innerRadius) * scale;
    const pixelRadius = middleRadius * scale;
    const count = PARTITIONS_PER_RING[ringIndex];
    const slotAngle = 360 / count;
    const rotation = CONFIG.ringRotations[ringIndex];
    const narrowGapDegrees = (narrowGapUnits / middleRadius) * (180 / Math.PI);
    const wideGapDegrees = (wideGapUnits / middleRadius) * (180 / Math.PI);

    for (let index = 0; index < count; index += 1) {
      const previousGapBit = encoded.gapByRing[ringIndex][(index - 1 + count) % count];
      const nextGapBit = encoded.gapByRing[ringIndex][index];
      const beforeGap = previousGapBit ? wideGapDegrees : narrowGapDegrees;
      const afterGap = nextGapBit ? wideGapDegrees : narrowGapDegrees;

      let startAngle = rotation + index * slotAngle + beforeGap / 2;
      let endAngle = rotation + (index + 1) * slotAngle - afterGap / 2;

      if (endAngle <= startAngle) {
        const centerAngle = rotation + (index + 0.5) * slotAngle;
        startAngle = centerAngle - slotAngle * 0.15;
        endAngle = centerAngle + slotAngle * 0.15;
      }

      context.beginPath();
      context.strokeStyle = encoded.colorByRing[ringIndex][index]
        ? CONFIG.bit1Color
        : CONFIG.bit0Color;
      context.lineWidth = lineWidth;
      context.arc(
        centerX,
        centerY,
        pixelRadius,
        startAngle * Math.PI / 180,
        endAngle * Math.PI / 180,
        false
      );
      context.stroke();
    }
  }

  drawCentralMarker(context, centerX, centerY, scale);
}

// ============================================================
// PROCESSAMENTO DE IMAGEM
// ============================================================

function imageDataToGray(imageData) {
  const gray = new Uint8Array(imageData.width * imageData.height);
  const source = imageData.data;
  for (let pixel = 0, index = 0; pixel < gray.length; pixel += 1, index += 4) {
    gray[pixel] = Math.round(
      source[index] * 0.2126 + source[index + 1] * 0.7152 + source[index + 2] * 0.0722
    );
  }
  return gray;
}

function percentileFromHistogram(gray, percentile) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;
  const target = Math.max(0, Math.min(gray.length - 1, Math.floor(gray.length * percentile)));
  let accumulated = 0;
  for (let value = 0; value < 256; value += 1) {
    accumulated += histogram[value];
    if (accumulated > target) return value;
  }
  return 255;
}

function normalizeGray(gray) {
  const low = percentileFromHistogram(gray, 0.02);
  const high = percentileFromHistogram(gray, 0.995);
  if (high - low < 24) return gray.slice();

  const normalized = new Uint8Array(gray.length);
  const multiplier = 255 / (high - low);
  for (let index = 0; index < gray.length; index += 1) {
    normalized[index] = Math.max(0, Math.min(255, Math.round((gray[index] - low) * multiplier)));
  }
  return normalized;
}

function sharpenGray(gray, width, height) {
  const result = gray.slice();
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const neighbors = (
        gray[index - width] + gray[index + width] +
        gray[index - 1] + gray[index + 1]
      ) / 4;
      result[index] = Math.max(0, Math.min(255, Math.round(gray[index] * 1.55 - neighbors * 0.55)));
    }
  }
  return result;
}

function calculateFrameQuality(gray, width, height) {
  let sumSquaredLaplacian = 0;
  let laplacianCount = 0;
  // O percentil 90 representa melhor a iluminação dos traços do que a média,
  // pois grande parte do quadro é propositalmente escura.
  const brightness = percentileFromHistogram(gray, 0.96);

  for (let y = 2; y < height - 2; y += 4) {
    for (let x = 2; x < width - 2; x += 4) {
      const index = y * width + x;
      const laplacian = 4 * gray[index] - gray[index - 1] - gray[index + 1] -
        gray[index - width] - gray[index + width];
      sumSquaredLaplacian += laplacian * laplacian;
      laplacianCount += 1;
    }
  }

  return {
    brightness,
    sharpness: laplacianCount ? sumSquaredLaplacian / laplacianCount : 0,
  };
}

function otsuThreshold(gray) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;

  const total = gray.length;
  let totalWeighted = 0;
  for (let value = 0; value < 256; value += 1) {
    totalWeighted += value * histogram[value];
  }

  let backgroundWeight = 0;
  let backgroundWeighted = 0;
  let bestVariance = -1;
  let bestThreshold = 96;

  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (backgroundWeight === 0) continue;

    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;

    backgroundWeighted += threshold * histogram[threshold];
    const backgroundMean = backgroundWeighted / backgroundWeight;
    const foregroundMean = (totalWeighted - backgroundWeighted) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

function sampleGray(gray, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return 0;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const dx = x - x0;
  const dy = y - y0;

  const top = gray[y0 * width + x0] * (1 - dx) + gray[y0 * width + x1] * dx;
  const bottom = gray[y1 * width + x0] * (1 - dx) + gray[y1 * width + x1] * dx;
  return top * (1 - dy) + bottom * dy;
}

function estimateMarkerCenter(gray, width, height, threshold) {
  const frameCenter = { x: width / 2, y: height / 2 };
  const minimumDimension = Math.min(width, height);
  const halfRegion = Math.floor(minimumDimension * 0.34);
  const minX = Math.max(1, Math.floor(frameCenter.x - halfRegion));
  const maxX = Math.min(width - 2, Math.ceil(frameCenter.x + halfRegion));
  const minY = Math.max(1, Math.floor(frameCenter.y - halfRegion));
  const maxY = Math.min(height - 2, Math.ceil(frameCenter.y + halfRegion));

  // O limiar mais alto privilegia o branco do marcador e evita que os
  // traços cinza dos anéis dominem a busca por componentes.
  const brightThreshold = Math.min(245, threshold + (255 - threshold) * 0.56);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array((maxX - minX + 1) * (maxY - minY + 1));
  let best = null;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const startIndex = y * width + x;
      if (visited[startIndex] || gray[startIndex] < brightThreshold) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = startIndex;
      visited[startIndex] = 1;

      let count = 0;
      let componentMinX = x;
      let componentMaxX = x;
      let componentMinY = y;
      let componentMaxY = y;

      while (head < tail) {
        const index = queue[head++];
        const cy = Math.floor(index / width);
        const cx = index - cy * width;
        count += 1;
        componentMinX = Math.min(componentMinX, cx);
        componentMaxX = Math.max(componentMaxX, cx);
        componentMinY = Math.min(componentMinY, cy);
        componentMaxY = Math.max(componentMaxY, cy);

        const neighbors = [index - 1, index + 1, index - width, index + width];
        for (const nextIndex of neighbors) {
          if (visited[nextIndex]) continue;
          const ny = Math.floor(nextIndex / width);
          const nx = nextIndex - ny * width;
          if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
          visited[nextIndex] = 1;
          if (gray[nextIndex] >= brightThreshold) queue[tail++] = nextIndex;
        }
      }

      if (count < 35) continue;
      const boxWidth = componentMaxX - componentMinX + 1;
      const boxHeight = componentMaxY - componentMinY + 1;
      const averageSize = (boxWidth + boxHeight) / 2;
      if (averageSize < minimumDimension * 0.055 || averageSize > minimumDimension * 0.31) continue;

      const aspect = Math.min(boxWidth, boxHeight) / Math.max(boxWidth, boxHeight);
      if (aspect < 0.62) continue;

      const centerX = (componentMinX + componentMaxX) / 2;
      const centerY = (componentMinY + componentMaxY) / 2;
      const centerDistance = Math.hypot(centerX - frameCenter.x, centerY - frameCenter.y);
      if (centerDistance > minimumDimension * 0.27) continue;

      const fillRatio = count / (boxWidth * boxHeight);
      const squareScore = aspect * 4.2;
      const sizeScore = 1.8 - Math.min(1.8, Math.abs(averageSize / minimumDimension - 0.19) * 8);
      const distanceScore = 2.4 - Math.min(2.4, centerDistance / minimumDimension * 9);
      const fillScore = fillRatio > 0.04 && fillRatio < 0.62 ? 1.2 : -1;
      const score = squareScore + sizeScore + distanceScore + fillScore;

      if (!best || score > best.score) {
        best = {
          x: centerX,
          y: centerY,
          markerSize: averageSize,
          score,
          source: "component",
        };
      }
    }
  }

  if (best) return best;

  // Reserva segura: continua permitindo a leitura quando o marcador estiver
  // desfocado, desde que o usuário o tenha alinhado ao guia central.
  return {
    x: frameCenter.x,
    y: frameCenter.y,
    markerSize: minimumDimension * 0.19,
    score: 0,
    source: "guide",
  };
}

function estimateMarkerRotation(gray, width, height, marker) {
  const angularSamples = 360;
  const minimumRadius = marker.markerSize * 0.25;
  const maximumRadius = marker.markerSize * 0.44;
  const radiusSteps = 7;
  const scores = new Float32Array(angularSamples);

  for (let angleIndex = 0; angleIndex < angularSamples; angleIndex += 1) {
    const angle = angleIndex * Math.PI * 2 / angularSamples;
    let score = 0;
    for (let radiusIndex = 0; radiusIndex < radiusSteps; radiusIndex += 1) {
      const radius = minimumRadius + (maximumRadius - minimumRadius) * radiusIndex / (radiusSteps - 1);
      score += sampleGray(
        gray,
        width,
        height,
        marker.x + radius * Math.cos(angle),
        marker.y + radius * Math.sin(angle)
      );
    }
    scores[angleIndex] = score / radiusSteps;
  }

  // Suavização circular reduz picos isolados de ruído.
  let bestAngle = 0;
  let bestScore = -Infinity;
  let mean = 0;
  for (let index = 0; index < angularSamples; index += 1) {
    const smooth = (
      scores[(index + angularSamples - 2) % angularSamples] +
      scores[(index + angularSamples - 1) % angularSamples] * 2 +
      scores[index] * 3 +
      scores[(index + 1) % angularSamples] * 2 +
      scores[(index + 2) % angularSamples]
    ) / 9;
    mean += smooth;
    if (smooth > bestScore) {
      bestScore = smooth;
      bestAngle = index;
    }
  }
  mean /= angularSamples;

  const confidence = bestScore - mean;
  if (confidence < 10) return null;

  // O ponto é desenhado a -45°. Logo, rotação global = ângulo observado + 45°.
  return {
    rotation: (bestAngle + 45) % 360,
    confidence,
  };
}

function buildRadialProfile(gray, width, height, center, threshold) {
  const maxRadius = Math.floor(Math.min(
    center.x,
    center.y,
    width - 1 - center.x,
    height - 1 - center.y
  ));
  const profile = new Float32Array(maxRadius + 1);
  const angularSamples = 180;

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    let bright = 0;
    for (let sample = 0; sample < angularSamples; sample += 1) {
      const angle = sample * Math.PI * 2 / angularSamples;
      const value = sampleGray(
        gray,
        width,
        height,
        center.x + radius * Math.cos(angle),
        center.y + radius * Math.sin(angle)
      );
      if (value > threshold) bright += 1;
    }
    profile[radius] = bright / angularSamples;
  }

  return profile;
}

function profileAverage(profile, centerRadius, halfWidth) {
  const start = Math.max(0, Math.floor(centerRadius - halfWidth));
  const end = Math.min(profile.length - 1, Math.ceil(centerRadius + halfWidth));
  let sum = 0;
  let count = 0;
  for (let radius = start; radius <= end; radius += 1) {
    sum += profile[radius];
    count += 1;
  }
  return count ? sum / count : 0;
}

function estimateScale(profile) {
  const lastMiddleRadius = RING_MID_RADII[RING_MID_RADII.length - 1];
  const minimumCandidate = Math.floor(profile.length * 0.34);
  const maximumCandidate = Math.floor(profile.length * 0.94);
  let best = { score: -Infinity, scale: 0, radius: 0 };

  for (let lastRadius = minimumCandidate; lastRadius <= maximumCandidate; lastRadius += 1) {
    const scale = lastRadius / lastMiddleRadius;
    const halfBand = Math.max(1.5, RING_RADIAL_WIDTH * scale * 0.38);
    let ringScore = 0;
    let gapScore = 0;

    for (let index = 0; index < RING_MID_RADII.length; index += 1) {
      ringScore += profileAverage(profile, RING_MID_RADII[index] * scale, halfBand);
      if (index < RING_MID_RADII.length - 1) {
        const gapRadius = (RING_MID_RADII[index] + RING_MID_RADII[index + 1]) * scale / 2;
        gapScore += profileAverage(profile, gapRadius, Math.max(1, halfBand * 0.35));
      }
    }

    const score = ringScore - gapScore * 0.72;
    if (score > best.score) best = { score, scale, radius: lastRadius };
  }

  if (!Number.isFinite(best.scale) || best.scale <= 0 || best.score < 0.34) {
    throw new Error("Não consegui localizar os cinco anéis. Centralize o código e aproxime a câmera.");
  }

  return best;
}

function kMeans1D(values, clusterCount) {
  if (!values.length) return { centers: [], labels: [] };
  const sorted = [...values].sort((a, b) => a - b);
  let centers = new Array(clusterCount).fill(0).map((_, index) => {
    const position = Math.min(
      sorted.length - 1,
      Math.round((index + 0.5) * sorted.length / clusterCount - 0.5)
    );
    return sorted[Math.max(0, position)];
  });
  const labels = new Uint8Array(values.length);

  for (let iteration = 0; iteration < 18; iteration += 1) {
    const sums = new Array(clusterCount).fill(0);
    const counts = new Array(clusterCount).fill(0);

    for (let index = 0; index < values.length; index += 1) {
      let bestCluster = 0;
      let bestDistance = Infinity;
      for (let cluster = 0; cluster < clusterCount; cluster += 1) {
        const distance = Math.abs(values[index] - centers[cluster]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = cluster;
        }
      }
      labels[index] = bestCluster;
      sums[bestCluster] += values[index];
      counts[bestCluster] += 1;
    }

    const updated = centers.map((center, cluster) => (
      counts[cluster] ? sums[cluster] / counts[cluster] : center
    ));
    const movement = updated.reduce((sum, center, cluster) => sum + Math.abs(center - centers[cluster]), 0);
    centers = updated;
    if (movement < 0.02) break;
  }

  const ordered = centers
    .map((center, originalIndex) => ({ center, originalIndex }))
    .sort((a, b) => a.center - b.center);
  const remap = new Map(ordered.map((item, index) => [item.originalIndex, index]));
  const orderedLabels = Uint8Array.from(labels, (label) => remap.get(label));

  return { centers: ordered.map((item) => item.center), labels: orderedLabels };
}

function averageRadialSample(gray, width, height, center, radius, angleDegrees, radialSpread) {
  const angle = angleDegrees * Math.PI / 180;
  const samples = [-0.26, 0, 0.26];
  let sum = 0;

  for (const factor of samples) {
    const sampledRadius = radius + radialSpread * factor;
    sum += sampleGray(
      gray,
      width,
      height,
      center.x + sampledRadius * Math.cos(angle),
      center.y + sampledRadius * Math.sin(angle)
    );
  }

  return sum / samples.length;
}

const EXPECTED_HEADER_LOGICAL_BITS = bytesToBits(new Uint8Array([
  CONFIG.magic[0], CONFIG.magic[1], CONFIG.version
]));
const EXPECTED_HEADER_VISUAL_BITS = EXPECTED_HEADER_LOGICAL_BITS.map(
  (bit, index) => bit ^ generateMask(EXPECTED_HEADER_LOGICAL_BITS.length)[index]
);

function scoreRotation(gray, width, height, center, scale, globalRotation, direction) {
  const ringIndex = 0;
  const count = PARTITIONS_PER_RING[ringIndex];
  const slotAngle = 360 / count;
  const radius = RING_MID_RADII[ringIndex] * scale;
  const radialSpread = RING_RADIAL_WIDTH * scale;
  const values = [];

  for (let index = 0; index < EXPECTED_HEADER_VISUAL_BITS.length; index += 1) {
    const angle = globalRotation + direction * (
      CONFIG.ringRotations[ringIndex] + (index + 0.5) * slotAngle
    );
    values.push(averageRadialSample(
      gray, width, height, center, radius, angle, radialSpread
    ));
  }

  const clustering = kMeans1D(values, 2);
  if (clustering.centers.length < 2) return -Infinity;

  let matches = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (clustering.labels[index] === EXPECTED_HEADER_VISUAL_BITS[index]) matches += 1;
  }

  const separation = clustering.centers[1] - clustering.centers[0];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return matches + Math.min(2.5, separation / 35) + Math.min(0.8, average / 320);
}

function circularDistance(a, b) {
  const difference = Math.abs(a - b) % 360;
  return Math.min(difference, 360 - difference);
}

function selectDistinctRotationCandidates(rawCandidates, limit = 8) {
  rawCandidates.sort((a, b) => b.score - a.score);
  const selected = [];

  for (const candidate of rawCandidates) {
    const isNearExisting = selected.some((existing) => (
      existing.direction === candidate.direction &&
      circularDistance(existing.rotation, candidate.rotation) < 2.2
    ));
    if (!isNearExisting) selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function refineRotationCandidates(gray, width, height, center, scale, candidates) {
  return candidates.map((candidate) => {
    let best = candidate;
    for (let offset = -1; offset <= 1.0001; offset += 0.05) {
      const rotation = (candidate.rotation + offset + 360) % 360;
      const score = scoreRotation(
        gray, width, height, center, scale, rotation, candidate.direction
      );
      if (score > best.score) best = { rotation, direction: candidate.direction, score };
    }
    return best;
  }).sort((a, b) => b.score - a.score);
}

function findRotationCandidates(gray, width, height, center, scale, rotationHint = null) {
  // Caminho rápido: o ponto assimétrico do marcador já oferece uma boa
  // aproximação da rotação. Procuramos somente perto desse ângulo primeiro.
  if (rotationHint) {
    const hinted = [];
    for (let offset = -14; offset <= 14.0001; offset += 0.35) {
      const rotation = (rotationHint.rotation + offset + 360) % 360;
      hinted.push({
        rotation,
        direction: 1,
        score: scoreRotation(gray, width, height, center, scale, rotation, 1),
      });
    }

    const refinedHinted = refineRotationCandidates(
      gray,
      width,
      height,
      center,
      scale,
      selectDistinctRotationCandidates(hinted, 6)
    );

    if (refinedHinted.length && refinedHinted[0].score >= 19) return refinedHinted;
  }

  // Reserva robusta para imagens antigas, ponto encoberto ou imagem espelhada.
  const rawCandidates = [];
  for (const direction of [1, -1]) {
    for (let rotation = 0; rotation < 360; rotation += 0.75) {
      rawCandidates.push({
        rotation,
        direction,
        score: scoreRotation(gray, width, height, center, scale, rotation, direction),
      });
    }
  }

  const refined = refineRotationCandidates(
    gray,
    width,
    height,
    center,
    scale,
    selectDistinctRotationCandidates(rawCandidates, 10)
  );

  if (!refined.length || refined[0].score < 19) {
    throw new Error("Não consegui determinar a rotação do código. Evite reflexos e mantenha a câmera perpendicular.");
  }
  return refined;
}

function readColorBits(gray, width, height, center, scale, rotation, direction) {
  const allBits = [];

  for (let ringIndex = 0; ringIndex < RINGS.length; ringIndex += 1) {
    const count = PARTITIONS_PER_RING[ringIndex];
    const slotAngle = 360 / count;
    const radius = RING_MID_RADII[ringIndex] * scale;
    const radialSpread = RING_RADIAL_WIDTH * scale;
    const values = [];

    for (let index = 0; index < count; index += 1) {
      const angle = rotation + direction * (
        CONFIG.ringRotations[ringIndex] + (index + 0.5) * slotAngle
      );
      values.push(averageRadialSample(
        gray, width, height, center, radius, angle, radialSpread
      ));
    }

    const clustering = kMeans1D(values, 2);
    if (clustering.centers.length < 2 || clustering.centers[1] - clustering.centers[0] < 10) {
      throw new Error(`Não foi possível separar as duas cores no anel ${ringIndex + 1}.`);
    }
    allBits.push(...clustering.labels);
  }

  return allBits;
}

function ringBackgroundThreshold(gray, width, height, center, radius) {
  const values = [];
  const sampleCount = 900;
  for (let index = 0; index < sampleCount; index += 1) {
    const angle = index * Math.PI * 2 / sampleCount;
    values.push(sampleGray(
      gray,
      width,
      height,
      center.x + radius * Math.cos(angle),
      center.y + radius * Math.sin(angle)
    ));
  }

  const clustering = kMeans1D(values, 3);
  if (clustering.centers.length < 3) {
    return otsuThreshold(Uint8Array.from(values, Math.round));
  }
  return (clustering.centers[0] + clustering.centers[1]) / 2;
}

function measureGapWidth(
  gray,
  width,
  height,
  center,
  radius,
  boundaryAngle,
  halfWindowDegrees,
  backgroundThreshold
) {
  const sampleCount = 81;
  const step = (2 * halfWindowDegrees) / (sampleCount - 1);
  const isBackground = new Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const angleDegrees = boundaryAngle - halfWindowDegrees + index * step;
    const angle = angleDegrees * Math.PI / 180;
    const value = sampleGray(
      gray,
      width,
      height,
      center.x + radius * Math.cos(angle),
      center.y + radius * Math.sin(angle)
    );
    isBackground[index] = value < backgroundThreshold;
  }

  const middle = Math.floor(sampleCount / 2);
  let anchor = middle;
  if (!isBackground[anchor]) {
    let found = -1;
    for (let distance = 1; distance <= 7; distance += 1) {
      if (middle - distance >= 0 && isBackground[middle - distance]) {
        found = middle - distance;
        break;
      }
      if (middle + distance < sampleCount && isBackground[middle + distance]) {
        found = middle + distance;
        break;
      }
    }
    if (found < 0) return 0;
    anchor = found;
  }

  let left = anchor;
  while (left > 0 && isBackground[left - 1]) left -= 1;
  let right = anchor;
  while (right < sampleCount - 1 && isBackground[right + 1]) right += 1;
  return (right - left) * step;
}

function readGapBits(gray, width, height, center, scale, rotation, direction) {
  const allBits = [];

  for (let ringIndex = 0; ringIndex < RINGS.length; ringIndex += 1) {
    const count = PARTITIONS_PER_RING[ringIndex];
    const slotAngle = 360 / count;
    const radius = RING_MID_RADII[ringIndex] * scale;
    const backgroundThreshold = ringBackgroundThreshold(gray, width, height, center, radius);
    const widths = [];

    for (let index = 0; index < count; index += 1) {
      const boundaryAngle = rotation + direction * (
        CONFIG.ringRotations[ringIndex] + (index + 1) * slotAngle
      );
      widths.push(measureGapWidth(
        gray,
        width,
        height,
        center,
        radius,
        boundaryAngle,
        slotAngle * 0.46,
        backgroundThreshold
      ));
    }

    const clustering = kMeans1D(widths, 2);
    if (clustering.centers.length < 2 || clustering.centers[1] - clustering.centers[0] < 0.18) {
      throw new Error(`Não foi possível separar os intervalos no anel ${ringIndex + 1}.`);
    }
    allBits.push(...clustering.labels);
  }

  return allBits;
}

function decodeWithGeometry(gray, width, height, center, scale, candidate) {
  const colorBits = readColorBits(
    gray, width, height, center, scale, candidate.rotation, candidate.direction
  );
  const gapBits = readGapBits(
    gray, width, height, center, scale, candidate.rotation, candidate.direction
  );
  const logicalBits = applyMask(colorBits.concat(gapBits));
  return decodePacket(bitsToBytes(logicalBits));
}

function centerCandidatesAround(marker, minimumDimension) {
  const delta = Math.max(1.5, minimumDimension * 0.0028);
  const offsets = [
    [0, 0],
    [-delta, 0], [delta, 0], [0, -delta], [0, delta],
    [-delta, -delta], [delta, -delta], [-delta, delta], [delta, delta],
  ];
  return offsets.map(([dx, dy]) => ({ x: marker.x + dx, y: marker.y + dy }));
}

function decodeGrayVariant(gray, width, height) {
  const threshold = otsuThreshold(gray);
  const marker = estimateMarkerCenter(gray, width, height, threshold);
  const rotationHint = estimateMarkerRotation(gray, width, height, marker);
  const profile = buildRadialProfile(gray, width, height, marker, threshold);
  const scaleEstimate = estimateScale(profile);
  const scaleMultipliers = [1, 0.996, 1.004, 0.99, 1.01, 0.984, 1.016];
  const centers = centerCandidatesAround(marker, Math.min(width, height));
  let lastError = null;

  for (const multiplier of scaleMultipliers) {
    const scale = scaleEstimate.scale * multiplier;
    let candidates;
    try {
      candidates = findRotationCandidates(
        gray,
        width,
        height,
        marker,
        scale,
        rotationHint
      );
    } catch (error) {
      lastError = error;
      continue;
    }

    for (const candidate of candidates) {
      for (const center of centers) {
        try {
          return {
            content: decodeWithGeometry(gray, width, height, center, scale, candidate),
            diagnostics: {
              center,
              marker,
              scale,
              rotation: candidate.rotation,
              direction: candidate.direction,
              rotationScore: candidate.score,
              rotationHint,
              codeDiameterRatio: 2 * OUTER_RADIUS * scale / Math.min(width, height),
            },
          };
        } catch (error) {
          lastError = error;
        }
      }
    }
  }

  const finalError = lastError ?? new Error("Não foi possível recuperar o conteúdo desta imagem.");
  finalError.diagnostics = {
    ...(finalError.diagnostics ?? {}),
    marker,
    rotationHint,
    scale: scaleEstimate.scale,
    codeDiameterRatio: 2 * OUTER_RADIUS * scaleEstimate.scale / Math.min(width, height),
  };
  throw finalError;
}

function decodeImageData(imageData) {
  const originalGray = imageDataToGray(imageData);
  const normalized = normalizeGray(originalGray);
  const quality = calculateFrameQuality(normalized, imageData.width, imageData.height);
  const variants = [
    { name: "normalizada", gray: normalized },
    { name: "realçada", gray: sharpenGray(normalized, imageData.width, imageData.height) },
  ];
  let lastError = null;

  for (const variant of variants) {
    try {
      const result = decodeGrayVariant(variant.gray, imageData.width, imageData.height);
      result.diagnostics.variant = variant.name;
      result.diagnostics.quality = quality;
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  const finalError = lastError ?? new Error("Não foi possível recuperar o conteúdo desta imagem.");
  finalError.diagnostics = {
    ...(finalError.diagnostics ?? {}),
    quality,
  };
  throw finalError;
}

function drawSourceToAnalysisCanvas(source, sourceWidth, sourceHeight) {
  const canvas = document.getElementById("analysis-canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const cropSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = (sourceWidth - cropSize) / 2;
  const sourceY = (sourceHeight - cropSize) / 2;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    source,
    sourceX,
    sourceY,
    cropSize,
    cropSize,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// ============================================================
// INTERFACE
// ============================================================

let generatedBlob = null;
let cameraStream = null;
let cameraTrack = null;
let autoScanTimer = null;
let decodingInProgress = false;
let torchEnabled = false;
let lastCameraContent = null;
let cameraConfirmationCount = 0;

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `message${type ? ` ${type}` : ""}`;
}

function setScanState(text, state = "") {
  const shell = document.getElementById("camera-shell");
  const element = document.getElementById("scan-state");
  element.textContent = text;
  shell.classList.toggle("is-searching", state === "searching");
  shell.classList.toggle("is-ready", state === "ready");
}

function setFeedbackChip(id, label, value, level = "") {
  const element = document.getElementById(id);
  element.textContent = `${label}: ${value}`;
  element.className = `feedback-chip${level ? ` ${level}` : ""}`;
}

function updateCameraFeedback(diagnostics = {}) {
  const quality = diagnostics.quality ?? {};
  const sharpness = quality.sharpness;
  const brightness = quality.brightness;
  const ratio = diagnostics.codeDiameterRatio;

  if (Number.isFinite(sharpness)) {
    if (sharpness >= 650) setFeedbackChip("feedback-focus", "Nitidez", "boa", "good");
    else if (sharpness >= 260) setFeedbackChip("feedback-focus", "Nitidez", "média", "warn");
    else setFeedbackChip("feedback-focus", "Nitidez", "baixa", "bad");
  } else {
    setFeedbackChip("feedback-focus", "Nitidez", "—");
  }

  if (Number.isFinite(ratio)) {
    if (ratio < 0.66) setFeedbackChip("feedback-size", "Tamanho", "aproxime", "warn");
    else if (ratio > 0.94) setFeedbackChip("feedback-size", "Tamanho", "afaste", "warn");
    else setFeedbackChip("feedback-size", "Tamanho", "bom", "good");
  } else {
    setFeedbackChip("feedback-size", "Tamanho", "—");
  }

  if (Number.isFinite(brightness)) {
    if (brightness < 85) setFeedbackChip("feedback-light", "Luz", "escura", "bad");
    else setFeedbackChip("feedback-light", "Luz", "boa", "good");
  } else {
    setFeedbackChip("feedback-light", "Luz", "—");
  }
}

function guidanceFromDiagnostics(diagnostics = {}) {
  const quality = diagnostics.quality ?? {};
  const ratio = diagnostics.codeDiameterRatio;

  if (Number.isFinite(ratio) && ratio < 0.66) return "Aproxime o celular lentamente.";
  if (Number.isFinite(ratio) && ratio > 0.94) return "Afaste um pouco para mostrar todos os anéis.";
  if (Number.isFinite(quality.sharpness) && quality.sharpness < 260) {
    return "Mantenha o celular parado até a imagem ficar nítida.";
  }
  if (Number.isFinite(quality.brightness) && quality.brightness < 85) {
    return "Aumente a iluminação ou use o botão de luz.";
  }
  return "Centralize o quadrado e mantenha os cinco anéis dentro do guia.";
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("O navegador não conseguiu gerar o arquivo PNG."));
    }, "image/png", 1);
  });
}

function safeFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `codigo-circular-${timestamp}.png`;
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showDecodedResult(content) {
  const resultCard = document.getElementById("result-card");
  const decodedContent = document.getElementById("decoded-content");
  const openResultLink = document.getElementById("open-result-link");

  decodedContent.textContent = content;
  resultCard.hidden = false;

  try {
    const parsed = new URL(content);
    if (["http:", "https:"].includes(parsed.protocol)) {
      openResultLink.href = parsed.href;
      openResultLink.hidden = false;
    } else {
      openResultLink.hidden = true;
    }
  } catch {
    openResultLink.hidden = true;
  }
}

async function processImageData(imageData, sourceLabel, options = {}) {
  const { silent = false } = options;
  if (decodingInProgress) throw new Error("Uma leitura já está em andamento.");

  decodingInProgress = true;
  const decoderMessage = document.getElementById("decoder-message");
  if (!silent) setMessage(decoderMessage, `Analisando ${sourceLabel}...`);

  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return decodeImageData(imageData);
  } catch (error) {
    if (!silent) {
      setMessage(
        decoderMessage,
        `${error.message} Mantenha o código inteiro, centralizado e o mais plano possível.`,
        "error"
      );
    }
    throw error;
  } finally {
    decodingInProgress = false;
  }
}

function switchReaderMode(mode) {
  const cameraTab = document.getElementById("camera-tab");
  const galleryTab = document.getElementById("gallery-tab");
  const cameraPanel = document.getElementById("camera-panel");
  const galleryPanel = document.getElementById("gallery-panel");
  const cameraActive = mode === "camera";

  cameraTab.classList.toggle("active", cameraActive);
  galleryTab.classList.toggle("active", !cameraActive);
  cameraTab.setAttribute("aria-selected", String(cameraActive));
  galleryTab.setAttribute("aria-selected", String(!cameraActive));
  cameraPanel.classList.toggle("active", cameraActive);
  galleryPanel.classList.toggle("active", !cameraActive);
  cameraPanel.hidden = !cameraActive;
  galleryPanel.hidden = cameraActive;

  if (!cameraActive) stopCamera();
}

function cancelAutoScan() {
  if (autoScanTimer) {
    clearTimeout(autoScanTimer);
    autoScanTimer = null;
  }
}

function scheduleAutoScan(delay = CONFIG.cameraScanIntervalMs) {
  cancelAutoScan();
  if (!cameraStream || !document.getElementById("auto-scan").checked) return;
  autoScanTimer = setTimeout(async () => {
    autoScanTimer = null;
    const recognized = await scanCameraFrame({ silent: true, manual: false });
    if (!recognized && cameraStream && document.getElementById("auto-scan").checked) {
      scheduleAutoScan();
    }
  }, delay);
}

async function configureCameraTrack(track) {
  const capabilities = track.getCapabilities?.() ?? {};
  const advanced = {};

  if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
    advanced.focusMode = "continuous";
  }
  if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("continuous")) {
    advanced.exposureMode = "continuous";
  }
  if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes("continuous")) {
    advanced.whiteBalanceMode = "continuous";
  }

  if (Object.keys(advanced).length) {
    try {
      await track.applyConstraints({ advanced: [advanced] });
    } catch {
      // Alguns navegadores anunciam a capacidade, mas não aceitam a restrição.
    }
  }

  const torchButton = document.getElementById("torch-button");
  torchButton.hidden = !capabilities.torch;

  const zoomControl = document.getElementById("zoom-control");
  const zoomInput = document.getElementById("camera-zoom");
  const zoomValue = document.getElementById("camera-zoom-value");

  if (capabilities.zoom && Number.isFinite(capabilities.zoom.min)) {
    zoomInput.min = capabilities.zoom.min;
    zoomInput.max = capabilities.zoom.max;
    zoomInput.step = capabilities.zoom.step || 0.1;
    const settings = track.getSettings?.() ?? {};
    const initialZoom = settings.zoom ?? capabilities.zoom.min;
    zoomInput.value = initialZoom;
    zoomValue.value = `${Number(initialZoom).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`;
    zoomControl.hidden = false;
  } else {
    zoomControl.hidden = true;
  }
}

async function startCamera() {
  const decoderMessage = document.getElementById("decoder-message");
  const video = document.getElementById("camera-video");

  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage(decoderMessage, "Este navegador não oferece acesso à câmera.", "error");
    return;
  }

  stopCamera();
  setScanState("Solicitando acesso à câmera…", "searching");

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 2560, min: 1280 },
        height: { ideal: 1440, min: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false,
    });

    cameraTrack = cameraStream.getVideoTracks()[0] ?? null;
    if (cameraTrack) await configureCameraTrack(cameraTrack);

    video.srcObject = cameraStream;
    await video.play();

    document.getElementById("camera-empty").classList.add("hidden");
    document.getElementById("start-camera-button").disabled = true;
    document.getElementById("scan-camera-button").disabled = false;
    document.getElementById("stop-camera-button").disabled = false;
    setMessage(decoderMessage, "Câmera ativa. A leitura automática procura o código continuamente.");
    setScanState("Procurando código…", "searching");
    lastCameraContent = null;
    cameraConfirmationCount = 0;
    scheduleAutoScan(250);
  } catch (error) {
    stopCamera();
    setMessage(
      decoderMessage,
      "Não foi possível acessar a câmera. Verifique a permissão e abra a página em HTTPS.",
      "error"
    );
    setScanState("Câmera indisponível");
  }
}

async function setTorch(enabled) {
  if (!cameraTrack) return;
  try {
    await cameraTrack.applyConstraints({ advanced: [{ torch: enabled }] });
    torchEnabled = enabled;
    document.getElementById("torch-button").textContent = enabled ? "Desligar luz" : "Ligar luz";
  } catch {
    setMessage(document.getElementById("decoder-message"), "A luz não pôde ser controlada neste aparelho.", "warning");
  }
}

function stopCamera() {
  cancelAutoScan();

  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
  }
  cameraStream = null;
  cameraTrack = null;
  torchEnabled = false;
  lastCameraContent = null;
  cameraConfirmationCount = 0;

  const video = document.getElementById("camera-video");
  if (video) video.srcObject = null;

  document.getElementById("camera-empty")?.classList.remove("hidden");
  document.getElementById("start-camera-button").disabled = false;
  document.getElementById("scan-camera-button").disabled = true;
  document.getElementById("stop-camera-button").disabled = true;
  document.getElementById("torch-button").hidden = true;
  document.getElementById("torch-button").textContent = "Ligar luz";
  document.getElementById("zoom-control").hidden = true;
  setFeedbackChip("feedback-focus", "Nitidez", "—");
  setFeedbackChip("feedback-size", "Tamanho", "—");
  setFeedbackChip("feedback-light", "Luz", "—");
  setScanState("Câmera desativada");
}

function acceptCameraResult(result, manual) {
  if (manual || CONFIG.cameraConfirmations <= 1) {
    cameraConfirmationCount = CONFIG.cameraConfirmations;
  } else if (result.content === lastCameraContent) {
    cameraConfirmationCount += 1;
  } else {
    lastCameraContent = result.content;
    cameraConfirmationCount = 1;
  }

  if (cameraConfirmationCount < CONFIG.cameraConfirmations) {
    setScanState("Código encontrado; confirmando…", "searching");
    return false;
  }

  showDecodedResult(result.content);
  setMessage(document.getElementById("decoder-message"), "Código lido e validado pelo CRC32.", "success");
  setScanState("Código reconhecido", "ready");
  cancelAutoScan();

  if (navigator.vibrate) navigator.vibrate(80);
  return true;
}

async function scanCameraFrame(options = {}) {
  const { silent = false, manual = false } = options;
  const video = document.getElementById("camera-video");
  if (!cameraStream || video.readyState < 2 || decodingInProgress) return false;

  setScanState(manual ? "Analisando quadro…" : "Procurando código…", "searching");

  try {
    const imageData = drawSourceToAnalysisCanvas(video, video.videoWidth, video.videoHeight);
    const result = await processImageData(imageData, "a imagem da câmera", { silent: true });
    updateCameraFeedback(result.diagnostics);
    return acceptCameraResult(result, manual);
  } catch (error) {
    const diagnostics = error.diagnostics ?? {};
    updateCameraFeedback(diagnostics);
    const guidance = guidanceFromDiagnostics(diagnostics);
    setScanState(guidance, "searching");

    if (!silent || manual) {
      setMessage(
        document.getElementById("decoder-message"),
        `${error.message} ${guidance}`,
        "warning"
      );
    }
    return false;
  }
}

function updateAutoScan() {
  if (document.getElementById("auto-scan").checked) {
    scheduleAutoScan(180);
  } else {
    cancelAutoScan();
    if (cameraStream) setScanState("Leitura automática pausada");
  }
}

async function handleGalleryFile(file) {
  const decoderMessage = document.getElementById("decoder-message");
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setMessage(decoderMessage, "Selecione um arquivo de imagem válido.", "error");
    return;
  }

  const preview = document.getElementById("gallery-preview");
  const objectUrl = URL.createObjectURL(file);
  preview.src = objectUrl;
  preview.hidden = false;

  try {
    const bitmap = await createImageBitmap(file);
    const imageData = drawSourceToAnalysisCanvas(bitmap, bitmap.width, bitmap.height);
    const result = await processImageData(imageData, "a imagem selecionada");
    showDecodedResult(result.content);
    setMessage(decoderMessage, "Código lido e validado pelo CRC32.", "success");
    bitmap.close();
  } catch (error) {
    // processImageData já apresentou uma mensagem mais específica.
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }
}

function initializeInterface() {
  const contentInput = document.getElementById("content-input");
  const generatorMessage = document.getElementById("generator-message");
  const canvas = document.getElementById("code-canvas");
  const downloadButton = document.getElementById("download-button");
  const shareButton = document.getElementById("share-button");

  contentInput.addEventListener("input", () => {
    const byteLength = textEncoder.encode(contentInput.value).length;
    document.getElementById("input-size").textContent = `${byteLength} bytes originais`;
  });

  document.getElementById("generate-button").addEventListener("click", async () => {
    const content = contentInput.value.trim();
    if (!content) {
      setMessage(generatorMessage, "Informe um link ou texto antes de gerar.", "error");
      return;
    }

    try {
      const encoded = prepareEncodedBits(content);
      drawCircularCode(canvas, encoded);
      generatedBlob = await canvasToBlob(canvas);
      document.getElementById("canvas-placeholder").classList.add("hidden");
      downloadButton.disabled = false;
      shareButton.disabled = false;
      document.getElementById("capacity-info").textContent =
        `${encoded.payloadLength}/${MAX_PAYLOAD_BYTES} bytes compactados`;
      const mode = encoded.compressionEnabled ? "compactação Huffman ativa" : "armazenamento UTF-8 direto";
      setMessage(
        generatorMessage,
        `Código criado: ${encoded.originalLength} bytes originais, ${encoded.payloadLength} bytes no payload; ${mode}.`,
        "success"
      );
    } catch (error) {
      generatedBlob = null;
      downloadButton.disabled = true;
      shareButton.disabled = true;
      setMessage(generatorMessage, error.message, "error");
    }
  });

  downloadButton.addEventListener("click", () => {
    if (generatedBlob) triggerDownload(generatedBlob, safeFileName());
  });

  shareButton.addEventListener("click", async () => {
    if (!generatedBlob) return;
    const fileName = safeFileName();
    const file = new File([generatedBlob], fileName, { type: "image/png" });

    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Código circular",
          text: "Código circular gerado no navegador.",
          files: [file],
        });
      } else {
        triggerDownload(generatedBlob, fileName);
        setMessage(
          generatorMessage,
          "O compartilhamento direto não está disponível neste navegador; o PNG foi baixado.",
          "warning"
        );
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        setMessage(generatorMessage, "Não foi possível compartilhar o arquivo.", "error");
      }
    }
  });

  document.getElementById("camera-tab").addEventListener("click", () => switchReaderMode("camera"));
  document.getElementById("gallery-tab").addEventListener("click", () => switchReaderMode("gallery"));
  document.getElementById("start-camera-button").addEventListener("click", startCamera);
  document.getElementById("stop-camera-button").addEventListener("click", stopCamera);
  document.getElementById("scan-camera-button").addEventListener("click", () => {
    scanCameraFrame({ silent: false, manual: true });
  });
  document.getElementById("auto-scan").addEventListener("change", updateAutoScan);
  document.getElementById("torch-button").addEventListener("click", () => setTorch(!torchEnabled));
  document.getElementById("camera-zoom").addEventListener("input", async (event) => {
    const value = Number(event.target.value);
    document.getElementById("camera-zoom-value").value =
      `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`;
    if (!cameraTrack) return;
    try {
      await cameraTrack.applyConstraints({ advanced: [{ zoom: value }] });
    } catch {
      setMessage(document.getElementById("decoder-message"), "O zoom não pôde ser alterado.", "warning");
    }
  });
  document.getElementById("gallery-input").addEventListener("change", (event) => {
    handleGalleryFile(event.target.files?.[0]);
  });

  document.getElementById("copy-result-button").addEventListener("click", async () => {
    const content = document.getElementById("decoded-content").textContent;
    try {
      await navigator.clipboard.writeText(content);
      setMessage(document.getElementById("decoder-message"), "Conteúdo copiado.", "success");
    } catch {
      setMessage(document.getElementById("decoder-message"), "Não foi possível copiar automaticamente.", "error");
    }
  });

  window.addEventListener("beforeunload", stopCamera);
  document.getElementById("capacity-info").textContent =
    `Até ${MAX_PAYLOAD_BYTES} bytes após compactação`;
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initializeInterface);
}

// Exportação opcional para testes do núcleo em Node.js.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONFIG,
    createPacket,
    decodePacket,
    prepareEncodedBits,
    bytesToBits,
    bitsToBytes,
    applyMask,
    PARTITIONS_PER_RING,
    MAX_PAYLOAD_BYTES,
  };
}
