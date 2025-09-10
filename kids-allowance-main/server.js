import express from "express";
import cors from "cors";
import multer from "multer";
import pdf from "pdf-parse";
import { fromBuffer } from "pdf2pic";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import path from "path";
import { fileURLToPath } from "url";
import { diffLines } from "diff"; // ★ defaultではなく名前付き

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// 同一オリジン配信（static）だが、将来CORSに切り替える可能性もあるので残す
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB/ファイル
});

// ---- PDFユーティリティ ----
async function getPageCount(pdfBuffer) {
  const data = await pdf(pdfBuffer);
  return data.numpages || 0;
}

function normalizeText(raw) {
  return raw.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

async function extractTextLines(pdfBuffer) {
  const { text } = await pdf(pdfBuffer);
  const norm = normalizeText(text);
  return norm.split(/\n+/);
}

async function pdfToPngBuffer(pdfBuffer, pageNumber = 1, opts = {}) {
  // Windows では ImageMagick/GraphicsMagick + Ghostscript が必要になる場合があります
  const convert = fromBuffer(pdfBuffer, {
    density: 150,
    format: "png",
    width: 1200,
    ...(opts || {})
  });
  const result = await convert(pageNumber);
  return result.buffer; // Node Buffer
}

function toDataUrlFromPngBuffer(buf) {
  const b64 = buf.toString("base64");
  return `data:image/png;base64,${b64}`;
}

function pngFromBuffer(buf) {
  return PNG.sync.read(buf);
}

function pngToBuffer(png) {
  return PNG.sync.write(png);
}

function makeBlankPng(width, height) {
  return new PNG({ width, height });
}

// ---- ルータ ----
app.post(
  "/api/compare",
  upload.fields([{ name: "before" }, { name: "after" }]),
  async (req, res) => {
    try {
      const beforeFile = req.files?.before?.[0];
      const afterFile = req.files?.after?.[0];
      if (!beforeFile || !afterFile) {
        return res
          .status(400)
          .json({ error: "both 'before' and 'after' PDF files are required." });
      }

      const beforeBuf = beforeFile.buffer;
      const afterBuf = afterFile.buffer;

      const beforePages = await getPageCount(beforeBuf);
      const afterPages = await getPageCount(afterBuf);

      if (beforePages === 0 || afterPages === 0) {
        return res.status(400).json({ error: "invalid PDF or zero page." });
      }

      const pagesToCompare = Math.min(beforePages, afterPages);

      const pages = [];
      for (let i = 1; i <= pagesToCompare; i++) {
        // PNG化（同条件で生成）
        const [bPngBuf, aPngBuf] = await Promise.all([
          pdfToPngBuffer(beforeBuf, i),
          pdfToPngBuffer(afterBuf, i)
        ]);

        // pixelmatch のために PNG 読み込み
        let bPNG = pngFromBuffer(bPngBuf);
        let aPNG = pngFromBuffer(aPngBuf);

        // サイズ不一致なら小さい方に合わせる（bitbltでキャンバス合わせ）
        const width = Math.min(bPNG.width, aPNG.width);
        const height = Math.min(bPNG.height, aPNG.height);

        if (bPNG.width !== width || bPNG.height !== height) {
          const bResized = makeBlankPng(width, height);
          PNG.bitblt(bPNG, bResized, 0, 0, width, height, 0, 0);
          bPNG = bResized;
        }
        if (aPNG.width !== width || aPNG.height !== height) {
          const aResized = makeBlankPng(width, height);
          PNG.bitblt(aPNG, aResized, 0, 0, width, height, 0, 0);
          aPNG = aResized;
        }

        const diffPNG = makeBlankPng(width, height);
        // 感度は threshold で調整（0.05〜0.3あたり）
        const diffPixels = pixelmatch(
          bPNG.data,
          aPNG.data,
          diffPNG.data,
          width,
          height,
          {
            threshold: 0.1,
            includeAA: true
          }
        );

        pages.push({
          index: i,
          before: toDataUrlFromPngBuffer(pngToBuffer(bPNG)),
          after: toDataUrlFromPngBuffer(pngToBuffer(aPNG)),
          diff: toDataUrlFromPngBuffer(pngToBuffer(diffPNG)),
          diffPixels
        });
      }

      // テキスト差分（全文）
      const [beforeLines, afterLines] = await Promise.all([
        extractTextLines(beforeBuf),
        extractTextLines(afterBuf)
      ]);
      const textDiff = diffLines(
        beforeLines.join("\n"),
        afterLines.join("\n")
      );

      res.json({
        pageCount: pagesToCompare,
        pages,
        textDiff
      });
    } catch (err) {
      console.error(err);
      // pdf2pic が ImageMagick/GS 未導入で失敗したケースのヒントを追加
      res.status(500).json({
        error:
          err?.message ||
          String(err),
        hint:
          "On Windows, installing ImageMagick (or GraphicsMagick) and Ghostscript, and ensuring they are on PATH, may be required for pdf2pic."
      });
    }
  }
);

const PORT = process.env.PORT || 5173;
app.listen(PORT, () => {
  console.log(`PDF diff webapp listening at http://localhost:${PORT}`);
});
