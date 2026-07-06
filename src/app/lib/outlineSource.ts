export type OutlineSourceFormat = "html" | "pdf" | "text";

export interface OutlineSource {
  outlineName: string;
  format: OutlineSourceFormat;
  content: string;
}

const TEXT_FILE_EXTENSIONS = /\.(?:txt|text|md|markdown|csv)$/i;
const HTML_FILE_EXTENSIONS = /\.html?$/i;
const PDF_FILE_EXTENSION = /\.pdf$/i;

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bytesToBinaryString(bytes: Uint8Array) {
  const chunkSize = 8192;
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return chunks.join("");
}

function binaryStringToBytes(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

async function inflatePdfStream(bytes: Uint8Array) {
  const DecompressionStreamCtor = globalThis.DecompressionStream;
  if (!DecompressionStreamCtor) return undefined;

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(
      new DecompressionStreamCtor("deflate")
    );
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

function decodePdfLiteralString(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = value[index + 1];
    if (!next) break;
    index += 1;

    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "(" || next === ")" || next === "\\") output += next;
    else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let count = 0; count < 2 && /[0-7]/.test(value[index + 1] ?? ""); count += 1) {
        index += 1;
        octal += value[index];
      }
      output += String.fromCharCode(Number.parseInt(octal, 8));
    } else if (next === "\r" && value[index + 1] === "\n") {
      index += 1;
    } else if (next !== "\n" && next !== "\r") {
      output += next;
    }
  }
  return output;
}

function decodePdfHexString(value: string) {
  const cleaned = value.replace(/[^0-9a-f]/gi, "");
  if (!cleaned) return "";
  const evenHex = cleaned.length % 2 === 0 ? cleaned : `${cleaned}0`;
  const bytes: number[] = [];
  for (let index = 0; index < evenHex.length; index += 2) {
    bytes.push(Number.parseInt(evenHex.slice(index, index + 2), 16));
  }

  const isUtf16Be =
    bytes.length >= 2 &&
    ((bytes[0] === 0xfe && bytes[1] === 0xff) ||
      bytes.filter((byte, index) => index % 2 === 0 && byte === 0).length > bytes.length / 4);

  if (isUtf16Be) {
    const start = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
    let output = "";
    for (let index = start; index + 1 < bytes.length; index += 2) {
      output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return output;
  }

  return String.fromCharCode(...bytes);
}

function readPdfLiteral(source: string, startIndex: number) {
  let depth = 1;
  let value = "";
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      value += char;
      if (index + 1 < source.length) {
        index += 1;
        value += source[index];
      }
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) {
      return {
        value: decodePdfLiteralString(value),
        endIndex: index + 1,
      };
    }
    value += char;
  }
  return undefined;
}

function extractPdfTextStrings(content: string) {
  const blocks = Array.from(content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g), (match) => match[1]);
  const sources = blocks.length > 0 ? blocks : [content];
  const values: string[] = [];

  sources.forEach((source) => {
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === "(") {
        const literal = readPdfLiteral(source, index);
        if (literal) {
          values.push(literal.value);
          index = literal.endIndex - 1;
        }
        continue;
      }
      if (
        char === "<" &&
        source[index + 1] !== "<" &&
        /[0-9a-f\s]/i.test(source[index + 1] ?? "")
      ) {
        const endIndex = source.indexOf(">", index + 1);
        if (endIndex !== -1) {
          values.push(decodePdfHexString(source.slice(index + 1, endIndex)));
          index = endIndex;
        }
      }
    }
  });

  return normalizeExtractedText(values.join(" "));
}

function extractPdfStreams(binary: string) {
  const streams: Array<{ dictionary: string; data: Uint8Array }> = [];
  let searchIndex = 0;

  while (searchIndex < binary.length) {
    const streamKeywordIndex = binary.indexOf("stream", searchIndex);
    if (streamKeywordIndex === -1) break;

    let dataStart = streamKeywordIndex + "stream".length;
    if (binary[dataStart] === "\r" && binary[dataStart + 1] === "\n") dataStart += 2;
    else if (binary[dataStart] === "\n" || binary[dataStart] === "\r") dataStart += 1;

    const dataEnd = binary.indexOf("endstream", dataStart);
    if (dataEnd === -1) break;

    const dictionaryStart = Math.max(0, binary.lastIndexOf("<<", streamKeywordIndex));
    const dictionary =
      dictionaryStart === -1 ? "" : binary.slice(dictionaryStart, streamKeywordIndex);
    streams.push({
      dictionary,
      data: binaryStringToBytes(binary.slice(dataStart, dataEnd).replace(/[\r\n]+$/g, "")),
    });
    searchIndex = dataEnd + "endstream".length;
  }

  return streams;
}

export async function extractPdfText(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const binary = bytesToBinaryString(bytes);
  const streams = extractPdfStreams(binary);
  const extractedParts: string[] = [];

  for (const stream of streams) {
    const isFlate = /\/Filter\s*(?:\[[^\]]*)?\/FlateDecode\b/.test(stream.dictionary);
    const decodedBytes = isFlate ? await inflatePdfStream(stream.data) : stream.data;
    if (!decodedBytes) continue;

    const streamText = bytesToBinaryString(decodedBytes);
    const extracted = extractPdfTextStrings(streamText);
    if (extracted) extractedParts.push(extracted);
  }

  const fallbackText = extractPdfTextStrings(binary);
  const text = normalizeExtractedText([...extractedParts, fallbackText].join("\n\n"));
  if (text.length < 20) {
    throw new Error(
      "Could not extract readable text from this PDF. Try exporting the outline as HTML or text."
    );
  }
  return text;
}

export function isSupportedOutlineFile(file: File) {
  return (
    HTML_FILE_EXTENSIONS.test(file.name) ||
    PDF_FILE_EXTENSION.test(file.name) ||
    TEXT_FILE_EXTENSIONS.test(file.name) ||
    /^text\//i.test(file.type) ||
    file.type === "application/pdf"
  );
}

export async function readOutlineSource(file: File): Promise<OutlineSource> {
  if (HTML_FILE_EXTENSIONS.test(file.name) || file.type === "text/html") {
    return {
      outlineName: file.name,
      format: "html",
      content: await file.text(),
    };
  }

  if (PDF_FILE_EXTENSION.test(file.name) || file.type === "application/pdf") {
    return {
      outlineName: file.name,
      format: "pdf",
      content: await extractPdfText(file),
    };
  }

  return {
    outlineName: file.name,
    format: "text",
    content: await file.text(),
  };
}
