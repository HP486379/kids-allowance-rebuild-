const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

// 静的ファイル (public フォルダ)
app.use(express.static(path.join(__dirname, "public")));

// API の例
app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from Kids Allowance Rebuild API!" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
