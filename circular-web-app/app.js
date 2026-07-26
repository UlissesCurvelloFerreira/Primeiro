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
  analysisSize: 900,
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
  const markerSize = 16 * scale;
  const half = markerSize / 2;
  const stroke = Math.max(5, 0.85 * scale);

  context.save();
  context.strokeStyle = CONFIG.bit1Color;
  context.fillStyle = CONFIG.bit1Color;
  context.lineWidth = stroke;
  context.lineCap = "round";
  context.lineJoin = "round";

  context.strokeRect(centerX - half, centerY - half, markerSize, markerSize);

  const crossHalf = markerSize * 0.24;
  context.beginPath();
  context.moveTo(centerX - crossHalf, centerY);
  context.lineTo(centerX + crossHalf, centerY);
  context.moveTo(centerX, centerY - crossHalf);
  context.lineTo(centerX, centerY + crossHalf);
  context.stroke();

  // Ponto assimétrico: indica orientação e elimina ambiguidade visual de 90°.
  const dotRadius = markerSize * 0.075;
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
  const initialX = width / 2;
  const initialY = height / 2;
  const halfRegion = Math.floor(Math.min(width, height) * 0.18);
  let brightCount = 0;
  let markerMinX = Infinity;
  let markerMaxX = -Infinity;
  let markerMinY = Infinity;
  let markerMaxY = -Infinity;

  const minX = Math.max(0, Math.floor(initialX - halfRegion));
  const maxX = Math.min(width - 1, Math.ceil(initialX + halfRegion));
  const minY = Math.max(0, Math.floor(initialY - halfRegion));
  const maxY = Math.min(height - 1, Math.ceil(initialY + halfRegion));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (gray[y * width + x] > threshold) {
        brightCount += 1;
        markerMinX = Math.min(markerMinX, x);
        markerMaxX = Math.max(markerMaxX, x);
        markerMinY = Math.min(markerMinY, y);
        markerMaxY = Math.max(markerMaxY, y);
      }
    }
  }

  if (brightCount < 40 || !Number.isFinite(markerMinX)) {
    return { x: initialX, y: initialY };
  }

  // O ponto assimétrico altera o centro de massa, mas não altera a moldura
  // quadrada. Por isso usamos o centro da caixa delimitadora do marcador.
  const detectedX = (markerMinX + markerMaxX) / 2;
  const detectedY = (markerMinY + markerMaxY) / 2;
  const maxShift = Math.min(width, height) * 0.09;

  if (Math.hypot(detectedX - initialX, detectedY - initialY) > maxShift) {
    return { x: initialX, y: initialY };
  }

  return { x: detectedX, y: detectedY };
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

function findRotationCandidates(gray, width, height, center, scale) {
  const rawCandidates = [];

  for (const direction of [1, -1]) {
    for (let rotation = 0; rotation < 360; rotation += 0.5) {
      rawCandidates.push({
        rotation,
        direction,
        score: scoreRotation(gray, width, height, center, scale, rotation, direction),
      });
    }
  }

  rawCandidates.sort((a, b) => b.score - a.score);
  const selected = [];

  for (const candidate of rawCandidates) {
    const isNearExisting = selected.some((existing) => (
      existing.direction === candidate.direction &&
      Math.min(
        Math.abs(existing.rotation - candidate.rotation),
        360 - Math.abs(existing.rotation - candidate.rotation)
      ) < 2.2
    ));
    if (!isNearExisting) selected.push(candidate);
    if (selected.length >= 8) break;
  }

  const refined = selected.map((candidate) => {
    let best = candidate;
    for (let offset = -1; offset <= 1.0001; offset += 0.05) {
      const rotation = (candidate.rotation + offset + 360) % 360;
      const score = scoreRotation(
        gray, width, height, center, scale, rotation, candidate.direction
      );
      if (score > best.score) best = { rotation, direction: candidate.direction, score };
    }
    return best;
  });

  refined.sort((a, b) => b.score - a.score);
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

function decodeImageData(imageData) {
  const gray = imageDataToGray(imageData);
  const threshold = otsuThreshold(gray);
  const center = estimateMarkerCenter(gray, imageData.width, imageData.height, threshold);
  const profile = buildRadialProfile(gray, imageData.width, imageData.height, center, threshold);
  const scaleEstimate = estimateScale(profile);
  const scaleMultipliers = [1, 0.996, 1.004, 0.99, 1.01];
  let lastError = null;

  for (const multiplier of scaleMultipliers) {
    const scale = scaleEstimate.scale * multiplier;
    let candidates;
    try {
      candidates = findRotationCandidates(
        gray, imageData.width, imageData.height, center, scale
      );
    } catch (error) {
      lastError = error;
      continue;
    }

    for (const candidate of candidates) {
      try {
        return {
          content: decodeWithGeometry(
            gray, imageData.width, imageData.height, center, scale, candidate
          ),
          diagnostics: {
            center,
            scale,
            rotation: candidate.rotation,
            direction: candidate.direction,
            rotationScore: candidate.score,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError ?? new Error("Não foi possível recuperar o conteúdo desta imagem.");
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
let autoScanTimer = null;
let decodingInProgress = false;

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `message${type ? ` ${type}` : ""}`;
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

async function processImageData(imageData, sourceLabel) {
  if (decodingInProgress) return;
  decodingInProgress = true;
  const decoderMessage = document.getElementById("decoder-message");
  setMessage(decoderMessage, `Analisando ${sourceLabel}...`);

  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const result = decodeImageData(imageData);
    showDecodedResult(result.content);
    setMessage(decoderMessage, "Código lido e validado pelo CRC32.", "success");
  } catch (error) {
    setMessage(
      decoderMessage,
      `${error.message} O código deve ocupar a maior parte do enquadramento e estar o mais plano possível.`,
      "error"
    );
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
}

async function startCamera() {
  const decoderMessage = document.getElementById("decoder-message");
  const video = document.getElementById("camera-video");

  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage(decoderMessage, "Este navegador não oferece acesso à câmera.", "error");
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    video.srcObject = cameraStream;
    await video.play();
    document.getElementById("camera-empty").classList.add("hidden");
    document.getElementById("start-camera-button").disabled = true;
    document.getElementById("scan-camera-button").disabled = false;
    document.getElementById("stop-camera-button").disabled = false;
    setMessage(decoderMessage, "Câmera ativa. Alinhe os anéis ao guia e mantenha o marcador no centro.");
    updateAutoScan();
  } catch (error) {
    setMessage(
      decoderMessage,
      "Não foi possível acessar a câmera. Verifique a permissão e abra a página em localhost ou HTTPS.",
      "error"
    );
  }
}

function stopCamera() {
  if (autoScanTimer) {
    clearInterval(autoScanTimer);
    autoScanTimer = null;
  }
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }

  const video = document.getElementById("camera-video");
  video.srcObject = null;
  document.getElementById("camera-empty").classList.remove("hidden");
  document.getElementById("start-camera-button").disabled = false;
  document.getElementById("scan-camera-button").disabled = true;
  document.getElementById("stop-camera-button").disabled = true;
}

async function scanCameraFrame(silentFailure = false) {
  const video = document.getElementById("camera-video");
  if (!cameraStream || video.readyState < 2 || decodingInProgress) return;

  try {
    const imageData = drawSourceToAnalysisCanvas(video, video.videoWidth, video.videoHeight);
    await processImageData(imageData, "a imagem da câmera");
    if (autoScanTimer) {
      clearInterval(autoScanTimer);
      autoScanTimer = null;
    }
  } catch (error) {
    if (silentFailure) {
      setMessage(
        document.getElementById("decoder-message"),
        "Procurando o código... aproxime, centralize e reduza reflexos.",
        "warning"
      );
    }
  }
}

function updateAutoScan() {
  const enabled = document.getElementById("auto-scan").checked;
  if (autoScanTimer) {
    clearInterval(autoScanTimer);
    autoScanTimer = null;
  }
  if (enabled && cameraStream) {
    autoScanTimer = setInterval(() => scanCameraFrame(true), 1300);
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
    await processImageData(imageData, "a imagem selecionada");
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
  document.getElementById("scan-camera-button").addEventListener("click", () => scanCameraFrame(false));
  document.getElementById("auto-scan").addEventListener("change", updateAutoScan);
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
